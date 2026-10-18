ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'courier',
  ADD COLUMN IF NOT EXISTS locker_location_id uuid REFERENCES public.locker_locations(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_delivery_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_method_check
  CHECK (delivery_method IN ('courier', 'pickup', 'locker'));

CREATE OR REPLACE FUNCTION public.generate_handoff_pin(
  p_locker_location_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_window_hours integer DEFAULT 48
)
RETURNS TABLE(handoff_id uuid, pin_code text, locker_name text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pin text;
  v_user_id uuid := auth.uid();
  v_exists boolean;
  v_locker locker_locations%ROWTYPE;
  v_expiry timestamptz;
  v_handoff_id uuid;
  v_existing locker_handoffs%ROWTYPE;
  v_order orders%ROWTYPE;
  v_expired_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User authentication required.';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'You cannot create a handoff for another user.';
  END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 48 THEN
    RAISE EXCEPTION 'Handoff windows must be between 1 and 48 hours.';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.buyer_id <> v_user_id
      OR v_order.status <> 'escrow_held'
      OR v_order.delivery_method <> 'locker'
      OR v_order.locker_location_id <> p_locker_location_id THEN
      RAISE EXCEPTION 'This order is not eligible for this locker handoff.';
    END IF;

    SELECT * INTO v_existing
    FROM locker_handoffs
    WHERE order_id = p_order_id
      AND status IN ('PENDING', 'DROPPED_OFF')
      AND drop_off_window_end >= now();
    IF FOUND THEN
      SELECT partner_name INTO v_locker.partner_name
      FROM locker_locations WHERE id = v_existing.locker_location_id;
      RETURN QUERY SELECT v_existing.id, v_existing.pin_code, v_locker.partner_name, v_existing.drop_off_window_end;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_locker
  FROM locker_locations
  WHERE id = p_locker_location_id AND is_active = true
  FOR UPDATE;
  IF v_locker.id IS NULL THEN
    RAISE EXCEPTION 'Locker location not found or inactive.';
  END IF;
  UPDATE locker_handoffs
  SET status = 'EXPIRED'
  WHERE locker_location_id = p_locker_location_id
    AND status IN ('PENDING', 'DROPPED_OFF')
    AND drop_off_window_end < now();
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  IF v_expired_count > 0 THEN
    UPDATE locker_locations
    SET capacity_available = LEAST(capacity_total, capacity_available + v_expired_count)
    WHERE id = p_locker_location_id;
    SELECT * INTO v_locker FROM locker_locations WHERE id = p_locker_location_id;
  END IF;
  IF v_locker.capacity_available <= 0 THEN
    RAISE EXCEPTION 'No available compartments at this locker location.';
  END IF;

  LOOP
    v_pin := lpad(floor(random() * 1000000)::text, 6, '0');
    SELECT EXISTS (
      SELECT 1 FROM locker_handoffs
      WHERE locker_location_id = p_locker_location_id
        AND pin_code = v_pin
        AND status IN ('PENDING', 'DROPPED_OFF')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  v_expiry := now() + (p_window_hours || ' hours')::interval;
  INSERT INTO locker_handoffs (
    locker_location_id, order_id, user_id, pin_code, status,
    drop_off_window_start, drop_off_window_end
  )
  VALUES (p_locker_location_id, p_order_id, v_user_id, v_pin, 'PENDING', now(), v_expiry)
  RETURNING id INTO v_handoff_id;

  UPDATE locker_locations
  SET capacity_available = capacity_available - 1
  WHERE id = p_locker_location_id;

  RETURN QUERY SELECT v_handoff_id, v_pin, v_locker.partner_name, v_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_handoff_pin(uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_handoff_pin(uuid, uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.checkout_fixed_items_with_fulfillment(
  p_items jsonb,
  p_shipping_address text,
  p_voucher_code text DEFAULT NULL,
  p_delivery_method text DEFAULT 'courier',
  p_locker_location_id uuid DEFAULT NULL
)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_ids uuid[];
  v_discount numeric;
  v_order_id uuid;
  v_available integer;
  v_expired_count integer;
BEGIN
  IF p_delivery_method IS NULL OR p_delivery_method NOT IN ('courier', 'pickup', 'locker') THEN
    RAISE EXCEPTION 'Choose a valid delivery method.';
  END IF;
  IF (p_delivery_method = 'locker') <> (p_locker_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose a locker only when using locker pickup.';
  END IF;
  IF p_delivery_method = 'locker' AND (
    p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
  ) THEN
    RAISE EXCEPTION 'The cart is empty or invalid.';
  END IF;
  IF p_delivery_method = 'locker'
    AND (jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50) THEN
    RAISE EXCEPTION 'The cart is empty or invalid.';
  END IF;

  IF p_delivery_method = 'locker' THEN
    SELECT capacity_available INTO v_available
    FROM locker_locations
    WHERE id = p_locker_location_id AND is_active = true
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Locker location not found or inactive.';
    END IF;
    UPDATE locker_handoffs
    SET status = 'EXPIRED'
    WHERE locker_location_id = p_locker_location_id
      AND status IN ('PENDING', 'DROPPED_OFF')
      AND drop_off_window_end < now();
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    IF v_expired_count > 0 THEN
      UPDATE locker_locations
      SET capacity_available = LEAST(capacity_total, capacity_available + v_expired_count)
      WHERE id = p_locker_location_id;
      SELECT capacity_available INTO v_available
      FROM locker_locations WHERE id = p_locker_location_id;
    END IF;
    IF v_available < jsonb_array_length(p_items) THEN
      RAISE EXCEPTION 'This locker does not have enough compartments for your cart.';
    END IF;
  END IF;

  SELECT result.order_ids, result.discount_amount
  INTO v_order_ids, v_discount
  FROM public.checkout_fixed_items(p_items, p_shipping_address, p_voucher_code) AS result;

  UPDATE orders
  SET delivery_method = p_delivery_method,
      locker_location_id = CASE WHEN p_delivery_method = 'locker' THEN p_locker_location_id ELSE NULL END
  WHERE id = ANY(v_order_ids);

  IF p_delivery_method = 'locker' THEN
    FOREACH v_order_id IN ARRAY v_order_ids
    LOOP
      PERFORM * FROM public.generate_handoff_pin(p_locker_location_id, v_order_id, NULL, 48);
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_order_ids, v_discount;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_fixed_items_with_fulfillment(jsonb, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_fixed_items_with_fulfillment(jsonb, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_dropped_off(p_handoff_id uuid, p_pin_code text)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handoff locker_handoffs%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Authentication required.';
    RETURN;
  END IF;

  SELECT * INTO v_handoff FROM locker_handoffs WHERE id = p_handoff_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Handoff record not found.';
    RETURN;
  END IF;
  IF p_pin_code IS NULL OR p_pin_code !~ '^[0-9]{6}$' OR v_handoff.pin_code <> p_pin_code THEN
    RETURN QUERY SELECT false, 'Invalid PIN code.';
    RETURN;
  END IF;
  IF v_handoff.order_id IS NULL THEN
    IF v_handoff.user_id <> v_user_id THEN
      RETURN QUERY SELECT false, 'Not authorized to confirm this handoff.';
      RETURN;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM orders AS order_row
    JOIN boutiques AS boutique ON boutique.id = order_row.boutique_id
    WHERE order_row.id = v_handoff.order_id
      AND order_row.delivery_method = 'locker'
      AND order_row.status = 'escrow_held'
      AND boutique.seller_id = v_user_id
  ) THEN
    RETURN QUERY SELECT false, 'Only the order seller can record locker drop-off.';
    RETURN;
  END IF;
  IF v_handoff.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'Handoff is not in pending state.';
    RETURN;
  END IF;
  IF v_handoff.drop_off_window_end IS NULL OR v_handoff.drop_off_window_end < now() THEN
    UPDATE locker_handoffs SET status = 'EXPIRED' WHERE id = v_handoff.id;
    UPDATE locker_locations SET capacity_available = capacity_available + 1
    WHERE id = v_handoff.locker_location_id;
    RETURN QUERY SELECT false, 'The handoff window has expired.';
    RETURN;
  END IF;

  UPDATE locker_handoffs
  SET status = 'DROPPED_OFF', dropped_off_at = now()
  WHERE id = v_handoff.id;
  IF v_handoff.order_id IS NOT NULL THEN
    UPDATE orders SET status = 'shipped'
    WHERE id = v_handoff.order_id AND status = 'escrow_held';
  END IF;
  RETURN QUERY SELECT true, 'Item marked as dropped off.';
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_handoff_pickup(
  p_handoff_id uuid,
  p_pin_code text,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handoff locker_handoffs%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR (p_user_id IS NOT NULL AND p_user_id <> v_user_id) THEN
    RETURN QUERY SELECT false, 'Authentication required.';
    RETURN;
  END IF;

  SELECT * INTO v_handoff FROM locker_handoffs WHERE id = p_handoff_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Handoff record not found.';
    RETURN;
  END IF;
  IF v_handoff.user_id <> v_user_id THEN
    RETURN QUERY SELECT false, 'Not authorized to confirm this handoff.';
    RETURN;
  END IF;
  IF v_handoff.order_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'Use the order pickup confirmation for this handoff.';
    RETURN;
  END IF;
  IF p_pin_code IS NULL OR p_pin_code !~ '^[0-9]{6}$' OR v_handoff.pin_code <> p_pin_code THEN
    RETURN QUERY SELECT false, 'Invalid PIN code.';
    RETURN;
  END IF;
  IF v_handoff.status <> 'DROPPED_OFF' THEN
    RETURN QUERY SELECT false, 'The item has not been marked as dropped off.';
    RETURN;
  END IF;
  IF v_handoff.drop_off_window_end IS NULL OR v_handoff.drop_off_window_end < now() THEN
    UPDATE locker_handoffs SET status = 'EXPIRED' WHERE id = p_handoff_id;
    UPDATE locker_locations SET capacity_available = capacity_available + 1
    WHERE id = v_handoff.locker_location_id;
    RETURN QUERY SELECT false, 'This handoff window has expired.';
    RETURN;
  END IF;

  UPDATE locker_handoffs
  SET status = 'PICKED_UP', picked_up_at = now()
  WHERE id = p_handoff_id;
  UPDATE locker_locations
  SET capacity_available = capacity_available + 1
  WHERE id = v_handoff.locker_location_id;
  RETURN QUERY SELECT true, 'Pickup confirmed successfully.';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_shipped(p_order_id uuid, p_tracking_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to update this order.';
  END IF;
  IF p_tracking_number IS NULL OR length(btrim(p_tracking_number)) = 0 OR length(btrim(p_tracking_number)) > 200 THEN
    RAISE EXCEPTION 'Enter a tracking number of 1 to 200 characters.';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM boutiques AS boutique
    WHERE boutique.id = v_order.boutique_id AND boutique.seller_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only this order''s seller can mark it shipped.';
  END IF;
  IF v_order.status <> 'escrow_held' THEN
    RAISE EXCEPTION 'Only orders in escrow can be marked shipped.';
  END IF;
  IF v_order.delivery_method = 'locker' THEN
    RAISE EXCEPTION 'Use the locker drop-off action for locker orders.';
  END IF;

  UPDATE orders SET status = 'shipped', tracking_number = btrim(p_tracking_number)
  WHERE id = v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_locker_dropped_off(p_order_id uuid, p_pin_code text)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_handoff locker_handoffs%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to update this order.';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM boutiques
    WHERE id = v_order.boutique_id AND seller_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only this order''s seller can record locker drop-off.';
  END IF;
  IF v_order.delivery_method <> 'locker' OR v_order.status <> 'escrow_held' THEN
    RAISE EXCEPTION 'This order is not waiting for locker drop-off.';
  END IF;

  SELECT * INTO v_handoff
  FROM locker_handoffs
  WHERE order_id = v_order.id
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.status <> 'PENDING' THEN
    RAISE EXCEPTION 'No pending locker handoff exists for this order.';
  END IF;
  IF v_handoff.drop_off_window_end IS NULL OR v_handoff.drop_off_window_end < now() THEN
    UPDATE locker_handoffs SET status = 'EXPIRED' WHERE id = v_handoff.id;
    UPDATE locker_locations SET capacity_available = capacity_available + 1
    WHERE id = v_handoff.locker_location_id;
    RETURN QUERY SELECT false, 'The locker PIN has expired. Contact the buyer to arrange another handoff.';
    RETURN;
  END IF;
  IF p_pin_code IS NULL OR p_pin_code !~ '^[0-9]{6}$' OR v_handoff.pin_code <> p_pin_code THEN
    RAISE EXCEPTION 'The PIN does not match this order.';
  END IF;

  UPDATE locker_handoffs SET status = 'DROPPED_OFF', dropped_off_at = now()
  WHERE id = v_handoff.id;
  UPDATE orders SET status = 'shipped' WHERE id = v_order.id;
  RETURN QUERY SELECT true, 'Locker drop-off recorded successfully.';
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_delivered(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm delivery.';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_order.buyer_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the buyer can confirm delivery.';
  END IF;
  IF v_order.delivery_method = 'locker' THEN
    RAISE EXCEPTION 'Confirm locker pickup with your handoff PIN.';
  END IF;
  IF v_order.status <> 'shipped' THEN
    RAISE EXCEPTION 'Only shipped orders can be marked delivered.';
  END IF;

  UPDATE orders SET status = 'delivered' WHERE id = v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_locker_pickup(p_order_id uuid, p_pin_code text)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_handoff locker_handoffs%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm locker pickup.';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the buyer can confirm this order pickup.';
  END IF;
  IF v_order.delivery_method <> 'locker' OR v_order.status <> 'shipped' THEN
    RAISE EXCEPTION 'This order is not ready for locker pickup.';
  END IF;

  SELECT * INTO v_handoff
  FROM locker_handoffs
  WHERE order_id = v_order.id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_handoff.status <> 'DROPPED_OFF' THEN
    RAISE EXCEPTION 'The seller has not recorded the locker drop-off yet.';
  END IF;
  IF v_handoff.drop_off_window_end IS NULL OR v_handoff.drop_off_window_end < now() THEN
    UPDATE locker_handoffs SET status = 'EXPIRED' WHERE id = v_handoff.id;
    UPDATE locker_locations SET capacity_available = capacity_available + 1
    WHERE id = v_handoff.locker_location_id;
    RETURN QUERY SELECT false, 'This handoff PIN has expired. Contact the seller for help.';
    RETURN;
  END IF;
  IF p_pin_code IS NULL OR p_pin_code !~ '^[0-9]{6}$' OR v_handoff.pin_code <> p_pin_code THEN
    RAISE EXCEPTION 'The PIN does not match this order.';
  END IF;

  UPDATE locker_handoffs SET status = 'PICKED_UP', picked_up_at = now()
  WHERE id = v_handoff.id;
  UPDATE locker_locations SET capacity_available = capacity_available + 1
  WHERE id = v_handoff.locker_location_id;
  UPDATE orders SET status = 'delivered' WHERE id = v_order.id;
  RETURN QUERY SELECT true, 'Locker pickup confirmed successfully.';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_locker_dropped_off(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_order_locker_pickup(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_locker_dropped_off(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_locker_pickup(uuid, text) TO authenticated;

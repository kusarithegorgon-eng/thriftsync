ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_status_check;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'reserved', 'sold', 'exchanged', 'draft'));

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS reserved_by_checkout_id uuid,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS listings_reserved_by_checkout_id_idx
  ON public.listings (reserved_by_checkout_id)
  WHERE reserved_by_checkout_id IS NOT NULL;

ALTER TABLE public.paymongo_checkouts
  ALTER COLUMN checkout_session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '20 minutes');

ALTER TABLE public.paymongo_checkouts
  DROP CONSTRAINT IF EXISTS paymongo_checkouts_status_check;

ALTER TABLE public.paymongo_checkouts
  ADD CONSTRAINT paymongo_checkouts_status_check
  CHECK (status IN ('pending', 'paid', 'fulfilled', 'failed', 'expired'));

CREATE INDEX IF NOT EXISTS paymongo_checkouts_pending_expiry_idx
  ON public.paymongo_checkouts (expires_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.prevent_checkout_reservation_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'reserved'
    AND (NEW.reserved_by_checkout_id IS NULL OR NEW.reservation_expires_at IS NULL) THEN
    RAISE EXCEPTION 'A listing reservation must be tied to a checkout and expiry.';
  END IF;
  IF NEW.status <> 'reserved'
    AND (NEW.reserved_by_checkout_id IS NOT NULL OR NEW.reservation_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only reserved listings may retain checkout reservation details.';
  END IF;

  IF OLD.reserved_by_checkout_id IS NOT NULL
    AND current_setting('app.checkout_reservation_id', true)
      IS DISTINCT FROM OLD.reserved_by_checkout_id::text
    AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.reserved_by_checkout_id IS DISTINCT FROM OLD.reserved_by_checkout_id
      OR NEW.reservation_expires_at IS DISTINCT FROM OLD.reservation_expires_at
    ) THEN
    RAISE EXCEPTION 'This listing is temporarily reserved for checkout.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_checkout_reservation_tampering ON public.listings;
CREATE TRIGGER prevent_checkout_reservation_tampering
  BEFORE UPDATE OF status, reserved_by_checkout_id, reservation_expires_at
  ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_checkout_reservation_tampering();

CREATE OR REPLACE FUNCTION public.prevent_delete_of_reserved_listing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.reserved_by_checkout_id IS NOT NULL THEN
    RAISE EXCEPTION 'This listing is temporarily reserved for checkout.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_delete_of_reserved_listing ON public.listings;
CREATE TRIGGER prevent_delete_of_reserved_listing
  BEFORE DELETE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_of_reserved_listing();

CREATE OR REPLACE FUNCTION public.prevent_order_for_unavailable_listing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.listings.status%TYPE;
  v_moderation_status public.listings.moderation_status%TYPE;
BEGIN
  SELECT status, moderation_status
  INTO v_status, v_moderation_status
  FROM public.listings
  WHERE id = NEW.listing_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'active' OR v_moderation_status <> 'approved' THEN
    RAISE EXCEPTION 'One or more order items are no longer available.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_order_for_unavailable_listing ON public.orders;
CREATE TRIGGER prevent_order_for_unavailable_listing
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_for_unavailable_listing();

CREATE OR REPLACE FUNCTION public.reserve_paymongo_checkout(p_checkout_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout public.paymongo_checkouts%ROWTYPE;
  v_item jsonb;
  v_listing public.listings%ROWTYPE;
  v_item_count integer;
  v_unique_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to reserve checkout items.';
  END IF;

  SELECT * INTO v_checkout
  FROM public.paymongo_checkouts
  WHERE id = p_checkout_id AND buyer_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND OR v_checkout.status <> 'pending'
    OR v_checkout.checkout_session_id IS NOT NULL
    OR v_checkout.expires_at <= now() THEN
    RAISE EXCEPTION 'This checkout cannot reserve inventory.';
  END IF;

  IF jsonb_typeof(v_checkout.payload->'items') <> 'array'
    OR jsonb_array_length(v_checkout.payload->'items') < 1
    OR jsonb_array_length(v_checkout.payload->'items') > 50 THEN
    RAISE EXCEPTION 'The cart is empty or invalid.';
  END IF;

  SELECT count(*), count(DISTINCT item->>'listing_id')
  INTO v_item_count, v_unique_count
  FROM jsonb_array_elements(v_checkout.payload->'items') AS row(item);

  IF v_item_count <> v_unique_count THEN
    RAISE EXCEPTION 'A listing appears more than once in the cart.';
  END IF;

  PERFORM 1
  FROM public.listings
  WHERE id IN (
    SELECT (item->>'listing_id')::uuid
    FROM jsonb_array_elements(v_checkout.payload->'items') AS row(item)
  )
  ORDER BY id
  FOR UPDATE;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_checkout.payload->'items')
  LOOP
    SELECT * INTO v_listing
    FROM public.listings
    WHERE id = (v_item->>'listing_id')::uuid;

    IF NOT FOUND
      OR v_listing.status <> 'active'
      OR v_listing.moderation_status <> 'approved'
      OR v_listing.listing_type <> 'fixed' THEN
      RAISE EXCEPTION 'One or more cart items are no longer available.';
    END IF;
    IF (v_item->>'amount')::numeric <> v_listing.price THEN
      RAISE EXCEPTION 'An item price changed. Refresh your cart.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.trade_inventory_locks
      WHERE listing_id = v_listing.id
        AND lock_status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'An item is committed to a barter exchange.';
    END IF;
  END LOOP;

  PERFORM set_config('app.checkout_reservation_id', p_checkout_id::text, true);

  UPDATE public.listings AS listing
  SET status = 'reserved',
      reserved_by_checkout_id = p_checkout_id,
      reservation_expires_at = v_checkout.expires_at
  WHERE listing.id IN (
    SELECT (item->>'listing_id')::uuid
    FROM jsonb_array_elements(v_checkout.payload->'items') AS row(item)
  );

  RETURN v_checkout.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_paymongo_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paymongo_checkout(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.extend_paymongo_checkout_reservation(p_checkout_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz := now() + interval '5 minutes';
BEGIN
  UPDATE public.paymongo_checkouts
  SET expires_at = v_expires_at, updated_at = now()
  WHERE id = p_checkout_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending checkout not found.';
  END IF;

  PERFORM set_config('app.checkout_reservation_id', p_checkout_id::text, true);

  UPDATE public.listings
  SET reservation_expires_at = v_expires_at
  WHERE reserved_by_checkout_id = p_checkout_id AND status = 'reserved';

  RETURN v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_paymongo_checkout_reservation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_paymongo_checkout_reservation(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_paymongo_checkout_reservation(
  p_checkout_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout public.paymongo_checkouts%ROWTYPE;
BEGIN
  IF p_status NOT IN ('failed', 'expired') THEN
    RAISE EXCEPTION 'Invalid checkout release status.';
  END IF;

  SELECT * INTO v_checkout
  FROM public.paymongo_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout not found.';
  END IF;
  IF v_checkout.status IN ('fulfilled', 'paid') THEN
    RAISE EXCEPTION 'A paid checkout cannot release its inventory reservation.';
  END IF;
  IF v_checkout.status IN ('failed', 'expired') THEN
    RETURN;
  END IF;

  PERFORM set_config('app.checkout_reservation_id', p_checkout_id::text, true);

  UPDATE public.listings
  SET status = 'active',
      reserved_by_checkout_id = NULL,
      reservation_expires_at = NULL
  WHERE reserved_by_checkout_id = p_checkout_id
    AND status = 'reserved';

  UPDATE public.paymongo_checkouts
  SET status = p_status, updated_at = now()
  WHERE id = p_checkout_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_paymongo_checkout_reservation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_paymongo_checkout_reservation(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fulfill_paymongo_checkout(p_checkout_id uuid)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout public.paymongo_checkouts%ROWTYPE;
  v_payload jsonb;
  v_order_ids uuid[];
  v_discount numeric;
  v_expected_count integer;
  v_reserved_count integer;
BEGIN
  SELECT * INTO v_checkout
  FROM public.paymongo_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout not found.';
  END IF;
  IF v_checkout.status = 'fulfilled' AND cardinality(v_checkout.order_ids) > 0 THEN
    RETURN QUERY SELECT v_checkout.order_ids, 0::numeric;
    RETURN;
  END IF;
  IF v_checkout.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'This checkout is no longer payable.';
  END IF;

  v_payload := v_checkout.payload;
  SELECT count(*) INTO v_expected_count
  FROM jsonb_array_elements(v_payload->'items');
  PERFORM 1
  FROM public.listings
  WHERE reserved_by_checkout_id = p_checkout_id
  ORDER BY id
  FOR UPDATE;
  SELECT count(*) INTO v_reserved_count
  FROM public.listings
  WHERE reserved_by_checkout_id = p_checkout_id
    AND status = 'reserved';

  IF v_expected_count = 0 OR v_reserved_count <> v_expected_count THEN
    RAISE EXCEPTION 'The checkout inventory reservation is missing or incomplete.';
  END IF;

  PERFORM set_config('app.checkout_reservation_id', p_checkout_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_checkout.buyer_id::text, true);

  UPDATE public.listings
  SET status = 'active',
      reserved_by_checkout_id = NULL,
      reservation_expires_at = NULL
  WHERE reserved_by_checkout_id = p_checkout_id
    AND status = 'reserved';

  SELECT result.order_ids, result.discount_amount
  INTO v_order_ids, v_discount
  FROM public.checkout_fixed_items_with_fulfillment(
    v_payload->'items',
    v_payload->>'shipping_address',
    v_payload->>'voucher_code',
    COALESCE(v_payload->>'delivery_method', 'courier'),
    NULLIF(v_payload->>'locker_location_id', '')::uuid
  ) AS result;

  IF cardinality(v_order_ids) <> v_expected_count THEN
    RAISE EXCEPTION 'PayMongo checkout did not create an order for every reserved item.';
  END IF;

  UPDATE public.orders
  SET payment_method = 'paymongo',
      payment_is_simulated = false
  WHERE id = ANY(v_order_ids)
    AND buyer_id = v_checkout.buyer_id;

  UPDATE public.paymongo_checkouts
  SET status = 'fulfilled',
      order_ids = v_order_ids,
      updated_at = now()
  WHERE id = p_checkout_id;

  RETURN QUERY SELECT v_order_ids, v_discount;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_paymongo_checkout(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_paymongo_checkout(uuid) TO service_role;

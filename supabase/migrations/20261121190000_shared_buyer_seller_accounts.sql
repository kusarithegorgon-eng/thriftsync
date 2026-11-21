CREATE OR REPLACE FUNCTION public.current_user_can_manage_boutique()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.boutiques b ON b.seller_id = p.id
    WHERE p.id = auth.uid()
      AND p.role IN ('buyer', 'seller')
      AND p.account_status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_manage_boutique() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_boutique() TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_list_couriers()
RETURNS TABLE(
  courier_id uuid,
  display_name text,
  account_role text,
  account_status text,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_manage_boutique() THEN
    RAISE EXCEPTION 'An active account with a boutique is required.';
  END IF;

  RETURN QUERY
  SELECT sc.courier_id, p.display_name, p.role, p.account_status, sc.is_active, sc.created_at
  FROM public.seller_couriers sc
  JOIN public.profiles p ON p.id = sc.courier_id
  WHERE sc.seller_id = auth.uid()
  ORDER BY sc.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_link_existing_courier(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_courier_id uuid;
BEGIN
  IF NOT public.current_user_can_manage_boutique() THEN
    RAISE EXCEPTION 'An active account with a boutique is required.';
  END IF;
  IF p_email IS NULL OR length(btrim(p_email)) > 254 THEN
    RAISE EXCEPTION 'Enter the driver account email.';
  END IF;

  SELECT p.id INTO v_courier_id
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(btrim(p_email))
    AND p.role = 'courier'
    AND p.account_status = 'active'
  LIMIT 1;
  IF v_courier_id IS NULL THEN
    RAISE EXCEPTION 'No active courier account was found for that email.';
  END IF;

  INSERT INTO public.seller_couriers (seller_id, courier_id, is_active)
  VALUES (auth.uid(), v_courier_id, true)
  ON CONFLICT (seller_id, courier_id) DO UPDATE SET is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_set_courier_active(p_courier_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_manage_boutique() THEN
    RAISE EXCEPTION 'An active account with a boutique is required.';
  END IF;
  PERFORM 1
  FROM public.seller_couriers
  WHERE seller_id = auth.uid() AND courier_id = p_courier_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This driver is not linked to your account.';
  END IF;
  IF NOT p_is_active AND EXISTS (
    SELECT 1
    FROM public.delivery_jobs j
    JOIN public.orders o ON o.id = j.order_id
    JOIN public.boutiques b ON b.id = o.boutique_id
    WHERE b.seller_id = auth.uid()
      AND j.courier_id = p_courier_id
      AND j.status IN ('assigned', 'accepted', 'picked_up', 'in_transit')
  ) THEN
    RAISE EXCEPTION 'This driver has an active delivery. Reassign or complete it before pausing the account.';
  END IF;

  UPDATE public.seller_couriers
  SET is_active = p_is_active
  WHERE seller_id = auth.uid() AND courier_id = p_courier_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_assign_delivery_courier(
  p_order_id uuid,
  p_courier_id uuid
)
RETURNS TABLE(delivery_job_id uuid, tracking_code text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_job public.delivery_jobs%ROWTYPE;
  v_job_id uuid;
  v_pickup_code text;
  v_delivery_code text;
  v_event text;
BEGIN
  IF NOT public.current_user_can_manage_boutique() THEN
    RAISE EXCEPTION 'An active account with a boutique is required.';
  END IF;
  PERFORM 1
  FROM public.seller_couriers sc
  WHERE sc.seller_id = auth.uid()
    AND sc.courier_id = p_courier_id
    AND sc.is_active = true
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_courier_id AND p.role = 'courier' AND p.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose one of your active driver accounts.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.delivery_method <> 'courier'
    OR v_order.status <> 'escrow_held'
    OR NOT EXISTS (
      SELECT 1 FROM public.boutiques b
      WHERE b.id = v_order.boutique_id AND b.seller_id = auth.uid()
    ) THEN
    RAISE EXCEPTION 'Only your courier orders awaiting pickup can be assigned.';
  END IF;

  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE order_id = p_order_id
  FOR UPDATE;

  v_pickup_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_delivery_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  IF FOUND THEN
    IF v_job.status NOT IN ('assigned', 'accepted', 'cancelled') THEN
      RAISE EXCEPTION 'A driver cannot be changed after pickup.';
    END IF;
    v_job_id := v_job.id;
    v_event := CASE WHEN v_job.status = 'cancelled' THEN 'assigned' ELSE 'reassigned' END;
    UPDATE public.delivery_jobs
    SET courier_id = p_courier_id,
        status = 'assigned',
        accepted_at = NULL,
        created_by = auth.uid(),
        updated_at = now()
    WHERE id = v_job_id;
    INSERT INTO public.delivery_job_secrets (job_id, pickup_code, delivery_code)
    VALUES (v_job_id, v_pickup_code, v_delivery_code)
    ON CONFLICT (job_id) DO UPDATE
      SET pickup_code = EXCLUDED.pickup_code,
          delivery_code = EXCLUDED.delivery_code,
          created_at = now();
  ELSE
    INSERT INTO public.delivery_jobs (order_id, courier_id, created_by)
    VALUES (p_order_id, p_courier_id, auth.uid())
    RETURNING id INTO v_job_id;
    INSERT INTO public.delivery_job_secrets (job_id, pickup_code, delivery_code)
    VALUES (v_job_id, v_pickup_code, v_delivery_code);
    v_event := 'assigned';
  END IF;

  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (
    v_job_id, auth.uid(), v_event,
    CASE WHEN v_event = 'assigned' THEN 'Driver assigned by the seller.'
      ELSE 'Driver assignment changed by the seller.' END
  );

  RETURN QUERY
  SELECT j.id, j.tracking_code, 'Driver assigned. Give them the pickup code in person.'::text
  FROM public.delivery_jobs j
  WHERE j.id = v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;

  RETURN jsonb_build_object(
    'total_accounts', (SELECT count(*) FROM public.profiles),
    'seller_accounts', (SELECT count(DISTINCT seller_id) FROM public.boutiques),
    'moderator_accounts', (SELECT count(*) FROM public.profiles WHERE role = 'moderator'),
    'restricted_accounts', (
      SELECT count(*) FROM public.profiles
      WHERE account_status = 'restricted'
        AND (account_restricted_until IS NULL OR account_restricted_until > now())
    ),
    'suspended_accounts', (SELECT count(*) FROM public.profiles WHERE account_status = 'suspended'),
    'active_listings', (
      SELECT count(*) FROM public.listings
      WHERE status = 'active' AND moderation_status = 'approved'
    ),
    'pending_listings', (
      SELECT count(*) FROM public.listings WHERE moderation_status = 'pending_review'
    ),
    'temporarily_hidden_listings', (
      SELECT count(*) FROM public.listings WHERE moderation_status = 'temporarily_hidden'
    ),
    'active_auctions', (
      SELECT count(*) FROM public.listings
      WHERE listing_type = 'auction' AND status = 'active' AND auction_end_at > now()
    ),
    'pending_auction_payments', (
      SELECT count(*) FROM public.orders
      WHERE status = 'pending_payment' AND payment_due_at IS NOT NULL
    ),
    'open_orders', (
      SELECT count(*) FROM public.orders
      WHERE status IN ('pending_payment', 'escrow_held', 'in_escrow', 'shipped', 'delivered', 'disputed')
    ),
    'disputed_orders', (SELECT count(*) FROM public.orders WHERE status = 'disputed'),
    'completed_sales_count', (SELECT count(*) FROM public.orders WHERE status = 'completed'),
    'completed_sales_total', (
      SELECT COALESCE(sum(amount), 0) FROM public.orders WHERE status = 'completed'
    ),
    'open_barter_offers', (
      SELECT count(*) FROM public.trade_offers
      WHERE status IN ('PENDING', 'COUNTERED', 'ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B')
    ),
    'completed_barter_offers', (
      SELECT count(*) FROM public.trade_offers WHERE status = 'COMPLETED'
    ),
    'open_transaction_reports', (
      SELECT count(*) FROM public.reports WHERE status IN ('pending', 'under_review')
    ),
    'open_content_reports', (
      SELECT count(*) FROM public.general_reports WHERE status IN ('pending', 'under_review')
    )
  );
END;
$$;

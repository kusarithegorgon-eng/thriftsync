ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('buyer', 'seller', 'courier', 'moderator', 'admin'));

CREATE OR REPLACE FUNCTION public.set_profile_role(p_profile_id uuid, p_role text)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_role text;
  v_admin_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own role.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('buyer', 'seller', 'courier', 'moderator', 'admin') THEN
    RAISE EXCEPTION 'Choose a valid account role.';
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY id
  FOR UPDATE;

  SELECT role INTO v_current_role
  FROM public.profiles
  WHERE id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Account not found.'::text;
    RETURN;
  END IF;
  IF v_current_role = p_role THEN
    RETURN QUERY SELECT true, 'Account role is unchanged.'::text;
    RETURN;
  END IF;
  IF v_current_role = 'admin' AND p_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'The last system administrator cannot be demoted.';
    END IF;
  END IF;

  UPDATE public.profiles SET role = p_role WHERE id = p_profile_id;
  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'profile_role_changed',
    jsonb_build_object(
      'profile_id', p_profile_id,
      'previous_role', v_current_role,
      'new_role', p_role
    )
  );
  RETURN QUERY SELECT true, 'Account role updated.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_role(uuid, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
  tracking_code text NOT NULL UNIQUE
    DEFAULT ('TS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz,
  cod_collected_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_job_secrets (
  job_id uuid PRIMARY KEY REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  pickup_code text NOT NULL,
  delivery_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'assigned', 'reassigned', 'accepted', 'picked_up', 'in_transit',
    'pickup_code_failed', 'delivery_code_failed', 'delivered'
  )),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_jobs_courier_status_idx
  ON public.delivery_jobs(courier_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_job_events_job_created_idx
  ON public.delivery_job_events(delivery_job_id, created_at);

ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_job_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_job_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.delivery_jobs, public.delivery_job_events, public.delivery_job_secrets
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_jobs, public.delivery_job_events TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_delivery_job(p_delivery_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.delivery_jobs j
    JOIN public.orders o ON o.id = j.order_id
    LEFT JOIN public.boutiques b ON b.id = o.boutique_id
    WHERE j.id = p_delivery_job_id
      AND (
        (
          j.courier_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'courier' AND p.account_status = 'active'
          )
        )
        OR o.buyer_id = auth.uid()
        OR b.seller_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_delivery_courier(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.delivery_jobs j
    JOIN public.profiles p ON p.id = j.courier_id
    WHERE j.order_id = p_order_id
      AND j.courier_id = auth.uid()
      AND p.role = 'courier'
      AND p.account_status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_delivery_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_assigned_delivery_courier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_delivery_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_delivery_courier(uuid) TO authenticated;

DROP POLICY IF EXISTS "Delivery participants read jobs" ON public.delivery_jobs;
CREATE POLICY "Delivery participants read jobs" ON public.delivery_jobs
  FOR SELECT TO authenticated
  USING (public.can_access_delivery_job(id));

DROP POLICY IF EXISTS "Assigned couriers read their delivery orders" ON public.orders;
CREATE POLICY "Assigned couriers read their delivery orders" ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_assigned_delivery_courier(id));

DROP POLICY IF EXISTS "Delivery participants read job events" ON public.delivery_job_events;
CREATE POLICY "Delivery participants read job events" ON public.delivery_job_events
  FOR SELECT TO authenticated
  USING (public.can_access_delivery_job(delivery_job_id));

CREATE OR REPLACE FUNCTION public.admin_list_delivery_jobs()
RETURNS TABLE(
  order_id uuid,
  item_title text,
  buyer_name text,
  seller_name text,
  amount numeric,
  payment_method text,
  order_status text,
  delivery_job_id uuid,
  courier_id uuid,
  courier_name text,
  delivery_status text,
  tracking_code text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;

  RETURN QUERY
  SELECT o.id, l.title, buyer.display_name, seller.display_name, o.amount,
    o.payment_method, o.status, j.id, j.courier_id, courier.display_name,
    j.status, j.tracking_code, o.created_at
  FROM public.orders o
  JOIN public.listings l ON l.id = o.listing_id
  JOIN public.profiles buyer ON buyer.id = o.buyer_id
  JOIN public.profiles seller ON seller.id = (
    SELECT b.seller_id FROM public.boutiques b WHERE b.id = o.boutique_id
  )
  LEFT JOIN public.delivery_jobs j ON j.order_id = o.id
  LEFT JOIN public.profiles courier ON courier.id = j.courier_id
  WHERE o.delivery_method = 'courier'
    AND o.status IN ('escrow_held', 'shipped', 'delivered', 'completed')
  ORDER BY o.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_delivery_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_jobs() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_delivery_courier(
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
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_courier_id AND role = 'courier' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose an active courier account.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.delivery_method <> 'courier' OR v_order.status <> 'escrow_held' THEN
    RAISE EXCEPTION 'Only courier orders awaiting pickup can be assigned.';
  END IF;

  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE order_id = p_order_id
  FOR UPDATE;

  v_pickup_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_delivery_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  IF FOUND THEN
    IF v_job.status NOT IN ('assigned', 'accepted', 'cancelled') THEN
      RAISE EXCEPTION 'A courier cannot be changed after pickup.';
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
    CASE WHEN v_event = 'assigned' THEN 'Courier assigned by system administrator.'
      ELSE 'Courier assignment changed by system administrator.' END
  );
  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'courier_delivery_assigned',
    jsonb_build_object('order_id', p_order_id, 'courier_id', p_courier_id)
  );

  RETURN QUERY
  SELECT j.id, j.tracking_code, 'Delivery assigned. Give the pickup code to the courier.'::text
  FROM public.delivery_jobs j
  WHERE j.id = v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_delivery_courier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_delivery_courier(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_delivery_pickup_code(p_order_id uuid)
RETURNS TABLE(pickup_code text, courier_name text, tracking_code text, delivery_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.boutiques b ON b.id = o.boutique_id
    WHERE o.id = p_order_id AND b.seller_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only this order''s seller can view its courier pickup code.';
  END IF;

  RETURN QUERY
  SELECT s.pickup_code, p.display_name, j.tracking_code, j.status
  FROM public.delivery_jobs j
  JOIN public.delivery_job_secrets s ON s.job_id = j.id
  JOIN public.profiles p ON p.id = j.courier_id
  JOIN public.orders o ON o.id = j.order_id
  WHERE o.id = p_order_id
    AND o.status = 'escrow_held'
    AND j.status IN ('assigned', 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_delivery_pickup_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_delivery_pickup_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_buyer_delivery_code(p_order_id uuid)
RETURNS TABLE(delivery_code text, tracking_code text, delivery_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only this order''s buyer can view its delivery code.';
  END IF;

  RETURN QUERY
  SELECT s.delivery_code, j.tracking_code, j.status
  FROM public.delivery_jobs j
  JOIN public.delivery_job_secrets s ON s.job_id = j.id
  JOIN public.orders o ON o.id = j.order_id
  WHERE o.id = p_order_id
    AND o.status = 'shipped'
    AND j.status IN ('picked_up', 'in_transit');
END;
$$;

REVOKE ALL ON FUNCTION public.get_buyer_delivery_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_delivery_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_accept_delivery(p_delivery_job_id uuid)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.delivery_jobs%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'courier' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active courier account is required.';
  END IF;
  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE id = p_delivery_job_id AND courier_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'assigned' THEN
    RETURN QUERY SELECT false, 'This delivery is not awaiting your acceptance.'::text;
    RETURN;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'escrow_held' OR v_order.delivery_method <> 'courier' THEN
    RETURN QUERY SELECT false, 'This order is no longer waiting for courier pickup.'::text;
    RETURN;
  END IF;

  UPDATE public.delivery_jobs SET status = 'accepted', accepted_at = now(), updated_at = now()
  WHERE id = v_job.id;
  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (v_job.id, auth.uid(), 'accepted', 'Courier accepted the delivery.');
  RETURN QUERY SELECT true, 'Delivery accepted.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_confirm_delivery_pickup(
  p_delivery_job_id uuid,
  p_pickup_code text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.delivery_jobs%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_secret public.delivery_job_secrets%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'courier' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active courier account is required.';
  END IF;
  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE id = p_delivery_job_id AND courier_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'accepted' THEN
    RETURN QUERY SELECT false, 'Accept this delivery before confirming pickup.'::text;
    RETURN;
  END IF;
  SELECT * INTO v_secret FROM public.delivery_job_secrets WHERE job_id = v_job.id;
  IF NOT FOUND OR p_pickup_code IS NULL OR upper(btrim(p_pickup_code)) <> v_secret.pickup_code THEN
    INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
    VALUES (v_job.id, auth.uid(), 'pickup_code_failed', 'The submitted pickup code did not match.');
    RETURN QUERY SELECT false, 'The pickup code is incorrect. Ask the seller to confirm the code.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'escrow_held' OR v_order.delivery_method <> 'courier' THEN
    RETURN QUERY SELECT false, 'This order is not ready for courier pickup.'::text;
    RETURN;
  END IF;
  UPDATE public.delivery_jobs
  SET status = 'picked_up', picked_up_at = now(), updated_at = now()
  WHERE id = v_job.id;
  UPDATE public.orders
  SET status = 'shipped', tracking_number = v_job.tracking_code
  WHERE id = v_order.id;
  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (v_job.id, auth.uid(), 'picked_up', 'Courier verified the seller handoff and collected the parcel.');
  RETURN QUERY SELECT true, 'Pickup confirmed. Start the delivery when ready.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_start_delivery(p_delivery_job_id uuid)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.delivery_jobs%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'courier' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active courier account is required.';
  END IF;
  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE id = p_delivery_job_id AND courier_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'picked_up' THEN
    RETURN QUERY SELECT false, 'Confirm parcel pickup before starting delivery.'::text;
    RETURN;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'shipped' OR v_order.delivery_method <> 'courier' THEN
    RETURN QUERY SELECT false, 'This order is no longer ready for courier delivery.'::text;
    RETURN;
  END IF;

  UPDATE public.delivery_jobs SET status = 'in_transit', in_transit_at = now(), updated_at = now()
  WHERE id = v_job.id;
  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (v_job.id, auth.uid(), 'in_transit', 'Courier started the delivery route.');
  RETURN QUERY SELECT true, 'Delivery is now in transit.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_confirm_delivery(
  p_delivery_job_id uuid,
  p_delivery_code text,
  p_cash_collected boolean DEFAULT false
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.delivery_jobs%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_secret public.delivery_job_secrets%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'courier' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active courier account is required.';
  END IF;
  SELECT * INTO v_job
  FROM public.delivery_jobs
  WHERE id = p_delivery_job_id AND courier_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'in_transit' THEN
    RETURN QUERY SELECT false, 'This delivery is not in transit.'::text;
    RETURN;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'shipped' THEN
    RETURN QUERY SELECT false, 'This order is not awaiting courier delivery.'::text;
    RETURN;
  END IF;
  IF v_order.payment_method = 'cash_on_delivery' AND NOT COALESCE(p_cash_collected, false) THEN
    RETURN QUERY SELECT false, 'Confirm that the buyer paid the courier before completing this COD delivery.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_secret FROM public.delivery_job_secrets WHERE job_id = v_job.id;
  IF NOT FOUND OR p_delivery_code IS NULL OR upper(btrim(p_delivery_code)) <> v_secret.delivery_code THEN
    INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
    VALUES (v_job.id, auth.uid(), 'delivery_code_failed', 'The submitted buyer delivery code did not match.');
    RETURN QUERY SELECT false, 'The buyer delivery code is incorrect. Ask the buyer to check their order page.'::text;
    RETURN;
  END IF;

  UPDATE public.delivery_jobs
  SET status = 'delivered',
      delivered_at = now(),
      cod_collected_at = CASE WHEN v_order.payment_method = 'cash_on_delivery' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = v_job.id;
  UPDATE public.orders SET status = 'delivered' WHERE id = v_order.id;
  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (
    v_job.id, auth.uid(), 'delivered',
    CASE WHEN v_order.payment_method = 'cash_on_delivery'
      THEN 'Buyer delivery code verified and cash collection confirmed.'
      ELSE 'Buyer delivery code verified.' END
  );
  RETURN QUERY SELECT true, 'Delivery confirmed. The buyer can now complete the order.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.courier_accept_delivery(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_confirm_delivery_pickup(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_start_delivery(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_confirm_delivery(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_accept_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_confirm_delivery_pickup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_start_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_confirm_delivery(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_order_shipped(p_order_id uuid, p_tracking_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to update this order.';
  END IF;
  IF p_tracking_number IS NULL OR length(btrim(p_tracking_number)) = 0 OR length(btrim(p_tracking_number)) > 200 THEN
    RAISE EXCEPTION 'Enter a tracking number of 1 to 200 characters.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.boutiques b
    WHERE b.id = v_order.boutique_id AND b.seller_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only this order''s seller can mark it shipped.';
  END IF;
  IF v_order.delivery_method = 'courier' THEN
    RAISE EXCEPTION 'Courier orders must be picked up and tracked by the assigned courier.';
  END IF;
  IF v_order.status <> 'escrow_held' OR v_order.delivery_method = 'locker' THEN
    RAISE EXCEPTION 'This order cannot be marked shipped with this action.';
  END IF;
  UPDATE public.orders
  SET status = 'shipped', tracking_number = btrim(p_tracking_number)
  WHERE id = v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_delivered(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm delivery.';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_id <> v_user_id THEN
    RAISE EXCEPTION 'Only this order''s buyer can confirm delivery.';
  END IF;
  IF v_order.delivery_method = 'locker' THEN
    RAISE EXCEPTION 'Confirm locker pickup with your handoff PIN.';
  END IF;
  IF v_order.delivery_method = 'courier' THEN
    RAISE EXCEPTION 'The assigned courier must verify your delivery code.';
  END IF;
  IF v_order.status <> 'shipped' THEN
    RAISE EXCEPTION 'Only shipped orders can be marked delivered.';
  END IF;
  UPDATE public.orders SET status = 'delivered' WHERE id = v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_shipped(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_order_delivered(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_order_shipped(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivered(uuid) TO authenticated;

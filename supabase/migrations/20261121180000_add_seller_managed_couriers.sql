CREATE TABLE IF NOT EXISTS public.seller_couriers (
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, courier_id),
  CHECK (seller_id <> courier_id)
);

CREATE INDEX IF NOT EXISTS seller_couriers_courier_idx
  ON public.seller_couriers(courier_id, is_active);

ALTER TABLE public.seller_couriers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_couriers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_couriers TO authenticated;

DROP POLICY IF EXISTS "Sellers and couriers read their driver links" ON public.seller_couriers;
CREATE POLICY "Sellers and couriers read their driver links" ON public.seller_couriers
  FOR SELECT TO authenticated
  USING (seller_id = auth.uid() OR courier_id = auth.uid());

INSERT INTO public.seller_couriers (seller_id, courier_id)
SELECT DISTINCT b.seller_id, j.courier_id
FROM public.delivery_jobs j
JOIN public.orders o ON o.id = j.order_id
JOIN public.boutiques b ON b.id = o.boutique_id
JOIN public.profiles p ON p.id = j.courier_id AND p.role = 'courier'
ON CONFLICT (seller_id, courier_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
    AND auth.uid() IS NOT NULL
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() = OLD.id OR NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Only a system administrator can change another user role.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF p_role IS NULL OR p_role NOT IN ('buyer', 'seller', 'moderator', 'admin') THEN
    RAISE EXCEPTION 'Courier accounts are created and managed by sellers.';
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
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'seller' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active seller account is required.';
  END IF;

  RETURN QUERY
  SELECT sc.courier_id, p.display_name, p.role, p.account_status, sc.is_active, sc.created_at
  FROM public.seller_couriers sc
  JOIN public.profiles p ON p.id = sc.courier_id
  WHERE sc.seller_id = auth.uid()
  ORDER BY sc.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_list_couriers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_couriers() TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_link_existing_courier(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_courier_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'seller' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active seller account is required.';
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

REVOKE ALL ON FUNCTION public.seller_link_existing_courier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_link_existing_courier(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_set_courier_active(p_courier_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'seller' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active seller account is required.';
  END IF;
  PERFORM 1
  FROM public.seller_couriers
  WHERE seller_id = auth.uid() AND courier_id = p_courier_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This driver is not linked to your seller account.';
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

REVOKE ALL ON FUNCTION public.seller_set_courier_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_set_courier_active(uuid, boolean) TO authenticated;

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
          AND EXISTS (
            SELECT 1 FROM public.seller_couriers sc
            WHERE sc.seller_id = b.seller_id
              AND sc.courier_id = j.courier_id
              AND sc.is_active = true
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
    JOIN public.orders o ON o.id = j.order_id
    JOIN public.boutiques b ON b.id = o.boutique_id
    JOIN public.profiles p ON p.id = j.courier_id
    JOIN public.seller_couriers sc
      ON sc.seller_id = b.seller_id
      AND sc.courier_id = j.courier_id
      AND sc.is_active = true
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
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'seller' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active seller account is required.';
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

REVOKE ALL ON FUNCTION public.seller_assign_delivery_courier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_assign_delivery_courier(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_assign_delivery_courier(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_list_delivery_jobs();

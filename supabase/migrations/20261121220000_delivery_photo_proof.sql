ALTER TABLE public.delivery_jobs
  ADD COLUMN delivery_proof_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('delivery-proof', 'delivery-proof', false, 8388608, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 8388608,
    allowed_mime_types = ARRAY['image/jpeg'];

CREATE OR REPLACE FUNCTION public.can_upload_delivery_proof(p_delivery_job_id text)
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
    WHERE j.id::text = p_delivery_job_id
      AND j.courier_id = auth.uid()
      AND j.status = 'in_transit'
      AND j.delivery_proof_path IS NULL
      AND p.role = 'courier'
      AND p.account_status = 'active'
      AND public.can_access_delivery_chat_message(j.id, auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_delivery_proof(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.delivery_jobs j
    WHERE j.delivery_proof_path = p_path
      AND public.can_access_delivery_chat_message(j.id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.can_upload_delivery_proof(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_delivery_proof(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_delivery_proof(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_delivery_proof(text) TO authenticated;

DROP POLICY IF EXISTS "Assigned courier uploads delivery proof" ON storage.objects;
CREATE POLICY "Assigned courier uploads delivery proof" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-proof'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.can_upload_delivery_proof((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Buyer and courier read delivery proof" ON storage.objects;
CREATE POLICY "Buyer and courier read delivery proof" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proof'
    AND public.can_read_delivery_proof(name)
  );

DROP POLICY IF EXISTS "Courier deletes unlinked delivery proof" ON storage.objects;
CREATE POLICY "Courier deletes unlinked delivery proof" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'delivery-proof'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.can_upload_delivery_proof((storage.foldername(name))[1])
  );

REVOKE ALL ON FUNCTION public.courier_confirm_delivery(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.courier_confirm_delivery_with_proof(
  p_delivery_job_id uuid,
  p_delivery_code text,
  p_cash_collected boolean,
  p_proof_path text
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

  IF p_proof_path IS NULL
    OR array_length(string_to_array(p_proof_path, '/'), 1) <> 3
    OR split_part(p_proof_path, '/', 1) <> v_job.id::text
    OR split_part(p_proof_path, '/', 2) <> auth.uid()::text
    OR split_part(p_proof_path, '/', 3) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'delivery-proof' AND name = p_proof_path
    ) THEN
    RETURN QUERY SELECT false, 'Take and upload a delivery proof photo before confirming.'::text;
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
      delivery_proof_path = p_proof_path,
      updated_at = now()
  WHERE id = v_job.id;
  UPDATE public.orders SET status = 'delivered' WHERE id = v_order.id;
  INSERT INTO public.delivery_job_events (delivery_job_id, actor_id, event_type, note)
  VALUES (
    v_job.id, auth.uid(), 'delivered',
    CASE WHEN v_order.payment_method = 'cash_on_delivery'
      THEN 'Buyer delivery code verified, photo proof saved, and cash collection confirmed.'
      ELSE 'Buyer delivery code verified and photo proof saved.' END
  );
  RETURN QUERY SELECT true, 'Delivery confirmed with photo proof. The buyer can now complete the order.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.courier_confirm_delivery_with_proof(uuid, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_confirm_delivery_with_proof(uuid, text, boolean, text)
  TO authenticated;

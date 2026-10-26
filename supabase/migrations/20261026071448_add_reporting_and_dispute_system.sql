ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('illegal_item', 'product_fraud')),
  description text,
  evidence_urls text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved_refunded', 'resolved_dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporters can create reports" ON public.reports;
CREATE POLICY "Reporters can create reports" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Participants can read reports" ON public.reports;
CREATE POLICY "Participants can read reports" ON public.reports
  FOR SELECT TO authenticated
  USING (
    auth.uid() = reporter_id
    OR auth.uid() = reported_user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update reports" ON public.reports;
CREATE POLICY "Admins can update reports" ON public.reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can read audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can read audit logs" ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can insert audit logs" ON public.admin_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_category ON public.reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON public.reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs(action);

CREATE OR REPLACE FUNCTION public.submit_report(
  p_reporter_id uuid,
  p_reported_user_id uuid,
  p_listing_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_category text,
  p_description text DEFAULT NULL,
  p_evidence_urls text[] DEFAULT '{}'
)
RETURNS TABLE(id uuid, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF auth.uid() <> p_reporter_id THEN
    RAISE EXCEPTION 'You can only submit a report on your own behalf.';
  END IF;

  IF p_reported_user_id IS NULL THEN
    RAISE EXCEPTION 'The reported seller or user is required.';
  END IF;

  IF p_category NOT IN ('illegal_item', 'product_fraud') THEN
    RAISE EXCEPTION 'Choose a valid report category.';
  END IF;

  IF p_evidence_urls IS NULL OR cardinality(p_evidence_urls) = 0 THEN
    RAISE EXCEPTION 'At least one photo or video evidence file is required.';
  END IF;

  IF p_category = 'product_fraud' THEN
    IF p_order_id IS NULL THEN
      RAISE EXCEPTION 'Product fraud reports require a valid order reference.';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND buyer_id = p_reporter_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the buyer on the order can file a product fraud report.';
    END IF;

    IF v_order.status NOT IN ('escrow_held', 'in_escrow', 'shipped', 'delivered') THEN
      RAISE EXCEPTION 'Product fraud reports are only available for shipped, delivered, or escrow-held orders.';
    END IF;
  END IF;

  INSERT INTO public.reports (
    reporter_id,
    reported_user_id,
    listing_id,
    order_id,
    category,
    description,
    evidence_urls,
    status,
    admin_notes
  ) VALUES (
    p_reporter_id,
    p_reported_user_id,
    p_listing_id,
    p_order_id,
    p_category,
    left(btrim(COALESCE(p_description, '')), 2000),
    p_evidence_urls,
    'pending',
    NULL
  )
  RETURNING id INTO v_report_id;

  IF p_category = 'product_fraud' THEN
    UPDATE public.orders
    SET status = 'disputed'
    WHERE id = p_order_id;

    INSERT INTO public.admin_audit_logs (report_id, actor_id, action, details)
    VALUES (
      v_report_id,
      auth.uid(),
      'escrow_frozen',
      jsonb_build_object('category', p_category, 'order_id', p_order_id, 'status', 'disputed')
    );
  END IF;

  INSERT INTO public.admin_audit_logs (report_id, actor_id, action, details)
  VALUES (
    v_report_id,
    auth.uid(),
    'report_submitted',
    jsonb_build_object('category', p_category, 'listing_id', p_listing_id, 'order_id', p_order_id, 'evidence_count', cardinality(p_evidence_urls))
  );

  RETURN QUERY SELECT v_report_id, 'Report submitted successfully.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_report(uuid, uuid, uuid, uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_report(uuid, uuid, uuid, uuid, text, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_report(
  p_report_id uuid,
  p_action text,
  p_admin_notes text DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access required.';
  END IF;

  IF p_action NOT IN ('dismiss', 'refund', 'sanction') THEN
    RAISE EXCEPTION 'Choose a valid moderation action.';
  END IF;

  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found.';
  END IF;

  UPDATE public.reports
  SET status = CASE
    WHEN p_action = 'dismiss' THEN 'resolved_dismissed'
    WHEN p_action = 'refund' THEN 'resolved_refunded'
    ELSE 'resolved_dismissed'
  END,
  admin_notes = left(btrim(COALESCE(p_admin_notes, admin_notes, '')), 2000)
  WHERE id = p_report_id;

  IF p_action = 'dismiss' THEN
    UPDATE public.orders
    SET status = 'completed'
    WHERE id = v_report.order_id AND status = 'disputed';
  ELSIF p_action = 'refund' THEN
    UPDATE public.orders
    SET status = 'refunded'
    WHERE id = v_report.order_id;
  ELSIF p_action = 'sanction' THEN
    UPDATE public.profiles
    SET is_banned = true
    WHERE id = v_report.reported_user_id;
  END IF;

  INSERT INTO public.admin_audit_logs(report_id, actor_id, action, details)
  VALUES (
    v_report.id,
    auth.uid(),
    CASE p_action
      WHEN 'dismiss' THEN 'report_dismissed'
      WHEN 'refund' THEN 'refund_issued'
      ELSE 'seller_sanctioned'
    END,
    jsonb_build_object(
      'report_status', CASE
        WHEN p_action = 'dismiss' THEN 'resolved_dismissed'
        WHEN p_action = 'refund' THEN 'resolved_refunded'
        ELSE 'resolved_dismissed'
      END,
      'admin_note', left(btrim(COALESCE(p_admin_notes, '')), 2000)
    )
  );

  RETURN QUERY SELECT true, CASE
    WHEN p_action = 'dismiss' THEN 'Report dismissed and escrow released to seller.'
    WHEN p_action = 'refund' THEN 'Buyer refund issued and escrow closed.'
    ELSE 'Seller account flagged and sanctions applied.'
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_report(uuid, text, text) TO authenticated;

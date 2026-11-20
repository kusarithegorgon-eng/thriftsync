ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('buyer', 'seller', 'moderator', 'admin'));

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role IN ('buyer', 'seller'));

CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS prevent_profile_role_self_change ON public.profiles;
CREATE TRIGGER prevent_profile_role_self_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_self_change();

CREATE OR REPLACE FUNCTION public.has_content_moderation_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'moderator')
  );
$$;

REVOKE ALL ON FUNCTION public.has_content_moderation_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_content_moderation_access() TO authenticated;

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
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own role.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('buyer', 'seller', 'moderator', 'admin') THEN
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
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin';
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

DROP POLICY IF EXISTS "Participants can read reports" ON public.reports;
CREATE POLICY "Participants can read reports" ON public.reports
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (reporter_id, reported_user_id)
    OR public.has_content_moderation_access()
  );

DROP POLICY IF EXISTS "Reporters and admins read general reports" ON public.general_reports;
CREATE POLICY "Reporters and admins read general reports" ON public.general_reports
  FOR SELECT TO authenticated
  USING (
    auth.uid() = reporter_id
    OR public.has_content_moderation_access()
  );

DROP POLICY IF EXISTS "Report owners and admins read evidence" ON storage.objects;
CREATE POLICY "Report owners and admins read evidence" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_content_moderation_access()
    )
  );

CREATE OR REPLACE FUNCTION public.approve_listing(
  p_listing_id uuid,
  p_note text DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
BEGIN
  IF NOT public.has_content_moderation_access() THEN
    RETURN QUERY SELECT false, 'Content moderation access required.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Listing not found.'::text;
    RETURN;
  END IF;

  UPDATE public.listings
  SET moderation_status = 'approved',
      moderation_note = left(btrim(COALESCE(p_note, '')), 2000),
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = 'active'
  WHERE id = p_listing_id;

  RETURN QUERY SELECT true, 'Listing approved and is now live.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_listing(
  p_listing_id uuid,
  p_reason text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
BEGIN
  IF NOT public.has_content_moderation_access() THEN
    RETURN QUERY SELECT false, 'Content moderation access required.'::text;
    RETURN;
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RETURN QUERY SELECT false, 'Provide a reason for rejecting this listing.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Listing not found.'::text;
    RETURN;
  END IF;

  UPDATE public.listings
  SET moderation_status = 'rejected',
      moderation_note = left(btrim(p_reason), 2000),
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = 'draft'
  WHERE id = p_listing_id;

  RETURN QUERY SELECT true, 'Listing rejected with reason provided.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_moderate_listings(
  p_listing_ids uuid[],
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(processed_count integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed integer;
BEGIN
  IF NOT public.has_content_moderation_access() THEN
    RAISE EXCEPTION 'Content moderation access required.';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Choose approve or reject.';
  END IF;
  IF p_listing_ids IS NULL OR cardinality(p_listing_ids) = 0 OR cardinality(p_listing_ids) > 50 THEN
    RAISE EXCEPTION 'Select between 1 and 50 pending listings.';
  END IF;
  IF p_action = 'reject' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Provide a reason for rejecting these listings.';
  END IF;

  UPDATE public.listings AS listing
  SET moderation_status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      moderation_note = CASE WHEN p_action = 'reject' THEN left(btrim(p_reason), 2000) ELSE NULL END,
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = CASE WHEN p_action = 'approve' THEN 'active' ELSE 'draft' END,
      auction_start_at = CASE
        WHEN p_action = 'approve' AND listing.listing_type = 'auction' THEN now()
        ELSE listing.auction_start_at
      END,
      auction_end_at = CASE
        WHEN p_action = 'approve' AND listing.listing_type = 'auction'
          THEN now() + make_interval(days => LEAST(GREATEST(COALESCE(listing.auction_duration_days, 1), 1), 30))
        ELSE listing.auction_end_at
      END
  WHERE listing.id = ANY(p_listing_ids)
    AND listing.moderation_status = 'pending_review';

  GET DIAGNOSTICS v_processed = ROW_COUNT;
  RETURN QUERY SELECT
    v_processed,
    CASE
      WHEN v_processed = 0 THEN 'No selected listings were still pending review.'
      WHEN p_action = 'approve' THEN v_processed::text || ' listing(s) approved.'
      ELSE v_processed::text || ' listing(s) rejected.'
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_general_report(
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
  v_role text;
  v_report public.general_reports%ROWTYPE;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'moderator') THEN
    RAISE EXCEPTION 'Content moderation access required.';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('resolve', 'dismiss', 'escalate') THEN
    RAISE EXCEPTION 'Choose resolve, dismiss, or escalate.';
  END IF;
  IF v_role = 'moderator' AND nullif(btrim(p_admin_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Add a decision note before updating this report.';
  END IF;
  IF p_action = 'escalate' AND nullif(btrim(p_admin_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Add a note explaining why this report is being escalated.';
  END IF;

  SELECT * INTO v_report
  FROM public.general_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND OR v_report.status NOT IN ('pending', 'under_review') THEN
    RETURN QUERY SELECT false, 'Pending report not found.'::text;
    RETURN;
  END IF;
  IF v_role = 'moderator' AND v_report.status = 'under_review' THEN
    RAISE EXCEPTION 'This escalated report is awaiting system administrator review.';
  END IF;

  UPDATE public.general_reports
  SET status = CASE
        WHEN p_action = 'resolve' THEN 'resolved'
        WHEN p_action = 'dismiss' THEN 'dismissed'
        ELSE 'under_review'
      END,
      admin_notes = left(btrim(COALESCE(p_admin_notes, '')), 2000)
  WHERE id = p_report_id;

  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'general_report_' || p_action,
    jsonb_build_object(
      'general_report_id', p_report_id,
      'actor_role', v_role,
      'notes', left(btrim(COALESCE(p_admin_notes, '')), 2000)
    )
  );

  RETURN QUERY SELECT true, CASE
    WHEN p_action = 'escalate' THEN 'Report escalated to a system administrator.'
    ELSE 'General report updated.'
  END::text;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_general_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_general_report(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.escalate_report(
  p_report_id uuid,
  p_admin_notes text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
BEGIN
  IF NOT public.has_content_moderation_access() THEN
    RAISE EXCEPTION 'Content moderation access required.';
  END IF;
  IF nullif(btrim(p_admin_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Add a note explaining why this report is being escalated.';
  END IF;

  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND OR v_report.status NOT IN ('pending', 'under_review') THEN
    RETURN QUERY SELECT false, 'Open report not found.'::text;
    RETURN;
  END IF;
  IF v_report.status = 'under_review' THEN
    RETURN QUERY SELECT false, 'Report is already escalated for administrator review.'::text;
    RETURN;
  END IF;

  UPDATE public.reports
  SET status = 'under_review',
      admin_notes = left(btrim(p_admin_notes), 2000)
  WHERE id = p_report_id;
  INSERT INTO public.admin_audit_logs (report_id, actor_id, action, details)
  VALUES (
    p_report_id,
    auth.uid(),
    'case_escalated',
    jsonb_build_object('notes', left(btrim(p_admin_notes), 2000))
  );

  RETURN QUERY SELECT true, 'Report escalated to a system administrator.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_report(uuid, text) TO authenticated;

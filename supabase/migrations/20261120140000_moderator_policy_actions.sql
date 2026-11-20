ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS moderation_hidden_until timestamptz;

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_moderation_status_check;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_moderation_status_check
  CHECK (moderation_status IN (
    'pending_review', 'approved', 'rejected', 'temporarily_hidden'
  ));

ALTER TABLE public.general_reports
  ADD COLUMN IF NOT EXISTS moderation_priority text NOT NULL DEFAULT 'normal'
    CHECK (moderation_priority IN ('low', 'normal', 'high', 'urgent'));

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  general_report_id uuid REFERENCES public.general_reports(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'warning', 'correction_request', 'temporary_hide', 'restore',
    'report_classified', 'temporary_hide_expired'
  )),
  notes text,
  classification text,
  hide_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (listing_id IS NOT NULL AND general_report_id IS NULL)
    OR (listing_id IS NULL AND general_report_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS moderation_actions_listing_created_idx
  ON public.moderation_actions(listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moderation_actions_report_created_idx
  ON public.moderation_actions(general_report_id, created_at DESC)
  WHERE general_report_id IS NOT NULL;

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Moderators and admins read moderation actions"
  ON public.moderation_actions;
CREATE POLICY "Moderators and admins read moderation actions"
  ON public.moderation_actions
  FOR SELECT TO authenticated
  USING (public.has_content_moderation_access());

DROP POLICY IF EXISTS "Listing owners read their moderation actions"
  ON public.moderation_actions;
CREATE POLICY "Listing owners read their moderation actions"
  ON public.moderation_actions
  FOR SELECT TO authenticated
  USING (
    listing_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.listings AS l
      JOIN public.boutiques AS b ON b.id = l.boutique_id
      WHERE l.id = moderation_actions.listing_id
        AND b.seller_id = auth.uid()
    )
  );

GRANT SELECT ON public.moderation_actions TO authenticated;

DROP POLICY IF EXISTS "Public read active listings" ON public.listings;
DROP POLICY IF EXISTS "Public read visible listings" ON public.listings;
CREATE POLICY "Public read visible listings"
  ON public.listings
  FOR SELECT TO anon, authenticated
  USING (moderation_status <> 'temporarily_hidden');

DROP POLICY IF EXISTS "Owners and moderators read hidden listings" ON public.listings;
CREATE POLICY "Owners and moderators read hidden listings"
  ON public.listings
  FOR SELECT TO authenticated
  USING (
    public.has_content_moderation_access()
    OR EXISTS (
      SELECT 1
      FROM public.boutiques AS b
      WHERE b.id = listings.boutique_id AND b.seller_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.protect_listing_moderation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status
    OR NEW.moderation_note IS DISTINCT FROM OLD.moderation_note
    OR NEW.moderated_by IS DISTINCT FROM OLD.moderated_by
    OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at
    OR NEW.moderation_hidden_until IS DISTINCT FROM OLD.moderation_hidden_until THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_content_moderation_access() THEN
      RAISE EXCEPTION 'Only a content moderator or system administrator can change moderation decisions.';
    END IF;
    IF NEW.moderation_status <> 'temporarily_hidden' THEN
      NEW.moderation_hidden_until := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_listing_moderation_fields ON public.listings;
CREATE TRIGGER protect_listing_moderation_fields
  BEFORE UPDATE OF moderation_status, moderation_note, moderated_by,
    moderated_at, moderation_hidden_until
  ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_listing_moderation_fields();

CREATE OR REPLACE FUNCTION public.apply_listing_moderation_action(
  p_listing_id uuid,
  p_action text,
  p_notes text DEFAULT NULL,
  p_hide_until timestamptz DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
  v_notes text := NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), '');
BEGIN
  IF NOT public.has_content_moderation_access() THEN
    RAISE EXCEPTION 'Content moderation access required.';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('warning', 'correction_request', 'temporary_hide', 'restore') THEN
    RAISE EXCEPTION 'Choose a supported listing moderation action.';
  END IF;
  IF p_action IN ('warning', 'correction_request', 'temporary_hide')
    AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Add a reason for this moderation action.';
  END IF;
  IF p_action = 'temporary_hide'
    AND (p_hide_until IS NULL OR p_hide_until <= now()
      OR p_hide_until > now() + interval '30 days') THEN
    RAISE EXCEPTION 'Choose a temporary-hide duration of up to 30 days.';
  END IF;
  IF p_action <> 'temporary_hide' AND p_hide_until IS NOT NULL THEN
    RAISE EXCEPTION 'A hide-until date is only valid for a temporary hide.';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Listing not found.'::text;
    RETURN;
  END IF;

  IF p_action = 'temporary_hide' THEN
    IF v_listing.moderation_status <> 'approved' OR v_listing.status <> 'active' THEN
      RETURN QUERY SELECT false, 'Only an active approved listing can be temporarily hidden.'::text;
      RETURN;
    END IF;
    UPDATE public.listings
    SET moderation_status = 'temporarily_hidden',
        moderation_hidden_until = p_hide_until,
        moderation_note = v_notes,
        moderated_by = auth.uid(),
        moderated_at = now()
    WHERE id = p_listing_id;
  ELSIF p_action = 'restore' THEN
    IF v_listing.moderation_status <> 'temporarily_hidden' THEN
      RETURN QUERY SELECT false, 'This listing is not temporarily hidden.'::text;
      RETURN;
    END IF;
    UPDATE public.listings
    SET moderation_status = 'approved',
        moderation_hidden_until = NULL,
        moderation_note = NULL,
        moderated_by = auth.uid(),
        moderated_at = now()
    WHERE id = p_listing_id;
  ELSE
    IF v_listing.moderation_status <> 'approved' THEN
      RETURN QUERY SELECT false, 'Warnings and correction requests require an approved listing.'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.moderation_actions (
    listing_id, actor_id, action, notes, hide_until
  )
  VALUES (p_listing_id, auth.uid(), p_action, v_notes, p_hide_until);
  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'listing_' || p_action,
    jsonb_build_object('listing_id', p_listing_id, 'notes', v_notes, 'hide_until', p_hide_until)
  );

  RETURN QUERY SELECT true, CASE p_action
    WHEN 'warning' THEN 'Warning documented for the seller.'
    WHEN 'correction_request' THEN 'Correction request sent to the seller.'
    WHEN 'temporary_hide' THEN 'Listing temporarily hidden from buyers.'
    ELSE 'Listing restored to public view.'
  END::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_listing_moderation_action(uuid, text, text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_listing_moderation_action(uuid, text, text, timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.classify_general_report(
  p_report_id uuid,
  p_priority text,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.general_reports%ROWTYPE;
  v_role text;
  v_notes text := NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), '');
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'moderator') THEN
    RAISE EXCEPTION 'Content moderation access required.';
  END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Choose a valid report priority.';
  END IF;
  IF v_role = 'moderator' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Add a note when classifying a report.';
  END IF;

  SELECT * INTO v_report
  FROM public.general_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Report not found.'::text;
    RETURN;
  END IF;
  UPDATE public.general_reports
  SET moderation_priority = p_priority
  WHERE id = p_report_id;

  INSERT INTO public.moderation_actions (
    general_report_id, actor_id, action, notes, classification
  )
  VALUES (p_report_id, auth.uid(), 'report_classified', v_notes, p_priority);
  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'report_classified',
    jsonb_build_object('report_id', p_report_id, 'priority', p_priority, 'notes', v_notes)
  );
  RETURN QUERY SELECT true, 'Report priority updated.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_general_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_general_report(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_temporary_listing_hides()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_expired_count integer := 0;
BEGIN
  FOR v_listing IN
    UPDATE public.listings
    SET moderation_status = 'approved',
        moderation_hidden_until = NULL,
        moderation_note = NULL,
        moderated_at = now()
    WHERE moderation_status = 'temporarily_hidden'
      AND moderation_hidden_until <= now()
    RETURNING id, moderated_by
  LOOP
    INSERT INTO public.moderation_actions (
      listing_id, actor_id, action, notes
    )
    VALUES (
      v_listing.id, v_listing.moderated_by, 'temporary_hide_expired',
      'Temporary hide expired automatically.'
    );
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (
      NULL,
      'listing_temporary_hide_expired',
      jsonb_build_object('listing_id', v_listing.id)
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;
  RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_temporary_listing_hides() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'expire-temporary-listing-hides'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'expire-temporary-listing-hides',
    '* * * * *',
    'SELECT public.expire_temporary_listing_hides();'
  );
END;
$$;

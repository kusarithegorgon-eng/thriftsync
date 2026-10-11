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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access required.';
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

REVOKE ALL ON FUNCTION public.bulk_moderate_listings(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_moderate_listings(uuid[], text, text) TO authenticated;

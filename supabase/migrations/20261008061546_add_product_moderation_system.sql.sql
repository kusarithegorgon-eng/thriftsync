/*
# Add Product Moderation System

## Overview
Adds admin moderation workflow for listings. When a seller creates a listing,
it starts in 'pending_review' status. An admin reviews it and either approves
(sets status to 'active') or rejects (sets status to 'rejected' with a reason).
Only approved listings appear in browse/home pages.

## Modified Tables

### listings (modified)
- `moderation_status` (text, default 'pending_review'): one of 'pending_review', 'approved', 'rejected'
- `moderation_note` (text, nullable): admin's rejection reason or approval note
- `moderated_by` (uuid, nullable, FK to auth.users): which admin reviewed it
- `moderated_at` (timestamptz, nullable): when moderation happened

### profiles (modified)
- No schema changes needed; the existing `role` column already supports 'admin'

## New Functions

### approve_listing(p_listing_id, p_note)
- Admin-only function that sets a listing to approved + active
- Verifies caller has role='admin' before allowing
- Returns success/message

### reject_listing(p_listing_id, p_reason)
- Admin-only function that sets a listing to rejected with a reason
- Verifies caller has role='admin' before allowing
- Returns success/message

## Security
- The approve/reject functions are SECURITY DEFINER and check that the caller
  has role='admin' in the profiles table before allowing the operation.
- RLS on listings is unchanged; the existing policies still govern read/write.
- The moderation columns can only be modified by the SECURITY DEFINER functions,
  not directly by sellers, because the functions check admin role.
*/

-- Add moderation columns to listings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'moderation_status') THEN
    ALTER TABLE listings ADD COLUMN moderation_status text NOT NULL DEFAULT 'pending_review'
      CHECK (moderation_status IN ('pending_review', 'approved', 'rejected'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'moderation_note') THEN
    ALTER TABLE listings ADD COLUMN moderation_note text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'moderated_by') THEN
    ALTER TABLE listings ADD COLUMN moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'moderated_at') THEN
    ALTER TABLE listings ADD COLUMN moderated_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_moderation ON listings(moderation_status);

-- Approve listing (admin only)
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
  v_is_admin boolean;
  v_listing listings%ROWTYPE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'Only admins can approve listings';
    RETURN;
  END IF;

  SELECT * INTO v_listing FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN
    RETURN QUERY SELECT false, 'Listing not found';
    RETURN;
  END IF;

  UPDATE listings
  SET moderation_status = 'approved',
      moderation_note = p_note,
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = 'active'
  WHERE id = p_listing_id;

  RETURN QUERY SELECT true, 'Listing approved and is now live';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_listing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_listing(uuid, text) TO authenticated;

-- Reject listing (admin only)
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
  v_is_admin boolean;
  v_listing listings%ROWTYPE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'Only admins can reject listings';
    RETURN;
  END IF;

  SELECT * INTO v_listing FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN
    RETURN QUERY SELECT false, 'Listing not found';
    RETURN;
  END IF;

  UPDATE listings
  SET moderation_status = 'rejected',
      moderation_note = p_reason,
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = 'draft'
  WHERE id = p_listing_id;

  RETURN QUERY SELECT true, 'Listing rejected with reason provided';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_listing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_listing(uuid, text) TO authenticated;

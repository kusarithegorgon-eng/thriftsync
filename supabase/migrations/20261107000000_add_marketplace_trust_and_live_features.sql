ALTER TABLE public.boutiques
  ADD COLUMN IF NOT EXISTS operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS seller_rating_avg numeric(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_rating_count integer NOT NULL DEFAULT 0;

DROP POLICY IF EXISTS "Public read bids" ON public.bids;
DROP POLICY IF EXISTS "Auction participants read bids" ON public.bids;
CREATE POLICY "Auction participants read bids" ON public.bids
  FOR SELECT TO authenticated
  USING (
    auth.uid() = bidder_id
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.boutiques b ON b.id = l.boutique_id
      WHERE l.id = bids.listing_id AND b.seller_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL UNIQUE REFERENCES public.bids(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  bidder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_bidder_id uuid NOT NULL DEFAULT gen_random_uuid(),
  amount numeric NOT NULL CHECK (amount > 0),
  is_winning boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auction_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auction participants read bid identities" ON public.auction_bids;
CREATE POLICY "Auction participants read bid identities" ON public.auction_bids
  FOR SELECT TO authenticated
  USING (
    auth.uid() = bidder_id
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.boutiques b ON b.id = l.boutique_id
      WHERE l.id = auction_bids.listing_id AND b.seller_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_auction_bids_listing_created
  ON public.auction_bids(listing_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.mirror_auction_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auction_bids (bid_id, listing_id, bidder_id, amount, is_winning, created_at)
  VALUES (NEW.id, NEW.listing_id, NEW.bidder_id, NEW.amount, COALESCE(NEW.is_winning, false), NEW.created_at)
  ON CONFLICT (bid_id) DO UPDATE SET
    amount = EXCLUDED.amount,
    is_winning = EXCLUDED.is_winning;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_auction_bid_to_live_feed ON public.bids;
CREATE TRIGGER mirror_auction_bid_to_live_feed
  AFTER INSERT OR UPDATE OF amount, is_winning ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.mirror_auction_bid();

INSERT INTO public.auction_bids (bid_id, listing_id, bidder_id, amount, is_winning, created_at)
SELECT id, listing_id, bidder_id, amount, COALESCE(is_winning, false), created_at
FROM public.bids
ON CONFLICT (bid_id) DO NOTHING;

CREATE OR REPLACE VIEW public.public_auction_bids AS
SELECT
  ab.id,
  ab.listing_id,
  'Bidder-' || upper(substr(replace(ab.public_bidder_id::text, '-', ''), 1, 6)) AS bidder_label,
  ab.amount,
  ab.is_winning,
  ab.created_at
FROM public.auction_bids ab
JOIN public.listings l ON l.id = ab.listing_id
WHERE l.moderation_status = 'approved' AND l.status IN ('active', 'sold');

GRANT SELECT ON public.public_auction_bids TO anon, authenticated;
ALTER TABLE public.auction_bids REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.get_seller_auction_bids(p_listing_id uuid)
RETURNS TABLE (
  id uuid,
  listing_id uuid,
  bidder_id uuid,
  display_name text,
  avatar_url text,
  profile_url text,
  feedback_score numeric,
  amount numeric,
  is_winning boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.listings l
    JOIN public.boutiques b ON b.id = l.boutique_id
    WHERE l.id = p_listing_id AND b.seller_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the listing seller can view bidder profiles.';
  END IF;

  RETURN QUERY
  SELECT
    ab.id,
    ab.listing_id,
    ab.bidder_id,
    p.display_name,
    p.avatar_url,
    '/#/profile/' || ab.bidder_id::text,
    (
      SELECT max(b.seller_rating_avg)
      FROM public.boutiques b
      WHERE b.seller_id = ab.bidder_id
    ),
    ab.amount,
    ab.is_winning,
    ab.created_at
  FROM public.auction_bids ab
  JOIN public.profiles p ON p.id = ab.bidder_id
  WHERE ab.listing_id = p_listing_id
  ORDER BY ab.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_auction_bids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_auction_bids(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'auction_bids'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_bids;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.thrift_crawl_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  transport_mode text NOT NULL DEFAULT 'driving'
    CHECK (transport_mode IN ('walking', 'driving', 'motorbike', 'jeepney')),
  total_distance_km numeric NOT NULL DEFAULT 0,
  total_time_minutes integer NOT NULL DEFAULT 0,
  scheduled_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.thrift_crawl_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own thrift crawl routes" ON public.thrift_crawl_routes;
CREATE POLICY "Users manage own thrift crawl routes" ON public.thrift_crawl_routes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_thrift_crawl_routes_user_created
  ON public.thrift_crawl_routes(user_id, created_at DESC);

INSERT INTO public.thrift_crawl_routes (
  id, user_id, name, stops, transport_mode, total_distance_km, total_time_minutes, scheduled_date, created_at
)
SELECT
  id, user_id, name, stops, transport_mode, total_distance_km, total_time_minutes, scheduled_date, created_at
FROM public.itineraries
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.seller_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accuracy_rating integer NOT NULL CHECK (accuracy_rating BETWEEN 1 AND 5),
  communication_rating integer NOT NULL CHECK (communication_rating BETWEEN 1 AND 5),
  punctuality_rating integer NOT NULL CHECK (punctuality_rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_id <> reviewer_id)
);

ALTER TABLE public.seller_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read seller reviews" ON public.seller_reviews;
DROP POLICY IF EXISTS "Review participants read seller reviews" ON public.seller_reviews;
CREATE POLICY "Review participants read seller reviews" ON public.seller_reviews
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (reviewer_id, seller_id)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller ON public.seller_reviews(seller_id);

CREATE OR REPLACE VIEW public.seller_review_scores AS
SELECT seller_id, accuracy_rating, communication_rating, punctuality_rating
FROM public.seller_reviews;

GRANT SELECT ON public.seller_review_scores TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_seller_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  v_seller_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.seller_id ELSE NEW.seller_id END;
  UPDATE public.boutiques b
  SET seller_rating_avg = COALESCE((
        SELECT round(avg((sr.accuracy_rating + sr.communication_rating + sr.punctuality_rating)::numeric / 3), 2)
        FROM public.seller_reviews sr
        WHERE sr.seller_id = v_seller_id
      ), 0),
      seller_rating_count = (
        SELECT count(*)::integer
        FROM public.seller_reviews sr
        WHERE sr.seller_id = v_seller_id
      )
  WHERE b.seller_id = v_seller_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_seller_rating_after_review ON public.seller_reviews;
CREATE TRIGGER refresh_seller_rating_after_review
  AFTER INSERT OR UPDATE OR DELETE ON public.seller_reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_seller_rating();

CREATE OR REPLACE FUNCTION public.complete_order(p_order_id uuid)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.orders
  SET status = 'completed'
  WHERE id = p_order_id
    AND buyer_id = auth.uid()
    AND status = 'delivered';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Only the buyer can complete a delivered order.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Order marked complete.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_seller_review(
  p_order_id uuid,
  p_accuracy_rating integer,
  p_communication_rating integer,
  p_punctuality_rating integer,
  p_body text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_accuracy_rating NOT BETWEEN 1 AND 5
    OR p_communication_rating NOT BETWEEN 1 AND 5
    OR p_punctuality_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Ratings must be between 1 and 5 stars.';
  END IF;

  SELECT b.seller_id INTO v_seller_id
  FROM public.orders o
  JOIN public.boutiques b ON b.id = o.boutique_id
  WHERE o.id = p_order_id
    AND o.buyer_id = auth.uid()
    AND o.status = 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A completed order from your account is required to review this seller.';
  END IF;

  INSERT INTO public.seller_reviews (
    order_id, seller_id, reviewer_id, accuracy_rating, communication_rating, punctuality_rating, body
  ) VALUES (
    p_order_id, v_seller_id, auth.uid(), p_accuracy_rating, p_communication_rating, p_punctuality_rating,
    left(btrim(COALESCE(p_body, '')), 2000)
  )
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_seller_review(uuid, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_seller_review(uuid, integer, integer, integer, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.general_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  violation_category text NOT NULL CHECK (
    violation_category IN ('counterfeit_item', 'stolen_goods', 'misleading_location', 'abusive_content')
  ),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  evidence_paths text[] NOT NULL CHECK (cardinality(evidence_paths) BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_user_id)
);

ALTER TABLE public.general_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporters and admins read general reports" ON public.general_reports;
CREATE POLICY "Reporters and admins read general reports" ON public.general_reports
  FOR SELECT TO authenticated
  USING (
    auth.uid() = reporter_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins update general reports" ON public.general_reports;
CREATE POLICY "Admins update general reports" ON public.general_reports
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_general_reports_status_created
  ON public.general_reports(status, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-evidence', 'report-evidence', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

DROP POLICY IF EXISTS "Report owners upload evidence" ON storage.objects;
CREATE POLICY "Report owners upload evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'report-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Report owners and admins read evidence" ON storage.objects;
CREATE POLICY "Report owners and admins read evidence" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );

DROP POLICY IF EXISTS "Owners delete unlinked evidence" ON storage.objects;
CREATE POLICY "Owners delete unlinked evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'report-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.evidence_urls @> ARRAY[storage.objects.name]
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.general_reports r
      WHERE r.evidence_paths @> ARRAY[storage.objects.name]
    )
  );

CREATE OR REPLACE FUNCTION public.submit_product_fraud_report(
  p_reported_user_id uuid,
  p_listing_id uuid,
  p_order_id uuid,
  p_description text,
  p_evidence_paths text[]
)
RETURNS TABLE(id uuid, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_order_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT o.status INTO v_order_status
  FROM public.orders o
  JOIN public.boutiques b ON b.id = o.boutique_id
  WHERE o.id = p_order_id
    AND o.buyer_id = auth.uid()
    AND o.listing_id = p_listing_id
    AND b.seller_id = p_reported_user_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order, listing, and reported seller must match your purchase.';
  END IF;
  IF v_order_status NOT IN ('escrow_held', 'in_escrow', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Product fraud reports are only available for shipped, delivered, or escrow-held orders.';
  END IF;
  IF p_evidence_paths IS NULL
    OR cardinality(p_evidence_paths) NOT BETWEEN 1 AND 5
    OR EXISTS (
      SELECT 1 FROM unnest(p_evidence_paths) AS evidence_path
      WHERE evidence_path NOT LIKE auth.uid()::text || '/%'
        OR NOT EXISTS (
          SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'report-evidence' AND o.name = evidence_path
        )
    ) THEN
    RAISE EXCEPTION 'Upload between one and five valid report images before submitting.';
  END IF;

  INSERT INTO public.reports (
    reporter_id, reported_user_id, listing_id, order_id, category, description, evidence_urls, status
  ) VALUES (
    auth.uid(), p_reported_user_id, p_listing_id, p_order_id, 'product_fraud',
    left(btrim(COALESCE(p_description, '')), 2000), p_evidence_paths, 'pending'
  )
  RETURNING reports.id INTO v_report_id;

  UPDATE public.orders SET status = 'disputed' WHERE id = p_order_id;

  INSERT INTO public.admin_audit_logs (report_id, actor_id, action, details)
  VALUES (
    v_report_id, auth.uid(), 'escrow_frozen',
    jsonb_build_object('category', 'product_fraud', 'order_id', p_order_id, 'status', 'disputed')
  );
  INSERT INTO public.admin_audit_logs (report_id, actor_id, action, details)
  VALUES (
    v_report_id, auth.uid(), 'report_submitted',
    jsonb_build_object(
      'category', 'product_fraud',
      'listing_id', p_listing_id,
      'order_id', p_order_id,
      'evidence_count', cardinality(p_evidence_paths)
    )
  );

  RETURN QUERY SELECT v_report_id, 'Report submitted successfully.'::text;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.submit_report(uuid,uuid,uuid,uuid,text,text,text[])') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.submit_report(uuid, uuid, uuid, uuid, text, text, text[]) FROM authenticated';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_product_fraud_report(uuid, uuid, uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_product_fraud_report(uuid, uuid, uuid, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_general_report(
  p_reported_user_id uuid,
  p_listing_id uuid,
  p_violation_category text,
  p_description text,
  p_evidence_paths text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_reported_user_id IS NULL OR p_reported_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Choose a valid seller or listing to report.';
  END IF;
  IF p_violation_category NOT IN ('counterfeit_item', 'stolen_goods', 'misleading_location', 'abusive_content') THEN
    RAISE EXCEPTION 'Choose a valid violation category.';
  END IF;
  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'A description is required.';
  END IF;
  IF p_evidence_paths IS NULL OR cardinality(p_evidence_paths) NOT BETWEEN 1 AND 5
    OR EXISTS (
      SELECT 1 FROM unnest(p_evidence_paths) AS evidence_path
      WHERE evidence_path NOT LIKE auth.uid()::text || '/%'
        OR NOT EXISTS (
          SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'report-evidence' AND o.name = evidence_path
        )
    ) THEN
    RAISE EXCEPTION 'Upload between one and five image files as report evidence.';
  END IF;
  IF p_listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.listings l
    JOIN public.boutiques b ON b.id = l.boutique_id
    WHERE l.id = p_listing_id AND b.seller_id = p_reported_user_id
  ) THEN
    RAISE EXCEPTION 'The reported seller does not own this listing.';
  END IF;

  INSERT INTO public.general_reports (
    reporter_id, reported_user_id, listing_id, violation_category, description, evidence_paths
  ) VALUES (
    auth.uid(), p_reported_user_id, p_listing_id, p_violation_category,
    left(btrim(p_description), 2000), p_evidence_paths
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_general_report(uuid, uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_general_report(uuid, uuid, text, text, text[]) TO authenticated;

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
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access required.';
  END IF;
  IF p_action NOT IN ('resolve', 'dismiss') THEN
    RAISE EXCEPTION 'Choose a valid moderation action.';
  END IF;

  UPDATE public.general_reports
  SET status = CASE WHEN p_action = 'resolve' THEN 'resolved' ELSE 'dismissed' END,
      admin_notes = left(btrim(COALESCE(p_admin_notes, '')), 2000)
  WHERE id = p_report_id AND status IN ('pending', 'under_review');

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Pending report not found.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'General report updated.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_general_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_general_report(uuid, text, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_id, seller_id),
  CHECK (buyer_id <> seller_id)
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversation participants read conversations" ON public.conversations;
CREATE POLICY "Conversation participants read conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE INDEX IF NOT EXISTS idx_conversations_buyer_updated ON public.conversations(buyer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller_updated ON public.conversations(seller_id, updated_at DESC);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at);

INSERT INTO public.conversations (listing_id, buyer_id, seller_id)
SELECT DISTINCT
  m.listing_id,
  CASE WHEN m.sender_id = b.seller_id THEN m.receiver_id ELSE m.sender_id END,
  b.seller_id
FROM public.messages m
JOIN public.listings l ON l.id = m.listing_id
JOIN public.boutiques b ON b.id = l.boutique_id
WHERE (m.sender_id = b.seller_id OR m.receiver_id = b.seller_id)
  AND m.sender_id <> m.receiver_id
ON CONFLICT (listing_id, buyer_id, seller_id) DO NOTHING;

UPDATE public.messages m
SET conversation_id = c.id
FROM public.conversations c
WHERE m.conversation_id IS NULL
  AND m.listing_id = c.listing_id
  AND (
    (m.sender_id = c.buyer_id AND m.receiver_id = c.seller_id)
    OR (m.sender_id = c.seller_id AND m.receiver_id = c.buyer_id)
  );

DROP POLICY IF EXISTS "Participants read messages" ON public.messages;
CREATE POLICY "Participants read messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    auth.uid() = sender_id
    OR auth.uid() = receiver_id
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND auth.uid() IN (c.buyer_id, c.seller_id)
    )
  );

DROP POLICY IF EXISTS "Authenticated send messages" ON public.messages;
CREATE POLICY "Authenticated send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND conversation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.listing_id = messages.listing_id
        AND auth.uid() IN (c.buyer_id, c.seller_id)
        AND receiver_id = CASE WHEN auth.uid() = c.buyer_id THEN c.seller_id ELSE c.buyer_id END
    )
  );

CREATE OR REPLACE FUNCTION public.get_or_create_listing_conversation(
  p_listing_id uuid,
  p_seller_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT b.seller_id INTO v_seller_id
  FROM public.listings l
  JOIN public.boutiques b ON b.id = l.boutique_id
  WHERE l.id = p_listing_id;

  IF NOT FOUND OR v_seller_id <> p_seller_id OR v_seller_id = auth.uid() THEN
    RAISE EXCEPTION 'A buyer can only start a conversation with this listing’s seller.';
  END IF;

  INSERT INTO public.conversations (listing_id, buyer_id, seller_id)
  VALUES (p_listing_id, auth.uid(), v_seller_id)
  ON CONFLICT (listing_id, buyer_id, seller_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_listing_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_listing_conversation(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_marketplace_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content text := lower(btrim(NEW.body));
  v_conversation public.conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NEW.sender_id <> auth.uid() THEN
    RAISE EXCEPTION 'Messages can only be sent from your own account.';
  END IF;
  IF length(btrim(NEW.body)) = 0 OR length(NEW.body) > 4000 THEN
    RAISE EXCEPTION 'Messages must contain between 1 and 4000 characters.';
  END IF;
  IF v_content ~* '(https?://|www\.[[:alnum:]-]+\.[[:alpha:]]{2,}|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})'
    OR v_content ~* '(^|[^[:alnum:]])(\+?63[[:space:]-]?9[0-9]{2}[[:space:]-]?[0-9]{3}[[:space:]-]?[0-9]{4}|09[0-9]{9})([^[:alnum:]]|$)'
    OR v_content ~* '(gcash|maya|paymaya|paypal|bank transfer|wire transfer|off[- ]platform|outside (the )?(app|platform)|pay (me|directly)|direct payment|cash (settlement|payment|transfer)|send (the )?money (to|via))' THEN
    RAISE EXCEPTION 'For your protection, external payment details and off-platform settlement are blocked. Keep all payments inside ThriftSync.';
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT * INTO v_conversation
    FROM public.conversations
    WHERE id = NEW.conversation_id
    FOR UPDATE;

    IF NOT FOUND
      OR NEW.listing_id <> v_conversation.listing_id
      OR NEW.sender_id NOT IN (v_conversation.buyer_id, v_conversation.seller_id)
      OR NEW.receiver_id <> (CASE
        WHEN NEW.sender_id = v_conversation.buyer_id THEN v_conversation.seller_id
        WHEN NEW.sender_id = v_conversation.seller_id THEN v_conversation.buyer_id
        ELSE NULL
      END) THEN
      RAISE EXCEPTION 'Message participants do not match this conversation.';
    END IF;

    UPDATE public.conversations SET updated_at = now() WHERE id = v_conversation.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_marketplace_message_before_insert ON public.messages;
CREATE TRIGGER guard_marketplace_message_before_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_message();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END;
$$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;

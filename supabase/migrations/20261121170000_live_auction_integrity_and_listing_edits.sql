DROP POLICY IF EXISTS "Authenticated place bids" ON public.bids;
DROP POLICY IF EXISTS "Bidders update own bids" ON public.bids;
REVOKE INSERT, UPDATE, DELETE ON public.bids FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.auction_bids FROM PUBLIC, anon, authenticated;

WITH ranked_winners AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY listing_id
      ORDER BY amount DESC, created_at DESC, id DESC
    ) AS winner_rank
  FROM public.bids
  WHERE is_winning = true
)
UPDATE public.bids b
SET is_winning = false
FROM ranked_winners w
WHERE b.id = w.id AND w.winner_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_single_winner_per_listing
  ON public.bids(listing_id)
  WHERE is_winning = true;

CREATE TABLE IF NOT EXISTS public.auction_bid_feed (
  bid_id uuid PRIMARY KEY REFERENCES public.auction_bids(bid_id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  bidder_label text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  is_winning boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.auction_bid_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_bid_feed REPLICA IDENTITY FULL;
REVOKE ALL ON public.auction_bid_feed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.auction_bid_feed TO anon, authenticated;

DROP POLICY IF EXISTS "Read visible anonymous auction bid feed" ON public.auction_bid_feed;
CREATE POLICY "Read visible anonymous auction bid feed" ON public.auction_bid_feed
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = auction_bid_feed.listing_id
        AND l.moderation_status = 'approved'
        AND l.status IN ('active', 'sold')
    )
  );

CREATE OR REPLACE FUNCTION public.mirror_public_auction_bid_feed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auction_bid_feed (
    bid_id, listing_id, bidder_label, amount, is_winning, created_at
  )
  VALUES (
    NEW.bid_id,
    NEW.listing_id,
    'Bidder-' || upper(substr(replace(NEW.public_bidder_id::text, '-', ''), 1, 6)),
    NEW.amount,
    NEW.is_winning,
    NEW.created_at
  )
  ON CONFLICT (bid_id) DO UPDATE
  SET listing_id = EXCLUDED.listing_id,
      bidder_label = EXCLUDED.bidder_label,
      amount = EXCLUDED.amount,
      is_winning = EXCLUDED.is_winning,
      created_at = EXCLUDED.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_public_auction_bid_feed ON public.auction_bids;
CREATE TRIGGER mirror_public_auction_bid_feed
  AFTER INSERT OR UPDATE OF amount, is_winning ON public.auction_bids
  FOR EACH ROW EXECUTE FUNCTION public.mirror_public_auction_bid_feed();

INSERT INTO public.auction_bid_feed (
  bid_id, listing_id, bidder_label, amount, is_winning, created_at
)
SELECT
  ab.bid_id,
  ab.listing_id,
  'Bidder-' || upper(substr(replace(ab.public_bidder_id::text, '-', ''), 1, 6)),
  ab.amount,
  ab.is_winning,
  ab.created_at
FROM public.auction_bids ab
ON CONFLICT (bid_id) DO UPDATE
SET listing_id = EXCLUDED.listing_id,
    bidder_label = EXCLUDED.bidder_label,
    amount = EXCLUDED.amount,
    is_winning = EXCLUDED.is_winning,
    created_at = EXCLUDED.created_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'auction_bid_feed'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_bid_feed;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_moderation_after_seller_listing_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.boutiques b
    WHERE b.id = OLD.boutique_id AND b.seller_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.title, NEW.description, NEW.price, NEW.era, NEW.category,
    NEW.condition_grade, NEW.material, NEW.images, NEW.image_metadata,
    NEW.listing_type, NEW.auction_mode, NEW.auction_duration_days,
    NEW.auction_end_at, NEW.auction_start_at, NEW.auction_start_price,
    NEW.reserve_price, NEW.increment_step, NEW.decrement_rate,
    NEW.decrement_interval_minutes, NEW.current_dutch_price,
    NEW.dutch_floor_price, NEW.barter_enabled, NEW.sku
  ) IS NOT DISTINCT FROM ROW(
    OLD.title, OLD.description, OLD.price, OLD.era, OLD.category,
    OLD.condition_grade, OLD.material, OLD.images, OLD.image_metadata,
    OLD.listing_type, OLD.auction_mode, OLD.auction_duration_days,
    OLD.auction_end_at, OLD.auction_start_at, OLD.auction_start_price,
    OLD.reserve_price, OLD.increment_step, OLD.decrement_rate,
    OLD.decrement_interval_minutes, OLD.current_dutch_price,
    OLD.dutch_floor_price, OLD.barter_enabled, OLD.sku
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('sold', 'exchanged', 'reserved', 'pending_auction_payment')
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.listing_id = OLD.id
        AND o.status NOT IN ('refunded', 'payment_expired')
    ) THEN
    RAISE EXCEPTION 'This product cannot be edited while it has an active or completed order.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bids WHERE listing_id = OLD.id) THEN
    RAISE EXCEPTION 'This auction cannot be edited after a bid has been placed.';
  END IF;

  NEW.moderation_status := 'pending_review';
  NEW.moderation_note := NULL;
  NEW.moderated_by := NULL;
  NEW.moderated_at := NULL;
  NEW.moderation_hidden_until := NULL;
  NEW.status := CASE WHEN OLD.status = 'active' THEN 'draft' ELSE OLD.status END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_moderation_after_seller_listing_edit ON public.listings;
CREATE TRIGGER zz_require_moderation_after_seller_listing_edit
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.require_moderation_after_seller_listing_edit();

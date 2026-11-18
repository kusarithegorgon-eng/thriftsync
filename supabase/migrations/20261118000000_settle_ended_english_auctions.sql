CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS auction_settled_at timestamptz;

CREATE TABLE IF NOT EXISTS public.auction_winner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, listing_id)
);

ALTER TABLE public.auction_winner_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their auction winner notifications"
  ON public.auction_winner_notifications;
CREATE POLICY "Users read their auction winner notifications"
  ON public.auction_winner_notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

GRANT SELECT ON public.auction_winner_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_direct_auction_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.listings
    WHERE id = NEW.listing_id AND listing_type = 'auction'
  )
    AND current_setting('app.allow_auction_order', true) IS DISTINCT FROM 'claim_dutch'
    AND current_setting('app.allow_auction_order', true) IS DISTINCT FROM 'settle_english' THEN
    RAISE EXCEPTION 'Auction orders must be placed through the auction claim or settlement flow.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_ended_english_auctions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
  v_bid public.bids%ROWTYPE;
  v_order_id uuid;
  v_settled_count integer := 0;
BEGIN
  FOR v_listing IN
    SELECT l.*
    FROM public.listings AS l
    WHERE l.listing_type = 'auction'
      AND l.auction_mode = 'ENGLISH'
      AND l.status = 'active'
      AND l.auction_end_at <= now()
      AND l.auction_settled_at IS NULL
    ORDER BY l.auction_end_at, l.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT b.*
    INTO v_bid
    FROM public.bids AS b
    WHERE b.listing_id = v_listing.id
    ORDER BY b.amount DESC, b.created_at ASC, b.id ASC
    LIMIT 1;

    IF FOUND AND (v_listing.reserve_price IS NULL OR v_bid.amount >= v_listing.reserve_price) THEN
      PERFORM set_config('app.allow_auction_order', 'settle_english', true);

      INSERT INTO public.orders (
        buyer_id, listing_id, boutique_id, amount, status, shipping_address
      )
      VALUES (
        v_bid.bidder_id,
        v_listing.id,
        v_listing.boutique_id,
        v_bid.amount,
        'escrow_held',
        'Pending - Cebu pickup/delivery'
      )
      RETURNING id INTO v_order_id;

      UPDATE public.listings
      SET status = 'sold', auction_settled_at = now()
      WHERE id = v_listing.id;

      INSERT INTO public.auction_winner_notifications (
        recipient_id, listing_id, order_id, title, body
      )
      VALUES (
        v_bid.bidder_id,
        v_listing.id,
        v_order_id,
        'You won the auction',
        'Your winning bid is confirmed. Open My Orders to contact the seller and arrange delivery or pickup.'
      );
    ELSE
      UPDATE public.listings
      SET auction_settled_at = now()
      WHERE id = v_listing.id;
    END IF;

    v_settled_count := v_settled_count + 1;
  END LOOP;

  RETURN v_settled_count;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_ended_english_auctions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_auction_winner_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User authentication required.';
  END IF;

  UPDATE public.auction_winner_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id
    AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_auction_winner_notification_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_auction_winner_notification_read(uuid) TO authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'settle-ended-english-auctions'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'settle-ended-english-auctions',
    '* * * * *',
    'SELECT public.settle_ended_english_auctions();'
  );
END;
$$;

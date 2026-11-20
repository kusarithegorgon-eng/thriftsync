ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending_payment', 'payment_expired', 'escrow_held', 'shipped',
    'delivered', 'completed', 'disputed', 'refunded', 'in_escrow'
  ));

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_status_check;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'reserved', 'pending_auction_payment', 'sold', 'exchanged', 'draft'));

CREATE OR REPLACE FUNCTION public.prevent_auction_payment_status_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transition text := current_setting('app.auction_payment_transition', true);
  v_has_bids boolean;
BEGIN
  IF OLD.listing_type = 'auction'
    AND OLD.auction_settled_at IS NOT NULL
    AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'A settled auction cannot be reopened; create a new listing instead.';
  END IF;

  IF NEW.status = 'pending_auction_payment' AND v_transition IS DISTINCT FROM 'settlement' THEN
    RAISE EXCEPTION 'Auction payment reservations must be created by the auction settlement flow.';
  END IF;

  IF OLD.status = 'pending_auction_payment' AND NEW.status = 'sold'
    AND v_transition IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Auction orders can only be marked sold after confirmed payment.';
  END IF;

  IF OLD.status = 'pending_auction_payment' AND NEW.status = 'draft'
    AND v_transition IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'Pending auction orders can only be released by the expiry workflow.';
  END IF;

  IF OLD.listing_type = 'auction' AND OLD.auction_mode = 'ENGLISH' AND OLD.status = 'active' THEN
    SELECT EXISTS (SELECT 1 FROM public.bids WHERE listing_id = OLD.id) INTO v_has_bids;
    IF v_has_bids AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.auction_end_at IS DISTINCT FROM OLD.auction_end_at
      OR NEW.auction_mode IS DISTINCT FROM OLD.auction_mode
      OR NEW.auction_start_price IS DISTINCT FROM OLD.auction_start_price
      OR NEW.reserve_price IS DISTINCT FROM OLD.reserve_price
      OR NEW.increment_step IS DISTINCT FROM OLD.increment_step
    ) AND NOT (
      NEW.status = 'draft'
      AND OLD.auction_end_at <= now()
      AND v_transition = 'settlement'
      AND NEW.price IS NOT DISTINCT FROM OLD.price
      AND NEW.auction_end_at IS NOT DISTINCT FROM OLD.auction_end_at
      AND NEW.auction_mode IS NOT DISTINCT FROM OLD.auction_mode
      AND NEW.auction_start_price IS NOT DISTINCT FROM OLD.auction_start_price
      AND NEW.reserve_price IS NOT DISTINCT FROM OLD.reserve_price
      AND NEW.increment_step IS NOT DISTINCT FROM OLD.increment_step
    ) THEN
      RAISE EXCEPTION 'An English auction cannot be cancelled or have its terms changed after the first bid.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_auction_payment_status_tampering ON public.listings;
CREATE TRIGGER prevent_auction_payment_status_tampering
  BEFORE UPDATE OF status, price, auction_end_at, auction_mode,
    auction_start_price, reserve_price, increment_step
  ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_auction_payment_status_tampering();

CREATE OR REPLACE FUNCTION public.prevent_delete_of_bid_auction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.listing_type = 'auction'
    AND (
      EXISTS (SELECT 1 FROM public.bids WHERE listing_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.orders WHERE listing_id = OLD.id)
    ) THEN
    RAISE EXCEPTION 'An auction with bids or an order cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_delete_of_bid_auction ON public.listings;
CREATE TRIGGER prevent_delete_of_bid_auction
  BEFORE DELETE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_of_bid_auction();

CREATE OR REPLACE FUNCTION public.cancel_auction_listing(p_listing_id uuid)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel an auction.';
  END IF;

  SELECT l.* INTO v_listing
  FROM public.listings AS l
  JOIN public.boutiques AS b ON b.id = l.boutique_id
  WHERE l.id = p_listing_id AND b.seller_id = auth.uid()
  FOR UPDATE OF l;

  IF NOT FOUND OR v_listing.listing_type <> 'auction'
    OR v_listing.status <> 'active' OR v_listing.auction_end_at IS NULL
    OR v_listing.auction_end_at <= now() THEN
    RETURN QUERY SELECT false, 'This active auction cannot be cancelled.'::text;
    RETURN;
  END IF;
  IF v_listing.auction_mode = 'ENGLISH'
    AND EXISTS (SELECT 1 FROM public.bids WHERE listing_id = p_listing_id) THEN
    RETURN QUERY SELECT false, 'Bids are binding; an auction cannot be cancelled after the first bid.'::text;
    RETURN;
  END IF;

  UPDATE public.listings SET status = 'draft' WHERE id = p_listing_id;
  RETURN QUERY SELECT true, 'Auction cancelled before a bid or claim.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_auction_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_auction_listing(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_dutch_auction(p_listing_id uuid)
RETURNS TABLE(success boolean, claim_price numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_listing public.listings%ROWTYPE;
  v_price numeric;
  v_order_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Sign in to claim this item.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND OR v_listing.listing_type <> 'auction' OR v_listing.auction_mode <> 'DUTCH'
    OR v_listing.status <> 'active' OR v_listing.moderation_status <> 'approved'
    OR v_listing.auction_end_at IS NULL OR v_listing.auction_end_at <= now() THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This descending-price auction is no longer available.'::text;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.boutiques
    WHERE id = v_listing.boutique_id AND seller_id = v_user_id
  ) THEN
    RETURN QUERY SELECT false, NULL::numeric, 'You cannot claim your own listing.'::text;
    RETURN;
  END IF;
  IF v_listing.auction_start_price IS NULL OR v_listing.dutch_floor_price IS NULL
    OR v_listing.auction_start_price <= v_listing.dutch_floor_price
    OR v_listing.decrement_rate IS NULL OR v_listing.decrement_rate <= 0 OR v_listing.decrement_rate > 100
    OR v_listing.decrement_interval_minutes < 5 THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This descending-price auction has invalid price-drop settings.'::text;
    RETURN;
  END IF;

  v_price := public.compute_dutch_price(
    v_listing.auction_start_price,
    v_listing.dutch_floor_price,
    v_listing.decrement_rate,
    v_listing.decrement_interval_minutes,
    COALESCE(v_listing.auction_start_at, v_listing.created_at)
  );
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This auction has an invalid current price.'::text;
    RETURN;
  END IF;

  PERFORM set_config('app.allow_auction_order', 'claim_dutch', true);
  PERFORM set_config('app.auction_payment_transition', 'settlement', true);
  INSERT INTO public.orders (
    buyer_id, listing_id, boutique_id, amount, status, payment_due_at, shipping_address
  )
  VALUES (
    v_user_id, v_listing.id, v_listing.boutique_id, v_price,
    'pending_payment', now() + interval '24 hours', 'Pending - Cebu pickup/delivery'
  )
  RETURNING id INTO v_order_id;
  UPDATE public.listings
  SET status = 'pending_auction_payment',
      current_dutch_price = v_price,
      auction_settled_at = now()
  WHERE id = v_listing.id;

  INSERT INTO public.auction_winner_notifications (
    recipient_id, listing_id, order_id, title, body
  )
  VALUES (
    v_user_id, v_listing.id, v_order_id,
    'Dutch auction claimed',
    'Complete PayMongo payment within 24 hours. If payment is not completed, the order expires and the seller may relist the item.'
  );

  RETURN QUERY SELECT true, v_price, 'Claim reserved. Complete PayMongo payment within 24 hours.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dutch_auction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_dutch_auction(uuid) TO authenticated;

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
    SELECT b.* INTO v_bid
    FROM public.bids AS b
    WHERE b.listing_id = v_listing.id
    ORDER BY b.amount DESC, b.created_at ASC, b.id ASC
    LIMIT 1;

    IF FOUND AND (v_listing.reserve_price IS NULL OR v_bid.amount >= v_listing.reserve_price) THEN
      PERFORM set_config('app.allow_auction_order', 'settle_english', true);
      PERFORM set_config('app.auction_payment_transition', 'settlement', true);
      INSERT INTO public.orders (
        buyer_id, listing_id, boutique_id, amount, status, payment_due_at, shipping_address
      )
      VALUES (
        v_bid.bidder_id, v_listing.id, v_listing.boutique_id, v_bid.amount,
        'pending_payment', now() + interval '24 hours', 'Pending - Cebu pickup/delivery'
      )
      RETURNING id INTO v_order_id;

      UPDATE public.listings
      SET status = 'pending_auction_payment', auction_settled_at = now()
      WHERE id = v_listing.id;

      INSERT INTO public.auction_winner_notifications (
        recipient_id, listing_id, order_id, title, body
      )
      VALUES (
        v_bid.bidder_id, v_listing.id, v_order_id, 'You won the auction',
        'Complete PayMongo payment within 24 hours. If payment is not completed, the order expires and the seller may relist the item.'
      );
    ELSE
      PERFORM set_config('app.auction_payment_transition', 'settlement', true);
      UPDATE public.listings
      SET status = 'draft', auction_settled_at = now()
      WHERE id = v_listing.id;
    END IF;

    v_settled_count := v_settled_count + 1;
  END LOOP;

  RETURN v_settled_count;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_ended_english_auctions() FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS paymongo_checkouts_active_auction_order_idx
  ON public.paymongo_checkouts ((payload->>'order_id'))
  WHERE payload->>'kind' = 'auction_payment' AND status IN ('pending', 'paid');

CREATE OR REPLACE FUNCTION public.create_auction_paymongo_checkout(p_order_id uuid)
RETURNS TABLE(checkout_id uuid, amount_centavos integer, expires_at timestamptz, listing_title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_listing_title text;
  v_listing_status text;
  v_amount_centavos integer;
  v_expires_at timestamptz;
  v_checkout_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to pay for this auction.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND buyer_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending_payment'
    OR v_order.payment_due_at IS NULL OR v_order.payment_due_at <= now()
  THEN
    RAISE EXCEPTION 'This auction payment window is closed or the order is no longer payable.';
  END IF;

  SELECT title, status
  INTO v_listing_title, v_listing_status
  FROM public.listings
  WHERE id = v_order.listing_id
  FOR UPDATE;
  IF NOT FOUND OR v_listing_status <> 'pending_auction_payment' THEN
    RAISE EXCEPTION 'This auction item is no longer reserved for payment.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.paymongo_checkouts AS c
    WHERE c.payload->>'kind' = 'auction_payment'
      AND c.payload->>'order_id' = p_order_id::text
      AND c.status IN ('pending', 'paid')
  ) THEN
    RAISE EXCEPTION 'An auction payment is already in progress. Return to My Orders and check its status.';
  END IF;

  v_amount_centavos := round(v_order.amount * 100)::integer;
  IF v_amount_centavos < 100 THEN
    RAISE EXCEPTION 'PayMongo requires a payable total of at least ₱1.';
  END IF;
  v_expires_at := LEAST(now() + interval '20 minutes', v_order.payment_due_at);

  INSERT INTO public.paymongo_checkouts (
    buyer_id, checkout_session_id, status, payload, amount_centavos, expires_at
  )
  VALUES (
    auth.uid(), NULL, 'pending',
    jsonb_build_object(
      'kind', 'auction_payment',
      'order_id', p_order_id,
      'listing_title', v_listing_title
    ),
    v_amount_centavos,
    v_expires_at
  )
  RETURNING id INTO v_checkout_id;

  RETURN QUERY SELECT v_checkout_id, v_amount_centavos, v_expires_at, v_listing_title;
END;
$$;

REVOKE ALL ON FUNCTION public.create_auction_paymongo_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_auction_paymongo_checkout(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fulfill_paymongo_auction_order(p_checkout_id uuid)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout public.paymongo_checkouts%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_checkout
  FROM public.paymongo_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction checkout not found.';
  END IF;
  IF v_checkout.status = 'fulfilled' AND cardinality(v_checkout.order_ids) > 0 THEN
    RETURN QUERY SELECT v_checkout.order_ids, 0::numeric;
    RETURN;
  END IF;
  IF v_checkout.status <> 'paid' OR v_checkout.payload->>'kind' <> 'auction_payment' THEN
    RAISE EXCEPTION 'This auction checkout is not a confirmed payment.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = NULLIF(v_checkout.payload->>'order_id', '')::uuid
    AND buyer_id = v_checkout.buyer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction order not found.';
  END IF;
  IF v_order.status = 'escrow_held' AND v_order.payment_method = 'paymongo' THEN
    UPDATE public.paymongo_checkouts
    SET status = 'fulfilled', order_ids = ARRAY[v_order.id], updated_at = now()
    WHERE id = p_checkout_id;
    RETURN QUERY SELECT ARRAY[v_order.id], 0::numeric;
    RETURN;
  END IF;
  IF v_order.status <> 'pending_payment' OR v_order.payment_due_at IS NULL THEN
    RAISE EXCEPTION 'This auction payment window has closed.';
  END IF;

  PERFORM set_config('app.auction_payment_transition', 'paid', true);
  UPDATE public.orders
  SET status = 'escrow_held',
      payment_method = 'paymongo',
      payment_reference = v_checkout.checkout_session_id,
      paid_at = now(),
      payment_due_at = NULL
  WHERE id = v_order.id;

  UPDATE public.listings
  SET status = 'sold'
  WHERE id = v_order.listing_id AND status = 'pending_auction_payment';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The auction listing is no longer reserved for this winner.';
  END IF;

  UPDATE public.paymongo_checkouts
  SET status = 'fulfilled', order_ids = ARRAY[v_order.id], updated_at = now()
  WHERE id = p_checkout_id;
  RETURN QUERY SELECT ARRAY[v_order.id], 0::numeric;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_paymongo_auction_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_paymongo_auction_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_unpaid_auction_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_expired_count integer := 0;
BEGIN
  FOR v_order IN
    SELECT o.*
    FROM public.orders AS o
    WHERE o.status = 'pending_payment'
      AND o.payment_due_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.paymongo_checkouts AS c
        WHERE c.buyer_id = o.buyer_id
          AND c.payload->>'kind' = 'auction_payment'
          AND c.payload->>'order_id' = o.id::text
          AND c.status IN ('pending', 'paid')
      )
    ORDER BY o.payment_due_at, o.id
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('app.auction_payment_transition', 'expired', true);
    UPDATE public.orders
    SET status = 'payment_expired', payment_due_at = NULL
    WHERE id = v_order.id;

    UPDATE public.listings
    SET status = 'draft'
    WHERE id = v_order.listing_id AND status = 'pending_auction_payment';

    UPDATE public.auction_winner_notifications
    SET title = 'Auction payment expired',
        body = 'The 24-hour payment window expired and the seller may relist the item.',
        read_at = NULL
    WHERE order_id = v_order.id;

    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (
      NULL,
      'auction_payment_expired',
      jsonb_build_object(
        'order_id', v_order.id,
        'listing_id', v_order.listing_id,
        'buyer_id', v_order.buyer_id,
        'payment_deadline', v_order.payment_due_at
      )
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;
  RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_auction_orders() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'expire-unpaid-auction-orders'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'expire-unpaid-auction-orders',
    '* * * * *',
    'SELECT public.expire_unpaid_auction_orders();'
  );
END;
$$;

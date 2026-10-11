ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS auction_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS auction_duration_days integer;

UPDATE public.listings
SET auction_duration_days = GREATEST(
  1,
  CEIL(EXTRACT(EPOCH FROM (auction_end_at - created_at)) / 86400)::integer
)
WHERE listing_type = 'auction'
  AND auction_end_at IS NOT NULL
  AND auction_duration_days IS NULL;

UPDATE public.listings
SET auction_start_at = created_at
WHERE listing_type = 'auction'
  AND auction_mode = 'DUTCH'
  AND auction_start_at IS NULL;

CREATE OR REPLACE FUNCTION public.compute_dutch_price(
  p_start_price numeric,
  p_floor_price numeric,
  p_decrement_rate numeric,
  p_decrement_interval_minutes integer,
  p_auction_start_at timestamptz,
  p_is_percentage boolean DEFAULT true
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_steps numeric;
  v_current_price numeric;
BEGIN
  IF p_start_price IS NULL OR p_floor_price IS NULL OR p_decrement_rate IS NULL
    OR p_auction_start_at IS NULL OR p_decrement_interval_minutes IS NULL
    OR p_decrement_interval_minutes <= 0 THEN
    RETURN p_start_price;
  END IF;

  v_steps := FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - p_auction_start_at)) / 60)
    / p_decrement_interval_minutes);
  IF p_is_percentage THEN
    v_current_price := p_start_price * POWER(
      1 - LEAST(GREATEST(p_decrement_rate, 0), 100) / 100,
      v_steps
    );
  ELSE
    v_current_price := p_start_price - GREATEST(p_decrement_rate, 0) * v_steps;
  END IF;

  RETURN GREATEST(v_current_price, p_floor_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.place_bid(
  p_listing_id uuid,
  p_bidder_id uuid,
  p_bid_amount numeric
)
RETURNS TABLE(success boolean, min_next_bid numeric, message text, new_current_bid numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.listings%ROWTYPE;
  v_current_bid numeric;
  v_min_increment numeric;
  v_valid boolean;
  v_message text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_bidder_id THEN
    RETURN QUERY SELECT false, NULL::numeric, 'You can only bid from your own account.', NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND OR v_listing.listing_type <> 'auction' OR v_listing.auction_mode <> 'ENGLISH' THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This is not an ascending-bid auction.', NULL::numeric;
    RETURN;
  END IF;

  IF v_listing.status <> 'active' OR v_listing.moderation_status <> 'approved'
    OR v_listing.auction_end_at IS NULL OR v_listing.auction_end_at <= now() THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This auction has ended or is not available.', NULL::numeric;
    RETURN;
  END IF;

  IF p_bid_amount IS NULL OR p_bid_amount <= 0 THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Enter a valid bid amount.', NULL::numeric;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.boutiques
    WHERE id = v_listing.boutique_id AND seller_id = auth.uid()
  ) THEN
    RETURN QUERY SELECT false, NULL::numeric, 'You cannot bid on your own listing.', NULL::numeric;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(amount), v_listing.price)
  INTO v_current_bid
  FROM public.bids
  WHERE listing_id = p_listing_id;

  SELECT valid, min_increment, message
  INTO v_valid, v_min_increment, v_message
  FROM public.validate_bid_increment(v_current_bid, p_bid_amount, v_listing.increment_step);
  IF NOT v_valid THEN
    RETURN QUERY SELECT false, v_min_increment, v_message, v_current_bid;
    RETURN;
  END IF;

  UPDATE public.bids SET is_winning = false WHERE listing_id = p_listing_id;
  INSERT INTO public.bids (listing_id, bidder_id, amount, is_winning)
  VALUES (p_listing_id, auth.uid(), p_bid_amount, true);

  RETURN QUERY SELECT true, v_current_bid + v_min_increment, 'Bid placed successfully', p_bid_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.place_bid(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, uuid, numeric) TO authenticated;

DROP POLICY IF EXISTS "Authenticated place bids" ON public.bids;
DROP POLICY IF EXISTS "Bidders update own bids" ON public.bids;

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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Sign in to claim this item.';
    RETURN;
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND OR v_listing.listing_type <> 'auction' OR v_listing.auction_mode <> 'DUTCH'
    OR v_listing.status <> 'active' OR v_listing.moderation_status <> 'approved'
    OR v_listing.auction_end_at IS NULL OR v_listing.auction_end_at <= now() THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This descending-price auction is no longer available.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.boutiques
    WHERE id = v_listing.boutique_id AND seller_id = v_user_id
  ) THEN
    RETURN QUERY SELECT false, NULL::numeric, 'You cannot claim your own listing.';
    RETURN;
  END IF;

  IF v_listing.auction_start_price IS NULL OR v_listing.dutch_floor_price IS NULL
    OR v_listing.auction_start_price <= v_listing.dutch_floor_price
    OR v_listing.decrement_rate IS NULL OR v_listing.decrement_rate <= 0 OR v_listing.decrement_rate > 100
    OR v_listing.decrement_interval_minutes < 5 THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This descending-price auction has invalid price-drop settings.';
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
    RETURN QUERY SELECT false, NULL::numeric, 'This auction has an invalid current price.';
    RETURN;
  END IF;

  PERFORM set_config('app.allow_auction_order', 'claim_dutch', true);
  INSERT INTO public.orders (buyer_id, listing_id, boutique_id, amount, status, shipping_address)
  VALUES (v_user_id, v_listing.id, v_listing.boutique_id, v_price, 'escrow_held', 'Pending - Cebu pickup/delivery');
  UPDATE public.listings
  SET status = 'sold', current_dutch_price = v_price
  WHERE id = v_listing.id;

  RETURN QUERY SELECT true, v_price, 'Dutch auction item claimed successfully.';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dutch_auction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_dutch_auction(uuid) TO authenticated;

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
  ) AND current_setting('app.allow_auction_order', true) IS DISTINCT FROM 'claim_dutch' THEN
    RAISE EXCEPTION 'Auction orders must be placed through the auction claim flow.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_direct_auction_orders ON public.orders;
CREATE TRIGGER prevent_direct_auction_orders
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_auction_orders();

CREATE OR REPLACE FUNCTION public.refresh_dutch_prices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_listing record;
  v_new_price numeric;
BEGIN
  FOR v_listing IN
    SELECT id, auction_start_price, dutch_floor_price, decrement_rate,
           decrement_interval_minutes, COALESCE(auction_start_at, created_at) AS started_at,
           current_dutch_price
    FROM public.listings
    WHERE listing_type = 'auction'
      AND auction_mode = 'DUTCH'
      AND status = 'active'
      AND auction_start_price IS NOT NULL
      AND dutch_floor_price IS NOT NULL
      AND decrement_rate IS NOT NULL
  LOOP
    v_new_price := public.compute_dutch_price(
      v_listing.auction_start_price,
      v_listing.dutch_floor_price,
      v_listing.decrement_rate,
      v_listing.decrement_interval_minutes,
      v_listing.started_at
    );
    IF v_new_price IS DISTINCT FROM v_listing.current_dutch_price THEN
      UPDATE public.listings SET current_dutch_price = v_new_price WHERE id = v_listing.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_items(jsonb, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.checkout_fixed_items(
  p_items jsonb,
  p_shipping_address text,
  p_voucher_code text DEFAULT NULL
)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'The cart is empty or invalid.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS cart(item)
    JOIN public.listings AS listing ON listing.id = (cart.item->>'listing_id')::uuid
    WHERE listing.listing_type = 'auction'
  ) THEN
    RAISE EXCEPTION 'Auction listings cannot be purchased through fixed-price checkout.';
  END IF;

  RETURN QUERY
  SELECT * FROM public.checkout_items(p_items, p_shipping_address, p_voucher_code);
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_fixed_items(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_fixed_items(jsonb, text, text) TO authenticated;

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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can approve listings';
    RETURN;
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Listing not found';
    RETURN;
  END IF;

  UPDATE public.listings
  SET moderation_status = 'approved',
      moderation_note = p_note,
      moderated_by = auth.uid(),
      moderated_at = now(),
      status = 'active',
      auction_start_at = CASE
        WHEN listing_type = 'auction' AND status <> 'active' THEN now()
        ELSE auction_start_at
      END,
      auction_end_at = CASE
        WHEN listing_type = 'auction' AND status <> 'active'
          THEN now() + make_interval(days => LEAST(GREATEST(COALESCE(auction_duration_days, 1), 1), 30))
        ELSE auction_end_at
      END
  WHERE id = p_listing_id;

  RETURN QUERY SELECT true, 'Listing approved and is now live';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_listing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_listing(uuid, text) TO authenticated;

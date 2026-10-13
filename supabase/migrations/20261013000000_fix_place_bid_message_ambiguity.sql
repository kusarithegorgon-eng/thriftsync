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

  SELECT validation.valid, validation.min_increment, validation.message
  INTO v_valid, v_min_increment, v_message
  FROM public.validate_bid_increment(v_current_bid, p_bid_amount, v_listing.increment_step) AS validation;
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
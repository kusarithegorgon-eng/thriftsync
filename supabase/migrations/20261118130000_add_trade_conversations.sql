CREATE OR REPLACE FUNCTION public.get_or_create_trade_conversation(p_trade_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade public.trade_offers%ROWTYPE;
  v_requested_listing_id uuid;
  v_item_count integer;
  v_offered_count integer;
  v_requested_count integer;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to message the other seller.';
  END IF;

  SELECT * INTO v_trade
  FROM public.trade_offers
  WHERE id = p_trade_offer_id;

  IF v_trade.id IS NULL
    OR auth.uid() NOT IN (v_trade.initiator_id, v_trade.recipient_id) THEN
    RAISE EXCEPTION 'Only a participant can message about this trade.';
  END IF;
  IF v_trade.status NOT IN ('ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B') THEN
    RAISE EXCEPTION 'Messaging is available after the barter offer is accepted.';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE side = 'OFFERED'),
    count(*) FILTER (WHERE side = 'REQUESTED')
  INTO v_item_count, v_offered_count, v_requested_count
  FROM public.trade_items
  WHERE trade_offer_id = v_trade.id;

  IF v_item_count <> 2 OR v_offered_count <> 1 OR v_requested_count <> 1 THEN
    RAISE EXCEPTION 'This trade does not contain a valid one-to-one item exchange.';
  END IF;

  SELECT listing_id INTO v_requested_listing_id
  FROM public.trade_items
  WHERE trade_offer_id = v_trade.id AND side = 'REQUESTED';

  INSERT INTO public.conversations (listing_id, buyer_id, seller_id)
  VALUES (v_requested_listing_id, v_trade.initiator_id, v_trade.recipient_id)
  ON CONFLICT (listing_id, buyer_id, seller_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_trade_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_trade_conversation(uuid) TO authenticated;

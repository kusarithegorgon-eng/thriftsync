CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS barter_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_status_check;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'sold', 'exchanged', 'draft'));

CREATE TABLE IF NOT EXISTS public.trade_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trade_offer_id uuid NOT NULL REFERENCES public.trade_offers(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their trade notifications" ON public.trade_notifications;
CREATE POLICY "Users read their trade notifications"
  ON public.trade_notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

GRANT SELECT ON public.trade_notifications TO authenticated;

DROP POLICY IF EXISTS "trade_participants_insert_offers" ON public.trade_offers;
DROP POLICY IF EXISTS "trade_participants_update_offers" ON public.trade_offers;
DROP POLICY IF EXISTS "trade_participants_delete_offers" ON public.trade_offers;
DROP POLICY IF EXISTS "trade_initiator_insert_items" ON public.trade_items;
DROP POLICY IF EXISTS "trade_initiator_update_items" ON public.trade_items;
DROP POLICY IF EXISTS "trade_initiator_delete_items" ON public.trade_items;
DROP POLICY IF EXISTS "trade_participants_update_shipments" ON public.trade_shipments;

REVOKE ALL ON FUNCTION public.accept_trade_offer(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_listing_sale_during_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND current_setting('app.allow_trade_completion', true) IS DISTINCT FROM 'true'
    AND EXISTS (
      SELECT 1
      FROM public.trade_inventory_locks
      WHERE listing_id = OLD.id
        AND lock_status = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'This listing is committed to an accepted barter exchange.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_listing_sale_during_trade ON public.listings;
CREATE TRIGGER prevent_listing_sale_during_trade
  BEFORE UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_listing_sale_during_trade();

CREATE OR REPLACE FUNCTION public.prevent_bid_during_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trade_inventory_locks
    WHERE listing_id = NEW.listing_id
      AND lock_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'This listing is committed to an accepted barter exchange.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_bid_during_trade ON public.bids;
CREATE TRIGGER prevent_bid_during_trade
  BEFORE INSERT ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bid_during_trade();

CREATE OR REPLACE FUNCTION public.create_trade_offer(
  p_requested_listing_id uuid,
  p_offered_listing_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_requested public.listings%ROWTYPE;
  v_offered public.listings%ROWTYPE;
  v_recipient_id uuid;
  v_trade_offer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to make a trade offer.';
  END IF;
  IF p_requested_listing_id IS NULL OR p_offered_listing_id IS NULL
    OR p_requested_listing_id = p_offered_listing_id THEN
    RAISE EXCEPTION 'Choose two different listings for the exchange.';
  END IF;

  PERFORM 1
  FROM public.listings
  WHERE id IN (p_requested_listing_id, p_offered_listing_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_requested
  FROM public.listings
  WHERE id = p_requested_listing_id;
  SELECT * INTO v_offered
  FROM public.listings
  WHERE id = p_offered_listing_id;

  IF v_requested.id IS NULL OR v_offered.id IS NULL
    OR v_requested.status <> 'active' OR v_offered.status <> 'active'
    OR v_requested.moderation_status <> 'approved' OR v_offered.moderation_status <> 'approved'
    OR v_requested.listing_type <> 'fixed' OR v_offered.listing_type <> 'fixed'
    OR NOT v_requested.barter_enabled OR NOT v_offered.barter_enabled THEN
    RAISE EXCEPTION 'Both listings must be approved, active, fixed-price items available for barter.';
  END IF;

  SELECT seller_id INTO v_recipient_id
  FROM public.boutiques
  WHERE id = v_requested.boutique_id;

  IF v_recipient_id IS NULL OR v_recipient_id = v_user_id THEN
    RAISE EXCEPTION 'You can only offer a trade to another seller.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.boutiques
    WHERE id = v_offered.boutique_id AND seller_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You can only offer an item from your own boutique.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.trade_inventory_locks
    WHERE listing_id IN (p_requested_listing_id, p_offered_listing_id)
      AND lock_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'One or more listings are already committed to another exchange.';
  END IF;

  INSERT INTO public.trade_offers (initiator_id, recipient_id, cash_top_up)
  VALUES (v_user_id, v_recipient_id, 0)
  RETURNING id INTO v_trade_offer_id;

  INSERT INTO public.trade_items (trade_offer_id, listing_id, side, title_snapshot, price_snapshot)
  VALUES
    (v_trade_offer_id, p_offered_listing_id, 'OFFERED', v_offered.title, v_offered.price),
    (v_trade_offer_id, p_requested_listing_id, 'REQUESTED', v_requested.title, v_requested.price);

  INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
  VALUES (v_trade_offer_id, v_user_id, 'CREATED', NULL, 'PENDING');

  INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
  VALUES (
    v_recipient_id,
    v_trade_offer_id,
    'New barter offer',
    'A seller offered one of their items in exchange for your listing. Review it in My Trades.'
  );

  RETURN v_trade_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trade_offer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trade_offer(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_trade_offer(
  p_trade_offer_id uuid,
  p_action text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trade public.trade_offers%ROWTYPE;
  v_item public.trade_items%ROWTYPE;
  v_listing public.listings%ROWTYPE;
  v_other_user_id uuid;
  v_next_status text;
  v_item_count integer;
  v_offered_count integer;
  v_requested_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to respond to a trade offer.';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'reject', 'cancel') THEN
    RAISE EXCEPTION 'Choose accept, reject, or cancel.';
  END IF;

  SELECT * INTO v_trade
  FROM public.trade_offers
  WHERE id = p_trade_offer_id
  FOR UPDATE;

  IF v_trade.id IS NULL THEN
    RAISE EXCEPTION 'Trade offer not found.';
  END IF;
  IF v_trade.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This trade offer is no longer pending.';
  END IF;
  IF p_action IN ('accept', 'reject') AND v_user_id <> v_trade.recipient_id THEN
    RAISE EXCEPTION 'Only the listing owner can respond to this offer.';
  ELSIF p_action = 'cancel' AND v_user_id <> v_trade.initiator_id THEN
    RAISE EXCEPTION 'Only the offer creator can cancel this offer.';
  END IF;
  IF v_trade.expires_at <= now() THEN
    UPDATE public.trade_offers
    SET status = 'REJECTED', updated_at = now()
    WHERE id = v_trade.id;
    INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
    VALUES (v_trade.id, v_user_id, 'EXPIRED', 'PENDING', 'REJECTED');
    INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
    VALUES
      (v_trade.initiator_id, v_trade.id, 'Barter offer expired', 'Your trade offer expired without a response.'),
      (v_trade.recipient_id, v_trade.id, 'Barter offer expired', 'This trade offer expired without a response.');
    RETURN 'REJECTED';
  END IF;
  IF p_action = 'accept' THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE side = 'OFFERED'),
      count(*) FILTER (WHERE side = 'REQUESTED')
    INTO v_item_count, v_offered_count, v_requested_count
    FROM public.trade_items
    WHERE trade_offer_id = v_trade.id;

    IF v_trade.cash_top_up <> 0
      OR v_item_count <> 2
      OR v_offered_count <> 1
      OR v_requested_count <> 1 THEN
      RAISE EXCEPTION 'Only one-to-one item exchanges without cash top-ups can be accepted.';
    END IF;

    FOR v_item IN
      SELECT * FROM public.trade_items
      WHERE trade_offer_id = v_trade.id
      ORDER BY listing_id
    LOOP
      SELECT * INTO v_listing
      FROM public.listings
      WHERE id = v_item.listing_id
      FOR UPDATE;

      IF NOT FOUND OR v_listing.status <> 'active'
        OR v_listing.moderation_status <> 'approved'
        OR v_listing.listing_type <> 'fixed'
        OR NOT v_listing.barter_enabled THEN
        RAISE EXCEPTION 'One or more listings are no longer available for barter.';
      END IF;
      IF v_item.side = 'OFFERED' AND NOT EXISTS (
        SELECT 1 FROM public.boutiques
        WHERE id = v_listing.boutique_id AND seller_id = v_trade.initiator_id
      ) THEN
        RAISE EXCEPTION 'The offered listing is no longer owned by the offer creator.';
      END IF;
      IF v_item.side = 'REQUESTED' AND NOT EXISTS (
        SELECT 1 FROM public.boutiques
        WHERE id = v_listing.boutique_id AND seller_id = v_trade.recipient_id
      ) THEN
        RAISE EXCEPTION 'The requested listing is no longer owned by the recipient.';
      END IF;

      INSERT INTO public.trade_inventory_locks (trade_offer_id, listing_id)
      VALUES (v_trade.id, v_item.listing_id);
    END LOOP;

    UPDATE public.trade_offers
    SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
    WHERE id = v_trade.id;
    INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
    VALUES (v_trade.id, v_user_id, 'ACCEPTED', 'PENDING', 'ACCEPTED');
    INSERT INTO public.trade_shipments (
      trade_offer_id, party, sender_id, recipient_id
    )
    VALUES
      (v_trade.id, 'A', v_trade.initiator_id, v_trade.recipient_id),
      (v_trade.id, 'B', v_trade.recipient_id, v_trade.initiator_id);
    INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
    VALUES (
      v_trade.initiator_id,
      v_trade.id,
      'Barter offer accepted',
      'Both listings are reserved for this exchange. Contact the other seller to arrange a handover.'
    );
    RETURN 'ACCEPTED';
  END IF;

  v_next_status := 'REJECTED';
  v_other_user_id := CASE
    WHEN p_action = 'cancel' THEN v_trade.recipient_id
    ELSE v_trade.initiator_id
  END;

  UPDATE public.trade_offers
  SET status = v_next_status, updated_at = now()
  WHERE id = v_trade.id;
  INSERT INTO public.trade_events (
    trade_offer_id, actor_id, event_type, from_status, to_status, metadata
  )
  VALUES (
    v_trade.id,
    v_user_id,
    'REJECTED',
    'PENDING',
    v_next_status,
    jsonb_build_object('action', p_action)
  );
  INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
  VALUES (
    v_other_user_id,
    v_trade.id,
    CASE WHEN p_action = 'cancel' THEN 'Barter offer cancelled' ELSE 'Barter offer declined' END,
    CASE WHEN p_action = 'cancel'
      THEN 'The other seller cancelled this trade offer.'
      ELSE 'The other seller declined this trade offer.'
    END
  );
  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_trade_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_trade_offer(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_trade_exchange(p_trade_offer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trade public.trade_offers%ROWTYPE;
  v_party text;
  v_confirmed_count integer;
  v_old_status text;
  v_next_status text;
  v_other_user_id uuid;
  v_item public.trade_items%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm the exchange.';
  END IF;

  SELECT * INTO v_trade
  FROM public.trade_offers
  WHERE id = p_trade_offer_id
  FOR UPDATE;
  IF v_trade.id IS NULL
    OR v_trade.status NOT IN ('ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B') THEN
    RAISE EXCEPTION 'This trade is not awaiting handover confirmation.';
  END IF;

  IF v_user_id NOT IN (v_trade.initiator_id, v_trade.recipient_id) THEN
    RAISE EXCEPTION 'Only a participant can confirm this exchange.';
  END IF;

  SELECT party INTO v_party
  FROM public.trade_shipments
  WHERE trade_offer_id = v_trade.id
    AND recipient_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your incoming handover is not available to confirm.';
  END IF;

  UPDATE public.trade_shipments
  SET status = 'DELIVERED', delivered_at = now()
  WHERE trade_offer_id = v_trade.id
    AND party = v_party
    AND status IN ('PENDING', 'SHIPPED');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You have already confirmed this exchange or it is not available.';
  END IF;

  SELECT count(*) INTO v_confirmed_count
  FROM public.trade_shipments
  WHERE trade_offer_id = v_trade.id
    AND status = 'DELIVERED';

  v_old_status := v_trade.status;
  IF v_confirmed_count = 2 THEN
    PERFORM set_config('app.allow_trade_completion', 'true', true);
    FOR v_item IN
      SELECT * FROM public.trade_items
      WHERE trade_offer_id = v_trade.id
      ORDER BY listing_id
    LOOP
      UPDATE public.listings
      SET status = 'exchanged'
      WHERE id = v_item.listing_id AND status = 'active';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An exchange listing is no longer available.';
      END IF;
    END LOOP;

    UPDATE public.trade_inventory_locks
    SET lock_status = 'RELEASED', released_at = now()
    WHERE trade_offer_id = v_trade.id AND lock_status = 'ACTIVE';
    UPDATE public.trade_shipments
    SET status = 'CLEARED'
    WHERE trade_offer_id = v_trade.id AND status = 'DELIVERED';
    UPDATE public.trade_offers
    SET status = 'COMPLETED', completed_at = now(), updated_at = now()
    WHERE id = v_trade.id;
    INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
    VALUES (v_trade.id, v_user_id, 'COMPLETED', v_old_status, 'COMPLETED');
    INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
    VALUES
      (v_trade.initiator_id, v_trade.id, 'Barter exchange completed', 'Both sellers confirmed the handover. The exchanged items are now marked unavailable.'),
      (v_trade.recipient_id, v_trade.id, 'Barter exchange completed', 'Both sellers confirmed the handover. The exchanged items are now marked unavailable.');
    RETURN 'COMPLETED';
  END IF;

  v_next_status := CASE WHEN v_party = 'A' THEN 'SHIPPED_BY_PARTY_A' ELSE 'SHIPPED_BY_PARTY_B' END;
  UPDATE public.trade_offers
  SET status = v_next_status, updated_at = now()
  WHERE id = v_trade.id;
  INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
  VALUES (v_trade.id, v_user_id, 'DELIVERED', v_old_status, v_next_status);
  v_other_user_id := CASE WHEN v_user_id = v_trade.initiator_id THEN v_trade.recipient_id ELSE v_trade.initiator_id END;
  INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
  VALUES (
    v_other_user_id,
    v_trade.id,
    'Exchange handover confirmed',
    'The other seller confirmed their handover. Confirm yours in My Trades when the item is received.'
  );
  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_trade_exchange(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_trade_exchange(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_trade_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.trade_offers
    SET status = 'REJECTED', updated_at = now()
    WHERE status IN ('PENDING', 'COUNTERED') AND expires_at <= now()
    RETURNING id, initiator_id, recipient_id
  ),
  event_rows AS (
    INSERT INTO public.trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
    SELECT id, NULL, 'EXPIRED', 'PENDING', 'REJECTED'
    FROM expired
    RETURNING trade_offer_id
  ),
  notification_rows AS (
    INSERT INTO public.trade_notifications (recipient_id, trade_offer_id, title, body)
    SELECT initiator_id, id, 'Barter offer expired', 'Your trade offer expired without a response.'
    FROM expired
    UNION ALL
    SELECT recipient_id, id, 'Barter offer expired', 'This trade offer expired without a response.'
    FROM expired
    RETURNING trade_offer_id
  )
  SELECT count(DISTINCT trade_offer_id)::integer
  INTO v_count
  FROM notification_rows;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trade_offers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_trade_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User authentication required.';
  END IF;
  UPDATE public.trade_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_trade_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_trade_notification_read(uuid) TO authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'expire-trade-offers'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'expire-trade-offers',
    '*/15 * * * *',
    'SELECT public.expire_trade_offers();'
  );
END;
$$;

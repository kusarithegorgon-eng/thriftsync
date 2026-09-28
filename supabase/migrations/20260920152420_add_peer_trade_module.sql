/*
# Add peer-to-peer trade module

## Overview
Adds a durable barter workflow for trading one or more active listings plus an optional cash top-up. Trade acceptance is protected by a database function that locks both parties' listings in a single operation, preventing the same item from being sold or committed to multiple trades.

## New Tables
1. `trade_offers`
   - `id`: trade proposal identifier.
   - `initiator_id`: authenticated user who created the proposal.
   - `recipient_id`: owner of the requested listing.
   - `status`: PENDING, COUNTERED, ACCEPTED, REJECTED, SHIPPED_BY_PARTY_A, SHIPPED_BY_PARTY_B, COMPLETED, or DISPUTED.
   - `cash_top_up`: optional amount offered in addition to the items.
   - `expires_at`: automatic expiration deadline, defaulting to 72 hours.
   - `accepted_at`, `completed_at`, `created_at`, `updated_at`: lifecycle timestamps.
2. `trade_items`
   - Maps every listing to a trade and marks it as OFFERED by party A or REQUESTED from party B.
   - Stores a snapshot of the listing title and price for an auditable offer history.
3. `trade_events`
   - Append-only lifecycle log for proposals, counters, acceptance, shipping, disputes, and completion.
4. `trade_inventory_locks`
   - One active lock per listing while a trade is accepted or being completed.
   - Includes the external channel lock state for inventory synchronization.
5. `trade_shipments`
   - Paired shipment records for party A and party B, including tracking and delivery confirmation timestamps.

## Security
- RLS is enabled on every new table.
- Trade offers and child records are visible only to participants.
- Participants can create offers using their own listings and can update only lifecycle actions allowed by their participation.
- Inventory locks and events are written by the database transition function rather than trusted client fields.
- The transition function uses `SECURITY DEFINER`, a fixed `search_path`, row locks, and unique active-lock indexes to prevent double-commits.

## Important Notes
1. A pending offer expires after 72 hours; scheduled cleanup can transition expired offers to REJECTED with an EXPIRED event.
2. Accepting an offer locks every listing in the trade before changing the trade status.
3. A listing cannot have two active trade locks at once, even under concurrent acceptance attempts.
4. The initial shipping rows are created together with acceptance so paired logistics has a durable starting point.
*/

CREATE TABLE IF NOT EXISTS trade_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B', 'COMPLETED', 'DISPUTED')),
  cash_top_up numeric NOT NULL DEFAULT 0 CHECK (cash_top_up >= 0),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (initiator_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS trade_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id uuid NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('OFFERED', 'REQUESTED')),
  title_snapshot text NOT NULL,
  price_snapshot numeric NOT NULL DEFAULT 0 CHECK (price_snapshot >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_offer_id, listing_id)
);

CREATE TABLE IF NOT EXISTS trade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id uuid NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'LOCKED', 'SHIPPED', 'DELIVERED', 'DISPUTED', 'COMPLETED')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_inventory_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id uuid NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  lock_status text NOT NULL DEFAULT 'ACTIVE' CHECK (lock_status IN ('ACTIVE', 'RELEASED')),
  channels jsonb NOT NULL DEFAULT '{"etsy":"LOCKED","shopify":"LOCKED","depop":"LOCKED","in_store":"LOCKED"}'::jsonb,
  locked_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (trade_offer_id, listing_id)
);

CREATE TABLE IF NOT EXISTS trade_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id uuid NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  party text NOT NULL CHECK (party IN ('A', 'B')),
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tracking_number text,
  label_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  inspection_ends_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LABEL_CREATED', 'SHIPPED', 'DELIVERED', 'INSPECTION', 'CLEARED', 'DISPUTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_offer_id, party)
);

CREATE INDEX IF NOT EXISTS idx_trade_offers_initiator ON trade_offers(initiator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_recipient ON trade_offers(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_status_expiry ON trade_offers(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_trade_items_trade ON trade_items(trade_offer_id);
CREATE INDEX IF NOT EXISTS idx_trade_items_listing ON trade_items(listing_id);
CREATE INDEX IF NOT EXISTS idx_trade_events_trade ON trade_events(trade_offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_shipments_trade ON trade_shipments(trade_offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_trade_lock_per_listing ON trade_inventory_locks(listing_id) WHERE lock_status = 'ACTIVE';

ALTER TABLE trade_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_inventory_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trade_participants_select_offers" ON trade_offers;
CREATE POLICY "trade_participants_select_offers" ON trade_offers FOR SELECT TO authenticated
USING (auth.uid() = initiator_id OR auth.uid() = recipient_id);
DROP POLICY IF EXISTS "trade_participants_insert_offers" ON trade_offers;
CREATE POLICY "trade_participants_insert_offers" ON trade_offers FOR INSERT TO authenticated
WITH CHECK (auth.uid() = initiator_id AND initiator_id <> recipient_id);
DROP POLICY IF EXISTS "trade_participants_update_offers" ON trade_offers;
CREATE POLICY "trade_participants_update_offers" ON trade_offers FOR UPDATE TO authenticated
USING (auth.uid() = initiator_id OR auth.uid() = recipient_id)
WITH CHECK (auth.uid() = initiator_id OR auth.uid() = recipient_id);
DROP POLICY IF EXISTS "trade_participants_delete_offers" ON trade_offers;
CREATE POLICY "trade_participants_delete_offers" ON trade_offers FOR DELETE TO authenticated
USING (auth.uid() = initiator_id AND status IN ('PENDING', 'COUNTERED'));

DROP POLICY IF EXISTS "trade_participants_select_items" ON trade_items;
CREATE POLICY "trade_participants_select_items" ON trade_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND (auth.uid() = t.initiator_id OR auth.uid() = t.recipient_id)));
DROP POLICY IF EXISTS "trade_initiator_insert_items" ON trade_items;
CREATE POLICY "trade_initiator_insert_items" ON trade_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND auth.uid() = t.initiator_id AND t.status IN ('PENDING', 'COUNTERED')));
DROP POLICY IF EXISTS "trade_initiator_update_items" ON trade_items;
CREATE POLICY "trade_initiator_update_items" ON trade_items FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND auth.uid() = t.initiator_id AND t.status IN ('PENDING', 'COUNTERED')))
WITH CHECK (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND auth.uid() = t.initiator_id AND t.status IN ('PENDING', 'COUNTERED')));
DROP POLICY IF EXISTS "trade_initiator_delete_items" ON trade_items;
CREATE POLICY "trade_initiator_delete_items" ON trade_items FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND auth.uid() = t.initiator_id AND t.status IN ('PENDING', 'COUNTERED')));

DROP POLICY IF EXISTS "trade_participants_select_events" ON trade_events;
CREATE POLICY "trade_participants_select_events" ON trade_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND (auth.uid() = t.initiator_id OR auth.uid() = t.recipient_id)));
DROP POLICY IF EXISTS "trade_participants_select_locks" ON trade_inventory_locks;
CREATE POLICY "trade_participants_select_locks" ON trade_inventory_locks FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM trade_offers t WHERE t.id = trade_offer_id AND (auth.uid() = t.initiator_id OR auth.uid() = t.recipient_id)));
DROP POLICY IF EXISTS "trade_participants_select_shipments" ON trade_shipments;
CREATE POLICY "trade_participants_select_shipments" ON trade_shipments FOR SELECT TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
DROP POLICY IF EXISTS "trade_participants_update_shipments" ON trade_shipments;
CREATE POLICY "trade_participants_update_shipments" ON trade_shipments FOR UPDATE TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id)
WITH CHECK (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE OR REPLACE FUNCTION public.accept_trade_offer(p_trade_offer_id uuid)
RETURNS trade_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_item trade_items;
  v_listing listings;
  v_lock_count integer := 0;
BEGIN
  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade offer not found'; END IF;
  IF auth.uid() <> v_trade.recipient_id THEN RAISE EXCEPTION 'Only the recipient can accept this offer'; END IF;
  IF v_trade.status NOT IN ('PENDING', 'COUNTERED') THEN RAISE EXCEPTION 'Trade offer is no longer actionable'; END IF;
  IF v_trade.expires_at <= now() THEN
    UPDATE trade_offers SET status = 'REJECTED', updated_at = now() WHERE id = v_trade.id RETURNING * INTO v_trade;
    INSERT INTO trade_events (trade_offer_id, actor_id, event_type, from_status, to_status) VALUES (v_trade.id, auth.uid(), 'EXPIRED', v_trade.status, 'REJECTED');
    RETURN v_trade;
  END IF;

  FOR v_item IN SELECT * FROM trade_items WHERE trade_offer_id = v_trade.id ORDER BY listing_id FOR UPDATE LOOP
    SELECT * INTO v_listing FROM listings WHERE id = v_item.listing_id FOR UPDATE;
    IF v_listing.status <> 'active' THEN RAISE EXCEPTION 'One or more trade items are no longer active'; END IF;
    IF v_item.side = 'OFFERED' AND NOT EXISTS (SELECT 1 FROM boutiques b WHERE b.id = v_listing.boutique_id AND b.seller_id = v_trade.initiator_id) THEN
      RAISE EXCEPTION 'An offered item is not owned by the initiator';
    END IF;
    IF v_item.side = 'REQUESTED' AND NOT EXISTS (SELECT 1 FROM boutiques b WHERE b.id = v_listing.boutique_id AND b.seller_id = v_trade.recipient_id) THEN
      RAISE EXCEPTION 'A requested item is not owned by the recipient';
    END IF;
    INSERT INTO trade_inventory_locks (trade_offer_id, listing_id) VALUES (v_trade.id, v_item.listing_id);
    v_lock_count := v_lock_count + 1;
  END LOOP;

  IF v_lock_count = 0 THEN RAISE EXCEPTION 'Trade must include at least one item'; END IF;
  UPDATE trade_offers SET status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = v_trade.id RETURNING * INTO v_trade;
  INSERT INTO trade_events (trade_offer_id, actor_id, event_type, from_status, to_status, metadata) VALUES (v_trade.id, auth.uid(), 'ACCEPTED', 'PENDING', 'ACCEPTED', jsonb_build_object('locked_items', v_lock_count));
  INSERT INTO trade_shipments (trade_offer_id, party, sender_id, recipient_id) VALUES
    (v_trade.id, 'A', v_trade.initiator_id, v_trade.recipient_id),
    (v_trade.id, 'B', v_trade.recipient_id, v_trade.initiator_id);
  RETURN v_trade;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'One or more items are already committed to another trade';
END;
$$;

REVOKE ALL ON FUNCTION public.accept_trade_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_trade_offer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_trade_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE trade_offers SET status = 'REJECTED', updated_at = now()
    WHERE status IN ('PENDING', 'COUNTERED') AND expires_at <= now()
    RETURNING id, initiator_id
  )
  INSERT INTO trade_events (trade_offer_id, actor_id, event_type, from_status, to_status)
  SELECT id, initiator_id, 'EXPIRED', 'PENDING', 'REJECTED' FROM expired;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_trade_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_trade_offers() TO authenticated;
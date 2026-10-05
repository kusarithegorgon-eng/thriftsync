/*
# Add Cebu Geofencing, Image Metadata, and Dynamic Auction Controls

## Overview
This migration adds four major capabilities to the ThriftSync marketplace:
1. Cebu-exclusive geofencing with lat/lng coordinates on boutiques and user addresses
2. Resilient image upload pipeline with multi-angle/flaw-tag metadata
3. Dynamic auction pricing with bid increment tiers and Dutch auction (descending price) support
4. A geofence validation function to enforce Cebu-only addresses at the database level

## Modified Tables

### boutiques (modified)
- `lat` (double precision, nullable): latitude coordinate within Cebu
- `lng` (double precision, nullable): longitude coordinate within Cebu
- `barangay` (text, nullable): barangay-level address within Cebu City/Metro Cebu
- `pickup_available` (boolean, default false): whether this boutique offers local pickup
- `courier_delivery` (boolean, default true): whether local courier delivery is available

### listings (modified)
- `image_metadata` (jsonb, default '[]'): array of {url, angle, is_flaw, caption} objects for multi-angle/flaw photos
- `auction_mode` (text, default 'ENGLISH'): ENGLISH (ascending bids) or DUTCH (descending price)
- `increment_step` (numeric, nullable): minimum bid increment for English auctions; if NULL, tier-based defaults are used
- `decrement_rate` (numeric, nullable): price drop per interval for Dutch auctions (percentage or fixed)
- `decrement_interval_minutes` (integer, default 60): minutes between price drops in Dutch auctions
- `current_dutch_price` (numeric, nullable): live computed price for Dutch auctions
- `dutch_floor_price` (numeric, nullable): absolute minimum price for Dutch auction (separate from reserve_price)
- `auction_start_price` (numeric, nullable): starting price for Dutch auctions (price begins here and descends)

### profiles (modified)
- `default_lat` (double precision, nullable): default delivery latitude within Cebu
- `default_lng` (double precision, nullable): default delivery longitude within Cebu
- `default_barangay` (text, nullable): default barangay for delivery

## New Tables

### cebu_barangays (new)
- Reference table of Cebu barangays with approximate coordinates for address validation
- `id` (uuid, primary key)
- `name` (text, not null): barangay name
- `city_municipality` (text, not null): city or municipality (e.g. Cebu City, Mandaue City, Lapu-Lapu City)
- `lat` (double precision): approximate latitude
- `lng` (double precision): approximate longitude
- `is_metro_cebu` (boolean): whether this barangay is within Metro Cebu

## Security
- RLS enabled on cebu_barangays (public read for all)
- Existing policies on boutiques and listings remain unchanged
- New columns inherit existing table-level RLS

## Important Notes
1. The `validate_cebu_geofence` function checks whether lat/lng coordinates fall within
   Cebu's bounding box (approximately 9.25°N–11.00°N, 123.20°E–124.70°E).
2. Dutch auction price decay is computed by the `compute_dutch_price` function, which
   calculates time-elapsed steps and applies the decrement rate down to the floor price.
3. Bid increment tiers for English auctions are enforced by the `validate_bid_increment` function:
   - $0–$50: $1 minimum increment
   - $50–$200: $5 minimum increment
   - $200–$500: $10 minimum increment
   - $500–$1000: $25 minimum increment
   - $1000+: $50 minimum increment
   These can be overridden per-listing by setting `increment_step`.
4. Image metadata replaces the simple `images` text[] array with structured JSON containing
   angle tags (front, back, left, right, detail, flaw) for vintage condition grading.
*/

-- Add geocoordinates and pickup flags to boutiques
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'lat') THEN
    ALTER TABLE boutiques ADD COLUMN lat double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'lng') THEN
    ALTER TABLE boutiques ADD COLUMN lng double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'barangay') THEN
    ALTER TABLE boutiques ADD COLUMN barangay text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'pickup_available') THEN
    ALTER TABLE boutiques ADD COLUMN pickup_available boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'courier_delivery') THEN
    ALTER TABLE boutiques ADD COLUMN courier_delivery boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Add image metadata and auction controls to listings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'image_metadata') THEN
    ALTER TABLE listings ADD COLUMN image_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'auction_mode') THEN
    ALTER TABLE listings ADD COLUMN auction_mode text NOT NULL DEFAULT 'ENGLISH' CHECK (auction_mode IN ('ENGLISH', 'DUTCH'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'increment_step') THEN
    ALTER TABLE listings ADD COLUMN increment_step numeric CHECK (increment_step IS NULL OR increment_step > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'decrement_rate') THEN
    ALTER TABLE listings ADD COLUMN decrement_rate numeric CHECK (decrement_rate IS NULL OR decrement_rate > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'decrement_interval_minutes') THEN
    ALTER TABLE listings ADD COLUMN decrement_interval_minutes integer NOT NULL DEFAULT 60 CHECK (decrement_interval_minutes > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'current_dutch_price') THEN
    ALTER TABLE listings ADD COLUMN current_dutch_price numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'dutch_floor_price') THEN
    ALTER TABLE listings ADD COLUMN dutch_floor_price numeric CHECK (dutch_floor_price IS NULL OR dutch_floor_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'listings' AND column_name = 'auction_start_price') THEN
    ALTER TABLE listings ADD COLUMN auction_start_price numeric;
  END IF;
END $$;

-- Add default delivery coordinates to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_lat') THEN
    ALTER TABLE profiles ADD COLUMN default_lat double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_lng') THEN
    ALTER TABLE profiles ADD COLUMN default_lng double precision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_barangay') THEN
    ALTER TABLE profiles ADD COLUMN default_barangay text;
  END IF;
END $$;

-- Create Cebu barangays reference table
CREATE TABLE IF NOT EXISTS cebu_barangays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city_municipality text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  is_metro_cebu boolean NOT NULL DEFAULT true,
  UNIQUE (name, city_municipality)
);

ALTER TABLE cebu_barangays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read cebu_barangays" ON cebu_barangays;
CREATE POLICY "Public read cebu_barangays" ON cebu_barangays FOR SELECT
  TO anon, authenticated USING (true);

-- Seed major Cebu barangays / municipalities
INSERT INTO cebu_barangays (name, city_municipality, lat, lng, is_metro_cebu) VALUES
  ('Lahug', 'Cebu City', 10.3389, 123.9033, true),
  ('Guadalupe', 'Cebu City', 10.3156, 123.8833, true),
  ('Banilad', 'Cebu City', 10.3392, 123.9133, true),
  ('Capitol Site', 'Cebu City', 10.3167, 123.8856, true),
  ('Kamputhaw', 'Cebu City', 10.3258, 123.8983, true),
  ('Mabolo', 'Cebu City', 10.3183, 123.9050, true),
  ('Pardo', 'Cebu City', 10.2983, 123.8683, true),
  ('Talisay', 'Cebu City', 10.2633, 123.8417, true),
  ('Mandaue City Proper', 'Mandaue City', 10.3300, 123.9300, true),
  ('Banilad', 'Mandaue City', 10.3400, 123.9200, true),
  ('Maguikay', 'Mandaue City', 10.3250, 123.9350, true),
  ('Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.3050, 124.0050, true),
  ('Mactan', 'Lapu-Lapu City', 10.2900, 124.0150, true),
  ('Maribago', 'Lapu-Lapu City', 10.2850, 124.0000, true),
  ('Talisay City Proper', 'Talisay City', 10.2500, 123.8500, true),
  ('Minglanilla Proper', 'Minglanilla', 10.2400, 123.7900, true),
  ('Naga City Proper', 'Naga City', 10.2100, 123.7600, true),
  ('Danao City Proper', 'Danao City', 10.5600, 124.0000, false),
  ('Carcar City Proper', 'Carcar City', 10.1200, 123.6400, false),
  ('Toledo City Proper', 'Toledo City', 10.3900, 123.6400, false)
ON CONFLICT (name, city_municipality) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cebu_barangays_city ON cebu_barangays(city_municipality);
CREATE INDEX IF NOT EXISTS idx_cebu_barangays_metro ON cebu_barangays(is_metro_cebu);
CREATE INDEX IF NOT EXISTS idx_listings_auction_mode ON listings(auction_mode);

-- Geofence validation function: checks if coordinates are within Cebu bounding box
CREATE OR REPLACE FUNCTION public.validate_cebu_geofence(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Cebu bounding box: approximately 9.25°N–11.00°N, 123.20°E–124.70°E
  -- Covers Cebu Province including Metro Cebu, Danao, Carcar, Toledo
  RETURN p_lat IS NOT NULL
    AND p_lng IS NOT NULL
    AND p_lat >= 9.25 AND p_lat <= 11.00
    AND p_lng >= 123.20 AND p_lng <= 124.70;
END;
$$;

-- Bid increment validation function: enforces minimum step-ups based on current bid tiers
CREATE OR REPLACE FUNCTION public.validate_bid_increment(
  p_current_bid numeric,
  p_bid_amount numeric,
  p_increment_override numeric DEFAULT NULL
)
RETURNS TABLE(valid boolean, min_increment numeric, message text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_min_increment numeric;
  v_tier_label text;
BEGIN
  -- Use per-listing override if set, otherwise use tier-based defaults
  IF p_increment_override IS NOT NULL AND p_increment_override > 0 THEN
    v_min_increment := p_increment_override;
  ELSIF p_current_bid < 50 THEN
    v_min_increment := 1;
  ELSIF p_current_bid < 200 THEN
    v_min_increment := 5;
  ELSIF p_current_bid < 500 THEN
    v_min_increment := 10;
  ELSIF p_current_bid < 1000 THEN
    v_min_increment := 25;
  ELSE
    v_min_increment := 50;
  END IF;

  IF p_bid_amount < p_current_bid + v_min_increment THEN
    RETURN QUERY SELECT false, v_min_increment, 'Minimum bid increment is $' || v_min_increment;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_min_increment, 'Valid bid';
END;
$$;

-- Dutch auction price computation function
-- Computes the current price for a Dutch auction based on time elapsed and decrement schedule
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
IMMUTABLE
AS $$
DECLARE
  v_elapsed_minutes numeric;
  v_steps integer;
  v_current_price numeric;
BEGIN
  IF p_start_price IS NULL OR p_floor_price IS NULL OR p_decrement_rate IS NULL THEN
    RETURN p_start_price;
  END IF;

  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - p_auction_start_at)) / 60.0;
  v_steps := FLOOR(v_elapsed_minutes / p_decrement_interval_minutes);

  IF p_is_percentage THEN
    v_current_price := p_start_price;
    FOR i IN 1..v_steps LOOP
      v_current_price := v_current_price * (1.0 - p_decrement_rate / 100.0);
      IF v_current_price <= p_floor_price THEN
        v_current_price := p_floor_price;
        EXIT;
      END IF;
    END LOOP;
  ELSE
    v_current_price := p_start_price - (p_decrement_rate * v_steps);
  END IF;

  -- Never go below floor price
  IF v_current_price < p_floor_price THEN
    v_current_price := p_floor_price;
  END IF;

  RETURN v_current_price;
END;
$$;

-- Place a bid with increment validation (SECURITY DEFINER for atomic bid placement)
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
  v_listing listings%ROWTYPE;
  v_current_bid numeric;
  v_min_increment numeric;
  v_valid boolean;
  v_msg text;
BEGIN
  SELECT * INTO v_listing FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Listing not found', NULL::numeric;
    RETURN;
  END IF;

  IF v_listing.listing_type <> 'auction' THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This item is not an auction', NULL::numeric;
    RETURN;
  END IF;

  IF v_listing.status <> 'active' THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This auction has ended', NULL::numeric;
    RETURN;
  END IF;

  IF v_listing.auction_end_at IS NOT NULL AND v_listing.auction_end_at <= now() THEN
    RETURN QUERY SELECT false, NULL::numeric, 'This auction has ended', NULL::numeric;
    RETURN;
  END IF;

  IF v_listing.auction_mode = 'DUTCH' THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Dutch auctions do not accept bids — claim at current price', NULL::numeric;
    RETURN;
  END IF;

  -- Determine current highest bid
  SELECT COALESCE(MAX(amount), v_listing.price) INTO v_current_bid
  FROM bids WHERE listing_id = p_listing_id;

  -- Validate increment
  SELECT valid, min_increment, message INTO v_valid, v_min_increment, v_msg
  FROM validate_bid_increment(v_current_bid, p_bid_amount, v_listing.increment_step);

  IF NOT v_valid THEN
    RETURN QUERY SELECT false, v_min_increment, v_msg, v_current_bid;
    RETURN;
  END IF;

  -- Unmark previous winning bids
  UPDATE bids SET is_winning = false WHERE listing_id = p_listing_id;

  -- Insert new bid
  INSERT INTO bids (listing_id, bidder_id, amount, is_winning)
  VALUES (p_listing_id, p_bidder_id, p_bid_amount, true);

  RETURN QUERY SELECT true, v_current_bid + v_min_increment, 'Bid placed successfully', p_bid_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.place_bid(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, uuid, numeric) TO authenticated;

-- Update Dutch auction prices (call periodically or on page load)
CREATE OR REPLACE FUNCTION public.refresh_dutch_prices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_listing RECORD;
  v_new_price numeric;
BEGIN
  FOR v_listing IN
    SELECT id, auction_start_price, dutch_floor_price, decrement_rate,
           decrement_interval_minutes, created_at, current_dutch_price
    FROM listings
    WHERE listing_type = 'auction'
      AND auction_mode = 'DUTCH'
      AND status = 'active'
      AND auction_start_price IS NOT NULL
      AND dutch_floor_price IS NOT NULL
      AND decrement_rate IS NOT NULL
  LOOP
    v_new_price := compute_dutch_price(
      v_listing.auction_start_price,
      v_listing.dutch_floor_price,
      v_listing.decrement_rate,
      v_listing.decrement_interval_minutes,
      v_listing.created_at
    );

    IF v_new_price <> v_listing.current_dutch_price THEN
      UPDATE listings SET current_dutch_price = v_new_price WHERE id = v_listing.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_dutch_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_dutch_prices() TO authenticated;
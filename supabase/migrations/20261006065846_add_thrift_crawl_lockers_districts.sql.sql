/*
# Add Thrift Crawl Itineraries, Locker Network, and Cebu Districts

## Overview
This migration adds three subsystems to ThriftSync:
1. Interactive Thrift Crawl Itinerary Engine — multi-stop boutique routes
2. Cebu District Geofencing — sub-region tagging and filtering
3. Secure Partner Locker Network — PIN-based item handoffs

## New Tables
- cebu_districts: Cebu sub-regions with center coordinates and radius
- itineraries: User-saved thrift crawl routes with ordered stops
- locker_locations: Partner pickup/drop-off points with capacity tracking
- locker_handoffs: Secure PIN-based handoff records

## Modified Tables
- boutiques: added district_id FK
- profiles: added district_id FK

## Security
- RLS on all new tables; cebu_districts and locker_locations are public read
- itineraries and locker_handoffs are owner-scoped
- SECURITY DEFINER functions for PIN generation, pickup confirmation, district assignment
*/

-- Create cebu_districts reference table
CREATE TABLE IF NOT EXISTS cebu_districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city_municipality text NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  radius_km double precision NOT NULL DEFAULT 2.0,
  is_metro boolean NOT NULL DEFAULT true,
  UNIQUE (name, city_municipality)
);

ALTER TABLE cebu_districts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read cebu_districts" ON cebu_districts;
CREATE POLICY "Public read cebu_districts" ON cebu_districts FOR SELECT
  TO anon, authenticated USING (true);

INSERT INTO cebu_districts (name, city_municipality, center_lat, center_lng, radius_km, is_metro) VALUES
  ('IT Park', 'Cebu City', 10.3300, 123.9050, 1.5, true),
  ('Lahug', 'Cebu City', 10.3389, 123.9033, 2.0, true),
  ('Guadalupe', 'Cebu City', 10.3156, 123.8833, 2.5, true),
  ('Mabolo', 'Cebu City', 10.3183, 123.9050, 2.0, true),
  ('Banilad', 'Cebu City', 10.3392, 123.9133, 2.5, true),
  ('Capitol Site', 'Cebu City', 10.3167, 123.8856, 1.5, true),
  ('Kamputhaw', 'Cebu City', 10.3258, 123.8983, 1.5, true),
  ('Pardo', 'Cebu City', 10.2983, 123.8683, 3.0, true),
  ('Downtown Colon', 'Cebu City', 10.2933, 123.9000, 2.0, true),
  ('Mandaue City Proper', 'Mandaue City', 10.3300, 123.9300, 3.0, true),
  ('Banilad Mandaue', 'Mandaue City', 10.3400, 123.9200, 2.5, true),
  ('Maguikay', 'Mandaue City', 10.3250, 123.9350, 2.0, true),
  ('Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.3050, 124.0050, 3.0, true),
  ('Mactan', 'Lapu-Lapu City', 10.2900, 124.0150, 4.0, true),
  ('Maribago', 'Lapu-Lapu City', 10.2850, 124.0000, 3.0, true),
  ('Talisay City Proper', 'Talisay City', 10.2500, 123.8500, 3.0, true),
  ('Minglanilla', 'Minglanilla', 10.2400, 123.7900, 4.0, true),
  ('Naga City', 'Naga City', 10.2100, 123.7600, 4.0, true),
  ('Danao City', 'Danao City', 10.5600, 124.0000, 5.0, false),
  ('Carcar City', 'Carcar City', 10.1200, 123.6400, 5.0, false),
  ('Toledo City', 'Toledo City', 10.3900, 123.6400, 5.0, false)
ON CONFLICT (name, city_municipality) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cebu_districts_city ON cebu_districts(city_municipality);
CREATE INDEX IF NOT EXISTS idx_cebu_districts_metro ON cebu_districts(is_metro);

-- Add district_id to boutiques
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boutiques' AND column_name = 'district_id') THEN
    ALTER TABLE boutiques ADD COLUMN district_id uuid REFERENCES cebu_districts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add district_id to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'district_id') THEN
    ALTER TABLE profiles ADD COLUMN district_id uuid REFERENCES cebu_districts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create itineraries table
CREATE TABLE IF NOT EXISTS itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  transport_mode text NOT NULL DEFAULT 'driving' CHECK (transport_mode IN ('walking', 'driving', 'jeepney')),
  total_distance_km numeric NOT NULL DEFAULT 0,
  total_time_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
  scheduled_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE itineraries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_itineraries" ON itineraries;
CREATE POLICY "select_own_itineraries" ON itineraries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_itineraries" ON itineraries;
CREATE POLICY "insert_own_itineraries" ON itineraries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_itineraries" ON itineraries;
CREATE POLICY "update_own_itineraries" ON itineraries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_itineraries" ON itineraries;
CREATE POLICY "delete_own_itineraries" ON itineraries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_itineraries_user ON itineraries(user_id);

-- Create locker_locations table
CREATE TABLE IF NOT EXISTS locker_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name text NOT NULL,
  address text NOT NULL,
  barangay text,
  city_municipality text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  district_id uuid REFERENCES cebu_districts(id) ON DELETE SET NULL,
  operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  capacity_total integer NOT NULL DEFAULT 12 CHECK (capacity_total > 0),
  capacity_available integer NOT NULL DEFAULT 12 CHECK (capacity_available >= 0),
  is_active boolean NOT NULL DEFAULT true,
  contact_phone text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE locker_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read locker_locations" ON locker_locations;
CREATE POLICY "Public read locker_locations" ON locker_locations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admin insert locker_locations" ON locker_locations;
CREATE POLICY "Admin insert locker_locations" ON locker_locations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Admin update locker_locations" ON locker_locations;
CREATE POLICY "Admin update locker_locations" ON locker_locations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Admin delete locker_locations" ON locker_locations;
CREATE POLICY "Admin delete locker_locations" ON locker_locations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_locker_locations_active ON locker_locations(is_active);
CREATE INDEX IF NOT EXISTS idx_locker_locations_district ON locker_locations(district_id);

-- Seed sample partner locker locations
INSERT INTO locker_locations (partner_name, address, barangay, city_municipality, lat, lng, operating_hours, capacity_total, capacity_available, contact_phone) VALUES
  ('The Coffee Hub - IT Park', 'Block 9, IT Park, Lahug', 'Lahug', 'Cebu City', 10.3315, 123.9060, '{"mon":"7:00-21:00","tue":"7:00-21:00","wed":"7:00-21:00","thu":"7:00-21:00","fri":"7:00-21:00","sat":"8:00-20:00","sun":"8:00-18:00"}', 8, 8, '+63-32-234-5678'),
  ('Banilad Town Center Locker', 'BTB, A.S. Fortuna St, Banilad', 'Banilad', 'Cebu City', 10.3380, 123.9120, '{"mon":"10:00-22:00","tue":"10:00-22:00","wed":"10:00-22:00","thu":"10:00-22:00","fri":"10:00-22:00","sat":"10:00-22:00","sun":"10:00-20:00"}', 12, 10, '+63-32-345-6789'),
  ('Mandaue Express Hub', 'A.C. Cortes Ave, Mandaue City', 'Maguikay', 'Mandaue City', 10.3260, 123.9340, '{"mon":"8:00-20:00","tue":"8:00-20:00","wed":"8:00-20:00","thu":"8:00-20:00","fri":"8:00-20:00","sat":"8:00-18:00","sun":"closed"}', 6, 5, '+63-32-456-7890'),
  ('Mactan Pickup Point', 'Maribago, Lapu-Lapu City', 'Maribago', 'Lapu-Lapu City', 10.2860, 124.0010, '{"mon":"9:00-18:00","tue":"9:00-18:00","wed":"9:00-18:00","thu":"9:00-18:00","fri":"9:00-18:00","sat":"9:00-17:00","sun":"closed"}', 4, 4, '+63-32-567-8901'),
  ('Talisay Drop Station', 'N. Bacalso Ave, Talisay City', 'Talisay', 'Talisay City', 10.2510, 123.8510, '{"mon":"8:00-19:00","tue":"8:00-19:00","wed":"8:00-19:00","thu":"8:00-19:00","fri":"8:00-19:00","sat":"8:00-17:00","sun":"closed"}', 6, 6, '+63-32-678-9012')
ON CONFLICT DO NOTHING;

-- Create locker_handoffs table
CREATE TABLE IF NOT EXISTS locker_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locker_location_id uuid NOT NULL REFERENCES locker_locations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DROPPED_OFF', 'PICKED_UP', 'EXPIRED', 'CANCELLED')),
  drop_off_window_start timestamptz,
  drop_off_window_end timestamptz,
  dropped_off_at timestamptz,
  picked_up_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE locker_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_handoffs" ON locker_handoffs;
CREATE POLICY "select_own_handoffs" ON locker_handoffs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_handoffs" ON locker_handoffs;
CREATE POLICY "insert_own_handoffs" ON locker_handoffs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_handoffs" ON locker_handoffs;
CREATE POLICY "update_own_handoffs" ON locker_handoffs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_handoffs" ON locker_handoffs;
CREATE POLICY "delete_own_handoffs" ON locker_handoffs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_locker_handoffs_user ON locker_handoffs(user_id);
CREATE INDEX IF NOT EXISTS idx_locker_handoffs_locker ON locker_handoffs(locker_location_id);
CREATE INDEX IF NOT EXISTS idx_locker_handoffs_status ON locker_handoffs(status);

-- Generate secure 6-digit handoff PIN
CREATE OR REPLACE FUNCTION public.generate_handoff_pin(
  p_locker_location_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_window_hours integer DEFAULT 48
)
RETURNS TABLE(handoff_id uuid, pin_code text, locker_name text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pin text;
  v_user_id uuid;
  v_exists boolean;
  v_locker locker_locations%ROWTYPE;
  v_expiry timestamptz;
  v_handoff_id uuid;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User authentication required';
  END IF;

  SELECT * INTO v_locker FROM locker_locations WHERE id = p_locker_location_id AND is_active = true;
  IF v_locker.id IS NULL THEN
    RAISE EXCEPTION 'Locker location not found or inactive';
  END IF;

  IF v_locker.capacity_available <= 0 THEN
    RAISE EXCEPTION 'No available compartments at this locker location';
  END IF;

  LOOP
    v_pin := lpad(floor(random() * 1000000)::text, 6, '0');
    SELECT EXISTS (
      SELECT 1 FROM locker_handoffs
      WHERE locker_location_id = p_locker_location_id
        AND pin_code = v_pin
        AND status IN ('PENDING', 'DROPPED_OFF')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  v_expiry := now() + (p_window_hours || ' hours')::interval;

  INSERT INTO locker_handoffs (locker_location_id, order_id, user_id, pin_code, status, drop_off_window_start, drop_off_window_end)
  VALUES (p_locker_location_id, p_order_id, v_user_id, v_pin, 'PENDING', now(), v_expiry)
  RETURNING id INTO v_handoff_id;

  UPDATE locker_locations
  SET capacity_available = capacity_available - 1
  WHERE id = p_locker_location_id;

  RETURN QUERY SELECT v_handoff_id, v_pin, v_locker.partner_name, v_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_handoff_pin(uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_handoff_pin(uuid, uuid, uuid, integer) TO authenticated;

-- Confirm handoff pickup (verify PIN)
CREATE OR REPLACE FUNCTION public.confirm_handoff_pickup(
  p_handoff_id uuid,
  p_pin_code text,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handoff locker_handoffs%ROWTYPE;
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Authentication required';
    RETURN;
  END IF;

  SELECT * INTO v_handoff FROM locker_handoffs WHERE id = p_handoff_id FOR UPDATE;
  IF v_handoff.id IS NULL THEN
    RETURN QUERY SELECT false, 'Handoff record not found';
    RETURN;
  END IF;

  IF v_handoff.user_id <> v_user_id THEN
    RETURN QUERY SELECT false, 'Not authorized to confirm this handoff';
    RETURN;
  END IF;

  IF v_handoff.pin_code <> p_pin_code THEN
    RETURN QUERY SELECT false, 'Invalid PIN code';
    RETURN;
  END IF;

  IF v_handoff.status = 'EXPIRED' OR (v_handoff.drop_off_window_end IS NOT NULL AND v_handoff.drop_off_window_end < now()) THEN
    UPDATE locker_handoffs SET status = 'EXPIRED' WHERE id = p_handoff_id;
    RETURN QUERY SELECT false, 'This handoff window has expired';
    RETURN;
  END IF;

  IF v_handoff.status = 'PICKED_UP' THEN
    RETURN QUERY SELECT false, 'Item already picked up';
    RETURN;
  END IF;

  UPDATE locker_handoffs
  SET status = 'PICKED_UP', picked_up_at = now()
  WHERE id = p_handoff_id;

  UPDATE locker_locations
  SET capacity_available = capacity_available + 1
  WHERE id = v_handoff.locker_location_id;

  RETURN QUERY SELECT true, 'Pickup confirmed successfully';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_handoff_pickup(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_handoff_pickup(uuid, text, uuid) TO authenticated;

-- Mark item as dropped off at locker
CREATE OR REPLACE FUNCTION public.mark_dropped_off(
  p_handoff_id uuid,
  p_pin_code text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handoff locker_handoffs%ROWTYPE;
BEGIN
  SELECT * INTO v_handoff FROM locker_handoffs WHERE id = p_handoff_id FOR UPDATE;
  IF v_handoff.id IS NULL THEN
    RETURN QUERY SELECT false, 'Handoff record not found';
    RETURN;
  END IF;

  IF v_handoff.pin_code <> p_pin_code THEN
    RETURN QUERY SELECT false, 'Invalid PIN code';
    RETURN;
  END IF;

  IF v_handoff.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'Handoff is not in pending state';
    RETURN;
  END IF;

  UPDATE locker_handoffs
  SET status = 'DROPPED_OFF', dropped_off_at = now()
  WHERE id = p_handoff_id;

  RETURN QUERY SELECT true, 'Item marked as dropped off';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dropped_off(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dropped_off(uuid, text) TO authenticated;

-- Assign boutique to nearest district based on coordinates
CREATE OR REPLACE FUNCTION public.assign_boutique_district(
  p_boutique_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boutique boutiques%ROWTYPE;
  v_district_id uuid;
  v_min_dist double precision := Infinity;
  v_dist double precision;
  d RECORD;
BEGIN
  SELECT * INTO v_boutique FROM boutiques WHERE id = p_boutique_id;
  IF v_boutique.lat IS NULL OR v_boutique.lng IS NULL THEN
    RETURN NULL;
  END IF;

  FOR d IN SELECT * FROM cebu_districts LOOP
    v_dist := sqrt(power(d.center_lat - v_boutique.lat, 2) + power(d.center_lng - v_boutique.lng, 2)) * 111.0;
    IF v_dist < v_min_dist AND v_dist <= d.radius_km THEN
      v_min_dist := v_dist;
      v_district_id := d.id;
    END IF;
  END LOOP;

  IF v_district_id IS NOT NULL THEN
    UPDATE boutiques SET district_id = v_district_id WHERE id = p_boutique_id;
  END IF;

  RETURN v_district_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_boutique_district(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_boutique_district(uuid) TO authenticated;
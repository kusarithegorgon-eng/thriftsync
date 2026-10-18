-- Run only in a development/demo Supabase project.
-- Replace both email values with existing ThriftSync test accounts before running.
-- The buyer and seller must be different accounts, with matching buyer/seller profile roles.
-- This creates a pending locker order with the demo PIN 482915. It does not reset an
-- existing order, so run once per demo database or remove these fixed-ID rows first.

BEGIN;

DO $$
DECLARE
  v_buyer_email text := 'REPLACE_WITH_BUYER_EMAIL';
  v_seller_email text := 'REPLACE_WITH_SELLER_EMAIL';
  v_buyer_id uuid;
  v_seller_id uuid;
  v_boutique_id uuid;
  v_locker_id constant uuid := 'e0000000-0000-4000-8000-000000000090';
  v_demo_boutique_id constant uuid := 'c0000000-0000-4000-8000-000000000090';
  v_listing_id constant uuid := 'b0000000-0000-4000-8000-000000000090';
  v_order_id constant uuid := 'a0000000-0000-4000-8000-000000000090';
  v_handoff_id constant uuid := 'f0000000-0000-4000-8000-000000000090';
  v_capacity integer;
  v_rows_inserted integer;
BEGIN
  IF v_buyer_email = 'REPLACE_WITH_BUYER_EMAIL'
    OR v_seller_email = 'REPLACE_WITH_SELLER_EMAIL' THEN
    RAISE EXCEPTION 'Edit the buyer and seller email values at the top of this seed script.';
  END IF;

  SELECT id INTO v_buyer_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(v_buyer_email));
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Buyer account % was not found in auth.users.', v_buyer_email;
  END IF;

  SELECT id INTO v_seller_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(v_seller_email));
  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Seller account % was not found in auth.users.', v_seller_email;
  END IF;
  IF v_buyer_id = v_seller_id THEN
    RAISE EXCEPTION 'Use separate buyer and seller accounts for the handoff demo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_buyer_id AND role = 'buyer') THEN
    RAISE EXCEPTION 'The buyer account must have a ThriftSync buyer profile.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_seller_id AND role = 'seller') THEN
    RAISE EXCEPTION 'The seller account must have a ThriftSync seller profile.';
  END IF;

  INSERT INTO locker_locations (
    id, partner_name, address, barangay, city_municipality, lat, lng,
    operating_hours, capacity_total, capacity_available, is_active,
    contact_phone
  )
  VALUES (
    v_locker_id, 'ThriftSync Demo Locker', 'Demo pickup point, IT Park',
    'Lahug', 'Cebu City', 10.3315, 123.9060,
    '{"mon":"8:00-20:00","tue":"8:00-20:00","wed":"8:00-20:00","thu":"8:00-20:00","fri":"8:00-20:00","sat":"9:00-18:00","sun":"9:00-18:00"}'::jsonb,
    6, 6, true, NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET partner_name = EXCLUDED.partner_name,
      address = EXCLUDED.address,
      barangay = EXCLUDED.barangay,
      city_municipality = EXCLUDED.city_municipality,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      operating_hours = EXCLUDED.operating_hours,
      is_active = true;

  SELECT id INTO v_boutique_id
  FROM boutiques
  WHERE seller_id = v_seller_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_boutique_id IS NULL THEN
    INSERT INTO boutiques (
      id, seller_id, name, slug, tagline, bio, location, barangay,
      lat, lng, pickup_available, courier_delivery
    )
    VALUES (
      v_demo_boutique_id, v_seller_id, 'Locker Demo Boutique',
      'locker-demo-' || left(replace(v_seller_id::text, '-', ''), 12),
      'A sample shop for the locker handoff walkthrough.',
      'Demo storefront created for the ThriftSync locker pickup walkthrough.',
      'IT Park, Cebu City', 'Lahug', 10.3315, 123.9060, true, true
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT id INTO v_boutique_id
    FROM boutiques
    WHERE id = v_demo_boutique_id AND seller_id = v_seller_id;
    IF v_boutique_id IS NULL THEN
      RAISE EXCEPTION 'The fixed demo boutique ID is already used by another seller.';
    END IF;
  END IF;

  INSERT INTO listings (
    id, boutique_id, title, description, price, era, category,
    condition_grade, material, images, status, moderation_status,
    moderated_at, created_at
  )
  VALUES (
    v_listing_id, v_boutique_id, 'Demo Locker Handoff Item',
    'A sample item reserved to demonstrate the order-to-locker pickup process. Not a real sale.',
    100, 'Demo', 'Accessories', 'Good', 'Demo item', ARRAY[]::text[],
    'sold', 'approved', now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM listings WHERE id = v_listing_id AND boutique_id = v_boutique_id
  ) THEN
    RAISE EXCEPTION 'The fixed demo listing ID is already used by another boutique.';
  END IF;

  INSERT INTO orders (
    id, buyer_id, listing_id, boutique_id, amount, status, shipping_address,
    delivery_method, locker_location_id, created_at
  )
  VALUES (
    v_order_id, v_buyer_id, v_listing_id, v_boutique_id, 100, 'escrow_held',
    'Demo locker order - no payment or shipment.',
    'locker', v_locker_id, now()
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM orders
    WHERE id = v_order_id
      AND buyer_id = v_buyer_id
      AND listing_id = v_listing_id
      AND boutique_id = v_boutique_id
      AND delivery_method = 'locker'
      AND locker_location_id = v_locker_id
  ) THEN
    RAISE EXCEPTION 'The fixed demo order ID is already used by another order.';
  END IF;

  SELECT capacity_available INTO v_capacity
  FROM locker_locations
  WHERE id = v_locker_id
  FOR UPDATE;

  INSERT INTO locker_handoffs (
    id, locker_location_id, order_id, user_id, pin_code, status,
    drop_off_window_start, drop_off_window_end, created_at
  )
  VALUES (
    v_handoff_id, v_locker_id, v_order_id, v_buyer_id, '482915', 'PENDING',
    now(), now() + interval '48 hours', now()
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted = 1 THEN
    IF v_capacity < 1 THEN
      RAISE EXCEPTION 'The demo locker has no free compartments.';
    END IF;
    UPDATE locker_locations
    SET capacity_available = capacity_available - 1
    WHERE id = v_locker_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM locker_handoffs
    WHERE id = v_handoff_id
      AND order_id = v_order_id
      AND user_id = v_buyer_id
      AND locker_location_id = v_locker_id
  ) THEN
    RAISE EXCEPTION 'The fixed demo handoff ID is already used by another handoff.';
  END IF;
END;
$$;

COMMIT;

CREATE OR REPLACE FUNCTION public.checkout_items(
  p_items jsonb,
  p_shipping_address text,
  p_voucher_code text DEFAULT NULL
)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item_count integer;
  v_order_ids uuid[] := '{}';
  v_listing listings%ROWTYPE;
  v_item jsonb;
  v_voucher vouchers%ROWTYPE;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_order_id uuid;
  v_user_uses integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to place an order.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) < 1
    OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'The cart is empty or invalid.';
  END IF;

  SELECT count(*), count(DISTINCT cart.item->>'listing_id')
  INTO v_item_count, v_user_uses
  FROM jsonb_array_elements(p_items) AS cart(item);
  IF v_item_count <> v_user_uses THEN
    RAISE EXCEPTION 'A listing appears more than once in the cart.';
  END IF;

  PERFORM 1
  FROM listings
  WHERE id IN (
    SELECT (cart.item->>'listing_id')::uuid
    FROM jsonb_array_elements(p_items) AS cart(item)
  )
  ORDER BY id
  FOR UPDATE;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_listing
    FROM listings
    WHERE id = (v_item->>'listing_id')::uuid;

    IF NOT FOUND OR v_listing.status <> 'active' OR v_listing.moderation_status <> 'approved' THEN
      RAISE EXCEPTION 'One or more cart items are no longer available.';
    END IF;
    IF (v_item->>'amount')::numeric <> v_listing.price THEN
      RAISE EXCEPTION 'An item price changed. Refresh your cart.';
    END IF;
    v_subtotal := v_subtotal + v_listing.price;
  END LOOP;

  IF p_voucher_code IS NOT NULL AND btrim(p_voucher_code) <> '' THEN
    SELECT * INTO v_voucher
    FROM vouchers
    WHERE upper(code) = upper(btrim(p_voucher_code))
    FOR UPDATE;
    IF NOT FOUND OR v_voucher.status <> 'ACTIVE'
      OR (v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at <= now()) THEN
      RAISE EXCEPTION 'The voucher is invalid or expired.';
    END IF;
    IF v_voucher.max_uses IS NOT NULL AND v_voucher.uses >= v_voucher.max_uses THEN
      RAISE EXCEPTION 'This voucher has reached its usage limit.';
    END IF;
    SELECT count(*) INTO v_user_uses
    FROM voucher_redemptions
    WHERE voucher_id = v_voucher.id AND user_id = v_user_id;
    IF v_user_uses >= v_voucher.max_uses_per_user THEN
      RAISE EXCEPTION 'You have already used this voucher.';
    END IF;
    IF v_subtotal < v_voucher.min_spend THEN
      RAISE EXCEPTION 'The cart does not meet this voucher minimum spend.';
    END IF;
    IF NOT v_voucher.auction_eligible AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS cart(item)
      JOIN listings l ON l.id = (cart.item->>'listing_id')::uuid
      WHERE l.listing_type = 'auction'
    ) THEN
      RAISE EXCEPTION 'This voucher does not apply to auction items.';
    END IF;
    IF v_voucher.scope = 'BOUTIQUE' AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS cart(item)
      JOIN listings l ON l.id = (cart.item->>'listing_id')::uuid
      WHERE l.boutique_id <> v_voucher.boutique_id
    ) THEN
      RAISE EXCEPTION 'This voucher does not apply to all cart items.';
    END IF;
    IF v_voucher.scope = 'CATEGORY' AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS cart(item)
      JOIN listings l ON l.id = (cart.item->>'listing_id')::uuid
      WHERE l.category IS DISTINCT FROM v_voucher.category
    ) THEN
      RAISE EXCEPTION 'This voucher does not apply to all cart items.';
    END IF;

    v_discount := CASE
      WHEN v_voucher.discount_type = 'PERCENTAGE'
        THEN v_subtotal * v_voucher.discount_value / 100
      ELSE LEAST(v_voucher.discount_value, v_subtotal)
    END;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_listing
    FROM listings
    WHERE id = (v_item->>'listing_id')::uuid;

    v_order_id := gen_random_uuid();
    INSERT INTO orders (id, buyer_id, listing_id, boutique_id, amount, status, shipping_address)
    VALUES (
      v_order_id, v_user_id, v_listing.id, v_listing.boutique_id,
      v_listing.price, 'escrow_held', left(coalesce(p_shipping_address, ''), 2000)
    );
    UPDATE listings SET status = 'sold' WHERE id = v_listing.id;
    v_order_ids := array_append(v_order_ids, v_order_id);
  END LOOP;

  IF v_voucher.id IS NOT NULL THEN
    UPDATE vouchers SET uses = uses + 1, updated_at = now()
    WHERE id = v_voucher.id;
    INSERT INTO voucher_redemptions (
      voucher_id, user_id, order_id, cart_total_at_redemption, discount_amount
    )
    VALUES (v_voucher.id, v_user_id, v_order_ids[1], v_subtotal, v_discount);
  END IF;

  RETURN QUERY SELECT v_order_ids, v_discount;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_items(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_items(jsonb, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('buyer', 'seller')
        THEN NEW.raw_user_meta_data->>'role'
      ELSE 'buyer'
    END
  );
  RETURN NEW;
END;
$$;

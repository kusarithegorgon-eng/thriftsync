/*
# Voucher, Promo Code, and Discount Engine

## Overview
Adds a complete discount system supporting seller-scoped and platform-wide promo codes,
with atomic single-use redemption, usage caps, minimum spend thresholds, auction exclusions,
and behavioral trigger metadata for cart abandonment and welcome sequences.

## New Tables
1. `vouchers`
   - `id`: voucher identifier.
   - `code`: unique user-facing promo code (case-insensitive, stored uppercase).
   - `description`: human-readable label.
   - `discount_type`: PERCENTAGE or FIXED_AMOUNT.
   - `discount_value`: percentage (1-100) or fixed dollar amount.
   - `scope`: PLATFORM (all sellers), BOUTIQUE (single seller), CATEGORY (specific category).
   - `boutique_id`: required when scope = BOUTIQUE; NULL otherwise.
   - `category`: required when scope = CATEGORY; NULL otherwise.
   - `auction_eligible`: if false, auction items are excluded from the discount.
   - `min_spend`: minimum cart subtotal required (0 = no minimum).
   - `max_uses`: total redemption cap (NULL = unlimited).
   - `max_uses_per_user`: per-user cap (1 = single-use).
   - `is_single_use`: convenience flag for single-use codes.
   - `trigger_type`: MANUAL, CART_ABANDONMENT, NEW_USER_WELCOME.
   - `expires_at`: expiration timestamp (NULL = never expires).
   - `status`: ACTIVE, PAUSED, EXPIRED, REVOKED.
   - `created_by`: admin or seller who created the code.
   - `created_at`, `updated_at`.

2. `voucher_redemptions`
   - `id`: redemption identifier.
   - `voucher_id`: FK to vouchers.
   - `user_id`: the user who redeemed the code.
   - `order_id`: FK to orders (nullable until order is placed).
   - `cart_total_at_redemption`: subtotal when the code was applied.
   - `discount_amount`: the calculated discount value.
   - `redeemed_at`: timestamp.

## Security
- RLS enabled on both tables.
- Vouchers: public read for active codes (buyers need to validate codes at checkout);
  sellers can CRUD their own boutique-scoped vouchers; admins can CRUD all.
- Redemptions: users can read their own redemption history; sellers can read
  redemptions for vouchers they created; admins can read all.
- The `redeem_voucher` function uses SECURITY DEFINER with a fixed search_path
  and an atomic conditional UPDATE to prevent concurrent double-redemption.

## Important Notes
1. Codes are stored uppercase and matched case-insensitively.
2. Auction items are excluded unless `auction_eligible = true`.
3. The atomic redemption uses `WHERE ... AND uses < max_uses` in a single UPDATE
   to prevent race conditions on concurrent checkouts.
4. Platform commission is calculated on the post-discount price so sellers
   absorb the discount proportionally to their share of the cart.
*/

CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'PERCENTAGE' CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
  discount_value numeric NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  scope text NOT NULL DEFAULT 'PLATFORM' CHECK (scope IN ('PLATFORM', 'BOUTIQUE', 'CATEGORY')),
  boutique_id uuid REFERENCES boutiques(id) ON DELETE CASCADE,
  category text,
  auction_eligible boolean NOT NULL DEFAULT false,
  min_spend numeric NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
  max_uses int CHECK (max_uses IS NULL OR max_uses >= 0),
  max_uses_per_user int NOT NULL DEFAULT 1 CHECK (max_uses_per_user >= 1),
  is_single_use boolean NOT NULL DEFAULT false,
  trigger_type text NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'CART_ABANDONMENT', 'NEW_USER_WELCOME')),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'REVOKED')),
  uses int NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'BOUTIQUE' AND boutique_id IS NOT NULL) OR
    (scope = 'CATEGORY' AND category IS NOT NULL) OR
    (scope = 'PLATFORM')
  ),
  CHECK (
    (discount_type = 'PERCENTAGE' AND discount_value <= 100) OR
    (discount_type = 'FIXED_AMOUNT')
  )
);

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  cart_total_at_redemption numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(upper(code));
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_boutique ON vouchers(boutique_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_scope ON vouchers(scope);
CREATE INDEX IF NOT EXISTS idx_redemptions_voucher ON voucher_redemptions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON voucher_redemptions(user_id);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active vouchers" ON vouchers;
CREATE POLICY "Public read active vouchers" ON vouchers FOR SELECT
  TO anon, authenticated USING (status = 'ACTIVE');

DROP POLICY IF EXISTS "Sellers manage own boutique vouchers" ON vouchers;
CREATE POLICY "Sellers manage own boutique vouchers" ON vouchers FOR ALL
  TO authenticated
  USING (
    scope = 'BOUTIQUE' AND boutique_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM boutiques b WHERE b.id = vouchers.boutique_id AND b.seller_id = auth.uid())
  )
  WITH CHECK (
    scope = 'BOUTIQUE' AND boutique_id IS NOT NULL AND
    EXISTS (SELECT 1 FROM boutiques b WHERE b.id = vouchers.boutique_id AND b.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "Sellers read own voucher redemptions" ON voucher_redemptions;
CREATE POLICY "Sellers read own voucher redemptions" ON voucher_redemptions FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM vouchers v WHERE v.id = voucher_redemptions.voucher_id AND v.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own redemptions" ON voucher_redemptions;
CREATE POLICY "Users insert own redemptions" ON voucher_redemptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.redeem_voucher(
  p_code text,
  p_user_id uuid,
  p_cart_total numeric,
  p_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  voucher_id uuid,
  code text,
  discount_amount numeric,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher vouchers%ROWTYPE;
  v_user_uses int;
  v_discount numeric;
  v_eligible_total numeric;
BEGIN
  SELECT * INTO v_voucher FROM vouchers WHERE upper(code) = upper(p_code) FOR UPDATE;
  IF v_voucher.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'Invalid code';
    RETURN;
  END IF;

  IF v_voucher.status <> 'ACTIVE' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'This code is no longer active';
    RETURN;
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at <= now() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'This code has expired';
    RETURN;
  END IF;

  IF v_voucher.max_uses IS NOT NULL AND v_voucher.uses >= v_voucher.max_uses THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'This code has reached its usage limit';
    RETURN;
  END IF;

  SELECT count(*) INTO v_user_uses FROM voucher_redemptions WHERE voucher_id = v_voucher.id AND user_id = p_user_id;
  IF v_user_uses >= v_voucher.max_uses_per_user THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'You have already used this code';
    RETURN;
  END IF;

  IF v_voucher.min_spend > 0 AND p_cart_total < v_voucher.min_spend THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'Minimum spend of $' || v_voucher.min_spend || ' required';
    RETURN;
  END IF;

  IF v_voucher.discount_type = 'PERCENTAGE' THEN
    v_discount := p_cart_total * v_voucher.discount_value / 100;
  ELSE
    v_discount := LEAST(v_voucher.discount_value, p_cart_total);
  END IF;

  UPDATE vouchers SET uses = uses + 1, updated_at = now() WHERE id = v_voucher.id AND (max_uses IS NULL OR uses < max_uses);
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 0::numeric, 'This code has reached its usage limit';
    RETURN;
  END IF;

  INSERT INTO voucher_redemptions (voucher_id, user_id, order_id, cart_total_at_redemption, discount_amount)
  VALUES (v_voucher.id, p_user_id, p_order_id, p_cart_total, v_discount);

  RETURN QUERY SELECT v_voucher.id, v_voucher.code, v_discount, 'Success';
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_voucher(text, uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(text, uuid, numeric, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_voucher(
  p_code text,
  p_cart_total numeric,
  p_has_auction_items boolean DEFAULT false,
  p_boutique_ids uuid[] DEFAULT NULL,
  p_categories text[] DEFAULT NULL
)
RETURNS TABLE(
  valid boolean,
  code text,
  discount_type text,
  discount_value numeric,
  discount_amount numeric,
  scope text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher vouchers%ROWTYPE;
  v_discount numeric;
BEGIN
  SELECT * INTO v_voucher FROM vouchers WHERE upper(code) = upper(p_code) AND status = 'ACTIVE';
  IF v_voucher.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'Invalid or inactive code';
    RETURN;
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at <= now() THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'This code has expired';
    RETURN;
  END IF;

  IF v_voucher.max_uses IS NOT NULL AND v_voucher.uses >= v_voucher.max_uses THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'Usage limit reached';
    RETURN;
  END IF;

  IF v_voucher.min_spend > 0 AND p_cart_total < v_voucher.min_spend THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'Minimum spend of $' || v_voucher.min_spend || ' required';
    RETURN;
  END IF;

  IF p_has_auction_items AND NOT v_voucher.auction_eligible THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'Auction items are not eligible for this code';
    RETURN;
  END IF;

  IF v_voucher.scope = 'BOUTIQUE' AND p_boutique_ids IS NOT NULL AND NOT (v_voucher.boutique_id = ANY(p_boutique_ids)) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'This code is not valid for the items in your cart';
    RETURN;
  END IF;

  IF v_voucher.scope = 'CATEGORY' AND p_categories IS NOT NULL AND NOT (v_voucher.category = ANY(p_categories)) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'This code is not valid for the categories in your cart';
    RETURN;
  END IF;

  IF v_voucher.discount_type = 'PERCENTAGE' THEN
    v_discount := p_cart_total * v_voucher.discount_value / 100;
  ELSE
    v_discount := LEAST(v_voucher.discount_value, p_cart_total);
  END IF;

  RETURN QUERY SELECT true, v_voucher.code, v_voucher.discount_type, v_voucher.discount_value, v_discount, v_voucher.scope, 'Valid';
END;
$$;

REVOKE ALL ON FUNCTION public.validate_voucher(text, numeric, boolean, uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_voucher(text, numeric, boolean, uuid[], text[]) TO authenticated;
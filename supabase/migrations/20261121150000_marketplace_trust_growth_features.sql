ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS buyer_rating_avg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_rating_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.protect_buyer_rating_summary_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    NEW.buyer_rating_avg := OLD.buyer_rating_avg;
    NEW.buyer_rating_count := OLD.buyer_rating_count;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_seller_rating_summary_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    NEW.seller_rating_avg := OLD.seller_rating_avg;
    NEW.seller_rating_count := OLD.seller_rating_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_buyer_rating_summary ON public.profiles;
CREATE TRIGGER protect_buyer_rating_summary
  BEFORE UPDATE OF buyer_rating_avg, buyer_rating_count ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_buyer_rating_summary_fields();

DROP TRIGGER IF EXISTS protect_seller_rating_summary ON public.boutiques;
CREATE TRIGGER protect_seller_rating_summary
  BEFORE UPDATE OF seller_rating_avg, seller_rating_count ON public.boutiques
  FOR EACH ROW EXECUTE FUNCTION public.protect_seller_rating_summary_fields();

CREATE TABLE IF NOT EXISTS public.buyer_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);

ALTER TABLE public.buyer_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Review participants read buyer reviews" ON public.buyer_reviews;
CREATE POLICY "Review participants read buyer reviews" ON public.buyer_reviews
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (buyer_id, seller_id)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_buyer_reviews_buyer ON public.buyer_reviews(buyer_id);

CREATE OR REPLACE FUNCTION public.refresh_buyer_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id uuid;
BEGIN
  v_buyer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.buyer_id ELSE NEW.buyer_id END;
  UPDATE public.profiles
  SET buyer_rating_avg = COALESCE((
        SELECT round(avg(rating)::numeric, 2)
        FROM public.buyer_reviews
        WHERE buyer_id = v_buyer_id
      ), 0),
      buyer_rating_count = (
        SELECT count(*)::integer
        FROM public.buyer_reviews
        WHERE buyer_id = v_buyer_id
      )
  WHERE id = v_buyer_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_buyer_rating_after_review ON public.buyer_reviews;
CREATE TRIGGER refresh_buyer_rating_after_review
  AFTER INSERT OR UPDATE OR DELETE ON public.buyer_reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_buyer_rating();

CREATE OR REPLACE FUNCTION public.submit_buyer_review(
  p_order_id uuid,
  p_rating integer,
  p_body text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
  v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5 stars.';
  END IF;

  SELECT o.buyer_id, b.seller_id
  INTO v_buyer_id, v_seller_id
  FROM public.orders o
  JOIN public.boutiques b ON b.id = o.boutique_id
  WHERE o.id = p_order_id
    AND o.status = 'completed'
    AND b.seller_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A completed order from your boutique is required to review this buyer.';
  END IF;

  INSERT INTO public.buyer_reviews (order_id, buyer_id, seller_id, rating, body)
  VALUES (p_order_id, v_buyer_id, v_seller_id, p_rating, left(btrim(COALESCE(p_body, '')), 2000))
  RETURNING id INTO v_review_id;
  RETURN v_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_buyer_review(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_buyer_review(uuid, integer, text) TO authenticated;

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Public read active vouchers" ON public.vouchers;
CREATE POLICY "Public read active vouchers" ON public.vouchers
  FOR SELECT TO anon, authenticated
  USING (
    status = 'ACTIVE'
    AND (assigned_user_id IS NULL OR assigned_user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.guard_assigned_voucher_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_user_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'A voucher can only be redeemed by the signed-in account.';
  END IF;

  SELECT assigned_user_id INTO v_assigned_user_id
  FROM public.vouchers
  WHERE id = NEW.voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found.';
  END IF;
  IF v_assigned_user_id IS NOT NULL AND v_assigned_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'This reward voucher belongs to another account.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_assigned_voucher_redemption ON public.voucher_redemptions;
CREATE TRIGGER guard_assigned_voucher_redemption
  BEFORE INSERT ON public.voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_assigned_voucher_redemption();

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
  v_voucher public.vouchers%ROWTYPE;
  v_discount numeric;
BEGIN
  SELECT * INTO v_voucher
  FROM public.vouchers
  WHERE upper(vouchers.code) = upper(p_code)
    AND vouchers.status = 'ACTIVE'
    AND (vouchers.assigned_user_id IS NULL OR vouchers.assigned_user_id = auth.uid());
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
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text,
      'Minimum spend of ' || v_voucher.min_spend || ' required';
    RETURN;
  END IF;
  IF p_has_auction_items AND NOT v_voucher.auction_eligible THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'Auction items are not eligible for this code';
    RETURN;
  END IF;
  IF v_voucher.scope = 'BOUTIQUE' AND p_boutique_ids IS NOT NULL
    AND NOT (v_voucher.boutique_id = ANY(p_boutique_ids)) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'This code is not valid for the items in your cart';
    RETURN;
  END IF;
  IF v_voucher.scope = 'CATEGORY' AND p_categories IS NOT NULL
    AND NOT (v_voucher.category = ANY(p_categories)) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 0::numeric, 0::numeric, NULL::text, 'This code is not valid for the items in your cart';
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_voucher.discount_type = 'PERCENTAGE' THEN p_cart_total * v_voucher.discount_value / 100
    ELSE LEAST(v_voucher.discount_value, p_cart_total)
  END;
  RETURN QUERY SELECT true, v_voucher.code, v_voucher.discount_type, v_voucher.discount_value,
    v_discount, v_voucher.scope, 'Valid';
END;
$$;

REVOKE ALL ON FUNCTION public.validate_voucher(text, numeric, boolean, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_voucher(text, numeric, boolean, uuid[], text[]) TO authenticated;

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_delta integer NOT NULL CHECK (points_delta <> 0),
  reason text NOT NULL CHECK (reason IN ('completed_order', 'reward_redemption')),
  order_id uuid UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own loyalty history" ON public.loyalty_ledger;
CREATE POLICY "Users read own loyalty history" ON public.loyalty_ledger
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_user_created
  ON public.loyalty_ledger(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.award_loyalty_points_for_completed_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
BEGIN
  IF NEW.status <> 'completed'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  v_points := floor(NEW.amount / 100)::integer;
  IF v_points < 1 THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = NEW.buyer_id FOR UPDATE;
  INSERT INTO public.loyalty_ledger (user_id, points_delta, reason, order_id)
  VALUES (NEW.buyer_id, v_points, 'completed_order', NEW.id)
  ON CONFLICT (order_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS award_loyalty_points_after_order_completion ON public.orders;
CREATE TRIGGER award_loyalty_points_after_order_completion
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.award_loyalty_points_for_completed_order();

INSERT INTO public.loyalty_ledger (user_id, points_delta, reason, order_id)
SELECT buyer_id, floor(amount / 100)::integer, 'completed_order', id
FROM public.orders
WHERE status = 'completed' AND floor(amount / 100) >= 1
ON CONFLICT (order_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_loyalty_points_balance()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum(points_delta), 0)::integer
  FROM public.loyalty_ledger
  WHERE user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_loyalty_points_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_loyalty_points_balance() TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(p_points integer)
RETURNS TABLE(code text, points_spent integer, discount_value numeric, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_balance integer;
  v_discount numeric;
  v_code text;
  v_expires_at timestamptz := now() + interval '90 days';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to redeem reward points.';
  END IF;
  IF p_points IS NULL OR p_points < 100 OR p_points > 2000 OR p_points % 100 <> 0 THEN
    RAISE EXCEPTION 'Redeem between 100 and 2,000 points in 100-point increments.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT COALESCE(sum(points_delta), 0)::integer INTO v_balance
  FROM public.loyalty_ledger
  WHERE user_id = v_user_id;
  IF v_balance < p_points THEN
    RAISE EXCEPTION 'You do not have enough reward points.';
  END IF;

  v_discount := (p_points / 100) * 25;
  v_code := 'TS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.vouchers (
    code, description, discount_type, discount_value, scope, min_spend, max_uses,
    max_uses_per_user, is_single_use, expires_at, status, assigned_user_id
  ) VALUES (
    v_code, 'Reward voucher redeemed with ThriftSync points', 'FIXED_AMOUNT', v_discount,
    'PLATFORM', v_discount * 2, 1, 1, true, v_expires_at, 'ACTIVE', v_user_id
  );

  INSERT INTO public.loyalty_ledger (user_id, points_delta, reason, voucher_id)
  VALUES (v_user_id, -p_points, 'reward_redemption', (
    SELECT id FROM public.vouchers WHERE vouchers.code = v_code
  ));

  RETURN QUERY SELECT v_code, p_points, v_discount, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_loyalty_points(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points(integer) TO authenticated;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS automated_flags text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.classify_listing_policy_signals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_content text := lower(concat_ws(' ', NEW.title, NEW.description));
  v_flags text[] := '{}';
BEGIN
  IF v_content ~ '\m(counterfeit|fake|replica)\M' THEN
    v_flags := array_append(v_flags, 'Possible counterfeit or replica terms');
  END IF;
  IF v_content ~ '\m(stolen|stole|found item)\M' THEN
    v_flags := array_append(v_flags, 'Possible stolen-property terms');
  END IF;
  IF v_content ~ '\m(weapon|firearm|ammunition|explosive)\M' THEN
    v_flags := array_append(v_flags, 'Potentially prohibited weapon');
  END IF;
  IF v_content ~ '\m(cocaine|methamphetamine|fentanyl|heroin)\M' THEN
    v_flags := array_append(v_flags, 'Potentially prohibited substance');
  END IF;
  NEW.automated_flags := v_flags;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classify_listing_policy_signals ON public.listings;
CREATE TRIGGER classify_listing_policy_signals
  BEFORE INSERT OR UPDATE OF title, description, automated_flags ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.classify_listing_policy_signals();

UPDATE public.listings SET title = title;

CREATE OR REPLACE FUNCTION public.seller_dashboard_summary()
RETURNS TABLE(gross_sales numeric, order_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to view seller totals.';
  END IF;
  RETURN QUERY
  SELECT COALESCE(sum(o.amount), 0)::numeric, count(o.id)::bigint
  FROM public.orders o
  JOIN public.boutiques b ON b.id = o.boutique_id
  WHERE b.seller_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.seller_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_dashboard_summary() TO authenticated;

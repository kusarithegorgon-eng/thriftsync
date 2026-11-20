ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'restricted', 'suspended')),
  ADD COLUMN IF NOT EXISTS account_status_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS account_restricted_until timestamptz;

CREATE TABLE IF NOT EXISTS public.account_restrictions (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users and administrators read account restriction reasons"
  ON public.account_restrictions;
CREATE POLICY "Users and administrators read account restriction reasons"
  ON public.account_restrictions
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
GRANT SELECT ON public.account_restrictions TO authenticated;

UPDATE public.profiles
SET account_status = 'suspended',
    account_status_updated_at = now()
WHERE is_banned AND account_status = 'active';

INSERT INTO public.account_restrictions (profile_id, reason)
SELECT id, 'Previously sanctioned by a system administrator.'
FROM public.profiles
WHERE account_status <> 'active'
ON CONFLICT (profile_id) DO NOTHING;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_restriction_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_restriction_check
  CHECK (account_status = 'restricted' OR account_restricted_until IS NULL);

CREATE OR REPLACE FUNCTION public.protect_profile_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
    OR NEW.account_status_updated_at IS DISTINCT FROM OLD.account_status_updated_at
    OR NEW.account_restricted_until IS DISTINCT FROM OLD.account_restricted_until
    OR NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Only a system administrator can change account restrictions.';
    END IF;

    IF NEW.is_banned IS DISTINCT FROM OLD.is_banned
      AND NEW.account_status IS NOT DISTINCT FROM OLD.account_status THEN
      NEW.account_status := CASE WHEN NEW.is_banned THEN 'suspended' ELSE 'active' END;
    END IF;

    IF NEW.account_status IS DISTINCT FROM OLD.account_status
      OR NEW.account_restricted_until IS DISTINCT FROM OLD.account_restricted_until THEN
      NEW.account_status_updated_at := now();
    END IF;
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      NEW.is_banned := NEW.account_status = 'suspended';
    END IF;

    IF NEW.account_status = 'active' THEN
      NEW.account_restricted_until := NULL;
    ELSIF NEW.account_status <> 'restricted' THEN
      NEW.account_restricted_until := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_account_status ON public.profiles;
CREATE TRIGGER protect_profile_account_status
  BEFORE UPDATE OF account_status, account_status_updated_at,
    account_restricted_until, is_banned
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_account_status();

CREATE OR REPLACE FUNCTION public.sync_account_restriction_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_status = 'active' THEN
    DELETE FROM public.account_restrictions WHERE profile_id = NEW.id;
  ELSE
    INSERT INTO public.account_restrictions (profile_id, reason, updated_by)
    VALUES (
      NEW.id,
      CASE WHEN NEW.account_status = 'suspended'
        THEN 'Administrative suspension.'
        ELSE 'Administrative restriction.'
      END,
      auth.uid()
    )
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_account_restriction_reason ON public.profiles;
CREATE TRIGGER sync_account_restriction_reason
  AFTER UPDATE OF account_status ON public.profiles
  FOR EACH ROW
  WHEN (NEW.account_status IS DISTINCT FROM OLD.account_status)
  EXECUTE FUNCTION public.sync_account_restriction_reason();

CREATE OR REPLACE FUNCTION public.can_perform_marketplace_action(
  p_action text,
  p_profile_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_restricted_until timestamptz;
BEGIN
  IF p_action IS NULL THEN
    RETURN false;
  END IF;

  SELECT account_status, account_restricted_until
  INTO v_status, v_restricted_until
  FROM public.profiles
  WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_status = 'restricted' AND v_restricted_until IS NOT NULL
    AND v_restricted_until <= now() THEN
    v_status := 'active';
  END IF;

  IF v_status = 'active' THEN
    RETURN p_action IN ('purchase', 'sell', 'bid', 'auction_claim', 'trade', 'message');
  ELSIF v_status = 'restricted' THEN
    RETURN p_action IN ('purchase', 'message');
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_perform_marketplace_action(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_perform_marketplace_action(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_listing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT seller_id INTO v_seller_id
  FROM public.boutiques
  WHERE id = NEW.boutique_id;
  IF v_seller_id = auth.uid()
    AND NOT public.can_perform_marketplace_action('sell', v_seller_id) THEN
    RAISE EXCEPTION 'Your account is restricted from creating or changing listings.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_listing ON public.listings;
CREATE TRIGGER enforce_account_status_on_listing
  BEFORE INSERT OR UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_listing();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_boutique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = NEW.seller_id
    AND NOT public.can_perform_marketplace_action('sell', NEW.seller_id) THEN
    RAISE EXCEPTION 'Your account is restricted from creating or changing a boutique.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_boutique ON public.boutiques;
CREATE TRIGGER enforce_account_status_on_boutique
  BEFORE INSERT OR UPDATE ON public.boutiques
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_boutique();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_perform_marketplace_action('bid', NEW.bidder_id) THEN
    RAISE EXCEPTION 'Your account is restricted from placing auction bids.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_bid ON public.bids;
CREATE TRIGGER enforce_account_status_on_bid
  BEFORE INSERT ON public.bids
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_bid();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_trade_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_perform_marketplace_action('trade', NEW.initiator_id) THEN
    RAISE EXCEPTION 'Your account is restricted from making barter offers.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_trade_offer ON public.trade_offers;
CREATE TRIGGER enforce_account_status_on_trade_offer
  BEFORE INSERT ON public.trade_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_trade_offer();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_perform_marketplace_action('message', NEW.sender_id) THEN
    RAISE EXCEPTION 'Your account is suspended from sending messages.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_message ON public.messages;
CREATE TRIGGER enforce_account_status_on_message
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_message();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction_action text := current_setting('app.allow_auction_order', true);
BEGIN
  IF v_auction_action = 'claim_dutch'
    AND NOT public.can_perform_marketplace_action('auction_claim', NEW.buyer_id) THEN
    RAISE EXCEPTION 'Your account is restricted from claiming auction items.';
  END IF;
  IF v_auction_action IS DISTINCT FROM 'claim_dutch'
    AND v_auction_action IS DISTINCT FROM 'settle_english'
    AND current_setting('app.allow_paid_checkout', true) IS DISTINCT FROM 'true'
    AND NOT public.can_perform_marketplace_action('purchase', NEW.buyer_id) THEN
    RAISE EXCEPTION 'Your account is suspended from starting new purchases.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_order ON public.orders;
CREATE TRIGGER enforce_account_status_on_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_order();

CREATE OR REPLACE FUNCTION public.enforce_account_status_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payload->>'kind' IS DISTINCT FROM 'auction_payment'
    AND NOT public.can_perform_marketplace_action('purchase', NEW.buyer_id) THEN
    RAISE EXCEPTION 'Your account is suspended from starting new purchases.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_status_on_checkout ON public.paymongo_checkouts;
CREATE TRIGGER enforce_account_status_on_checkout
  BEFORE INSERT ON public.paymongo_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_status_on_checkout();

CREATE OR REPLACE FUNCTION public.fulfill_paymongo_checkout(p_checkout_id uuid)
RETURNS TABLE(order_ids uuid[], discount_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout public.paymongo_checkouts%ROWTYPE;
  v_payload jsonb;
  v_order_ids uuid[];
  v_discount numeric;
  v_expected_count integer;
  v_reserved_count integer;
BEGIN
  SELECT * INTO v_checkout
  FROM public.paymongo_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout not found.';
  END IF;
  IF v_checkout.status = 'fulfilled' AND cardinality(v_checkout.order_ids) > 0 THEN
    RETURN QUERY SELECT v_checkout.order_ids, 0::numeric;
    RETURN;
  END IF;
  IF v_checkout.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'This checkout is no longer payable.';
  END IF;

  v_payload := v_checkout.payload;
  SELECT count(*) INTO v_expected_count
  FROM jsonb_array_elements(v_payload->'items');
  PERFORM 1
  FROM public.listings
  WHERE reserved_by_checkout_id = p_checkout_id
  ORDER BY id
  FOR UPDATE;
  SELECT count(*) INTO v_reserved_count
  FROM public.listings
  WHERE reserved_by_checkout_id = p_checkout_id
    AND status = 'reserved';
  IF v_expected_count = 0 OR v_reserved_count <> v_expected_count THEN
    RAISE EXCEPTION 'The checkout inventory reservation is missing or incomplete.';
  END IF;

  PERFORM set_config('app.checkout_reservation_id', p_checkout_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_checkout.buyer_id::text, true);
  UPDATE public.listings
  SET status = 'active',
      reserved_by_checkout_id = NULL,
      reservation_expires_at = NULL
  WHERE reserved_by_checkout_id = p_checkout_id
    AND status = 'reserved';

  PERFORM set_config('app.allow_paid_checkout', 'true', true);
  SELECT result.order_ids, result.discount_amount
  INTO v_order_ids, v_discount
  FROM public.checkout_fixed_items_with_fulfillment(
    v_payload->'items',
    v_payload->>'shipping_address',
    v_payload->>'voucher_code',
    COALESCE(v_payload->>'delivery_method', 'courier'),
    NULLIF(v_payload->>'locker_location_id', '')::uuid
  ) AS result;
  IF cardinality(v_order_ids) <> v_expected_count THEN
    RAISE EXCEPTION 'PayMongo checkout did not create an order for every reserved item.';
  END IF;

  UPDATE public.orders
  SET payment_method = 'paymongo',
      payment_is_simulated = false,
      payment_reference = v_checkout.checkout_session_id,
      paid_at = COALESCE(paid_at, now())
  WHERE id = ANY(v_order_ids)
    AND buyer_id = v_checkout.buyer_id;
  UPDATE public.paymongo_checkouts
  SET status = 'fulfilled',
      order_ids = v_order_ids,
      updated_at = now()
  WHERE id = p_checkout_id;
  RETURN QUERY SELECT v_order_ids, v_discount;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_paymongo_checkout(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_paymongo_checkout(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_profile_account_status(
  p_profile_id uuid,
  p_status text,
  p_reason text DEFAULT NULL,
  p_restricted_until timestamptz DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot restrict their own account.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'restricted', 'suspended') THEN
    RAISE EXCEPTION 'Choose a valid account status.';
  END IF;
  IF p_status <> 'active' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Provide a reason for the account restriction.';
  END IF;
  IF p_status = 'restricted' AND p_restricted_until IS NOT NULL
    AND p_restricted_until <= now() THEN
    RAISE EXCEPTION 'The restriction expiry must be in the future.';
  END IF;
  IF p_status <> 'restricted' AND p_restricted_until IS NOT NULL THEN
    RAISE EXCEPTION 'Only a restricted account can have a restriction expiry.';
  END IF;

  SELECT account_status INTO v_previous_status
  FROM public.profiles
  WHERE id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Account not found.'::text;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET account_status = p_status,
      account_restricted_until = p_restricted_until
  WHERE id = p_profile_id;

  IF p_status = 'active' THEN
    DELETE FROM public.account_restrictions WHERE profile_id = p_profile_id;
  ELSE
    INSERT INTO public.account_restrictions (profile_id, reason, updated_by)
    VALUES (
      p_profile_id,
      left(btrim(p_reason), 2000),
      auth.uid()
    )
    ON CONFLICT (profile_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
  END IF;

  INSERT INTO public.admin_audit_logs (actor_id, action, details)
  VALUES (
    auth.uid(),
    'account_status_changed',
    jsonb_build_object(
      'profile_id', p_profile_id,
      'previous_status', v_previous_status,
      'new_status', p_status,
      'reason', left(btrim(COALESCE(p_reason, '')), 2000),
      'restricted_until', p_restricted_until
    )
  );
  RETURN QUERY SELECT true, 'Account status updated.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_account_status(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_account_status(uuid, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_account_restrictions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_expired_count integer := 0;
BEGIN
  FOR v_profile IN
    UPDATE public.profiles
    SET account_status = 'active'
    WHERE account_status = 'restricted'
      AND account_restricted_until IS NOT NULL
      AND account_restricted_until <= now()
    RETURNING id
  LOOP
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (
      NULL,
      'account_restriction_expired',
      jsonb_build_object('profile_id', v_profile.id)
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;
  RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_account_restrictions() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'expire-account-restrictions'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'expire-account-restrictions',
    '* * * * *',
    'SELECT public.expire_account_restrictions();'
  );
END;
$$;

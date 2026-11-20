CREATE TABLE IF NOT EXISTS public.inventory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_reference uuid NOT NULL,
  boutique_reference uuid,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  old_price numeric,
  new_price numeric,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_events_created_idx
  ON public.inventory_events(created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_events_listing_idx
  ON public.inventory_events(listing_reference, created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_created_idx
  ON public.order_events(created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_order_idx
  ON public.order_events(order_reference, created_at DESC);

ALTER TABLE public.inventory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Administrators read inventory history" ON public.inventory_events;
CREATE POLICY "Administrators read inventory history"
  ON public.inventory_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

DROP POLICY IF EXISTS "Administrators read order history" ON public.order_events;
CREATE POLICY "Administrators read order history"
  ON public.order_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

GRANT SELECT ON public.inventory_events, public.order_events TO authenticated;

CREATE OR REPLACE FUNCTION public.record_inventory_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_old_status text;
  v_new_status text;
  v_old_price numeric;
  v_new_price numeric;
  v_details jsonb;
  v_listing_id uuid;
  v_boutique_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_event_type := 'listing_deleted';
    v_old_status := OLD.status;
    v_old_price := OLD.price;
    v_listing_id := OLD.id;
    v_boutique_id := OLD.boutique_id;
    v_details := jsonb_build_object('title', OLD.title, 'listing_type', OLD.listing_type);
  ELSIF TG_OP = 'INSERT' THEN
    v_event_type := 'listing_created';
    v_new_status := NEW.status;
    v_new_price := NEW.price;
    v_listing_id := NEW.id;
    v_boutique_id := NEW.boutique_id;
    v_details := jsonb_build_object(
      'title', NEW.title,
      'listing_type', NEW.listing_type,
      'moderation_status', NEW.moderation_status
    );
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_event_type := 'listing_status_changed';
    ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
      v_event_type := 'listing_price_changed';
    ELSIF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
      v_event_type := 'listing_moderation_changed';
    ELSE
      RETURN NEW;
    END IF;
    v_old_status := OLD.status;
    v_new_status := NEW.status;
    v_old_price := OLD.price;
    v_new_price := NEW.price;
    v_listing_id := NEW.id;
    v_boutique_id := NEW.boutique_id;
    v_details := jsonb_build_object(
      'title', NEW.title,
      'listing_type', NEW.listing_type,
      'old_moderation_status', OLD.moderation_status,
      'new_moderation_status', NEW.moderation_status
    );
  END IF;

  INSERT INTO public.inventory_events (
    listing_reference, boutique_reference, actor_id, event_type,
    old_status, new_status, old_price, new_price, details
  )
  VALUES (
    v_listing_id, v_boutique_id, auth.uid(), v_event_type,
    v_old_status, v_new_status, v_old_price, v_new_price, v_details
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_inventory_event ON public.listings;
CREATE TRIGGER record_inventory_event
  AFTER INSERT OR UPDATE OR DELETE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.record_inventory_event();

CREATE OR REPLACE FUNCTION public.record_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (
      order_reference, order_id, actor_id, event_type, new_status, details
    )
    VALUES (
      NEW.id, NEW.id, auth.uid(), 'order_created', NEW.status,
      jsonb_build_object(
        'amount', NEW.amount,
        'payment_method', NEW.payment_method,
        'delivery_method', NEW.delivery_method,
        'listing_id', NEW.listing_id,
        'boutique_id', NEW.boutique_id
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (
      order_reference, order_id, actor_id, event_type, old_status, new_status, details
    )
    VALUES (
      NEW.id, NEW.id, auth.uid(), 'order_status_changed', OLD.status, NEW.status,
      jsonb_build_object('payment_method', NEW.payment_method)
    );
  END IF;
  IF NEW.paid_at IS DISTINCT FROM OLD.paid_at AND NEW.paid_at IS NOT NULL THEN
    INSERT INTO public.order_events (
      order_reference, order_id, actor_id, event_type, old_status, new_status, details
    )
    VALUES (
      NEW.id, NEW.id, auth.uid(), 'payment_recorded', OLD.status, NEW.status,
      jsonb_build_object('payment_method', NEW.payment_method, 'paid_at', NEW.paid_at)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_order_event ON public.orders;
CREATE TRIGGER record_order_event
  AFTER INSERT OR UPDATE OF status, paid_at ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.record_order_event();

INSERT INTO public.inventory_events (
  listing_reference, boutique_reference, actor_id, event_type,
  new_status, new_price, details, created_at
)
SELECT id, boutique_id, NULL, 'listing_snapshot', status, price,
  jsonb_build_object('title', title, 'listing_type', listing_type, 'moderation_status', moderation_status),
  COALESCE(created_at, now())
FROM public.listings;

INSERT INTO public.order_events (
  order_reference, order_id, actor_id, event_type, new_status, details, created_at
)
SELECT id, id, NULL, 'order_snapshot', status,
  jsonb_build_object(
    'amount', amount,
    'payment_method', payment_method,
    'delivery_method', delivery_method,
    'listing_id', listing_id,
    'boutique_id', boutique_id
  ),
  COALESCE(created_at, now())
FROM public.orders;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'System administrator access required.';
  END IF;

  RETURN jsonb_build_object(
    'total_accounts', (SELECT count(*) FROM public.profiles),
    'seller_accounts', (SELECT count(*) FROM public.profiles WHERE role = 'seller'),
    'moderator_accounts', (SELECT count(*) FROM public.profiles WHERE role = 'moderator'),
    'restricted_accounts', (
      SELECT count(*) FROM public.profiles
      WHERE account_status = 'restricted'
        AND (account_restricted_until IS NULL OR account_restricted_until > now())
    ),
    'suspended_accounts', (SELECT count(*) FROM public.profiles WHERE account_status = 'suspended'),
    'active_listings', (
      SELECT count(*) FROM public.listings
      WHERE status = 'active' AND moderation_status = 'approved'
    ),
    'pending_listings', (
      SELECT count(*) FROM public.listings WHERE moderation_status = 'pending_review'
    ),
    'temporarily_hidden_listings', (
      SELECT count(*) FROM public.listings WHERE moderation_status = 'temporarily_hidden'
    ),
    'active_auctions', (
      SELECT count(*) FROM public.listings
      WHERE listing_type = 'auction' AND status = 'active' AND auction_end_at > now()
    ),
    'pending_auction_payments', (
      SELECT count(*) FROM public.orders
      WHERE status = 'pending_payment' AND payment_due_at IS NOT NULL
    ),
    'open_orders', (
      SELECT count(*) FROM public.orders
      WHERE status IN ('pending_payment', 'escrow_held', 'in_escrow', 'shipped', 'delivered', 'disputed')
    ),
    'disputed_orders', (SELECT count(*) FROM public.orders WHERE status = 'disputed'),
    'completed_sales_count', (SELECT count(*) FROM public.orders WHERE status = 'completed'),
    'completed_sales_total', (
      SELECT COALESCE(sum(amount), 0) FROM public.orders WHERE status = 'completed'
    ),
    'open_barter_offers', (
      SELECT count(*) FROM public.trade_offers
      WHERE status IN ('PENDING', 'COUNTERED', 'ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B')
    ),
    'completed_barter_offers', (
      SELECT count(*) FROM public.trade_offers WHERE status = 'COMPLETED'
    ),
    'open_transaction_reports', (
      SELECT count(*) FROM public.reports WHERE status IN ('pending', 'under_review')
    ),
    'open_content_reports', (
      SELECT count(*) FROM public.general_reports WHERE status IN ('pending', 'under_review')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_summary() TO authenticated;

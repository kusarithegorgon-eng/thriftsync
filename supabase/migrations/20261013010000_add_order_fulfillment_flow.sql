DROP POLICY IF EXISTS "Buyers and sellers update orders" ON public.orders;

CREATE OR REPLACE FUNCTION public.mark_order_shipped(
  p_order_id uuid,
  p_tracking_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to update this order.';
  END IF;
  IF p_tracking_number IS NULL OR length(btrim(p_tracking_number)) = 0 OR length(btrim(p_tracking_number)) > 200 THEN
    RAISE EXCEPTION 'Enter a tracking number of 1 to 200 characters.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.boutiques AS boutique
    WHERE boutique.id = v_order.boutique_id AND boutique.seller_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only this order''s seller can mark it shipped.';
  END IF;
  IF v_order.status <> 'escrow_held' THEN
    RAISE EXCEPTION 'Only orders in escrow can be marked shipped.';
  END IF;

  UPDATE public.orders
  SET status = 'shipped', tracking_number = btrim(p_tracking_number)
  WHERE id = v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_delivered(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm delivery.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_order.buyer_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the buyer can confirm delivery.';
  END IF;
  IF v_order.status <> 'shipped' THEN
    RAISE EXCEPTION 'Only shipped orders can be marked delivered.';
  END IF;

  UPDATE public.orders
  SET status = 'delivered'
  WHERE id = v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_shipped(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_order_delivered(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_shipped(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivered(uuid) TO authenticated;
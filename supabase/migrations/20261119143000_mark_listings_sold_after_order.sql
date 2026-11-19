CREATE OR REPLACE FUNCTION public.mark_listing_sold_after_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.listings
  SET status = 'sold'
  WHERE id = NEW.listing_id
    AND status = 'active';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_listing_sold_after_order() FROM PUBLIC;

DROP TRIGGER IF EXISTS mark_listing_sold_after_order ON public.orders;
CREATE TRIGGER mark_listing_sold_after_order
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_listing_sold_after_order();

UPDATE public.listings AS listing
SET status = 'sold'
WHERE listing.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM public.orders AS order_row
    WHERE order_row.listing_id = listing.id
      AND order_row.status <> 'refunded'
  );

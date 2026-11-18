ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('paymongo', 'voucher', 'gcash_demo', 'cash_on_delivery', 'unknown'));

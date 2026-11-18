ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS payment_is_simulated boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('paymongo', 'voucher', 'gcash_demo', 'unknown'));

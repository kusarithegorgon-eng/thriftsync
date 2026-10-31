CREATE TABLE IF NOT EXISTS public.paymongo_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkout_session_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'fulfilled', 'failed')),
  payload jsonb NOT NULL,
  amount_centavos integer NOT NULL CHECK (amount_centavos >= 0),
  order_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paymongo_checkouts_buyer_id_idx
  ON public.paymongo_checkouts (buyer_id, created_at DESC);

ALTER TABLE public.paymongo_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paymongo_checkouts_select_own ON public.paymongo_checkouts;
CREATE POLICY paymongo_checkouts_select_own ON public.paymongo_checkouts
  FOR SELECT TO authenticated
  USING (buyer_id = auth.uid());

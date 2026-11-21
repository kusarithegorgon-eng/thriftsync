CREATE TABLE public.delivery_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
    CHECK (body !~* '(^|[^[:alnum:]])[A-F0-9]{12}([^[:alnum:]]|$)'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_messages_job_created_idx
  ON public.delivery_messages(delivery_job_id, created_at);

ALTER TABLE public.delivery_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.delivery_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_delivery_chat_message(
  p_delivery_job_id uuid,
  p_sender_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.delivery_jobs j
    JOIN public.orders o ON o.id = j.order_id
    JOIN public.boutiques b ON b.id = o.boutique_id
    WHERE j.id = p_delivery_job_id
      AND j.status IN ('accepted', 'picked_up', 'in_transit', 'delivered')
      AND p_sender_id IN (o.buyer_id, j.courier_id)
      AND (
        auth.uid() = o.buyer_id
        OR (
          auth.uid() = j.courier_id
          AND EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'courier'
              AND p.account_status = 'active'
          )
          AND EXISTS (
            SELECT 1
            FROM public.seller_couriers sc
            WHERE sc.seller_id = b.seller_id
              AND sc.courier_id = auth.uid()
              AND sc.is_active = true
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_send_delivery_chat_message(
  p_delivery_job_id uuid,
  p_sender_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.delivery_jobs j
      JOIN public.orders o ON o.id = j.order_id
      JOIN public.boutiques b ON b.id = o.boutique_id
      WHERE j.id = p_delivery_job_id
        AND j.status IN ('accepted', 'picked_up', 'in_transit')
        AND (
          auth.uid() = o.buyer_id
          OR (
            auth.uid() = j.courier_id
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.id = auth.uid()
                AND p.role = 'courier'
                AND p.account_status = 'active'
            )
            AND EXISTS (
              SELECT 1
              FROM public.seller_couriers sc
              WHERE sc.seller_id = b.seller_id
                AND sc.courier_id = auth.uid()
                AND sc.is_active = true
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_delivery_chat_message(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_send_delivery_chat_message(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_delivery_chat_message(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_send_delivery_chat_message(uuid, uuid) TO authenticated;

CREATE POLICY "Buyer and assigned courier read delivery chat"
  ON public.delivery_messages
  FOR SELECT TO authenticated
  USING (public.can_access_delivery_chat_message(delivery_job_id, sender_id));

CREATE POLICY "Buyer and assigned courier send delivery chat"
  ON public.delivery_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.can_send_delivery_chat_message(delivery_job_id, sender_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'delivery_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'delivery_jobs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_jobs;
    END IF;
  END IF;
END;
$$;

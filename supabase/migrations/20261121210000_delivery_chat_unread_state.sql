CREATE TABLE public.delivery_chat_reads (
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_job_id, profile_id)
);

ALTER TABLE public.delivery_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_chat_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_chat_reads TO authenticated;

CREATE POLICY "Participants read their own delivery chat state"
  ON public.delivery_chat_reads
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    AND public.can_access_delivery_chat_message(delivery_job_id, profile_id)
  );

CREATE OR REPLACE FUNCTION public.mark_delivery_chat_read(
  p_delivery_job_id uuid,
  p_read_through timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_read_through IS NULL OR p_read_through > now() THEN
    RAISE EXCEPTION 'Invalid delivery chat read position.';
  END IF;
  IF auth.uid() IS NULL
    OR NOT public.can_access_delivery_chat_message(p_delivery_job_id, auth.uid()) THEN
    RAISE EXCEPTION 'You are not a participant in this delivery chat.';
  END IF;

  INSERT INTO public.delivery_chat_reads (delivery_job_id, profile_id, last_read_at)
  VALUES (p_delivery_job_id, auth.uid(), p_read_through)
  ON CONFLICT (delivery_job_id, profile_id) DO UPDATE
    SET last_read_at = GREATEST(
      public.delivery_chat_reads.last_read_at,
      EXCLUDED.last_read_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_delivery_chat_read(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_delivery_chat_read(uuid, timestamptz) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'delivery_chat_reads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_chat_reads;
    END IF;
  END IF;
END;
$$;

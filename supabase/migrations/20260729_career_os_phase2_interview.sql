-- Career OS Phase 2.2: interview events + prep reports (kind=interview).
-- Apply after durability. Idempotent where practical. Self-host / public.mt_* layout.
-- Doctrine: user-scheduled rounds only; prep drafts are copy-only (never auto-send).

-- ---------------------------------------------------------------------------
-- Interview rounds (was ephemeral drawer state)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mt_interview_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner             uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  round             int NOT NULL DEFAULT 1,
  scheduled_at      timestamptz,
  type              text NOT NULL DEFAULT 'screen',
  notes             text DEFAULT '',
  interviewer_name  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_interview_events_round_chk CHECK (round >= 1),
  CONSTRAINT mt_interview_events_type_chk CHECK (
    type IN ('screen', 'phone', 'onsite', 'loop', 'panel', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_mt_interview_events_owner
  ON public.mt_interview_events(owner, scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_mt_interview_events_role
  ON public.mt_interview_events(role_id, round, scheduled_at);

ALTER TABLE public.mt_interview_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mt_interview_events_own ON public.mt_interview_events;
CREATE POLICY mt_interview_events_own ON public.mt_interview_events
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mt_roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.mt_interview_events_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_interview_events_touch ON public.mt_interview_events;
CREATE TRIGGER trg_mt_interview_events_touch
  BEFORE UPDATE ON public.mt_interview_events
  FOR EACH ROW EXECUTE FUNCTION public.mt_interview_events_touch_updated();

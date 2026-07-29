-- Career OS durability prerequisite: outcomes, story bank, Sent / version display names.
-- Apply after Phase 1. Idempotent where practical. Self-host / public.mt_* layout.

-- ---------------------------------------------------------------------------
-- Profiles: story bank (was co_stories_* localStorage)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS story_bank text DEFAULT '';

-- ---------------------------------------------------------------------------
-- Roles: role-level Sent marker (was co_sent localStorage)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt_roles
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Reports: version display name + Sent freeze (was rp2_ver_names / co_sent_ver)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt_reports
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mt_reports_owner_sent
  ON public.mt_reports(owner, sent_at)
  WHERE sent_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Outcomes (was co_outcomes_* localStorage)
-- One row per role; user-provided kind/date/note only — never invent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mt_outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  outcome_date  date,
  note          text DEFAULT '',
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_outcomes_kind_chk CHECK (
    kind IN ('offer', 'reject', 'withdraw', 'ghost')
  ),
  CONSTRAINT mt_outcomes_owner_role_uq UNIQUE (owner, role_id)
);

CREATE INDEX IF NOT EXISTS idx_mt_outcomes_owner
  ON public.mt_outcomes(owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_outcomes_role
  ON public.mt_outcomes(role_id);

ALTER TABLE public.mt_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mt_outcomes_own ON public.mt_outcomes;
CREATE POLICY mt_outcomes_own ON public.mt_outcomes
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mt_roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.mt_outcomes_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_outcomes_touch ON public.mt_outcomes;
CREATE TRIGGER trg_mt_outcomes_touch
  BEFORE UPDATE ON public.mt_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.mt_outcomes_touch_updated();

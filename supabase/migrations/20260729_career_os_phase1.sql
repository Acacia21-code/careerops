-- Career OS Phase 1: bullet memory, portfolio, cadence, advisor-friendly reports.
-- Apply after base schema.sql. Idempotent where practical.

-- ---------------------------------------------------------------------------
-- Profiles: cadence + structured resume sync markers
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS bullet_memory_cadence text DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS cadence_timezone text DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS cadence_anchor text DEFAULT '1,15',
  ADD COLUMN IF NOT EXISTS last_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_prompted_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS resume_struct_rev int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS structured_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_reconcile_needed boolean DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.mt_profiles
    ADD CONSTRAINT mt_profiles_cadence_chk
    CHECK (bullet_memory_cadence IS NULL OR bullet_memory_cadence IN ('biweekly','monthly','off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Accomplishments (bullet memory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mt_accomplishments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body_original       text NOT NULL,
  body_current        text NOT NULL,
  revisions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'inbox',
  archived_at         timestamptz,
  role_id             text,
  employer            text,
  project             text,
  tags                text[] DEFAULT '{}',
  checked             boolean DEFAULT false,
  promoted_role_id    text,
  promoted_bullet_id  text,
  promoted_at         timestamptz,
  promotion_snapshot  text,
  polish_candidate    text,
  polish_model        text,
  polish_at           timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT mt_accomplishments_status_chk CHECK (
    status IN ('inbox','ready','promoted','archived','orphaned')
  ),
  CONSTRAINT mt_accomplishments_body_chk CHECK (
    length(trim(body_original)) > 0 AND length(trim(body_current)) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_mt_accomplishments_owner_status
  ON public.mt_accomplishments(owner, status);
CREATE INDEX IF NOT EXISTS idx_mt_accomplishments_owner_created
  ON public.mt_accomplishments(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_accomplishments_owner_role
  ON public.mt_accomplishments(owner, role_id);

ALTER TABLE public.mt_accomplishments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mt_accomplishments_own ON public.mt_accomplishments;
CREATE POLICY mt_accomplishments_own ON public.mt_accomplishments
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

-- body_original must remain immutable after insert (trigger)
CREATE OR REPLACE FUNCTION public.mt_accomplishments_guard_original()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body_original IS DISTINCT FROM OLD.body_original THEN
    RAISE EXCEPTION 'body_original is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_accomplishments_guard ON public.mt_accomplishments;
CREATE TRIGGER trg_mt_accomplishments_guard
  BEFORE UPDATE ON public.mt_accomplishments
  FOR EACH ROW EXECUTE FUNCTION public.mt_accomplishments_guard_original();

-- ---------------------------------------------------------------------------
-- Portfolio library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mt_portfolio_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type           text NOT NULL DEFAULT 'other',
  title               text NOT NULL,
  url                 text,
  summary             text,
  bullets             jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags                text[] DEFAULT '{}',
  started_on          date,
  ended_on            date,
  visibility          text NOT NULL DEFAULT 'private',
  body_original       text,
  body_current        text,
  revisions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  polish_candidate    text,
  polish_model        text,
  polish_at           timestamptz,
  promoted_project_id text,
  promoted_at         timestamptz,
  promotion_snapshot  text,
  archived_at         timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT mt_portfolio_type_chk CHECK (item_type IN ('code','design','product','other')),
  CONSTRAINT mt_portfolio_vis_chk CHECK (visibility IN ('private','resume_ok')),
  CONSTRAINT mt_portfolio_title_chk CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_mt_portfolio_owner
  ON public.mt_portfolio_items(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_portfolio_vis
  ON public.mt_portfolio_items(owner, visibility);

ALTER TABLE public.mt_portfolio_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mt_portfolio_own ON public.mt_portfolio_items;
CREATE POLICY mt_portfolio_own ON public.mt_portfolio_items
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports: allow career-wide advisor briefs (nullable role_id) + owner column
-- ---------------------------------------------------------------------------
ALTER TABLE public.mt_reports ALTER COLUMN role_id DROP NOT NULL;
ALTER TABLE public.mt_reports ADD COLUMN IF NOT EXISTS owner uuid REFERENCES auth.users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS mt_reports_own ON public.mt_reports;
CREATE POLICY mt_reports_own ON public.mt_reports
  FOR ALL TO authenticated
  USING (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid())
  )
  WITH CHECK (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid())
  );

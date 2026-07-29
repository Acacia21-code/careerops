-- Production (app schema) variant of Phase 1. Live project uses app.* tables + public.mt_* views.

-- Career OS Phase 1 for production (app schema + public mt_* views)

ALTER TABLE app.profiles
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
  ALTER TABLE app.profiles
    ADD CONSTRAINT app_profiles_cadence_chk
    CHECK (bullet_memory_cadence IS NULL OR bullet_memory_cadence IN ('biweekly','monthly','off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE VIEW public.mt_profiles
WITH (security_invoker=true) AS
SELECT
  owner, full_name, email, phone, linkedin, location, resume_text,
  target_titles, keywords, locations, seniority, industries,
  ai_key, humanizer_email, humanizer_pw, onboarded, created_at, kimi_key, resume_struct,
  bullet_memory_cadence, cadence_timezone, cadence_anchor,
  last_entry_at, last_prompted_at, snoozed_until,
  resume_struct_rev, structured_modified_at, resume_reconcile_needed
FROM app.profiles;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_profiles TO authenticated, anon;

-- Accomplishments
CREATE TABLE IF NOT EXISTS app.accomplishments (
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
  CONSTRAINT app_accomplishments_status_chk CHECK (
    status IN ('inbox','ready','promoted','archived','orphaned')
  ),
  CONSTRAINT app_accomplishments_body_chk CHECK (
    length(trim(body_original)) > 0 AND length(trim(body_current)) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_app_accomplishments_owner_status
  ON app.accomplishments(owner, status);
CREATE INDEX IF NOT EXISTS idx_app_accomplishments_owner_created
  ON app.accomplishments(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_accomplishments_owner_role
  ON app.accomplishments(owner, role_id);

ALTER TABLE app.accomplishments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own ON app.accomplishments;
CREATE POLICY own ON app.accomplishments
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

CREATE OR REPLACE FUNCTION app.accomplishments_guard_original()
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

DROP TRIGGER IF EXISTS trg_app_accomplishments_guard ON app.accomplishments;
CREATE TRIGGER trg_app_accomplishments_guard
  BEFORE UPDATE ON app.accomplishments
  FOR EACH ROW EXECUTE FUNCTION app.accomplishments_guard_original();

CREATE OR REPLACE VIEW public.mt_accomplishments
WITH (security_invoker=true) AS
SELECT * FROM app.accomplishments;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_accomplishments TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.accomplishments TO authenticated;

-- Portfolio
CREATE TABLE IF NOT EXISTS app.portfolio_items (
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
  CONSTRAINT app_portfolio_type_chk CHECK (item_type IN ('code','design','product','other')),
  CONSTRAINT app_portfolio_vis_chk CHECK (visibility IN ('private','resume_ok')),
  CONSTRAINT app_portfolio_title_chk CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_app_portfolio_owner
  ON app.portfolio_items(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_portfolio_vis
  ON app.portfolio_items(owner, visibility);

ALTER TABLE app.portfolio_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own ON app.portfolio_items;
CREATE POLICY own ON app.portfolio_items
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

CREATE OR REPLACE VIEW public.mt_portfolio_items
WITH (security_invoker=true) AS
SELECT * FROM app.portfolio_items;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_portfolio_items TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.portfolio_items TO authenticated;

-- Reports: owner already exists; role_id already nullable. Expose owner on view + tighten RLS.
CREATE OR REPLACE VIEW public.mt_reports
WITH (security_invoker=true) AS
SELECT id, role_id, kind, jd_text, match_score, missing_keywords, rewritten, created_at, owner
FROM app.reports;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_reports TO authenticated, anon;

DROP POLICY IF EXISTS own ON app.reports;
CREATE POLICY own ON app.reports
  FOR ALL TO authenticated
  USING (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM app.roles r WHERE r.id = role_id AND r.owner = auth.uid())
  )
  WITH CHECK (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM app.roles r WHERE r.id = role_id AND r.owner = auth.uid())
  );

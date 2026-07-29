-- Production (app schema) durability prerequisite.
-- Live project uses app.* tables + public.mt_* views.

-- ---------------------------------------------------------------------------
-- Profiles: story bank
-- ---------------------------------------------------------------------------
ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS story_bank text DEFAULT '';

CREATE OR REPLACE VIEW public.mt_profiles
WITH (security_invoker=true) AS
SELECT
  owner, full_name, email, phone, linkedin, location, resume_text,
  target_titles, keywords, locations, seniority, industries,
  ai_key, humanizer_email, humanizer_pw, onboarded, created_at, kimi_key, resume_struct,
  bullet_memory_cadence, cadence_timezone, cadence_anchor,
  last_entry_at, last_prompted_at, snoozed_until,
  resume_struct_rev, structured_modified_at, resume_reconcile_needed,
  story_bank
FROM app.profiles;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_profiles TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Roles: sent_at
-- ---------------------------------------------------------------------------
ALTER TABLE app.roles
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Refresh mt_roles view if it exists as a view; otherwise column is on public table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'mt_roles'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.mt_roles
      WITH (security_invoker=true) AS
      SELECT * FROM app.roles
    $v$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_roles TO authenticated, anon;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Self-host installs may use public.mt_roles as a table; ignore view refresh.
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Reports: display_name + sent_at
-- ---------------------------------------------------------------------------
ALTER TABLE app.reports
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE OR REPLACE VIEW public.mt_reports
WITH (security_invoker=true) AS
SELECT
  id, role_id, kind, jd_text, match_score, missing_keywords, rewritten,
  created_at, owner, display_name, sent_at
FROM app.reports;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_reports TO authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_app_reports_owner_sent
  ON app.reports(owner, sent_at)
  WHERE sent_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Outcomes
-- ---------------------------------------------------------------------------
-- NOTE: production app.roles.id is bigint (not uuid). Keep role_id aligned.
CREATE TABLE IF NOT EXISTS app.outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id       bigint NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  outcome_date  date,
  note          text DEFAULT '',
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_outcomes_kind_chk CHECK (
    kind IN ('offer', 'reject', 'withdraw', 'ghost')
  ),
  CONSTRAINT app_outcomes_owner_role_uq UNIQUE (owner, role_id)
);

CREATE INDEX IF NOT EXISTS idx_app_outcomes_owner
  ON app.outcomes(owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_outcomes_role
  ON app.outcomes(role_id);

ALTER TABLE app.outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own ON app.outcomes;
CREATE POLICY own ON app.outcomes
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM app.roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION app.outcomes_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_outcomes_touch ON app.outcomes;
CREATE TRIGGER trg_app_outcomes_touch
  BEFORE UPDATE ON app.outcomes
  FOR EACH ROW EXECUTE FUNCTION app.outcomes_touch_updated();

CREATE OR REPLACE VIEW public.mt_outcomes
WITH (security_invoker=true) AS
SELECT * FROM app.outcomes;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_outcomes TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.outcomes TO authenticated;

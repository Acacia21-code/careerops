-- Production schema hardening for app.* tables + public.mt_* views.
-- Production board role IDs are bigint; resume_struct role keys remain text.

-- The client and public.mt_profiles use humanizer_pw. Copy a legacy
-- humanizer_pass value when present, but retain the old column for compatibility.
ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS humanizer_pw text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'profiles'
      AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE app.profiles
       SET humanizer_pw = COALESCE(humanizer_pw, humanizer_pass)
       WHERE humanizer_pw IS NULL AND humanizer_pass IS NOT NULL';
  END IF;
END $$;

-- CREATE OR REPLACE cannot rename/reorder view columns when app.profiles gains fields.
DROP VIEW IF EXISTS public.mt_profiles;
CREATE VIEW public.mt_profiles
WITH (security_invoker=true) AS
SELECT * FROM app.profiles;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_profiles TO authenticated, anon;

-- These are resume_struct string keys, not references to bigint app.roles.id.
COMMENT ON COLUMN app.accomplishments.role_id IS
  'Text resume_struct role key; not a foreign key to app.roles.id.';
COMMENT ON COLUMN app.accomplishments.promoted_role_id IS
  'Text resume_struct role key retained for promotion provenance.';

-- Keep partial legacy promotion provenance by marking it orphaned. Orphaned
-- rows remain exempt from clearing because they are needed for link healing.
UPDATE app.accomplishments
SET status = 'orphaned'
WHERE status = 'promoted'
  AND (
    promoted_role_id IS NULL
    OR promoted_bullet_id IS NULL
    OR promoted_at IS NULL
    OR promotion_snapshot IS NULL
  );

UPDATE app.accomplishments
SET promoted_role_id = NULL,
    promoted_bullet_id = NULL,
    promoted_at = NULL,
    promotion_snapshot = NULL
WHERE status NOT IN ('promoted', 'orphaned')
  AND (
    promoted_role_id IS NOT NULL
    OR promoted_bullet_id IS NOT NULL
    OR promoted_at IS NOT NULL
    OR promotion_snapshot IS NOT NULL
  );

DO $$ BEGIN
  ALTER TABLE app.accomplishments
    ADD CONSTRAINT app_accomplishments_promotion_chk CHECK (
      status = 'orphaned'
      OR (
        status = 'promoted'
        AND promoted_role_id IS NOT NULL
        AND promoted_bullet_id IS NOT NULL
        AND promoted_at IS NOT NULL
        AND promotion_snapshot IS NOT NULL
      )
      OR (
        status NOT IN ('promoted', 'orphaned')
        AND promoted_role_id IS NULL
        AND promoted_bullet_id IS NULL
        AND promoted_at IS NULL
        AND promotion_snapshot IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE app.portfolio_items
SET promoted_project_id = NULL,
    promoted_at = NULL,
    promotion_snapshot = NULL
WHERE NOT (
  (
    promoted_project_id IS NULL
    AND promoted_at IS NULL
    AND promotion_snapshot IS NULL
  )
  OR (
    promoted_project_id IS NOT NULL
    AND promoted_at IS NOT NULL
    AND promotion_snapshot IS NOT NULL
  )
);

DO $$ BEGIN
  ALTER TABLE app.portfolio_items
    ADD CONSTRAINT app_portfolio_promotion_chk CHECK (
      (
        promoted_project_id IS NULL
        AND promoted_at IS NULL
        AND promotion_snapshot IS NULL
      )
      OR (
        promoted_project_id IS NOT NULL
        AND promoted_at IS NOT NULL
        AND promotion_snapshot IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Prod app.* tables may predate updated_at; triggers require the column.
ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE app.roles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE app.portfolio_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_profiles_touch ON app.profiles;
CREATE TRIGGER trg_app_profiles_touch
  BEFORE UPDATE ON app.profiles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_roles_touch ON app.roles;
CREATE TRIGGER trg_app_roles_touch
  BEFORE UPDATE ON app.roles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_portfolio_items_touch ON app.portfolio_items;
CREATE TRIGGER trg_app_portfolio_items_touch
  BEFORE UPDATE ON app.portfolio_items
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

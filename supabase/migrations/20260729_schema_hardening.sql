-- CareerOps schema hardening for self-host / public.mt_* tables.
-- Apply after Phase 1-3 migrations. Idempotent where practical.

-- The client and production views use humanizer_pw. Preserve a legacy
-- humanizer_pass column if present so existing self-host integrations keep working.
ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS humanizer_pw text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mt_profiles'
      AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE public.mt_profiles
       SET humanizer_pw = COALESCE(humanizer_pw, humanizer_pass)
       WHERE humanizer_pw IS NULL AND humanizer_pass IS NOT NULL';
  END IF;
END $$;

-- role_id and promoted_role_id point into profiles.resume_struct, whose keys are
-- strings. They are intentionally text and are not board-role foreign keys.
COMMENT ON COLUMN public.mt_accomplishments.role_id IS
  'Text resume_struct role key; not a foreign key to mt_roles.id.';
COMMENT ON COLUMN public.mt_accomplishments.promoted_role_id IS
  'Text resume_struct role key retained for promotion provenance.';

-- Heal legacy partial promotions without inventing missing provenance.
-- Orphaned rows deliberately retain whatever promotion fields remain.
UPDATE public.mt_accomplishments
SET status = 'orphaned'
WHERE status = 'promoted'
  AND (
    promoted_role_id IS NULL
    OR promoted_bullet_id IS NULL
    OR promoted_at IS NULL
    OR promotion_snapshot IS NULL
  );

UPDATE public.mt_accomplishments
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
  ALTER TABLE public.mt_accomplishments
    ADD CONSTRAINT mt_accomplishments_promotion_chk CHECK (
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

-- Portfolio promotions have no status field, so the three provenance values
-- must either all be present or all be absent.
UPDATE public.mt_portfolio_items
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
  ALTER TABLE public.mt_portfolio_items
    ADD CONSTRAINT mt_portfolio_promotion_chk CHECK (
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

CREATE OR REPLACE FUNCTION public.mt_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_profiles_touch ON public.mt_profiles;
CREATE TRIGGER trg_mt_profiles_touch
  BEFORE UPDATE ON public.mt_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mt_roles_touch ON public.mt_roles;
CREATE TRIGGER trg_mt_roles_touch
  BEFORE UPDATE ON public.mt_roles
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mt_portfolio_items_touch ON public.mt_portfolio_items;
CREATE TRIGGER trg_mt_portfolio_items_touch
  BEFORE UPDATE ON public.mt_portfolio_items
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

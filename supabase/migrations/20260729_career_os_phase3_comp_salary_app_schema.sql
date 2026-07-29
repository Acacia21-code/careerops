-- Production (app schema) Phase 3.2 + 3.3: role posted comp + profile target band.

ALTER TABLE app.roles
  ADD COLUMN IF NOT EXISTS comp_range jsonb,
  ADD COLUMN IF NOT EXISTS comp_raw text;

ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS target_band_min numeric,
  ADD COLUMN IF NOT EXISTS target_band_max numeric,
  ADD COLUMN IF NOT EXISTS target_band_currency text DEFAULT 'USD';

-- Refresh mt_roles / mt_profiles views when they wrap app.*
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
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'mt_profiles'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.mt_profiles
      WITH (security_invoker=true) AS
      SELECT * FROM app.profiles
    $v$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_profiles TO authenticated, anon;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

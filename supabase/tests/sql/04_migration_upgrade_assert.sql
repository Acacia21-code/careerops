-- End-state assertions after migration upgrade path (pre_phase1 → ordered migrations).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mt_accomplishments_promotion_chk'
  ) THEN
    RAISE EXCEPTION 'missing mt_accomplishments_promotion_chk after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mt_portfolio_promotion_chk'
  ) THEN
    RAISE EXCEPTION 'missing mt_portfolio_promotion_chk after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mt_accomplishments_status_chk'
  ) THEN
    RAISE EXCEPTION 'missing mt_accomplishments_status_chk after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mt_profiles' AND column_name = 'humanizer_pw'
  ) THEN
    RAISE EXCEPTION 'missing humanizer_pw after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mt_profiles' AND column_name = 'resume_struct_rev'
  ) THEN
    RAISE EXCEPTION 'missing resume_struct_rev after upgrade';
  END IF;

  IF to_regprocedure('public.promote_accomplishment(uuid,int,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'missing promote_accomplishment after upgrade';
  END IF;

  IF to_regprocedure('public.promote_portfolio(uuid,int,text)') IS NULL THEN
    RAISE EXCEPTION 'missing promote_portfolio after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_mt_accomplishments_guard'
  ) THEN
    RAISE EXCEPTION 'missing body_original guard trigger after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mt_profiles' AND t.tgname = 'trg_mt_profiles_touch'
  ) THEN
    RAISE EXCEPTION 'missing mt_profiles updated_at trigger after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mt_contacts'
  ) THEN
    RAISE EXCEPTION 'missing mt_contacts after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mt_interview_events'
  ) THEN
    RAISE EXCEPTION 'missing mt_interview_events after upgrade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mt_provider_secrets'
  ) THEN
    RAISE EXCEPTION 'missing mt_provider_secrets after upgrade';
  END IF;

  IF NOT (
    SELECT relrowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mt_provider_secrets'
  ) THEN
    RAISE EXCEPTION 'mt_provider_secrets must have RLS enabled after upgrade';
  END IF;

  -- The vault is service_role-only; a client-facing grant here would leak ciphertext.
  IF has_table_privilege('authenticated', 'public.mt_provider_secrets', 'SELECT')
    OR has_table_privilege('anon', 'public.mt_provider_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'mt_provider_secrets must not be readable by anon/authenticated';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.mt_provider_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'mt_provider_secrets must be readable by service_role';
  END IF;
END $$;

SELECT 'migration_upgrade_ok' AS result;

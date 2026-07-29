-- Grants for authenticated role after schema / migrations load (plain Postgres CI).

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- The blanket ALL TABLES grant above also hits the service-role-only vault, the
-- same way Supabase default privileges would. Re-assert the restriction so the
-- RLS tests see production privileges instead of the stub's over-grant.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mt_provider_secrets'
  ) THEN
    REVOKE ALL ON TABLE public.mt_provider_secrets FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.mt_provider_secrets TO service_role;
  END IF;
END $$;

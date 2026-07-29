-- Plain-Postgres stub for Supabase auth primitives used by schema.sql / RLS / promote RPCs.
-- Not for production. Used by scripts/test-pg-integration.mjs and CI.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);

-- Prefer request.jwt.claim.sub (PostgREST style); fall back to claims JSON.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      CASE
        WHEN current_setting('request.jwt.claims', true) IS NULL
          OR current_setting('request.jwt.claims', true) = ''
        THEN NULL
        ELSE current_setting('request.jwt.claims', true)::json->>'sub'
      END
    ),
    ''
  )::uuid;
$$;

DO $$ BEGIN
  CREATE ROLE authenticated NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE anon NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT SELECT ON auth.users TO authenticated, anon;

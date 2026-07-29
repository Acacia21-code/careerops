-- Track B2 (production app.*): credential vault + client-safe mt_profiles view.
-- Plaintext secret columns stay on app.profiles for service-role edge fallback
-- until CREDENTIALS_KEK is set and secrets are re-saved (or lazily migrated).
-- CI cannot encrypt-in-place (KEK is an edge secret) — document clear-and-reenter
-- after enabling vault for users who still only have plaintext.

ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS ai_key_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS kimi_key_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_pw_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_email_on_file boolean DEFAULT false;

ALTER TABLE app.profiles
  ADD COLUMN IF NOT EXISTS humanizer_pw text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'profiles' AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE app.profiles
       SET humanizer_pw = COALESCE(humanizer_pw, humanizer_pass)
       WHERE humanizer_pw IS NULL AND humanizer_pass IS NOT NULL';
  END IF;
END $$;

UPDATE app.profiles SET
  ai_key_on_file = COALESCE(ai_key_on_file, false)
    OR (ai_key IS NOT NULL AND length(trim(ai_key)) > 0),
  kimi_key_on_file = COALESCE(kimi_key_on_file, false)
    OR (kimi_key IS NOT NULL AND length(trim(kimi_key)) > 0),
  humanizer_pw_on_file = COALESCE(humanizer_pw_on_file, false)
    OR (humanizer_pw IS NOT NULL AND length(trim(humanizer_pw)) > 0),
  humanizer_email_on_file = COALESCE(humanizer_email_on_file, false)
    OR (humanizer_email IS NOT NULL AND length(trim(humanizer_email)) > 0);

-- Copy humanizer_pass into on_file when that legacy column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'profiles' AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE app.profiles
       SET humanizer_pw_on_file = humanizer_pw_on_file
         OR (humanizer_pass IS NOT NULL AND length(trim(humanizer_pass)) > 0)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.provider_secrets (
  owner       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  ciphertext  bytea NOT NULL,
  iv          bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, provider),
  CONSTRAINT app_provider_secrets_provider_chk CHECK (
    provider IN ('ai_key', 'kimi_key', 'humanizer_pw', 'humanizer_email')
  )
);

COMMENT ON TABLE app.provider_secrets IS
  'Encrypted BYO provider secrets (hosted). Service-role only. Decrypt with edge CREDENTIALS_KEK.';

ALTER TABLE app.provider_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.provider_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE app.provider_secrets TO service_role;

-- Client-facing view: never expose decrypted or plaintext provider secrets.
-- Dynamically include all non-secret columns so future profile fields still appear.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'app'
    AND c.table_name = 'profiles'
    AND c.column_name NOT IN (
      'ai_key', 'kimi_key', 'openai_key',
      'humanizer_pw', 'humanizer_pass', 'humanizer_email'
    );

  IF cols IS NULL OR length(cols) = 0 THEN
    RAISE EXCEPTION 'credential vault: no safe columns found on app.profiles';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.mt_profiles WITH (security_invoker=true) AS SELECT %s FROM app.profiles',
    cols
  );
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_profiles TO authenticated, anon;
END $$;

-- public.mt_provider_secrets → app.provider_secrets (edge uses either name)
CREATE OR REPLACE VIEW public.mt_provider_secrets
WITH (security_invoker=true) AS
SELECT * FROM app.provider_secrets;

REVOKE ALL ON TABLE public.mt_provider_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mt_provider_secrets TO service_role;

COMMENT ON COLUMN app.profiles.humanizer_pw IS
  'Canonical humanizer password (not humanizer_pass). Prefer app.provider_secrets when CREDENTIALS_KEK is set.';
COMMENT ON COLUMN app.profiles.ai_key_on_file IS
  'Presence flag only — never the secret. Client UI shows “key on file”.';

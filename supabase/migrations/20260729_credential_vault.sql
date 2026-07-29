-- Track B2: optional provider credential vault (self-host / public.mt_*).
-- Plaintext profile columns remain for simple self-host (documented tradeoff).
-- When edge secret CREDENTIALS_KEK is set, upsert_provider_secret encrypts into
-- mt_provider_secrets and sets *_on_file flags; edge functions decrypt server-side.
--
-- Encrypt-in-place is NOT done in SQL (KEK is an edge secret, unavailable in CI).
-- Existing plaintext keys keep working until re-saved through the vault edge RPCs
-- (or cleared). Hosted (_app_schema) hides plaintext from the client view.

ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS ai_key_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS kimi_key_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_pw_on_file boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_email_on_file boolean DEFAULT false;

-- Align naming: humanizer_pw is canonical (humanizer_pass is legacy alias only).
ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS humanizer_pw text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mt_profiles' AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE public.mt_profiles
       SET humanizer_pw = COALESCE(humanizer_pw, humanizer_pass)
       WHERE humanizer_pw IS NULL AND humanizer_pass IS NOT NULL';
  END IF;
END $$;

UPDATE public.mt_profiles SET
  ai_key_on_file = COALESCE(ai_key_on_file, false)
    OR (ai_key IS NOT NULL AND length(trim(ai_key)) > 0),
  kimi_key_on_file = COALESCE(kimi_key_on_file, false)
    OR (kimi_key IS NOT NULL AND length(trim(kimi_key)) > 0),
  humanizer_pw_on_file = COALESCE(humanizer_pw_on_file, false)
    OR (humanizer_pw IS NOT NULL AND length(trim(humanizer_pw)) > 0),
  humanizer_email_on_file = COALESCE(humanizer_email_on_file, false)
    OR (humanizer_email IS NOT NULL AND length(trim(humanizer_email)) > 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mt_profiles' AND column_name = 'humanizer_pass'
  ) THEN
    EXECUTE
      'UPDATE public.mt_profiles
       SET humanizer_pw_on_file = humanizer_pw_on_file
         OR (humanizer_pass IS NOT NULL AND length(trim(humanizer_pass)) > 0)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mt_provider_secrets (
  owner       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  ciphertext  bytea NOT NULL,
  iv          bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, provider),
  CONSTRAINT mt_provider_secrets_provider_chk CHECK (
    provider IN ('ai_key', 'kimi_key', 'humanizer_pw', 'humanizer_email')
  )
);

COMMENT ON TABLE public.mt_provider_secrets IS
  'Encrypted BYO provider secrets. Service-role only; never exposed to anon/authenticated clients. Requires edge CREDENTIALS_KEK to decrypt.';

ALTER TABLE public.mt_provider_secrets ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon — service role bypasses RLS.

REVOKE ALL ON TABLE public.mt_provider_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mt_provider_secrets TO service_role;

COMMENT ON COLUMN public.mt_profiles.ai_key IS
  'Self-host plaintext Claude key (tradeoff). Hosted: prefer mt_provider_secrets + ai_key_on_file.';
COMMENT ON COLUMN public.mt_profiles.kimi_key IS
  'Self-host plaintext Kimi key (tradeoff). Hosted: prefer mt_provider_secrets + kimi_key_on_file.';
COMMENT ON COLUMN public.mt_profiles.humanizer_pw IS
  'Canonical humanizer password column (not humanizer_pass). Self-host plaintext tradeoff; hosted vault preferred.';
COMMENT ON COLUMN public.mt_profiles.ai_key_on_file IS
  'True when a Claude key is stored (vault ciphertext and/or plaintext). Never holds the secret value.';
COMMENT ON COLUMN public.mt_profiles.kimi_key_on_file IS
  'True when a Kimi key is stored. Never holds the secret value.';
COMMENT ON COLUMN public.mt_profiles.humanizer_pw_on_file IS
  'True when a humanizer password is stored. Never holds the secret value.';
COMMENT ON COLUMN public.mt_profiles.humanizer_email_on_file IS
  'True when a humanizer email is stored. Never holds the secret value.';

-- Pre-Phase-1 public schema fixture for migration upgrade-path tests.
-- Intentionally missing: accomplishments, portfolio, cadence columns, durability
-- tables, interview/contacts, promotion CHECKs, promote RPCs.
-- Legacy humanizer_pass (not humanizer_pw) so hardening migration exercises rename path.

CREATE TABLE IF NOT EXISTS public.mt_profiles (
  owner           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text,
  full_name       text,
  phone           text,
  linkedin        text,
  location        text,
  resume_text     text,
  resume_struct   jsonb,
  target_titles   text[] DEFAULT '{}',
  keywords        text[] DEFAULT '{}',
  seniority       text[] DEFAULT '{}',
  locations       text[] DEFAULT '{}',
  ats_boards      jsonb,
  ai_key          text,
  kimi_key        text,
  openai_base_url text,
  openai_key      text,
  openai_model    text,
  humanizer_email text,
  humanizer_pass  text,
  onboarded       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mt_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  company      text NOT NULL,
  title        text NOT NULL,
  level        text,
  url          text,
  source       text,
  fit_score    text,
  match_score  text,
  stage        text DEFAULT 'sourced',
  ghost_risk   text DEFAULT 'unknown',
  jd           text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_roles_owner_stage ON public.mt_roles(owner, stage);
CREATE INDEX IF NOT EXISTS idx_mt_roles_url ON public.mt_roles(url);

CREATE TABLE IF NOT EXISTS public.mt_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  owner             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  match_score       int,
  missing_keywords  jsonb,
  rewritten         text,
  jd_text           text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_reports_role ON public.mt_reports(role_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mt_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text NOT NULL,
  role_id    uuid,
  meta       jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mt_usage (
  owner      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date NOT NULL DEFAULT CURRENT_DATE,
  match_n    int DEFAULT 0,
  generate_n int DEFAULT 0,
  PRIMARY KEY (owner, day)
);

CREATE TABLE IF NOT EXISTS public.ai_config (
  id       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  endpoint text,
  token    text,
  model    text
);

ALTER TABLE public.mt_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mt_profiles_own ON public.mt_profiles;
CREATE POLICY mt_profiles_own ON public.mt_profiles
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

DROP POLICY IF EXISTS mt_roles_own ON public.mt_roles;
CREATE POLICY mt_roles_own ON public.mt_roles
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

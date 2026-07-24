-- CareerOps minimal schema for self-host.
-- Apply in the Supabase SQL editor (or via migrations) on a fresh project.
-- No personal data. Adjust RLS policies to match your threat model.

-- Profiles (one row per auth user)
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

-- Pipeline roles (kanban cards)
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
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_roles_owner_stage ON public.mt_roles(owner, stage);
CREATE INDEX IF NOT EXISTS idx_mt_roles_url ON public.mt_roles(url);

-- Match / rewrite / jobscan artifacts (append-only versions)
CREATE TABLE IF NOT EXISTS public.mt_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid NOT NULL REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  match_score       int,
  missing_keywords  jsonb,
  rewritten         text,
  jd_text           text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_reports_role ON public.mt_reports(role_id, kind, created_at DESC);

-- Lightweight action log (ids / action names only — not resume or JD text)
CREATE TABLE IF NOT EXISTS public.mt_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text,
  role_id    uuid,
  meta       jsonb,
  created_at timestamptz DEFAULT now()
);

-- Daily usage counters (search + free AI)
CREATE TABLE IF NOT EXISTS public.mt_usage (
  owner     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day       date NOT NULL,
  searches  int DEFAULT 0,
  ai_calls  int DEFAULT 0,
  PRIMARY KEY (owner, day)
);

-- Optional free-tier provider config (service role only)
CREATE TABLE IF NOT EXISTS public.ai_config (
  id       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  endpoint text,
  token    text,
  model    text
);

CREATE OR REPLACE VIEW public.ai_config_v AS
  SELECT id, endpoint, token, model FROM public.ai_config;

-- Row level security
ALTER TABLE public.mt_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config   ENABLE ROW LEVEL SECURITY;

-- Profiles: owner-only
DROP POLICY IF EXISTS mt_profiles_own ON public.mt_profiles;
CREATE POLICY mt_profiles_own ON public.mt_profiles
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

-- Roles: owner-only
DROP POLICY IF EXISTS mt_roles_own ON public.mt_roles;
CREATE POLICY mt_roles_own ON public.mt_roles
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

-- Reports: via role ownership
DROP POLICY IF EXISTS mt_reports_own ON public.mt_reports;
CREATE POLICY mt_reports_own ON public.mt_reports
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid()));

-- Events / usage: owner-only
DROP POLICY IF EXISTS mt_events_own ON public.mt_events;
CREATE POLICY mt_events_own ON public.mt_events
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

DROP POLICY IF EXISTS mt_usage_own ON public.mt_usage;
CREATE POLICY mt_usage_own ON public.mt_usage
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

-- ai_config: no policies for authenticated (service role only)

-- Optional: Jobscan PDF storage bucket (create in Dashboard → Storage)
-- insert into storage.buckets (id, name, public) values ('reports', 'reports', false);

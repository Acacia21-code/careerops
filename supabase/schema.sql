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
  humanizer_pw    text,
  ai_key_on_file  boolean DEFAULT false,
  kimi_key_on_file boolean DEFAULT false,
  humanizer_pw_on_file boolean DEFAULT false,
  humanizer_email_on_file boolean DEFAULT false,
  onboarded       boolean DEFAULT false,
  bullet_memory_cadence text DEFAULT 'off',
  cadence_timezone text DEFAULT 'UTC',
  cadence_anchor  text DEFAULT '1,15',
  last_entry_at   timestamptz,
  last_prompted_at timestamptz,
  snoozed_until   timestamptz,
  resume_struct_rev int DEFAULT 0,
  structured_modified_at timestamptz,
  resume_reconcile_needed boolean DEFAULT false,
  story_bank      text DEFAULT '',
  target_band_min numeric,
  target_band_max numeric,
  target_band_currency text DEFAULT 'USD',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT mt_profiles_cadence_chk CHECK (
    bullet_memory_cadence IS NULL
    OR bullet_memory_cadence IN ('biweekly', 'monthly', 'off')
  )
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
  location     text,
  sent_at      timestamptz,
  comp_range   jsonb,
  comp_raw     text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_roles_owner_stage ON public.mt_roles(owner, stage);
CREATE INDEX IF NOT EXISTS idx_mt_roles_url ON public.mt_roles(url);

-- Match / rewrite / jobscan / advisor artifacts (append-only versions)
-- role_id nullable for career-wide advisor briefs; owner required when role_id is null
CREATE TABLE IF NOT EXISTS public.mt_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  owner             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  match_score       int,
  missing_keywords  jsonb,
  rewritten         text,
  jd_text           text,
  display_name      text,
  sent_at           timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt_reports_role ON public.mt_reports(role_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_reports_owner_sent
  ON public.mt_reports(owner, sent_at)
  WHERE sent_at IS NOT NULL;

-- Outcomes (offer / reject / withdraw / ghost) — user-provided only
CREATE TABLE IF NOT EXISTS public.mt_outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  outcome_date  date,
  note          text DEFAULT '',
  base_amount   numeric,
  bonus_amount  numeric,
  equity_notes  text DEFAULT '',
  remote        text DEFAULT '',
  offer_deadline date,
  currency      text DEFAULT 'USD',
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_outcomes_kind_chk CHECK (
    kind IN ('offer', 'reject', 'withdraw', 'ghost')
  ),
  CONSTRAINT mt_outcomes_owner_role_uq UNIQUE (owner, role_id)
);
CREATE INDEX IF NOT EXISTS idx_mt_outcomes_owner ON public.mt_outcomes(owner, updated_at DESC);

-- Interview rounds (user-scheduled; prep drafts live in mt_reports.kind='interview')
CREATE TABLE IF NOT EXISTS public.mt_interview_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner             uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL REFERENCES public.mt_roles(id) ON DELETE CASCADE,
  round             int NOT NULL DEFAULT 1,
  scheduled_at      timestamptz,
  type              text NOT NULL DEFAULT 'screen',
  notes             text DEFAULT '',
  interviewer_name  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_interview_events_round_chk CHECK (round >= 1),
  CONSTRAINT mt_interview_events_type_chk CHECK (
    type IN ('screen', 'phone', 'onsite', 'loop', 'panel', 'other')
  )
);
CREATE INDEX IF NOT EXISTS idx_mt_interview_events_owner
  ON public.mt_interview_events(owner, scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_mt_interview_events_role
  ON public.mt_interview_events(role_id, round, scheduled_at);

-- Recruiter / network CRM (draft + log only — never auto-send)
CREATE TABLE IF NOT EXISTS public.mt_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  channel        text NOT NULL DEFAULT 'email',
  company        text DEFAULT '',
  role_ids       uuid[] NOT NULL DEFAULT '{}',
  last_touch_at  timestamptz,
  notes          text DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_contacts_channel_chk CHECK (
    channel IN ('email', 'linkedin', 'phone', 'other')
  ),
  CONSTRAINT mt_contacts_name_chk CHECK (char_length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_mt_contacts_owner
  ON public.mt_contacts(owner, last_touch_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_mt_contacts_company
  ON public.mt_contacts(owner, lower(company));
CREATE INDEX IF NOT EXISTS idx_mt_contacts_role_ids
  ON public.mt_contacts USING GIN (role_ids);

-- Bullet memory (provenance-first accomplishments)
CREATE TABLE IF NOT EXISTS public.mt_accomplishments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body_original       text NOT NULL,
  body_current        text NOT NULL,
  revisions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'inbox',
  archived_at         timestamptz,
  role_id             text,
  employer            text,
  project             text,
  tags                text[] DEFAULT '{}',
  checked             boolean DEFAULT false,
  promoted_role_id    text,
  promoted_bullet_id  text,
  promoted_at         timestamptz,
  promotion_snapshot  text,
  polish_candidate    text,
  polish_model        text,
  polish_at           timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT mt_accomplishments_status_chk CHECK (
    status IN ('inbox', 'ready', 'promoted', 'archived', 'orphaned')
  ),
  CONSTRAINT mt_accomplishments_body_chk CHECK (
    length(trim(body_original)) > 0 AND length(trim(body_current)) > 0
  ),
  CONSTRAINT mt_accomplishments_promotion_chk CHECK (
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
  )
);
CREATE INDEX IF NOT EXISTS idx_mt_accomplishments_owner_status ON public.mt_accomplishments(owner, status);

-- role_id and promoted_role_id are resume_struct role keys, not mt_roles.id values.
-- They intentionally remain text even when a deployment's board role IDs are bigint.
COMMENT ON COLUMN public.mt_accomplishments.role_id IS
  'Text resume_struct role key; not a foreign key to mt_roles.id.';
COMMENT ON COLUMN public.mt_accomplishments.promoted_role_id IS
  'Text resume_struct role key retained for promotion provenance.';

-- Portfolio library (code / design / product)
CREATE TABLE IF NOT EXISTS public.mt_portfolio_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type           text NOT NULL DEFAULT 'other',
  title               text NOT NULL,
  url                 text,
  summary             text,
  bullets             jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags                text[] DEFAULT '{}',
  started_on          date,
  ended_on            date,
  visibility          text NOT NULL DEFAULT 'private',
  body_original       text,
  body_current        text,
  revisions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  polish_candidate    text,
  polish_model        text,
  polish_at           timestamptz,
  promoted_project_id text,
  promoted_at         timestamptz,
  promotion_snapshot  text,
  archived_at         timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT mt_portfolio_type_chk CHECK (
    item_type IN ('code', 'design', 'product', 'other')
  ),
  CONSTRAINT mt_portfolio_vis_chk CHECK (
    visibility IN ('private', 'resume_ok')
  ),
  CONSTRAINT mt_portfolio_title_chk CHECK (
    length(trim(title)) > 0
  ),
  CONSTRAINT mt_portfolio_promotion_chk CHECK (
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
  )
);
CREATE INDEX IF NOT EXISTS idx_mt_portfolio_owner ON public.mt_portfolio_items(owner, created_at DESC);

-- body_original is immutable; this also maintains updated_at for accomplishments.
CREATE OR REPLACE FUNCTION public.mt_accomplishments_guard_original()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body_original IS DISTINCT FROM OLD.body_original THEN
    RAISE EXCEPTION 'body_original is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_accomplishments_guard ON public.mt_accomplishments;
CREATE TRIGGER trg_mt_accomplishments_guard
  BEFORE UPDATE ON public.mt_accomplishments
  FOR EACH ROW EXECUTE FUNCTION public.mt_accomplishments_guard_original();

-- Maintain updated_at for every other mutable personal table.
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

DROP TRIGGER IF EXISTS trg_mt_outcomes_touch ON public.mt_outcomes;
CREATE TRIGGER trg_mt_outcomes_touch
  BEFORE UPDATE ON public.mt_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mt_interview_events_touch ON public.mt_interview_events;
CREATE TRIGGER trg_mt_interview_events_touch
  BEFORE UPDATE ON public.mt_interview_events
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mt_contacts_touch ON public.mt_contacts;
CREATE TRIGGER trg_mt_contacts_touch
  BEFORE UPDATE ON public.mt_contacts
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mt_portfolio_items_touch ON public.mt_portfolio_items;
CREATE TRIGGER trg_mt_portfolio_items_touch
  BEFORE UPDATE ON public.mt_portfolio_items
  FOR EACH ROW EXECUTE FUNCTION public.mt_touch_updated_at();

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

-- Encrypted BYO provider secrets (optional). Used when edge secret CREDENTIALS_KEK is set.
-- Simple self-host may keep plaintext ai_key/kimi_key/humanizer_* on mt_profiles instead (tradeoff).
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
  'AES-GCM ciphertext for BYO keys. Service-role only. Prefer over plaintext profile columns when CREDENTIALS_KEK is set.';
COMMENT ON COLUMN public.mt_profiles.ai_key IS
  'Self-host plaintext Claude key (explicit tradeoff). Hosted demo uses mt_provider_secrets + ai_key_on_file.';
COMMENT ON COLUMN public.mt_profiles.humanizer_pw IS
  'Canonical humanizer password column (not humanizer_pass).';

-- Row level security
ALTER TABLE public.mt_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_accomplishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_interview_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt_contacts ENABLE ROW LEVEL SECURITY;

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

-- Reports: via role ownership OR direct owner (advisor briefs)
DROP POLICY IF EXISTS mt_reports_own ON public.mt_reports;
CREATE POLICY mt_reports_own ON public.mt_reports
  FOR ALL TO authenticated
  USING (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid())
  )
  WITH CHECK (
    owner = auth.uid()
    OR EXISTS (SELECT 1 FROM public.mt_roles r WHERE r.id = role_id AND r.owner = auth.uid())
  );

DROP POLICY IF EXISTS mt_accomplishments_own ON public.mt_accomplishments;
CREATE POLICY mt_accomplishments_own ON public.mt_accomplishments
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

DROP POLICY IF EXISTS mt_portfolio_own ON public.mt_portfolio_items;
CREATE POLICY mt_portfolio_own ON public.mt_portfolio_items
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

DROP POLICY IF EXISTS mt_outcomes_own ON public.mt_outcomes;
CREATE POLICY mt_outcomes_own ON public.mt_outcomes
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mt_roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

DROP POLICY IF EXISTS mt_interview_events_own ON public.mt_interview_events;
CREATE POLICY mt_interview_events_own ON public.mt_interview_events
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mt_roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

DROP POLICY IF EXISTS mt_contacts_own ON public.mt_contacts;
CREATE POLICY mt_contacts_own ON public.mt_contacts
  FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());

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
-- mt_provider_secrets: no policies for authenticated (service role only)
REVOKE ALL ON TABLE public.mt_provider_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mt_provider_secrets TO service_role;


-- ---------------------------------------------------------------------------
-- Track A2: transactional promote RPCs (optimistic resume_struct_rev).
-- Board role IDs may differ by deploy; resume_struct role keys remain TEXT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_stable_role_key(p_role jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h text;
  hash bigint := 0;
  i int;
  code int;
  unsigned bigint;
BEGIN
  IF p_role ? 'id' AND nullif(trim(p_role->>'id'), '') IS NOT NULL THEN
    RETURN p_role->>'id';
  END IF;
  h := lower(trim(regexp_replace(COALESCE(p_role->>'header', ''), '\s+', ' ', 'g')));
  FOR i IN 1..char_length(h) LOOP
    code := ascii(substr(h, i, 1));
    hash := ((hash << 5) - hash + code);
    -- emulate JS signed 32-bit wrap
    hash := ((hash + 2147483648) % 4294967296) - 2147483648;
  END LOOP;
  unsigned := CASE WHEN hash < 0 THEN hash + 4294967296 ELSE hash END;
  RETURN 'role_' || to_hex(unsigned);
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_jsonb_set_array_elem(
  p_arr jsonb,
  p_idx int,
  p_elem jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(CASE WHEN (ord - 1) = p_idx THEN p_elem ELSE elem END ORDER BY ord)
      FROM jsonb_array_elements(COALESCE(p_arr, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.mt_render_resume_text_from_struct(
  p_struct jsonb,
  p_prior_text text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lines text[] := ARRAY[]::text[];
  prior text := COALESCE(p_prior_text, '');
  head_lines text[] := ARRAY[]::text[];
  raw_lines text[];
  l text;
  heads_re text := '^(professional\s+summary|summary|experience|skills|education|projects|certifications)';
  role jsonb;
  bullet jsonb;
  project jsonb;
  bt text;
  other_summary text := '';
  other_skills text := '';
  other_education text := '';
  cur text := NULL;
  buf text[] := ARRAY[]::text[];
  key text;
BEGIN
  raw_lines := string_to_array(replace(prior, E'\r\n', E'\n'), E'\n');
  FOREACH l IN ARRAY COALESCE(raw_lines, ARRAY[]::text[]) LOOP
    IF trim(l) ~* heads_re THEN
      EXIT;
    END IF;
    head_lines := array_append(head_lines, l);
  END LOOP;
  IF array_length(head_lines, 1) IS NOT NULL AND trim(array_to_string(head_lines, E'\n')) <> '' THEN
    lines := lines || ARRAY[trim(array_to_string(head_lines, E'\n')), ''];
  END IF;

  cur := NULL;
  buf := ARRAY[]::text[];
  FOREACH l IN ARRAY COALESCE(raw_lines, ARRAY[]::text[]) LOOP
    IF trim(l) ~* '^(professional\s+summary|summary|profile|experience|skills|education|projects|certifications)\s*:?\s*$' THEN
      IF cur = 'summary' THEN other_summary := trim(array_to_string(buf, E'\n'));
      ELSIF cur = 'skills' THEN other_skills := trim(array_to_string(buf, E'\n'));
      ELSIF cur = 'education' THEN other_education := trim(array_to_string(buf, E'\n'));
      END IF;
      key := lower(trim(l));
      IF key ~ 'summary|profile' THEN cur := 'summary';
      ELSIF key ~ 'skills' THEN cur := 'skills';
      ELSIF key ~ 'education' THEN cur := 'education';
      ELSE cur := NULL;
      END IF;
      buf := ARRAY[]::text[];
      CONTINUE;
    END IF;
    IF cur IS NOT NULL THEN
      buf := array_append(buf, l);
    END IF;
  END LOOP;
  IF cur = 'summary' THEN other_summary := trim(array_to_string(buf, E'\n'));
  ELSIF cur = 'skills' THEN other_skills := trim(array_to_string(buf, E'\n'));
  ELSIF cur = 'education' THEN other_education := trim(array_to_string(buf, E'\n'));
  END IF;

  IF nullif(trim(COALESCE(p_struct->>'summary', '')), '') IS NOT NULL THEN
    lines := lines || ARRAY['PROFESSIONAL SUMMARY', p_struct->>'summary', ''];
  ELSIF other_summary <> '' THEN
    lines := lines || ARRAY['PROFESSIONAL SUMMARY', other_summary, ''];
  END IF;

  lines := array_append(lines, 'EXPERIENCE');
  FOR role IN SELECT * FROM jsonb_array_elements(COALESCE(p_struct->'roles', '[]'::jsonb))
  LOOP
    lines := array_append(lines, COALESCE(role->>'header', '') ||
      CASE WHEN nullif(role->>'sub', '') IS NOT NULL THEN E'\n' || (role->>'sub') ELSE '' END);
    FOR bullet IN SELECT * FROM jsonb_array_elements(COALESCE(role->'bullets', '[]'::jsonb))
    LOOP
      bt := CASE
        WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}'
        ELSE COALESCE(bullet->>'text', '')
      END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  END LOOP;

  IF jsonb_array_length(COALESCE(p_struct->'projects', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'PROJECTS');
    FOR project IN SELECT * FROM jsonb_array_elements(p_struct->'projects')
    LOOP
      lines := array_append(lines, COALESCE(nullif(project->>'header', ''), nullif(project->>'title', ''), 'Project'));
      IF nullif(COALESCE(project->>'sub', project->>'url'), '') IS NOT NULL THEN
        lines := array_append(lines, COALESCE(project->>'sub', project->>'url'));
      END IF;
      FOR bullet IN SELECT * FROM jsonb_array_elements(COALESCE(project->'bullets', '[]'::jsonb))
      LOOP
        bt := CASE
          WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}'
          ELSE COALESCE(bullet->>'text', '')
        END;
        lines := array_append(lines, '- ' || bt);
      END LOOP;
      lines := array_append(lines, '');
    END LOOP;
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'skills', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'SKILLS');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'skills')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  ELSIF other_skills <> '' THEN
    lines := lines || ARRAY['SKILLS', other_skills, ''];
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'education', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'EDUCATION');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'education')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  ELSIF other_education <> '' THEN
    lines := lines || ARRAY['EDUCATION', other_education, ''];
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'certs', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'CERTIFICATIONS');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'certs')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
  END IF;

  RETURN trim(array_to_string(lines, E'\n'));
END;
$$;

-- ---------------------------------------------------------------------------
-- promote_accomplishment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_accomplishment(
  p_accomplishment_id uuid,
  p_expected_rev int,
  p_role_id text DEFAULT NULL,
  p_role_header text DEFAULT NULL,
  p_role_sub text DEFAULT NULL,
  p_new_role_id text DEFAULT NULL,
  p_bullet_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prof public.mt_profiles%ROWTYPE;
  v_acc public.mt_accomplishments%ROWTYPE;
  v_struct jsonb;
  v_roles jsonb;
  v_role jsonb;
  v_role_idx int := -1;
  v_role_key text;
  v_bullet_id text;
  v_bullet jsonb;
  v_bullets jsonb;
  v_existing jsonb;
  v_ord int;
  v_resume_text text;
  v_new_rev int;
  v_snap text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prof
  FROM public.mt_profiles
  WHERE owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_prof.resume_struct_rev, 0) IS DISTINCT FROM COALESCE(p_expected_rev, 0) THEN
    RAISE EXCEPTION 'resume_struct_rev_conflict expected=% actual=%',
      COALESCE(p_expected_rev, 0), COALESCE(v_prof.resume_struct_rev, 0)
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_acc
  FROM public.mt_accomplishments
  WHERE id = p_accomplishment_id AND owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'accomplishment not found' USING ERRCODE = 'P0002';
  END IF;

  v_struct := COALESCE(v_prof.resume_struct, '{}'::jsonb);
  IF v_struct->'roles' IS NULL OR jsonb_typeof(v_struct->'roles') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{roles}', '[]'::jsonb, true);
  END IF;
  IF v_struct->'projects' IS NULL OR jsonb_typeof(v_struct->'projects') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{projects}', '[]'::jsonb, true);
  END IF;

  v_roles := v_struct->'roles';
  v_role_key := COALESCE(nullif(trim(p_role_id), ''), nullif(trim(v_acc.role_id), ''));

  IF v_role_key IS NOT NULL THEN
    FOR v_ord, v_role IN
      SELECT ord, elem FROM jsonb_array_elements(v_roles) WITH ORDINALITY AS t(elem, ord)
    LOOP
      IF (v_role->>'id') = v_role_key
         OR public.mt_stable_role_key(v_role) = v_role_key THEN
        v_role_idx := (v_ord - 1)::int;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_role_idx < 0 AND nullif(trim(p_role_header), '') IS NOT NULL THEN
    v_role_key := COALESCE(nullif(trim(p_new_role_id), ''), gen_random_uuid()::text);
    v_role := jsonb_build_object(
      'id', v_role_key,
      'header', p_role_header,
      'sub', COALESCE(p_role_sub, ''),
      'bullets', '[]'::jsonb
    );
    v_roles := v_roles || jsonb_build_array(v_role);
    v_role_idx := jsonb_array_length(v_roles) - 1;
  END IF;

  IF v_role_idx < 0 THEN
    RAISE EXCEPTION 'Pick a resume role before promoting' USING ERRCODE = '22023';
  END IF;

  v_role := v_roles->v_role_idx;
  IF nullif(v_role->>'id', '') IS NULL THEN
    v_role := jsonb_set(v_role, '{id}', to_jsonb(public.mt_stable_role_key(v_role)), true);
  END IF;
  v_role_key := v_role->>'id';
  v_bullets := COALESCE(v_role->'bullets', '[]'::jsonb);
  IF jsonb_typeof(v_bullets) <> 'array' THEN
    v_bullets := '[]'::jsonb;
  END IF;

  v_snap := v_acc.body_current;

  -- Idempotent: already promoted to same bullet
  IF nullif(trim(v_acc.promoted_bullet_id), '') IS NOT NULL THEN
    FOR v_ord, v_existing IN
      SELECT ord, elem FROM jsonb_array_elements(v_bullets) WITH ORDINALITY AS t(elem, ord)
    LOOP
      IF (v_existing->>'id') = v_acc.promoted_bullet_id THEN
        v_existing := v_existing
          || jsonb_build_object(
            'text', v_snap,
            'source_type', 'accomplishment',
            'source_id', v_acc.id::text
          );
        v_bullets := public.mt_jsonb_set_array_elem(v_bullets, (v_ord - 1)::int, v_existing);
        v_role := jsonb_set(v_role, '{bullets}', v_bullets, true);
        v_roles := public.mt_jsonb_set_array_elem(v_roles, v_role_idx, v_role);
        v_struct := jsonb_set(v_struct, '{roles}', v_roles, true);
        v_bullet_id := v_acc.promoted_bullet_id;

        v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
        v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

        UPDATE public.mt_profiles SET
          resume_struct = v_struct,
          resume_text = v_resume_text,
          resume_struct_rev = v_new_rev,
          structured_modified_at = v_now,
          resume_reconcile_needed = true
        WHERE owner = v_uid;

        UPDATE public.mt_accomplishments SET
          promoted_role_id = v_role_key,
          promoted_bullet_id = v_bullet_id,
          promoted_at = COALESCE(v_acc.promoted_at, v_now),
          promotion_snapshot = v_snap,
          status = 'promoted',
          updated_at = v_now
        WHERE id = v_acc.id AND owner = v_uid
        RETURNING * INTO v_acc;

        RETURN jsonb_build_object(
          'resume_struct_rev', v_new_rev,
          'structured_modified_at', v_now,
          'resume_reconcile_needed', true,
          'resume_struct', v_struct,
          'resume_text', v_resume_text,
          'accomplishment', to_jsonb(v_acc)
        );
      END IF;
    END LOOP;
  END IF;

  v_bullet_id := COALESCE(nullif(trim(p_bullet_id), ''), gen_random_uuid()::text);
  v_bullet := jsonb_build_object(
    'id', v_bullet_id,
    'text', v_snap,
    'source_type', 'accomplishment',
    'source_id', v_acc.id::text
  );
  v_bullets := v_bullets || jsonb_build_array(v_bullet);
  v_role := jsonb_set(v_role, '{bullets}', v_bullets, true);
  v_roles := public.mt_jsonb_set_array_elem(v_roles, v_role_idx, v_role);
  v_struct := jsonb_set(v_struct, '{roles}', v_roles, true);

  v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
  v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

  UPDATE public.mt_profiles SET
    resume_struct = v_struct,
    resume_text = v_resume_text,
    resume_struct_rev = v_new_rev,
    structured_modified_at = v_now,
    resume_reconcile_needed = true
  WHERE owner = v_uid;

  UPDATE public.mt_accomplishments SET
    promoted_role_id = v_role_key,
    promoted_bullet_id = v_bullet_id,
    promoted_at = v_now,
    promotion_snapshot = v_snap,
    status = 'promoted',
    updated_at = v_now
  WHERE id = v_acc.id AND owner = v_uid
  RETURNING * INTO v_acc;

  RETURN jsonb_build_object(
    'resume_struct_rev', v_new_rev,
    'structured_modified_at', v_now,
    'resume_reconcile_needed', true,
    'resume_struct', v_struct,
    'resume_text', v_resume_text,
    'accomplishment', to_jsonb(v_acc)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- promote_portfolio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_portfolio(
  p_portfolio_id uuid,
  p_expected_rev int,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prof public.mt_profiles%ROWTYPE;
  v_item public.mt_portfolio_items%ROWTYPE;
  v_struct jsonb;
  v_projects jsonb;
  v_project jsonb;
  v_project_idx int := -1;
  v_project_id text;
  v_ord int;
  v_bullet_texts text[];
  v_bt text;
  v_bullets jsonb := '[]'::jsonb;
  v_body text;
  v_snap text;
  v_resume_text text;
  v_new_rev int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prof
  FROM public.mt_profiles
  WHERE owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_prof.resume_struct_rev, 0) IS DISTINCT FROM COALESCE(p_expected_rev, 0) THEN
    RAISE EXCEPTION 'resume_struct_rev_conflict expected=% actual=%',
      COALESCE(p_expected_rev, 0), COALESCE(v_prof.resume_struct_rev, 0)
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_item
  FROM public.mt_portfolio_items
  WHERE id = p_portfolio_id AND owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'portfolio item not found' USING ERRCODE = 'P0002';
  END IF;

  v_struct := COALESCE(v_prof.resume_struct, '{}'::jsonb);
  IF v_struct->'projects' IS NULL OR jsonb_typeof(v_struct->'projects') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{projects}', '[]'::jsonb, true);
  END IF;
  IF v_struct->'roles' IS NULL OR jsonb_typeof(v_struct->'roles') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{roles}', '[]'::jsonb, true);
  END IF;

  v_projects := v_struct->'projects';
  v_project_id := COALESCE(
    nullif(trim(v_item.promoted_project_id), ''),
    nullif(trim(p_project_id), ''),
    gen_random_uuid()::text
  );

  FOR v_ord, v_project IN
    SELECT ord, elem FROM jsonb_array_elements(v_projects) WITH ORDINALITY AS t(elem, ord)
  LOOP
    IF (v_project->>'id') = v_project_id THEN
      v_project_idx := (v_ord - 1)::int;
      EXIT;
    END IF;
  END LOOP;

  -- Normalize portfolio bullet texts
  IF jsonb_typeof(v_item.bullets) = 'array' AND jsonb_array_length(v_item.bullets) > 0 THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_bullet_texts
    FROM (
      SELECT CASE
        WHEN jsonb_typeof(b) = 'string' THEN nullif(trim(b #>> '{}'), '')
        ELSE nullif(trim(COALESCE(b->>'text', '')), '')
      END AS x
      FROM jsonb_array_elements(v_item.bullets) AS b
    ) s
    WHERE x IS NOT NULL;
  ELSE
    v_body := COALESCE(v_item.body_current, v_item.summary, '');
    SELECT COALESCE(array_agg(trim(regexp_replace(line, '^[-•]\s*', ''))), ARRAY[]::text[])
      INTO v_bullet_texts
    FROM unnest(string_to_array(v_body, E'\n')) AS line
    WHERE trim(regexp_replace(line, '^[-•]\s*', '')) <> '';
  END IF;

  IF v_project_idx < 0 THEN
    FOREACH v_bt IN ARRAY COALESCE(v_bullet_texts, ARRAY[]::text[]) LOOP
      v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'text', v_bt,
        'source_type', 'portfolio',
        'source_id', v_item.id::text
      ));
    END LOOP;
    v_project := jsonb_build_object(
      'id', v_project_id,
      'header', v_item.title,
      'title', v_item.title,
      'sub', COALESCE(v_item.url, ''),
      'url', COALESCE(v_item.url, ''),
      'bullets', v_bullets,
      'source_type', 'portfolio',
      'source_id', v_item.id::text
    );
    v_projects := v_projects || jsonb_build_array(v_project);
  ELSE
    v_project := v_projects->v_project_idx;
    v_project := v_project
      || jsonb_build_object(
        'header', v_item.title,
        'title', v_item.title,
        'sub', COALESCE(nullif(v_item.url, ''), v_project->>'sub'),
        'source_type', 'portfolio',
        'source_id', v_item.id::text
      );
    IF nullif(v_item.url, '') IS NOT NULL THEN
      v_project := jsonb_set(v_project, '{url}', to_jsonb(v_item.url), true);
    END IF;
    v_projects := public.mt_jsonb_set_array_elem(v_projects, v_project_idx, v_project);
  END IF;

  v_struct := jsonb_set(v_struct, '{projects}', v_projects, true);
  v_snap := v_item.title || E'\n' || array_to_string(COALESCE(v_bullet_texts, ARRAY[]::text[]), E'\n');
  v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
  v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

  UPDATE public.mt_profiles SET
    resume_struct = v_struct,
    resume_text = v_resume_text,
    resume_struct_rev = v_new_rev,
    structured_modified_at = v_now,
    resume_reconcile_needed = true
  WHERE owner = v_uid;

  UPDATE public.mt_portfolio_items SET
    promoted_project_id = v_project_id,
    promoted_at = v_now,
    promotion_snapshot = v_snap,
    updated_at = v_now
  WHERE id = v_item.id AND owner = v_uid
  RETURNING * INTO v_item;

  RETURN jsonb_build_object(
    'resume_struct_rev', v_new_rev,
    'structured_modified_at', v_now,
    'resume_reconcile_needed', true,
    'resume_struct', v_struct,
    'resume_text', v_resume_text,
    'portfolio', to_jsonb(v_item)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt_stable_role_key(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_jsonb_set_array_elem(jsonb, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_render_resume_text_from_struct(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_accomplishment(uuid, int, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_portfolio(uuid, int, text) TO authenticated;

COMMENT ON FUNCTION public.promote_accomplishment IS
  'Atomic promote: check resume_struct_rev, mutate resume_struct + resume_text, update accomplishment promotion fields.';
COMMENT ON FUNCTION public.promote_portfolio IS
  'Atomic portfolio promote: check resume_struct_rev, mutate resume_struct.projects + resume_text, update portfolio promotion fields.';

-- Optional: Jobscan PDF storage bucket (create in Dashboard → Storage)
-- insert into storage.buckets (id, name, public) values ('reports', 'reports', false);

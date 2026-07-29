-- Persist ATS location (+ notes) on roles.
-- OSS / sterile schema: public.mt_roles is a real table.
ALTER TABLE public.mt_roles ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.mt_roles ADD COLUMN IF NOT EXISTS notes text;

-- Telivity live (vqcjdqhcdhxjlznpqing): public.mt_roles is a VIEW over app.roles.
-- Apply there instead:
--   ALTER TABLE app.roles ADD COLUMN IF NOT EXISTS location text;
--   ALTER TABLE app.roles ADD COLUMN IF NOT EXISTS notes text;
--   ALTER TABLE app.roles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
--   CREATE OR REPLACE VIEW public.mt_roles AS
--     SELECT id, company, title, level, url, source, fit_score, stage, ghost_risk,
--            match_score, created_at, jd, location, notes, updated_at, owner
--     FROM app.roles;

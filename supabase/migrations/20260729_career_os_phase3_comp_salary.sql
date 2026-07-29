-- Career OS Phase 3.2 + 3.3: posted ATS comp on roles + profile target band.
-- Apply after contacts (or after Phase 2). User/posted numbers only — never invent.

ALTER TABLE public.mt_roles
  ADD COLUMN IF NOT EXISTS comp_range jsonb,
  ADD COLUMN IF NOT EXISTS comp_raw text;

ALTER TABLE public.mt_profiles
  ADD COLUMN IF NOT EXISTS target_band_min numeric,
  ADD COLUMN IF NOT EXISTS target_band_max numeric,
  ADD COLUMN IF NOT EXISTS target_band_currency text DEFAULT 'USD';

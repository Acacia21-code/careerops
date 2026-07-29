-- Production (app schema) Phase 2.3: structured offer fields.

ALTER TABLE app.outcomes
  ADD COLUMN IF NOT EXISTS base_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_amount numeric,
  ADD COLUMN IF NOT EXISTS equity_notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS remote text DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_deadline date,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

CREATE OR REPLACE VIEW public.mt_outcomes
WITH (security_invoker=true) AS
SELECT * FROM app.outcomes;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_outcomes TO authenticated, anon;

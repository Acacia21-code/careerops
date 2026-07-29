-- Career OS Phase 2.3: structured offer fields on outcomes.
-- Apply after durability (+ interview optional). User-provided numbers only — never invent.

ALTER TABLE public.mt_outcomes
  ADD COLUMN IF NOT EXISTS base_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_amount numeric,
  ADD COLUMN IF NOT EXISTS equity_notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS remote text DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_deadline date,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

-- Soft constraint: remote is free text but document expected values in app
-- (remote | hybrid | onsite | '' | custom).

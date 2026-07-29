-- Career OS Phase 3.1: recruiter / network CRM (draft + log only — no send / no OAuth).
-- Apply after Phase 2. Idempotent where practical. Self-host / public.mt_* layout.

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

ALTER TABLE public.mt_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mt_contacts_own ON public.mt_contacts;
CREATE POLICY mt_contacts_own ON public.mt_contacts
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (owner = auth.uid());

CREATE OR REPLACE FUNCTION public.mt_contacts_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_contacts_touch ON public.mt_contacts;
CREATE TRIGGER trg_mt_contacts_touch
  BEFORE UPDATE ON public.mt_contacts
  FOR EACH ROW EXECUTE FUNCTION public.mt_contacts_touch_updated();

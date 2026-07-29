-- Production (app schema) Phase 3.1: contacts CRM.
-- Live project uses app.* tables + public.mt_* views.

CREATE TABLE IF NOT EXISTS app.contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  channel        text NOT NULL DEFAULT 'email',
  company        text DEFAULT '',
  -- NOTE: production app.roles.id is bigint (not uuid).
  role_ids       bigint[] NOT NULL DEFAULT '{}',
  last_touch_at  timestamptz,
  notes          text DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_contacts_channel_chk CHECK (
    channel IN ('email', 'linkedin', 'phone', 'other')
  ),
  CONSTRAINT app_contacts_name_chk CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_app_contacts_owner
  ON app.contacts(owner, last_touch_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_app_contacts_company
  ON app.contacts(owner, lower(company));
CREATE INDEX IF NOT EXISTS idx_app_contacts_role_ids
  ON app.contacts USING GIN (role_ids);

ALTER TABLE app.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own ON app.contacts;
CREATE POLICY own ON app.contacts
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (owner = auth.uid());

CREATE OR REPLACE FUNCTION app.contacts_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_contacts_touch ON app.contacts;
CREATE TRIGGER trg_app_contacts_touch
  BEFORE UPDATE ON app.contacts
  FOR EACH ROW EXECUTE FUNCTION app.contacts_touch_updated();

CREATE OR REPLACE VIEW public.mt_contacts
WITH (security_invoker=true) AS
SELECT * FROM app.contacts;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_contacts TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.contacts TO authenticated;

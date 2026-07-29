-- Production (app schema) Phase 2.2: interview events.
-- Live project uses app.* tables + public.mt_* views.

CREATE TABLE IF NOT EXISTS app.interview_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner             uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
  round             int NOT NULL DEFAULT 1,
  scheduled_at      timestamptz,
  type              text NOT NULL DEFAULT 'screen',
  notes             text DEFAULT '',
  interviewer_name  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_interview_events_round_chk CHECK (round >= 1),
  CONSTRAINT app_interview_events_type_chk CHECK (
    type IN ('screen', 'phone', 'onsite', 'loop', 'panel', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_app_interview_events_owner
  ON app.interview_events(owner, scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_app_interview_events_role
  ON app.interview_events(role_id, round, scheduled_at);

ALTER TABLE app.interview_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own ON app.interview_events;
CREATE POLICY own ON app.interview_events
  FOR ALL TO authenticated
  USING (owner = auth.uid())
  WITH CHECK (
    owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM app.roles r
      WHERE r.id = role_id AND r.owner = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION app.interview_events_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_interview_events_touch ON app.interview_events;
CREATE TRIGGER trg_app_interview_events_touch
  BEFORE UPDATE ON app.interview_events
  FOR EACH ROW EXECUTE FUNCTION app.interview_events_touch_updated();

CREATE OR REPLACE VIEW public.mt_interview_events
WITH (security_invoker=true) AS
SELECT * FROM app.interview_events;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt_interview_events TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.interview_events TO authenticated;

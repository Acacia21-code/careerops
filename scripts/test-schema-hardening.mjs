import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const schema = read('supabase/schema.sql')

for (const constraint of [
  'mt_profiles_cadence_chk',
  'mt_accomplishments_status_chk',
  'mt_accomplishments_body_chk',
  'mt_portfolio_type_chk',
  'mt_portfolio_vis_chk',
  'mt_portfolio_title_chk',
  'mt_accomplishments_promotion_chk',
  'mt_portfolio_promotion_chk',
]) {
  assert.match(schema, new RegExp(`CONSTRAINT\\s+${constraint}\\b`), `${constraint} missing from schema.sql`)
}

assert.match(schema, /CREATE OR REPLACE FUNCTION public\.mt_accomplishments_guard_original\(\)/)
assert.match(schema, /CREATE TRIGGER trg_mt_accomplishments_guard/)
assert.match(schema, /body_original is immutable/)
assert.match(schema, /\brole_id\s+text\b/)
assert.match(schema, /\bpromoted_role_id\s+text\b/)
assert.match(schema, /resume_struct role key/i)
assert.match(schema, /\bhumanizer_pw\s+text\b/)
assert.doesNotMatch(schema, /\bhumanizer_pass\s+text\b/)

for (const table of [
  'mt_profiles',
  'mt_roles',
  'mt_outcomes',
  'mt_interview_events',
  'mt_contacts',
  'mt_accomplishments',
  'mt_portfolio_items',
]) {
  assert.match(
    schema,
    new RegExp(`BEFORE UPDATE ON public\\.${table}\\b`),
    `${table} needs an updated_at trigger in schema.sql`,
  )
}

const publicMigration = read('supabase/migrations/20260729_schema_hardening.sql')
assert.match(publicMigration, /ALTER TABLE public\.mt_accomplishments/)
assert.match(publicMigration, /mt_accomplishments_promotion_chk/)
assert.match(publicMigration, /status = 'orphaned'/)
assert.match(publicMigration, /ALTER TABLE public\.mt_portfolio_items/)
assert.match(publicMigration, /mt_portfolio_promotion_chk/)
assert.match(publicMigration, /COMMENT ON COLUMN public\.mt_accomplishments\.role_id/)
assert.match(publicMigration, /COMMENT ON COLUMN public\.mt_accomplishments\.promoted_role_id/)
assert.match(publicMigration, /ADD COLUMN IF NOT EXISTS humanizer_pw text/)
assert.match(publicMigration, /humanizer_pass/)
assert.doesNotMatch(publicMigration, /promote_accomplishment|promote_portfolio/i)
for (const table of ['mt_profiles', 'mt_roles', 'mt_portfolio_items']) {
  assert.match(
    publicMigration,
    new RegExp(`BEFORE UPDATE ON public\\.${table}\\b`),
    `${table} needs a hardening migration updated_at trigger`,
  )
}

const appMigration = read('supabase/migrations/20260729_schema_hardening_app_schema.sql')
assert.match(appMigration, /ALTER TABLE app\.accomplishments/)
assert.match(appMigration, /app_accomplishments_promotion_chk/)
assert.match(appMigration, /status = 'orphaned'/)
assert.match(appMigration, /ALTER TABLE app\.portfolio_items/)
assert.match(appMigration, /app_portfolio_promotion_chk/)
assert.match(appMigration, /COMMENT ON COLUMN app\.accomplishments\.role_id/)
assert.match(appMigration, /COMMENT ON COLUMN app\.accomplishments\.promoted_role_id/)
assert.match(appMigration, /ADD COLUMN IF NOT EXISTS humanizer_pw text/)
assert.match(appMigration, /humanizer_pass/)
assert.match(appMigration, /CREATE OR REPLACE VIEW public\.mt_profiles/)
assert.doesNotMatch(appMigration, /promote_accomplishment|promote_portfolio/i)
for (const table of ['profiles', 'roles', 'portfolio_items']) {
  assert.match(
    appMigration,
    new RegExp(`BEFORE UPDATE ON app\\.${table}\\b`),
    `app.${table} needs a hardening migration updated_at trigger`,
  )
}

console.log('test-schema-hardening passed')

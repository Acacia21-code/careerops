#!/usr/bin/env node
/**
 * Track A3: Docker / local Postgres integration suite.
 *
 * Modes:
 *   1) Fresh schema.sql + hardening already inlined → CHECK / RLS / promote txn tests
 *   2) pre_phase1 fixture → public migrations in order → end-state assert + same SQL tests
 *
 * Env:
 *   DATABASE_URL  — if set, use it (CI service container)
 *   PG_INTEGRATION_SKIP_DOCKER=1 — do not auto-start a Docker Postgres
 *
 * Exit 0 on pass. Exit 2 if Docker/psql unavailable (documented CI-only path).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const testsDir = path.join(root, 'supabase/tests')

const PUBLIC_MIGRATIONS = [
  '20260726_mt_roles_location.sql',
  '20260729_career_os_phase1.sql',
  '20260729_career_os_durability.sql',
  '20260729_career_os_phase2_interview.sql',
  '20260729_career_os_phase2_offers.sql',
  '20260729_career_os_phase3_contacts.sql',
  '20260729_career_os_phase3_comp_salary.sql',
  '20260729_credential_vault.sql',
  '20260729_schema_hardening.sql',
  '20260729_promote_rpc.sql',
]

const USER_A = '00000000-0000-4000-8000-0000000000aa'
const USER_B = '00000000-0000-4000-8000-0000000000bb'

const CONTAINER = process.env.PG_INTEGRATION_CONTAINER || 'careerops-pg-integration'
const IMAGE = process.env.PG_INTEGRATION_IMAGE || 'postgres:16'
const DB_NAME = 'careerops_test'
const DB_USER = 'postgres'
const DB_PASS = 'postgres'
const HOST_PORT = process.env.PG_INTEGRATION_PORT || '55432'

let startedContainer = false
let databaseUrl = process.env.DATABASE_URL || ''

function log(msg) {
  console.log(`[pg-integration] ${msg}`)
}

function fail(msg, code = 1) {
  console.error(`[pg-integration] FAIL: ${msg}`)
  process.exit(code)
}

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' })
  return r.status === 0
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || root,
  })
  if (opts.allowFail) return r
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim()
    fail(`${cmd} ${args.join(' ')}\n${err}`)
  }
  return r
}

function ensureDockerPostgres() {
  if (databaseUrl) {
    log(`using DATABASE_URL`)
    return
  }
  if (process.env.PG_INTEGRATION_SKIP_DOCKER === '1') {
    fail('DATABASE_URL unset and PG_INTEGRATION_SKIP_DOCKER=1', 2)
  }
  if (!which('docker')) {
    fail('docker not found; set DATABASE_URL or install Docker (CI uses postgres:16 service)', 2)
  }
  const info = spawnSync('docker', ['info'], { encoding: 'utf8' })
  if (info.status !== 0) {
    fail('docker daemon not reachable; set DATABASE_URL or start Docker/Colima', 2)
  }

  const inspect = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { encoding: 'utf8' })
  if (inspect.status === 0 && String(inspect.stdout).trim() === 'true') {
    log(`reusing container ${CONTAINER}`)
  } else {
    spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' })
    log(`starting ${IMAGE} as ${CONTAINER} on :${HOST_PORT}`)
    run('docker', [
      'run', '-d', '--name', CONTAINER,
      '-e', `POSTGRES_PASSWORD=${DB_PASS}`,
      '-e', `POSTGRES_USER=${DB_USER}`,
      '-e', `POSTGRES_DB=${DB_NAME}`,
      '-p', `${HOST_PORT}:5432`,
      IMAGE,
    ])
    startedContainer = true
  }

  databaseUrl = `postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${HOST_PORT}/${DB_NAME}`
  waitForReady()
}

function waitForReady() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', DB_USER, '-d', DB_NAME], {
      encoding: 'utf8',
    })
    if (r.status === 0) return
    spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)'], {
      encoding: 'utf8',
    })
  }
  fail('postgres did not become ready in 60s', 2)
}

function psqlFile(filePath, extraArgs = []) {
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) fail(`missing SQL file ${abs}`)

  if (databaseUrl.includes('127.0.0.1:' + HOST_PORT) || databaseUrl.includes('localhost:' + HOST_PORT)) {
    // Prefer docker exec so host need not install psql matching the container.
    const relIn = `/tmp/${path.basename(abs)}`
    run('docker', ['cp', abs, `${CONTAINER}:${relIn}`])
    const r = run('docker', [
      'exec', '-e', `PGPASSWORD=${DB_PASS}`, CONTAINER,
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB_NAME,
      ...extraArgs, '-f', relIn,
    ])
    return r
  }

  if (!which('psql')) fail('psql not found on PATH and not using managed Docker container', 2)
  const url = new URL(databaseUrl)
  return run('psql', ['-v', 'ON_ERROR_STOP=1', '-f', abs, ...extraArgs], {
    env: {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username || DB_USER),
      PGPASSWORD: decodeURIComponent(url.password || DB_PASS),
      PGDATABASE: (url.pathname || `/${DB_NAME}`).replace(/^\//, '') || DB_NAME,
    },
  })
}

function psqlScript(sql) {
  // Scratch goes to the OS temp dir, not testsDir: fail() exits the process, so
  // the finally below never runs on a psql error and repo-local scratch survives.
  const tmp = path.join(os.tmpdir(), `careerops-pg-${process.pid}-${Date.now()}.sql`)
  fs.writeFileSync(tmp, sql)
  try {
    return psqlFile(tmp)
  } finally {
    try { fs.unlinkSync(tmp) } catch (_e) { /* ignore */ }
  }
}

function resetDatabase() {
  log('reset database')
  // CURRENT_USER, not a literal postgres: the CI service container and a local
  // Postgres install do not share an owner role.
  psqlScript(`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
GRANT ALL ON SCHEMA public TO public;
`)
}

function seedUsers() {
  psqlScript(`
INSERT INTO auth.users (id) VALUES ('${USER_A}'::uuid), ('${USER_B}'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mt_profiles (owner, email, full_name, onboarded, resume_struct_rev)
VALUES
  ('${USER_A}'::uuid, 'a@example.com', 'User A', true, 0),
  ('${USER_B}'::uuid, 'b@example.com', 'User B', true, 0)
ON CONFLICT (owner) DO NOTHING;
`)
}

function applyAuthAndGrants() {
  psqlFile(path.join(testsDir, 'auth_stub.sql'))
}

function applyGrants() {
  psqlFile(path.join(testsDir, 'grants.sql'))
}

function runFreshPath() {
  log('=== fresh schema.sql path ===')
  resetDatabase()
  applyAuthAndGrants()
  psqlFile(path.join(root, 'supabase/schema.sql'))
  applyGrants()
  seedUsers()
  psqlFile(path.join(testsDir, 'sql/01_checks_triggers.sql'))
  psqlFile(path.join(testsDir, 'sql/02_rls_two_user.sql'))
  psqlFile(path.join(testsDir, 'sql/03_promote_atomicity.sql'))
  log('fresh path passed')
}

function runUpgradePath() {
  log('=== migration upgrade path (pre_phase1 → migrations) ===')
  resetDatabase()
  applyAuthAndGrants()
  psqlFile(path.join(testsDir, 'fixtures/pre_phase1.sql'))
  applyGrants()

  for (const name of PUBLIC_MIGRATIONS) {
    const file = path.join(root, 'supabase/migrations', name)
    log(`apply ${name}`)
    psqlFile(file)
  }
  applyGrants()
  psqlFile(path.join(testsDir, 'sql/04_migration_upgrade_assert.sql'))

  // Re-seed and run behavioral tests on upgraded schema
  seedUsers()
  psqlFile(path.join(testsDir, 'sql/01_checks_triggers.sql'))
  psqlFile(path.join(testsDir, 'sql/02_rls_two_user.sql'))
  psqlFile(path.join(testsDir, 'sql/03_promote_atomicity.sql'))
  log('upgrade path passed')
}

function cleanup() {
  if (startedContainer && process.env.PG_INTEGRATION_KEEP !== '1') {
    log(`removing container ${CONTAINER}`)
    spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' })
  }
}

try {
  ensureDockerPostgres()
  runFreshPath()
  runUpgradePath()
  log('all pg integration tests passed')
} catch (e) {
  cleanup()
  throw e
}
cleanup()

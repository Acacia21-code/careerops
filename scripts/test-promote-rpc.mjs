/**
 * Track A2 static/unit tests: promote RPC SQL presence + JS fallback helpers.
 * Track A3 live Docker suite: scripts/test-pg-integration.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  promoteAccomplishment,
  promotePortfolio,
} from '../web/lib/resume-sync.mjs'
import { createAccomplishment } from '../web/lib/bullet-memory.mjs'
import { createPortfolioItem } from '../web/lib/portfolio.mjs'
import {
  isResumeRevConflict,
  resumeRevConflictError,
  applyPromoteRpcResult,
  shouldUsePromoteRpc,
  rpcPromoteAccomplishment,
  rpcPromotePortfolio,
  RESUME_REV_CONFLICT,
} from '../web/lib/promote-rpc.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const schema = read('supabase/schema.sql')
const publicMig = read('supabase/migrations/20260729_promote_rpc.sql')
const appMig = read('supabase/migrations/20260729_promote_rpc_app_schema.sql')
const spa = `${read('web/index.html')}\n${read('web/ui/state.mjs')}`
const helper = read('web/lib/promote-rpc.mjs')
const resumeSync = read('web/lib/resume-sync.mjs')

function assertRpcSignatures(sql, label) {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.promote_accomplishment\(\s*p_accomplishment_id uuid,\s*p_expected_rev int,/s,
    `${label}: promote_accomplishment signature`,
  )
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.promote_portfolio\(\s*p_portfolio_id uuid,\s*p_expected_rev int,/s,
    `${label}: promote_portfolio signature`,
  )
  assert.match(sql, /resume_struct_rev_conflict/)
  assert.match(sql, /resume_struct_rev/)
  assert.match(sql, /structured_modified_at/)
  assert.match(sql, /mt_render_resume_text_from_struct/)
  assert.match(sql, /SECURITY DEFINER/)
}

assertRpcSignatures(publicMig, 'public migration')
assertRpcSignatures(appMig, 'app_schema migration')
assertRpcSignatures(schema, 'schema.sql')

assert.match(publicMig, /UPDATE public\.mt_profiles SET/)
assert.match(publicMig, /UPDATE public\.mt_accomplishments SET/)
assert.match(publicMig, /UPDATE public\.mt_portfolio_items SET/)
assert.match(publicMig, /SET search_path = public\b/)
assert.doesNotMatch(publicMig, /FROM app\.profiles/)

assert.match(appMig, /UPDATE app\.profiles SET/)
assert.match(appMig, /UPDATE app\.accomplishments SET/)
assert.match(appMig, /UPDATE app\.portfolio_items SET/)
assert.match(appMig, /SET search_path = public, app/)
assert.match(appMig, /Prod board role IDs are bigint/i)
assert.match(appMig, /resume_struct role keys remain TEXT/i)
assert.doesNotMatch(appMig, /UPDATE public\.mt_profiles SET/)

// Hardening migrations must stay free of promote RPCs (A1 ownership)
const harden = read('supabase/migrations/20260729_schema_hardening.sql')
const hardenApp = read('supabase/migrations/20260729_schema_hardening_app_schema.sql')
assert.doesNotMatch(harden, /promote_accomplishment|promote_portfolio/)
assert.doesNotMatch(hardenApp, /promote_accomplishment|promote_portfolio/)

// SPA wires online path through helper; keeps JS promote for offline
assert.match(spa, /from '\.\.\/lib\/promote-rpc\.mjs'/)
assert.match(spa, /shouldUsePromoteRpc/)
assert.match(spa, /rpcPromoteAccomplishment/)
assert.match(spa, /rpcPromotePortfolio/)
assert.match(spa, /isResumeRevConflict/)
assert.match(spa, /promoteAccomplishment\(PROFILE/)
assert.match(spa, /promotePortfolio\(PROFILE/)
assert.match(helper, /sb\.rpc\('promote_accomplishment'/)
assert.match(helper, /sb\.rpc\('promote_portfolio'/)
assert.match(resumeSync, /export function promoteAccomplishment/)
assert.match(resumeSync, /export function promotePortfolio/)

// --- JS unit: conflict helpers ---
assert.equal(isResumeRevConflict({ message: 'resume_struct_rev_conflict expected=1 actual=2' }), true)
assert.equal(isResumeRevConflict({ code: '40001', message: 'resume_struct_rev_conflict expected=0 actual=1' }), true)
assert.equal(isResumeRevConflict({ code: RESUME_REV_CONFLICT }), true)
assert.equal(isResumeRevConflict({ message: 'not authenticated' }), false)
const conflictErr = resumeRevConflictError({ message: 'resume_struct_rev_conflict' })
assert.equal(conflictErr.code, RESUME_REV_CONFLICT)

assert.equal(shouldUsePromoteRpc({ dbOk: true, userId: 'u1', sb: { rpc() {} } }), true)
assert.equal(shouldUsePromoteRpc({ dbOk: false, userId: 'u1', sb: { rpc() {} } }), false)
assert.equal(shouldUsePromoteRpc({ dbOk: true, userId: null, sb: { rpc() {} } }), false)

const applied = applyPromoteRpcResult(
  { resume_struct_rev: 0, resume_text: 'old' },
  {
    resume_struct_rev: 2,
    resume_text: 'new',
    resume_struct: { roles: [] },
    structured_modified_at: '2026-07-29T00:00:00Z',
    resume_reconcile_needed: true,
    accomplishment: { id: 'a1', status: 'promoted' },
  },
)
assert.equal(applied.profile.resume_struct_rev, 2)
assert.equal(applied.profile.resume_reconcile_needed, true)
assert.equal(applied.accomplishment.status, 'promoted')

// --- Offline fallback pure JS still works ---
{
  const profile = {
    resume_text: 'Jane\n\nEXPERIENCE\nEng\n- Old\n',
    resume_struct: {
      roles: [{ id: 'r1', header: 'Eng', bullets: [{ id: 'b0', text: 'Old' }] }],
      projects: [],
      skills: [],
      education: [],
      certs: [],
    },
    resume_struct_rev: 3,
  }
  const acc = createAccomplishment('Shipped X — 10%', { id: 'acc-offline', role_id: 'r1' })
  const out = promoteAccomplishment(profile, acc, { role_id: 'r1' })
  assert.equal(out.resume_struct_rev, 4)
  assert.equal(out.accomplishment.status, 'promoted')
  assert.ok(out.resume_text.includes('Shipped X'))
}
{
  const profile = {
    resume_text: '',
    resume_struct: { roles: [], projects: [], skills: [], education: [], certs: [] },
    resume_struct_rev: 0,
  }
  const item = createPortfolioItem({ title: 'CLI', summary: 'Built CLI', item_type: 'code' })
  const out = promotePortfolio(profile, item)
  assert.equal(out.resume_struct_rev, 1)
  assert.equal(out.struct.projects[0].source_type, 'portfolio')
}

// --- Mock sb.rpc paths ---
{
  const calls = []
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args })
      return {
        data: {
          resume_struct_rev: 1,
          resume_reconcile_needed: true,
          resume_struct: { roles: [] },
          resume_text: 't',
          accomplishment: { id: args.p_accomplishment_id, status: 'promoted' },
        },
        error: null,
      }
    },
  }
  const data = await rpcPromoteAccomplishment(sb, {
    accomplishmentId: '11111111-1111-1111-1111-111111111111',
    expectedRev: 0,
    roleId: 'r1',
  })
  assert.equal(calls[0].name, 'promote_accomplishment')
  assert.equal(calls[0].args.p_expected_rev, 0)
  assert.equal(data.resume_struct_rev, 1)
}
{
  const sb = {
    async rpc() {
      return { data: null, error: { code: '40001', message: 'resume_struct_rev_conflict expected=0 actual=1' } }
    },
  }
  await assert.rejects(
    () => rpcPromotePortfolio(sb, { portfolioId: '22222222-2222-2222-2222-222222222222', expectedRev: 0 }),
    err => err.code === RESUME_REV_CONFLICT,
  )
}

console.log('test-promote-rpc passed')

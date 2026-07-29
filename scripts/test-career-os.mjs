/**
 * Career OS Phase 1 unit + round-trip + unsupported-claim tests.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAccomplishment,
  editAccomplishment,
  archiveAccomplishment,
  setPolishCandidate,
  acceptPolish,
  detectMetricEntityDrift,
} from '../web/lib/bullet-memory.mjs'
import { shouldNudge, currentPeriod, recordNewCapture } from '../web/lib/cadence.mjs'
import { rankForGenerate, assertNoUnsupportedClaims } from '../web/lib/generate-rank.mjs'
import {
  promoteAccomplishment,
  promotePortfolio,
  healSourceLinks,
  renderResumeTextFromStruct,
  stableRoleKey,
} from '../web/lib/resume-sync.mjs'
import { buildBoardPack, importBoardPack, roundTripOk, BOARD_PACK_SCHEMA_VERSION } from '../web/lib/board-pack.mjs'
import { createPortfolioItem, acceptPortfolioPolish, setPortfolioPolish, resumeOkItems } from '../web/lib/portfolio.mjs'
import { buildAdvisorContext, normalizeAdvisorBrief, advisorReportRow } from '../web/lib/advisor.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log('ok ', name)
  } catch (e) {
    failed++
    console.error('FAIL', name, e.message)
  }
}

check('create locks body_original', () => {
  const a = createAccomplishment('Shipped X — cut latency 40%', { id: 'a1' })
  assert.equal(a.body_original, a.body_current)
  const e = editAccomplishment(a, 'Shipped X — cut latency 40% with caching')
  assert.equal(e.body_original, 'Shipped X — cut latency 40%')
  assert.equal(e.body_current.includes('caching'), true)
  assert.equal(e.revisions.length, 1)
  assert.equal(e.revisions[0].source, 'user')
})

check('archive soft-deletes', () => {
  const a = archiveAccomplishment(createAccomplishment('Did Y', { id: 'a2' }))
  assert.equal(a.status, 'archived')
  assert.ok(a.archived_at)
})

check('polish accept with drift block', () => {
  const a = createAccomplishment('Grew revenue 10% at Acme', { id: 'a3' })
  const { drift } = setPolishCandidate(a, 'Grew revenue 25% at Acme')
  assert.equal(drift.blocked, true)
  assert.equal(detectMetricEntityDrift(a.body_current, 'Grew revenue 10% at Acme with focus').blocked, false)
  const ok = setPolishCandidate(a, 'Grew revenue 10% at Acme with sharper focus')
  const accepted = acceptPolish(ok.row)
  assert.equal(accepted.revisions.at(-1).source, 'polish_accept')
  assert.equal(accepted.body_original, 'Grew revenue 10% at Acme')
})

check('cadence calendar not elapsed drift', () => {
  const now = new Date(2026, 6, 20) // Jul 20 2026
  const period = currentPeriod('biweekly', '1,15', now)
  assert.ok(period.start <= now && now < period.end)
  // Logged after period start → not due
  const state = { bullet_memory_cadence: 'biweekly', cadence_anchor: '1,15', last_entry_at: new Date(2026, 6, 16).toISOString() }
  assert.equal(shouldNudge(state, now).due, false)
  // No entry this period → due
  const due = shouldNudge({ bullet_memory_cadence: 'biweekly', cadence_anchor: '1,15', last_entry_at: new Date(2026, 6, 1).toISOString() }, now)
  assert.equal(due.due, true)
  // Promotion must not use recordNewCapture — verify helper only updates last_entry_at
  const after = recordNewCapture(state, now)
  assert.ok(after.last_entry_at)
})

check('generate rank checked > role-linked > relevance > recency', () => {
  const items = [
    { id: 'old', body_current: 'unrelated gardening', created_at: '2026-01-01T00:00:00Z', status: 'ready' },
    { id: 'rel', body_current: 'kubernetes platform migration', created_at: '2026-02-01T00:00:00Z', status: 'ready', tags: ['kubernetes'] },
    { id: 'role', body_current: 'misc ops', role_id: 'r1', created_at: '2026-03-01T00:00:00Z', status: 'ready' },
    { id: 'chk', body_current: 'tiny note', created_at: '2020-01-01T00:00:00Z', status: 'ready' },
  ]
  const ranked = rankForGenerate(items, {
    jd: 'Need kubernetes experience',
    gaps: ['kubernetes'],
    relevantRoleIds: ['r1'],
    checkedIds: ['chk'],
    cap: 3,
  })
  assert.equal(ranked[0].id, 'chk')
  assert.equal(ranked.map(x => x.id).includes('old'), false) // cap after rank drops low relevance
  assert.ok(ranked.find(x => x.id === 'role') || ranked.find(x => x.id === 'rel'))
})

check('promote bidirectional + atomic text sync', () => {
  const profile = {
    resume_text: 'Jane Doe\n\nEXPERIENCE\nEng at Co\n- Old bullet\n',
    resume_struct: {
      roles: [{ id: 'r1', header: 'Eng at Co', sub: '2020–2024', bullets: [{ id: 'b0', text: 'Old bullet' }] }],
      skills: [],
      education: [],
      certs: [],
      projects: [],
    },
    resume_struct_rev: 0,
  }
  const acc = createAccomplishment('Led API redesign — p95 -30%', { id: 'acc1', role_id: 'r1' })
  const out = promoteAccomplishment(profile, acc, { role_id: 'r1' })
  assert.equal(out.accomplishment.status, 'promoted')
  assert.equal(out.accomplishment.promoted_bullet_id, out.struct.roles[0].bullets.at(-1).id)
  const bullet = out.struct.roles[0].bullets.at(-1)
  assert.equal(bullet.source_type, 'accomplishment')
  assert.equal(bullet.source_id, 'acc1')
  assert.ok(out.resume_text.includes('Led API redesign'))
  assert.equal(out.resume_struct_rev, 1)
  assert.equal(out.resume_reconcile_needed, true)
})

check('heal orphans when role deleted', () => {
  const struct = { roles: [{ id: 'r2', header: 'Other', bullets: [] }], projects: [] }
  const accs = [{
    id: 'acc9',
    body_original: 'x',
    body_current: 'x',
    promoted_role_id: 'missing',
    promoted_bullet_id: 'bx',
    promotion_snapshot: 'x',
    status: 'promoted',
  }]
  const healed = healSourceLinks(struct, accs)
  assert.equal(healed.accomplishments[0].status, 'orphaned')
})

check('board pack round-trip preserves provenance', () => {
  const a = createAccomplishment('Original fact 12%', { id: 'rt1' })
  const edited = editAccomplishment(a, 'Original fact 12% clarified')
  edited.status = 'promoted'
  edited.promoted_bullet_id = 'b1'
  edited.promotion_snapshot = edited.body_current
  assert.equal(roundTripOk([edited]), true)
  const pack = buildBoardPack({ accomplishments: [edited], portfolio: [] })
  assert.equal(pack.schema_version, BOARD_PACK_SCHEMA_VERSION)
  const imported = importBoardPack(JSON.stringify({
    format: 'careerops-board-pack/v1',
    profile: { resume_text: 'hi' },
    roles: [],
  }))
  assert.equal(imported.schema_version, BOARD_PACK_SCHEMA_VERSION)
  assert.ok(Array.isArray(imported.accomplishments))
})

check('portfolio promote + polish', () => {
  const item = createPortfolioItem({ title: 'Open source CLI', summary: 'Built CLI used by 3 teams', item_type: 'code', visibility: 'resume_ok' })
  assert.equal(resumeOkItems([item]).length, 1)
  const { item: polished, drift } = setPortfolioPolish(item, 'Built CLI used by 3 teams end-to-end')
  assert.equal(drift.blocked, false)
  const accepted = acceptPortfolioPolish(polished)
  assert.equal(accepted.revisions.at(-1).source, 'polish_accept')
  const profile = { resume_text: '', resume_struct: { roles: [], projects: [], skills: [], education: [], certs: [] }, resume_struct_rev: 0 }
  const out = promotePortfolio(profile, accepted)
  assert.equal(out.struct.projects[0].source_type, 'portfolio')
  assert.ok(out.resume_text.includes('PROJECTS'))
})

check('advisor brief materials-only + report row', () => {
  const ctx = buildAdvisorContext({
    accomplishments: [createAccomplishment('Ran pricing experiment — +8% conversion', { id: 'm1', checked: true })],
    portfolio: [createPortfolioItem({ title: 'Design system', item_type: 'design', visibility: 'resume_ok' })],
    profile: { resume_text: 'Designer', target_titles: ['PM'], keywords: ['pricing'] },
    checkedIds: ['m1'],
    jd: 'Product manager pricing',
  })
  assert.ok(ctx.observed_materials.accomplishments.length >= 1)
  const brief = normalizeAdvisorBrief({
    market_read: 'Pricing PMs are in demand',
    fit: 'Observed: pricing experiment',
    suggested_next_skills: ['SQL'],
    demand_gaps: ['SQL'],
  })
  assert.equal(brief.market_read.label, 'model_judgment')
  assert.equal(brief.suggested_next_skills[0].label, 'model_judgment')
  const row = advisorReportRow(brief, null)
  assert.equal(row.kind, 'advisor')
  assert.equal(row.role_id, null)
})

check('E2E Generate has no unsupported claims', () => {
  const materials = [
    createAccomplishment('Cut checkout latency 40% at ShopCo', { id: 'e1', checked: true }),
    createAccomplishment('Mentored 2 engineers on observability', { id: 'e2' }),
  ]
  const ranked = rankForGenerate(materials, { checkedIds: ['e1'], jd: 'latency performance', cap: 20 })
  const corpus = ranked.map(a => a.body_current).join('\n') + '\nShopCo'
  // Simulated generate output grounded in materials
  const good = 'EXPERIENCE\n- Cut checkout latency 40% at ShopCo\n'
  assert.equal(assertNoUnsupportedClaims(good, corpus).ok, true)
  // Invented metric/entity must fail
  const bad = 'EXPERIENCE\n- Cut checkout latency 90% at MegaCorp\n'
  const res = assertNoUnsupportedClaims(bad, corpus)
  assert.equal(res.ok, false)
  assert.ok(res.unsupported.length >= 1)
})

check('stableRoleKey + render text', () => {
  const k = stableRoleKey({ header: 'Director, Partnerships — Acme' })
  assert.ok(k.startsWith('role_'))
  const text = renderResumeTextFromStruct({
    summary: 'Ops leader',
    roles: [{ id: 'r', header: 'Dir', bullets: [{ id: 'b', text: 'Did thing', source_type: 'accomplishment', source_id: 'x' }] }],
    skills: [{ id: 's', text: 'SQL' }],
    education: [],
    certs: [],
    projects: [],
  }, 'Pat Lee\npat@x.com')
  assert.ok(text.includes('Pat Lee'))
  assert.ok(text.includes('Did thing'))
  assert.ok(text.includes('SQL'))
})

check('schema declares RLS for accomplishments + portfolio', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  assert.match(schema, /mt_accomplishments_own/)
  assert.match(schema, /mt_portfolio_own/)
  assert.match(schema, /body_original/)
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase1.sql'), 'utf8')
  assert.match(mig, /mt_accomplishments_guard_original/)
  assert.match(mig, /body_original is immutable/)
})

if (failed) {
  console.error(`\ntest-career-os: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-career-os passed')

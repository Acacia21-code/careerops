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
import { buildBoardPack, importBoardPack, planBoardPackUpsert, roundTripOk, BOARD_PACK_SCHEMA_VERSION } from '../web/lib/board-pack.mjs'
import { createPortfolioItem, acceptPortfolioPolish, setPortfolioPolish, resumeOkItems } from '../web/lib/portfolio.mjs'
import { buildAdvisorContext, normalizeAdvisorBrief, advisorReportRow } from '../web/lib/advisor.mjs'
import {
  readLocalCareerTruth, writeLocalCareerTruth,
  isDurabilityMigrated, markDurabilityMigrated,
  planDurabilityMigrate, remoteCareerTruthFromDb, applyRemoteAuthoritative,
  normalizeOutcome, outcomeRowFromLocal, OUTCOME_KINDS,
} from '../web/lib/career-durability.mjs'
import {
  normalizeInterviewEvent, followupDueForRole, buildFollowupStrip, interviewReportRow,
} from '../web/lib/interview-events.mjs'
import { buildOfferCompare, formatMoney, parseMoneyInput } from '../web/lib/offer-compare.mjs'
import { buildVersionTimeline, timelineLines } from '../web/lib/version-timeline.mjs'
import { normalizeContact, logTouch, filterContacts, channelFromDraftKind } from '../web/lib/contacts-crm.mjs'
import { normalizeAshbyCompensation, roleCompFieldsFromAshby, postedCompLabel } from '../web/lib/ats-comp.mjs'
import { buildSalaryCompare, normalizeTargetBand, targetBandLabel } from '../web/lib/salary-compare.mjs'
import {
  classifyEnrichUrl, proposeEnrichCandidates, acceptEnrichCandidate,
} from '../web/lib/enrich-inbox.mjs'
import {
  buildTriageRoleRow, buildMatchReportRow, splitGapsByMaterials, validateTriageAdd, inferRoleLevel,
} from '../web/lib/jd-triage.mjs'

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

check('normalizeOutcome rejects invented kinds', () => {
  assert.equal(normalizeOutcome({ kind: 'offer', date: '2026-07-01', note: 'ok' }).kind, 'offer')
  assert.equal(normalizeOutcome({ kind: 'hired_by_ai' }), null)
  assert.ok(OUTCOME_KINDS.includes('withdraw'))
  const row = outcomeRowFromLocal('role-1', { kind: 'reject', date: '2026-07-02', note: 'no', at: '2026-07-02T12:00:00Z' }, 'user-1')
  assert.equal(row.role_id, 'role-1')
  assert.equal(row.outcome_date, '2026-07-02')
  assert.equal(row.owner, 'user-1')
})

check('structured offer fields round-trip on outcomes', () => {
  const n = normalizeOutcome({
    kind: 'offer', date: '2026-07-01', note: 'signed', at: '2026-07-01T00:00:00Z',
    base: '150k', bonus: '20,000', currency: 'USD', equity_notes: '10k RSU', remote: 'hybrid', deadline: '2026-07-15',
  })
  assert.equal(n.base, 150000)
  assert.equal(n.bonus, 20000)
  assert.equal(n.remote, 'hybrid')
  const row = outcomeRowFromLocal('r1', n, 'u1')
  assert.equal(row.base_amount, 150000)
  assert.equal(row.offer_deadline, '2026-07-15')
  assert.equal(row.equity_notes, '10k RSU')
})

check('offer compare builds side-by-side without inventing', () => {
  const cmp = buildOfferCompare([
    { roleId: 'a', company: 'Acme', title: 'PM', outcome: { kind: 'offer', base: 160000, bonus: 10000, currency: 'USD', remote: 'remote', note: '' } },
    { roleId: 'b', company: 'Beta', title: 'PM', outcome: { kind: 'offer', base: 155000, bonus: null, currency: 'USD', equity_notes: '5k RSU', remote: 'hybrid', note: 'expiring' } },
    { roleId: 'c', company: 'Skip', title: 'X', outcome: { kind: 'reject', note: 'no' } },
  ])
  assert.equal(cmp.columns.length, 2)
  assert.equal(cmp.empty, false)
  const base = cmp.rows.find(r => r.key === 'base')
  assert.ok(base.values[0].includes('160'))
  assert.equal(cmp.rows.find(r => r.key === 'equity').values[1], '5k RSU')
  assert.equal(buildOfferCompare([{ roleId: 'a', company: 'A', outcome: { kind: 'offer', base: 1 } }]).empty, true)
  assert.equal(parseMoneyInput(''), null)
  assert.equal(parseMoneyInput('nope'), null)
  assert.equal(formatMoney(null), '—')
})

check('offer schema migration declares columns', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  assert.match(schema, /base_amount/)
  assert.match(schema, /offer_deadline/)
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase2_offers.sql'), 'utf8')
  assert.match(mig, /equity_notes/)
  const app = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase2_offers_app_schema.sql'), 'utf8')
  assert.match(app, /bonus_amount/)
})

check('durability migrate fills remote gaps only', () => {
  const local = {
    stories: 'STAR: led migration',
    outcomes: {
      r1: { kind: 'offer', date: '2026-07-01', note: 'base 200k', at: '2026-07-01T00:00:00Z' },
      r2: { kind: 'ghost', date: '', note: '', at: '2026-07-03T00:00:00Z' },
    },
    sentRoles: { r1: 1, r3: 1 },
    sentVers: { v1: 1 },
    verNames: { v1: 'Acme · sent · Jul 1 · resume', v2: 'Cover draft' },
  }
  const remote = remoteCareerTruthFromDb({
    story_bank: '',
    outcomeRows: [{ role_id: 'r1', kind: 'offer', outcome_date: '2026-06-01', note: 'from other device', recorded_at: '2026-06-01T00:00:00Z' }],
    roles: [{ id: 'r1', sent_at: '2026-06-01T00:00:00Z' }],
    reports: [{ id: 'v2', display_name: 'Remote name', sent_at: null }],
  })
  const plan = planDurabilityMigrate({ local, remote, now: '2026-07-29T18:00:00Z' })
  assert.equal(plan.story_bank, 'STAR: led migration')
  // r1 already on remote — do not overwrite
  assert.equal(plan.outcomeUpserts.some(x => x.role_id === 'r1'), false)
  assert.equal(plan.outcomeUpserts.some(x => x.role_id === 'r2'), true)
  assert.equal(plan.roleSentUpserts.some(x => x.role_id === 'r1'), false)
  assert.equal(plan.roleSentUpserts.some(x => x.role_id === 'r3'), true)
  const v1 = plan.versionMetaUpserts.find(x => x.id === 'v1')
  assert.ok(v1)
  assert.equal(v1.sent_at, '2026-07-29T18:00:00Z')
  assert.equal(v1.display_name, 'Acme · sent · Jul 1 · resume')
  // v2 already has remote display_name — no overwrite; local had no sent
  assert.equal(plan.versionMetaUpserts.some(x => x.id === 'v2'), false)
})

check('localStorage truth round-trip + migrate flag', () => {
  const mem = {
    _d: {},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null },
    setItem(k, v){ this._d[k] = String(v) },
  }
  const uid = 'user-abc'
  assert.equal(isDurabilityMigrated(mem, uid), false)
  writeLocalCareerTruth(mem, uid, {
    stories: 'line1\nline2',
    outcomes: { r9: { kind: 'withdraw', date: '2026-07-10', note: 'took other', at: '2026-07-10T00:00:00Z' } },
    sentRoles: { r9: 1 },
    sentVers: { ver9: 1 },
    verNames: { ver9: 'Sent artifact' },
  })
  const back = readLocalCareerTruth(mem, uid)
  assert.equal(back.stories, 'line1\nline2')
  assert.equal(back.outcomes.r9.kind, 'withdraw')
  assert.equal(back.sentRoles.r9, 1)
  assert.equal(back.verNames.ver9, 'Sent artifact')
  markDurabilityMigrated(mem, uid)
  assert.equal(isDurabilityMigrated(mem, uid), true)
  const auth = applyRemoteAuthoritative(remoteCareerTruthFromDb({
    story_bank: 'from db',
    outcomeRows: [],
    roles: [],
    reports: [],
  }))
  assert.equal(auth.stories, 'from db')
  assert.deepEqual(auth.outcomes, {})
})

check('board pack v3 migrates sent metadata', () => {
  const pack = buildBoardPack({
    stories: 'story A',
    outcomes: { r1: { kind: 'offer', date: '2026-07-01', note: '', at: '2026-07-01T00:00:00Z' } },
    roles: [{ id: 'r1', company: 'Acme', title: 'PM', sent_at: '2026-07-01T12:00:00Z' }],
    reports: [
      { id: 'm1', role_id: 'r1', kind: 'resume', rewritten: '…', display_name: 'Acme · sent', sent_at: '2026-07-01T12:00:00Z', created_at: '2026-07-01T10:00:00Z' },
      { id: 'e1', role_id: 'r1', kind: 'evaluate', rewritten: '{}', created_at: '2026-07-01T09:00:00Z' },
    ],
  })
  assert.equal(pack.schema_version, BOARD_PACK_SCHEMA_VERSION)
  assert.equal(pack.doctrine.no_auto_send, true)
  assert.equal(pack.roles[0].sent_at, '2026-07-01T12:00:00Z')
  assert.equal(pack.materials[0].display_name, 'Acme · sent')
  assert.equal(pack.materials[0].sent_at, '2026-07-01T12:00:00Z')
  const fromV2 = importBoardPack({
    format: 'careerops-board-pack/v2',
    schema_version: 2,
    roles: [{ id: 'r2', company: 'Beta', title: 'Eng' }],
    materials: [{ id: 'm2', role_id: 'r2', kind: 'cover', rewritten: 'hi' }],
    accomplishments: [],
    portfolio: [],
    stories: 'old',
    outcomes: {},
  })
  assert.equal(fromV2.schema_version, BOARD_PACK_SCHEMA_VERSION)
  assert.equal(fromV2.roles[0].sent_at, null)
  assert.equal(fromV2.materials[0].display_name, null)
  assert.equal(fromV2.doctrine.no_auto_send, true)
})

check('durability schema + migration declare RLS', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  assert.match(schema, /mt_outcomes_own/)
  assert.match(schema, /story_bank/)
  assert.match(schema, /display_name/)
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_durability.sql'), 'utf8')
  assert.match(mig, /mt_outcomes/)
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  assert.match(mig, /sent_at/)
  const app = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_durability_app_schema.sql'), 'utf8')
  assert.match(app, /app\.outcomes/)
  assert.match(app, /public\.mt_outcomes/)
})

check('interview events normalize + follow-up prefers event dates', () => {
  assert.equal(normalizeInterviewEvent({ type: 'invented', role_id: 'r1' }), null)
  const ev = normalizeInterviewEvent({
    id: 'e1', role_id: 'r1', round: 2, type: 'onsite',
    scheduled_at: '2026-08-01T15:00:00Z', notes: 'panel', interviewer_name: 'Sam',
  })
  assert.equal(ev.type, 'onsite')
  assert.equal(ev.round, 2)
  const now = Date.parse('2026-07-29T12:00:00Z')
  const upcoming = followupDueForRole(
    { id: 'r1', stage: 'interview', company: 'Acme', title: 'PM', created_at: '2026-07-01T00:00:00Z' },
    [ev],
    { now }
  )
  assert.equal(upcoming.source, 'interview_event')
  assert.equal(upcoming.labelKind, 'upcoming')
  assert.equal(upcoming.due.toISOString().slice(0, 10), '2026-08-01')
  const pastEv = { ...ev, scheduled_at: '2026-07-20T15:00:00Z' }
  const follow = followupDueForRole(
    { id: 'r1', stage: 'interview', company: 'Acme', title: 'PM', created_at: '2026-07-01T00:00:00Z' },
    [pastEv],
    { now }
  )
  assert.equal(follow.source, 'interview_event')
  assert.equal(follow.labelKind, 'followup')
  assert.equal(follow.due.toISOString().slice(0, 10), '2026-07-22')
  const strip = buildFollowupStrip(
    [{ id: 'r1', stage: 'applied', company: 'A', title: 'T', created_at: '2026-07-01T00:00:00Z' }],
    [],
    { now }
  )
  assert.equal(strip[0].source, 'fallback')
  const report = interviewReportRow({ roleId: 'r1', text: 'Angles…', owner: 'u1' })
  assert.equal(report.kind, 'interview')
  assert.equal(report.rewritten, 'Angles…')
  assert.equal(interviewReportRow({ roleId: 'r1', text: '  ' }), null)
})

check('board pack v4 interview events + interview reports', () => {
  assert.ok(BOARD_PACK_SCHEMA_VERSION >= 4)
  const pack = buildBoardPack({
    interview_events: [{ id: 'e1', role_id: 'r1', round: 1, type: 'screen', scheduled_at: '2026-08-02T10:00:00Z', notes: '', interviewer_name: null }],
    reports: [
      { id: 'i1', role_id: 'r1', kind: 'interview', rewritten: 'prep text', created_at: '2026-07-29T10:00:00Z' },
      { id: 'm1', role_id: 'r1', kind: 'match', match_score: 80, created_at: '2026-07-28T10:00:00Z' },
    ],
    outcomes: { r1: { kind: 'offer', date: '2026-07-01', note: '', at: '2026-07-01T00:00:00Z' } },
  })
  assert.equal(pack.interview_events.length, 1)
  assert.equal(pack.interview_events[0].type, 'screen')
  assert.ok(pack.reports.some(r => r.kind === 'interview'))
  const fromV3 = importBoardPack({
    format: 'careerops-board-pack/v3',
    schema_version: 3,
    roles: [],
    materials: [],
    reports: [],
    accomplishments: [],
    portfolio: [],
    stories: '',
    outcomes: { r1: { kind: 'offer', date: '2026-07-01', note: 'raw', at: '2026-07-01T00:00:00Z' } },
  })
  assert.equal(fromV3.schema_version, BOARD_PACK_SCHEMA_VERSION)
  assert.deepEqual(fromV3.interview_events, [])
  assert.equal(fromV3.outcomes.r1.currency, 'USD')
})

check('interview schema + migration declare RLS', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  assert.match(schema, /mt_interview_events_own/)
  assert.match(schema, /interviewer_name/)
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase2_interview.sql'), 'utf8')
  assert.match(mig, /mt_interview_events/)
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  const app = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase2_interview_app_schema.sql'), 'utf8')
  assert.match(app, /app\.interview_events/)
  assert.match(app, /public\.mt_interview_events/)
})

check('version timeline answers which Sent + outcome', () => {
  const tl = buildVersionTimeline({
    reports: [
      { id: 'm1', kind: 'match', match_score: 72, created_at: '2026-07-01T10:00:00Z' },
      { id: 'm2', kind: 'match', match_score: 81, created_at: '2026-07-05T10:00:00Z' },
      { id: 'r1', kind: 'resume', rewritten: '…', created_at: '2026-07-06T10:00:00Z', sent_at: '2026-07-07T12:00:00Z', display_name: 'Acme · sent · resume' },
      { id: 'c1', kind: 'cover', rewritten: '…', created_at: '2026-07-06T11:00:00Z' },
    ],
    outcome: { kind: 'offer', date: '2026-07-20', note: 'accepted', at: '2026-07-20T15:00:00Z', base: 160000 },
    displayNames: {},
    sentVerIds: {},
  })
  assert.equal(tl.summary.match_count, 2)
  assert.equal(tl.summary.latest_match, 81)
  assert.equal(tl.summary.sent_count, 1)
  assert.equal(tl.summary.outcome_kind, 'offer')
  assert.match(tl.summary.answer, /outcome was offer/i)
  assert.ok(tl.events.some(e => e.type === 'sent' && e.label.includes('resume')))
  const lines = timelineLines(tl)
  assert.ok(lines.length >= 4)
  assert.equal(lines[0].type, 'match')
  // role-level sent only when no version Sent
  const roleOnly = buildVersionTimeline({
    reports: [{ id: 'm3', kind: 'match', match_score: 50, created_at: '2026-07-01T00:00:00Z' }],
    role: { sent_at: '2026-07-02T00:00:00Z' },
    outcome: null,
  })
  assert.equal(roleOnly.summary.sent_count, 1)
  assert.match(roleOnly.summary.answer, /no outcome/i)
})

check('contacts CRM log touch + filter (no send)', () => {
  assert.equal(normalizeContact({ name: '' }), null)
  const c = normalizeContact({ name: 'Alex', channel: 'email', company: 'Acme', role_ids: ['r1'] })
  assert.equal(c.channel, 'email')
  const touched = logTouch(c, { at: '2026-07-29T12:00:00Z', noteLine: 'Copied outreach', roleId: 'r1' })
  assert.equal(touched.last_touch_at, '2026-07-29T12:00:00Z')
  assert.match(touched.notes, /Copied outreach/)
  assert.equal(filterContacts([touched], { roleId: 'r1' }).length, 1)
  assert.equal(filterContacts([touched], { company: 'acme' }).length, 1)
  assert.equal(filterContacts([touched], { company: 'zeta' }).length, 0)
  assert.equal(channelFromDraftKind('outreach'), 'email')
})

check('Ashby compensation normalized + not invented', () => {
  assert.equal(normalizeAshbyCompensation(null), null)
  const range = normalizeAshbyCompensation({
    scrapeableCompensationSalarySummary: '$120K - $150K',
    summaryComponents: [
      { compensationType: 'Salary', minValue: 120000, maxValue: 150000, currencyCode: 'USD', interval: '1 YEAR' },
    ],
  })
  assert.equal(range.min, 120000)
  assert.equal(range.max, 150000)
  const fields = roleCompFieldsFromAshby({
    compensationTierSummary: 'Offers Bonus',
    summaryComponents: [],
  })
  assert.ok(fields.comp_raw)
  assert.equal(postedCompLabel({ comp_raw: '$90k' }), '$90k')
  assert.equal(postedCompLabel({}), '')
})

check('salary compare labels gaps without inventing market average', () => {
  const cmp = buildSalaryCompare({
    profile: { target_band_min: 160000, target_band_max: 180000, target_band_currency: 'USD' },
    role: { comp_range: { min: 140000, max: 155000, currency: 'USD', label: 'USD 140k – 155k' } },
    outcome: { kind: 'offer', base: 150000, currency: 'USD' },
  })
  assert.equal(cmp.has_any, true)
  assert.ok(cmp.gaps.some(g => g.kind === 'posted_below_target'))
  assert.match(cmp.doctrine, /not market averages/i)
  assert.equal(normalizeTargetBand({}).min, null)
  assert.match(targetBandLabel({ min: 100000, max: 120000, currency: 'USD' }), /100/)
})

check('board pack v5 contacts + comp + target band + upsert plan strips keys', () => {
  assert.equal(BOARD_PACK_SCHEMA_VERSION, 5)
  const pack = buildBoardPack({
    profile: {
      full_name: 'Pat',
      target_band_min: 150000,
      target_band_max: 170000,
      ai_key: 'sk-secret',
      openai_key: 'sk-oai',
    },
    roles: [{
      id: 'r1', company: 'Acme', title: 'PM',
      comp_range: { min: 140000, max: 160000, currency: 'USD', label: 'USD 140k – 160k' },
      comp_raw: 'USD 140k – 160k',
    }],
    contacts: [{ id: 'c1', name: 'Sam', channel: 'email', company: 'Acme', role_ids: ['r1'] }],
  })
  assert.equal(pack.schema_version, 5)
  assert.equal(pack.contacts.length, 1)
  assert.equal(pack.roles[0].comp_range.min, 140000)
  assert.equal(pack.profile.target_band_min, 150000)
  assert.equal(pack.profile.ai_key, undefined)
  const imported = importBoardPack(JSON.stringify({
    ...pack,
    profile: { ...pack.profile, kimi_key: 'should-strip' },
  }))
  assert.equal(imported.profile.kimi_key, undefined)
  assert.equal(imported.contacts[0].name, 'Sam')
  const fromV4 = importBoardPack({
    format: 'careerops-board-pack/v4',
    schema_version: 4,
    roles: [{ id: 'r2', company: 'Beta', title: 'Eng' }],
    materials: [],
    reports: [],
    accomplishments: [],
    portfolio: [],
    outcomes: {},
    interview_events: [],
  })
  assert.equal(fromV4.schema_version, 5)
  assert.deepEqual(fromV4.contacts, [])
  const plan = planBoardPackUpsert(imported, { existingRoleIds: ['r1'], existingContactIds: [] })
  assert.equal(plan.secrets_imported, false)
  assert.equal(plan.roles.upsert.length, 1)
  assert.equal(plan.contacts.insert.length, 1)
  assert.ok(!('ai_key' in (plan.profilePatch || {})))
})

check('contacts + comp schema migrations declare RLS / columns', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  assert.match(schema, /mt_contacts_own/)
  assert.match(schema, /comp_range/)
  assert.match(schema, /target_band_min/)
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase3_contacts.sql'), 'utf8')
  assert.match(mig, /mt_contacts/)
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  const app = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase3_contacts_app_schema.sql'), 'utf8')
  assert.match(app, /app\.contacts/)
  assert.match(app, /public\.mt_contacts/)
  const comp = fs.readFileSync(path.join(root, 'supabase/migrations/20260729_career_os_phase3_comp_salary.sql'), 'utf8')
  assert.match(comp, /comp_raw/)
  assert.match(comp, /target_band_max/)
})

check('enrichment proposes inbox candidates never auto-promote', () => {
  assert.equal(classifyEnrichUrl('https://example.com'), null)
  const gh = classifyEnrichUrl('https://github.com/acme/cli')
  assert.equal(gh.kind, 'github_repo')
  const proposed = proposeEnrichCandidates({
    url: 'https://github.com/acme/cli',
    pastedText: 'A CLI for widgets',
    fetchMeta: { full_name: 'acme/cli', description: 'Widgets CLI', language: 'TypeScript' },
  })
  assert.equal(proposed.ok, true)
  assert.equal(proposed.auto_promote, false)
  assert.equal(proposed.candidates[0].type, 'portfolio')
  assert.match(proposed.candidates[0].item.body_original, /Source: https:\/\/github.com\/acme\/cli/)
  const accepted = acceptEnrichCandidate(proposed.candidates[0])
  assert.equal(accepted.type, 'portfolio')
  assert.equal(accepted.item._enrich, undefined)
  const li = proposeEnrichCandidates({
    url: 'https://www.linkedin.com/in/pat-example',
    pastedText: 'Led pricing redesign',
  })
  assert.equal(li.candidates[0].type, 'accomplishment')
  assert.equal(li.candidates[0].item.status, 'inbox')
})

check('jd triage → sourced role + match artifact', () => {
  assert.equal(inferRoleLevel('VP Engineering'), 'VP')
  assert.equal(inferRoleLevel('Director of Product'), 'Director')
  const err = validateTriageAdd({ company: '', title: 'X', jd: 'y'.repeat(400) })
  assert.match(err, /Company/)
  assert.equal(validateTriageAdd({
    company: 'Acme', title: 'Director', jd: 'Responsibilities: ship product. '.repeat(20),
  }), null)
  assert.match(validateTriageAdd({ company: 'Acme', title: 'Director', jd: '' }), /job description/i)
  const row = buildTriageRoleRow({
    company: 'Acme',
    title: 'Director, Platform',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    jd: 'About the role\n\nResponsibilities\n• Lead platform\n\nRequirements\n• 10 years',
    ghost_risk: 'low',
  })
  assert.equal(row.stage, 'sourced')
  assert.equal(row.source, 'manual')
  assert.equal(row.company, 'Acme')
  assert.equal(row.level, 'Director')
  assert.ok(row.jd.includes('Responsibilities'))
  const report = buildMatchReportRow({ role_id: 42, match_score: 78, missing_keywords: ['Kubernetes', 'Go'] })
  assert.equal(report.kind, 'match')
  assert.equal(report.role_id, 42)
  assert.equal(report.match_score, 78)
  assert.deepEqual(report.missing_keywords, ['Kubernetes', 'Go'])
  const split = splitGapsByMaterials(
    ['Kubernetes', 'pricing strategy', 'Go'],
    'Led pricing strategy and GTM for B2B SaaS',
  )
  assert.ok(split.inMat.includes('pricing strategy'))
  assert.ok(split.worth.includes('Kubernetes'))
  assert.ok(split.worth.includes('Go'))
})

if (failed) {
  console.error(`\ntest-career-os: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-career-os passed')

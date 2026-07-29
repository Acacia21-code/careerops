/**
 * Focused tests for Phase 4 human-gated mode chains.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILTIN_CHAINS,
  listChains,
  getChain,
  loadChainDefinition,
  startChain,
  writeStepReport,
  confirmStep,
  cancelChain,
  findActiveRun,
  stepBrief,
} from '../web/lib/mode-chains.mjs'
import { buildBoardPack, importBoardPack } from '../web/lib/board-pack.mjs'

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

check('builtin prep-pipeline is evaluate→rank→interview', () => {
  assert.ok(listChains().includes('prep-pipeline'))
  const c = getChain('prep-pipeline')
  assert.deepEqual(c.steps.map(s => s.mode), ['evaluate', 'rank', 'interview'])
  assert.equal(c.human_confirm_between_steps, true)
  assert.equal(loadChainDefinition(c).doctrine.no_auto_apply, true)
  assert.throws(() => loadChainDefinition({
    ...c,
    human_confirm_between_steps: false,
  }))
})

check('chain run writes reports and requires confirm between steps', () => {
  let pack = buildBoardPack({
    roles: [{ id: 'r1', company: 'Acme', title: 'PM' }],
  })
  const started = startChain(pack, 'prep-pipeline', { roleId: 'r1', now: '2026-07-29T12:00:00Z' })
  pack = started.pack
  assert.equal(started.brief.mode, 'evaluate')
  assert.equal(started.run.status, 'in_progress')

  assert.throws(() => confirmStep(pack, started.run.id, { confirm: true }))

  let w = writeStepReport(pack, started.run.id, {
    body: JSON.stringify({ call: 'Apply', summary: 'Strong platform fit from materials' }),
    now: '2026-07-29T12:01:00Z',
  })
  pack = w.pack
  assert.equal(w.report.kind, 'evaluate')
  assert.equal(w.run.status, 'awaiting_confirm')
  assert.throws(() => confirmStep(pack, started.run.id, { confirm: false }))

  let c1 = confirmStep(pack, started.run.id, { confirm: true, now: '2026-07-29T12:02:00Z' })
  pack = c1.pack
  assert.equal(c1.run.step_index, 1)
  assert.equal(c1.brief.mode, 'rank')
  assert.equal(c1.run.status, 'in_progress')

  w = writeStepReport(pack, started.run.id, {
    body: JSON.stringify([{ role_id: 'r1', rank: 1 }]),
    now: '2026-07-29T12:03:00Z',
  })
  pack = w.pack
  assert.equal(w.report.kind, 'rank')
  c1 = confirmStep(pack, started.run.id, { confirm: true, now: '2026-07-29T12:04:00Z' })
  pack = c1.pack
  assert.equal(c1.brief.mode, 'interview')

  w = writeStepReport(pack, started.run.id, {
    body: 'Angles from story bank only',
    now: '2026-07-29T12:05:00Z',
  })
  pack = w.pack
  assert.equal(w.report.kind, 'interview')
  const done = confirmStep(pack, started.run.id, { confirm: true, now: '2026-07-29T12:06:00Z' })
  pack = done.pack
  assert.equal(done.run.status, 'completed')
  assert.equal(done.brief.done, true)
  assert.equal(done.run.report_ids.length, 3)
  assert.equal(findActiveRun(pack), null)

  const rebuilt = buildBoardPack({
    roles: pack.roles,
    reports: pack.reports,
    extensions: pack.extensions,
  })
  assert.ok(rebuilt.reports.some(r => r.kind === 'rank'))
  assert.ok(rebuilt.reports.some(r => r.kind === 'interview'))
  const imported = importBoardPack(JSON.stringify(rebuilt))
  assert.equal(imported.extensions.chain_runs[0].status, 'completed')
})

check('cancel does not invent or auto-advance', () => {
  let pack = buildBoardPack({ roles: [{ id: 'r1', company: 'A', title: 'T' }] })
  const started = startChain(pack, 'evaluate-interview', { roleId: 'r1' })
  pack = started.pack
  const cancelled = cancelChain(pack, started.run.id)
  assert.equal(cancelled.run.status, 'cancelled')
  assert.throws(() => writeStepReport(cancelled.pack, started.run.id, { body: 'x' }))
})

check('step brief encodes doctrine gates', () => {
  const chain = getChain('prep-pipeline')
  const brief = stepBrief(chain, { id: 'x', step_index: 0, role_id: null, status: 'in_progress' }, { roles: [] })
  assert.equal(brief.doctrine.human_confirm_required, true)
  assert.equal(brief.doctrine.no_auto_apply, true)
  assert.ok(brief.instructions.some(i => /never invent/i.test(i)))
})

check('docs + builtin JSON surface', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/CHAINS.md'), 'utf8')
  assert.match(doc, /human confirm/i)
  assert.match(doc, /prep-pipeline/)
  assert.match(doc, /run-chain/)
  assert.ok(BUILTIN_CHAINS['prep-pipeline'])
})

if (failed) {
  console.error(`\ntest-chains: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-chains passed')

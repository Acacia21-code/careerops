/**
 * Focused tests for Phase 4 plugin registry + example adapter.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRegistry,
  loadManifest,
  registerFromManifest,
  mergeBoardSources,
  listReportKinds,
  resolveReportKind,
  applyPackSchemaPlugins,
  filterReportsForPack,
  CORE_REPORT_KINDS,
  MANIFEST_FORMAT,
} from '../web/lib/plugin-registry.mjs'
import {
  EXAMPLE_MANIFEST,
  registerExamplePlugin,
  renderDecisionMemo,
} from '../web/lib/plugins/example-adapter.mjs'
import { buildBoardPack, importBoardPack, BOARD_PACK_SCHEMA_VERSION } from '../web/lib/board-pack.mjs'

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

check('loadManifest validates doctrine + points', () => {
  const m = loadManifest(EXAMPLE_MANIFEST)
  assert.equal(m.format, MANIFEST_FORMAT)
  assert.equal(m.id, 'example-careerops-hooks')
  assert.equal(m.extensions.length, 3)
  assert.throws(() => loadManifest({ ...EXAMPLE_MANIFEST, doctrine: { no_auto_apply: false } }))
  assert.throws(() => loadManifest({ ...EXAMPLE_MANIFEST, extensions: [{ type: 'chrome_ext', id: 'x' }] }))
})

check('example adapter merges boards + custom kind', () => {
  const registry = createRegistry()
  registerExamplePlugin(registry)
  const boards = mergeBoardSources(registry, { greenhouse: ['openai'], ashby: [] })
  assert.ok(boards.greenhouse.includes('openai'))
  assert.ok(boards.greenhouse.includes('example-corp'))
  assert.ok(boards.ashby.includes('example-startup'))
  assert.ok(listReportKinds(registry).includes('decision_memo'))
  assert.ok(CORE_REPORT_KINDS.includes('rank'))
  const resolved = resolveReportKind(registry, 'decision_memo')
  assert.equal(typeof resolved.handler, 'function')
  const rendered = renderDecisionMemo({ rewritten: 'Apply — strong match on platform work' })
  assert.equal(rendered.kind, 'decision_memo')
  assert.match(rendered.doctrine_note, /never auto-apply/i)
})

check('pack schema plugin is additive without version bump', () => {
  const registry = createRegistry()
  registerExamplePlugin(registry)
  const base = buildBoardPack({
    reports: [
      { id: 'r1', role_id: 'role1', kind: 'evaluate', rewritten: '{}' },
      { id: 'r2', role_id: 'role1', kind: 'decision_memo', rewritten: 'memo' },
      { id: 'r3', role_id: 'role1', kind: 'rank', rewritten: '[]' },
    ],
    reportKinds: ['decision_memo'],
  })
  assert.equal(base.schema_version, BOARD_PACK_SCHEMA_VERSION)
  assert.ok(base.reports.some(r => r.kind === 'rank'))
  assert.ok(base.reports.some(r => r.kind === 'decision_memo'))
  const withPlugins = applyPackSchemaPlugins(registry, base)
  assert.equal(withPlugins.extensions.fields.example_note, '')
  assert.ok(withPlugins.extensions.plugins.includes('example-careerops-hooks'))
  const filtered = filterReportsForPack(
    [{ kind: 'decision_memo' }, { kind: 'cover' }, { kind: 'match' }],
    registry,
  )
  assert.deepEqual(filtered.map(r => r.kind).sort(), ['decision_memo', 'match'])
})

check('pack round-trip preserves extensions', () => {
  const pack = buildBoardPack({
    extensions: {
      plugins: ['example-careerops-hooks'],
      fields: { example_note: 'hi' },
      chain_runs: [{ id: 'c1', chain_id: 'prep-pipeline', status: 'awaiting_confirm', step_index: 0 }],
    },
  })
  const imported = importBoardPack(JSON.stringify(pack))
  assert.equal(imported.extensions.fields.example_note, 'hi')
  assert.equal(imported.extensions.chain_runs[0].chain_id, 'prep-pipeline')
  assert.equal(imported.schema_version, BOARD_PACK_SCHEMA_VERSION)
})

check('shipped example manifest JSON matches adapter', () => {
  const p = path.join(root, 'packages/careerops/plugins/example-careerops-hooks/manifest.json')
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  const registry = createRegistry()
  registerFromManifest(registry, raw)
  assert.equal(registry.manifests.get('example-careerops-hooks').version, '1.0.0')
  assert.ok(registry.board_sources.has('example-extra-boards'))
})

check('docs/PLUGINS.md exists', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/PLUGINS.md'), 'utf8')
  assert.match(doc, /board_source/)
  assert.match(doc, /report_kind/)
  assert.match(doc, /board_pack_schema/)
  assert.match(doc, /not a browser extension/i)
})

if (failed) {
  console.error(`\ntest-plugins: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-plugins passed')

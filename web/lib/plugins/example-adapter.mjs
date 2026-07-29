/**
 * Example board-source + report-kind + pack-schema plugin (local only).
 * Not a browser extension — registers via manifest JSON + host handlers.
 */
import { loadManifest, registerFromManifest } from '../plugin-registry.mjs'

export const EXAMPLE_MANIFEST = {
  format: 'careerops-plugin-manifest',
  schema_version: 1,
  id: 'example-careerops-hooks',
  name: 'Example CareerOps hooks',
  version: '1.0.0',
  description:
    'Demo board_source + custom report_kind + additive pack field. No auto-apply / no auto-send.',
  doctrine: {
    no_auto_apply: true,
    no_auto_send: true,
    no_invented_facts: true,
  },
  extensions: [
    {
      type: 'board_source',
      id: 'example-extra-boards',
      summary: 'Adds a few demo Greenhouse/Ashby slugs to ats_boards merges',
      boards: {
        greenhouse: ['example-corp'],
        ashby: ['example-startup'],
      },
    },
    {
      type: 'report_kind',
      id: 'example-decision-memo',
      kind: 'decision_memo',
      summary: 'Custom mt_reports kind for a short decision memo (materials-only)',
      handler: 'renderDecisionMemo',
    },
    {
      type: 'board_pack_schema',
      id: 'example-pack-note',
      summary: 'Adds extensions.fields.example_note on pack export',
      pack_fields: ['example_note'],
      handler: 'ensureExampleNote',
    },
  ],
}

/** Renderer stub for kind=decision_memo — never invents facts. */
export function renderDecisionMemo(report) {
  const body = (report && report.rewritten) || ''
  return {
    kind: 'decision_memo',
    title: 'Decision memo',
    body,
    doctrine_note: 'Materials-only. Human submits applications; never auto-apply.',
  }
}

/** Additive pack field initializer. */
export function ensureExampleNote(pack) {
  const next = { ...pack }
  if (!next.extensions || typeof next.extensions !== 'object') {
    next.extensions = { plugins: [], fields: {} }
  }
  const fields = { ...(next.extensions.fields || {}) }
  if (fields.example_note == null) fields.example_note = ''
  next.extensions = {
    ...next.extensions,
    fields,
    plugins: Array.isArray(next.extensions.plugins) ? [...next.extensions.plugins] : [],
  }
  if (!next.extensions.plugins.includes('example-careerops-hooks')) {
    next.extensions.plugins.push('example-careerops-hooks')
  }
  return next
}

/**
 * Register the example plugin into a registry.
 * @param {ReturnType<import('../plugin-registry.mjs').createRegistry>} registry
 */
export function registerExamplePlugin(registry) {
  const manifest = loadManifest(EXAMPLE_MANIFEST)
  return registerFromManifest(registry, manifest, {
    'example-decision-memo': renderDecisionMemo,
    'example-pack-note': ensureExampleNote,
  })
}

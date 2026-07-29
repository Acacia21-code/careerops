/**
 * Career OS Phase 4 — extension registry (hooks, not a browser extension).
 *
 * Extension points:
 *   - board_source     — merge extra ATS board packs into Find search
 *   - report_kind      — declare mt_reports kind handlers / renderers
 *   - board_pack_schema — additive pack field migrators / serializers
 *
 * Manifests are JSON only. Handlers are local modules registered by the host
 * (SPA, CLI, or edge). Hosted demos never eval remote code.
 */

export const EXTENSION_POINTS = Object.freeze([
  'board_source',
  'report_kind',
  'board_pack_schema',
])

/** Core report kinds always exported in board packs. */
export const CORE_REPORT_KINDS = Object.freeze([
  'match',
  'evaluate',
  'advisor',
  'interview',
  'rank',
])

export const MANIFEST_FORMAT = 'careerops-plugin-manifest'
export const MANIFEST_SCHEMA_VERSION = 1

/**
 * @typedef {{
 *   format: string,
 *   schema_version: number,
 *   id: string,
 *   name?: string,
 *   version?: string,
 *   description?: string,
 *   doctrine?: { no_auto_apply?: boolean, no_auto_send?: boolean, no_invented_facts?: boolean },
 *   extensions: Array<{
 *     type: 'board_source' | 'report_kind' | 'board_pack_schema',
 *     id: string,
 *     summary?: string,
 *     boards?: Record<string, string[]>,
 *     kind?: string,
 *     pack_fields?: string[],
 *   }>
 * }} PluginManifest
 */

/**
 * @returns {{
 *   board_sources: Map<string, object>,
 *   report_kinds: Map<string, object>,
 *   pack_schemas: Map<string, object>,
 *   manifests: Map<string, PluginManifest>,
 * }}
 */
export function createRegistry() {
  return {
    board_sources: new Map(),
    report_kinds: new Map(),
    pack_schemas: new Map(),
    manifests: new Map(),
  }
}

/**
 * Validate + normalize a plugin manifest. Throws on invalid shape.
 * @param {unknown} raw
 * @returns {PluginManifest}
 */
export function loadManifest(raw) {
  const m = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!m || typeof m !== 'object') throw new Error('Plugin manifest must be an object')
  if (m.format !== MANIFEST_FORMAT && m.format !== `${MANIFEST_FORMAT}/v1`) {
    throw new Error(`Unknown plugin manifest format: ${m.format || '(missing)'}`)
  }
  const version = m.schema_version == null ? 1 : Number(m.schema_version)
  if (version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported plugin manifest schema_version ${version}`)
  }
  if (!m.id || typeof m.id !== 'string') throw new Error('Plugin manifest requires id')
  if (!Array.isArray(m.extensions) || m.extensions.length === 0) {
    throw new Error('Plugin manifest requires non-empty extensions[]')
  }
  const doctrine = {
    no_auto_apply: true,
    no_auto_send: true,
    no_invented_facts: true,
    ...(m.doctrine && typeof m.doctrine === 'object' ? m.doctrine : {}),
  }
  if (doctrine.no_auto_apply !== true || doctrine.no_auto_send !== true || doctrine.no_invented_facts !== true) {
    throw new Error('Plugin doctrine must keep no_auto_apply, no_auto_send, no_invented_facts')
  }
  const extensions = m.extensions.map((ext, i) => normalizeExtension(ext, i))
  return {
    format: MANIFEST_FORMAT,
    schema_version: MANIFEST_SCHEMA_VERSION,
    id: m.id,
    name: m.name || m.id,
    version: m.version || '0.0.0',
    description: m.description || '',
    doctrine,
    extensions,
  }
}

function normalizeExtension(ext, index) {
  if (!ext || typeof ext !== 'object') throw new Error(`extensions[${index}] invalid`)
  if (!EXTENSION_POINTS.includes(ext.type)) {
    throw new Error(`extensions[${index}] unknown type ${ext.type}`)
  }
  if (!ext.id || typeof ext.id !== 'string') {
    throw new Error(`extensions[${index}] requires id`)
  }
  const out = {
    type: ext.type,
    id: ext.id,
    summary: ext.summary || '',
  }
  if (ext.type === 'board_source') {
    out.boards = normalizeBoards(ext.boards)
  }
  if (ext.type === 'report_kind') {
    if (!ext.kind || typeof ext.kind !== 'string') {
      throw new Error(`extensions[${index}] report_kind requires kind`)
    }
    out.kind = ext.kind
    out.handler = ext.handler || null
  }
  if (ext.type === 'board_pack_schema') {
    out.pack_fields = Array.isArray(ext.pack_fields)
      ? ext.pack_fields.filter(f => typeof f === 'string')
      : []
    out.handler = ext.handler || null
  }
  return out
}

function normalizeBoards(boards) {
  if (!boards || typeof boards !== 'object' || Array.isArray(boards)) return {}
  const out = {}
  for (const [ats, list] of Object.entries(boards)) {
    if (!Array.isArray(list)) continue
    out[ats] = list.map(String).filter(Boolean)
  }
  return out
}

/**
 * Register a validated manifest. Optional handlers map: { [extensionId]: fn|object }.
 * @param {ReturnType<createRegistry>} registry
 * @param {PluginManifest|unknown} manifestOrRaw
 * @param {Record<string, unknown>} [handlers]
 */
export function registerFromManifest(registry, manifestOrRaw, handlers = {}) {
  const manifest = loadManifest(manifestOrRaw)
  if (registry.manifests.has(manifest.id)) {
    throw new Error(`Plugin already registered: ${manifest.id}`)
  }
  registry.manifests.set(manifest.id, manifest)
  for (const ext of manifest.extensions) {
    const handler = handlers[ext.id] ?? null
    if (ext.type === 'board_source') {
      registry.board_sources.set(ext.id, {
        plugin_id: manifest.id,
        ...ext,
        handler,
      })
    } else if (ext.type === 'report_kind') {
      registry.report_kinds.set(ext.kind, {
        plugin_id: manifest.id,
        extension_id: ext.id,
        kind: ext.kind,
        summary: ext.summary,
        handler,
      })
    } else if (ext.type === 'board_pack_schema') {
      registry.pack_schemas.set(ext.id, {
        plugin_id: manifest.id,
        ...ext,
        handler,
      })
    }
  }
  return manifest
}

/**
 * Merge registered board_source adapters into a base ats_boards object.
 * Dedupes company slugs per ATS key. Does not invent companies beyond manifests.
 */
export function mergeBoardSources(registry, baseBoards = {}) {
  const out = {}
  const seed = baseBoards && typeof baseBoards === 'object' ? baseBoards : {}
  for (const [ats, list] of Object.entries(seed)) {
    out[ats] = Array.isArray(list) ? [...list] : []
  }
  for (const entry of registry.board_sources.values()) {
    const boards = entry.boards || {}
    for (const [ats, list] of Object.entries(boards)) {
      if (!out[ats]) out[ats] = []
      const seen = new Set(out[ats].map(String))
      for (const slug of list) {
        const s = String(slug)
        if (!seen.has(s)) {
          seen.add(s)
          out[ats].push(s)
        }
      }
    }
  }
  return out
}

/** All report kinds known to core + registered plugins. */
export function listReportKinds(registry) {
  const kinds = new Set(CORE_REPORT_KINDS)
  for (const kind of registry.report_kinds.keys()) kinds.add(kind)
  return [...kinds]
}

/**
 * Resolve a report kind handler entry (plugin or core stub).
 * @returns {object|null}
 */
export function resolveReportKind(registry, kind) {
  if (!kind) return null
  if (registry.report_kinds.has(kind)) return registry.report_kinds.get(kind)
  if (CORE_REPORT_KINDS.includes(kind)) {
    return { plugin_id: 'core', extension_id: kind, kind, summary: `Core kind ${kind}`, handler: null }
  }
  return null
}

/**
 * Apply board_pack_schema plugins to a pack object (additive fields only).
 * Handlers receive (pack) and must return a pack; they must not strip doctrine.
 */
export function applyPackSchemaPlugins(registry, pack) {
  if (!pack || typeof pack !== 'object') throw new Error('Invalid board pack')
  let cur = { ...pack }
  if (!cur.extensions || typeof cur.extensions !== 'object') {
    cur.extensions = { plugins: [], fields: {} }
  } else {
    cur.extensions = {
      plugins: Array.isArray(cur.extensions.plugins) ? [...cur.extensions.plugins] : [],
      fields: cur.extensions.fields && typeof cur.extensions.fields === 'object'
        ? { ...cur.extensions.fields }
        : {},
      ...(cur.extensions.chain_runs ? { chain_runs: cur.extensions.chain_runs } : {}),
    }
  }
  for (const entry of registry.pack_schemas.values()) {
    if (!cur.extensions.plugins.includes(entry.plugin_id)) {
      cur.extensions.plugins.push(entry.plugin_id)
    }
    if (typeof entry.handler === 'function') {
      const next = entry.handler(cur, entry)
      if (!next || typeof next !== 'object') {
        throw new Error(`Pack schema plugin ${entry.id} returned invalid pack`)
      }
      if (next.doctrine?.no_auto_apply === false || next.doctrine?.no_invented_facts === false) {
        throw new Error(`Pack schema plugin ${entry.id} violated doctrine`)
      }
      cur = next
    } else {
      for (const field of entry.pack_fields || []) {
        if (cur.extensions.fields[field] === undefined) {
          cur.extensions.fields[field] = null
        }
      }
    }
  }
  return cur
}

/**
 * Filter reports for board-pack export using core + plugin kinds.
 */
export function filterReportsForPack(reports, registry = null) {
  const kinds = new Set(CORE_REPORT_KINDS)
  if (registry) {
    for (const k of registry.report_kinds.keys()) kinds.add(k)
  }
  return (reports || []).filter(r => r && kinds.has(r.kind))
}

/**
 * Serialize registry manifests for pack.extensions.plugins metadata (ids only + versions).
 */
export function registryManifestSummary(registry) {
  return [...registry.manifests.values()].map(m => ({
    id: m.id,
    version: m.version,
    name: m.name,
  }))
}

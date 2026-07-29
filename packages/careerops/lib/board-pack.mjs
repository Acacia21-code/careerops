/**
 * Versioned board pack import/export for Career OS.
 * schema_version bumps require a migrator in the pack reader.
 *
 * v2 — accomplishments + portfolio + doctrine flags
 * v3 — durable Sent / version display names on materials + role sent_at
 * v4 — interview events + interview prep reports; structured offer fields on outcomes
 */

export const BOARD_PACK_FORMAT = 'careerops-board-pack'
export const BOARD_PACK_SCHEMA_VERSION = 4

/** Report kinds always included in pack.reports (plugins may add more via reportKinds). */
export const BOARD_PACK_REPORT_KINDS = Object.freeze([
  'match',
  'evaluate',
  'advisor',
  'interview',
  'rank',
])

/**
 * Build sanitized pack (never includes API keys).
 * Optional `extensions` is additive (plugin / chain metadata) — no schema_version bump.
 * Optional `reportKinds` extends which report rows land in pack.reports.
 */
export function buildBoardPack({
  profile,
  roles = [],
  reports = [],
  accomplishments = [],
  portfolio = [],
  stories = '',
  find_prefs = null,
  outcomes = {},
  interview_events = [],
  extensions = null,
  reportKinds = null,
  exported_at = new Date().toISOString(),
} = {}) {
  const p = profile ? sanitizeProfile(profile) : null
  const kinds = new Set(BOARD_PACK_REPORT_KINDS)
  if (Array.isArray(reportKinds)) {
    for (const k of reportKinds) if (k) kinds.add(k)
  }
  const pack = {
    format: `${BOARD_PACK_FORMAT}/v${BOARD_PACK_SCHEMA_VERSION}`,
    schema_version: BOARD_PACK_SCHEMA_VERSION,
    exported_at,
    doctrine: {
      no_auto_apply: true,
      no_invented_facts: true,
      resume_struct_canonical: true,
      memory_provenance: true,
      no_auto_send: true,
    },
    profile: p,
    stories,
    find_prefs,
    roles: (roles || []).map(r => ({
      id: r.id,
      company: r.company,
      title: r.title,
      stage: r.stage,
      url: r.url,
      jd: r.jd,
      match_score: r.match_score,
      fit_score: r.fit_score,
      ghost_risk: r.ghost_risk,
      created_at: r.created_at,
      level: r.level,
      location: r.location,
      sent_at: r.sent_at || null,
    })),
    materials: (reports || [])
      .filter(x => x.kind === 'resume' || x.kind === 'cover' || x.kind === 'jobscan')
      .map(x => ({
        id: x.id,
        role_id: x.role_id,
        kind: x.kind,
        match_score: x.match_score,
        rewritten: x.rewritten,
        created_at: x.created_at,
        display_name: x.display_name || null,
        sent_at: x.sent_at || null,
      })),
    reports: (reports || [])
      .filter(x => x && kinds.has(x.kind))
      .map(x => ({
        id: x.id,
        role_id: x.role_id,
        kind: x.kind,
        match_score: x.match_score,
        missing_keywords: x.missing_keywords,
        rewritten: x.rewritten,
        created_at: x.created_at,
        display_name: x.display_name || null,
      })),
    accomplishments: (accomplishments || []).map(serializeAccomplishment),
    portfolio: (portfolio || []).map(serializePortfolio),
    outcomes: outcomes || {},
    interview_events: (interview_events || []).map(serializeInterviewEvent).filter(Boolean),
  }
  if (extensions && typeof extensions === 'object') {
    pack.extensions = sanitizeExtensions(extensions)
  }
  return pack
}

function sanitizeExtensions(ext) {
  return {
    plugins: Array.isArray(ext.plugins) ? ext.plugins.map(String) : [],
    fields: ext.fields && typeof ext.fields === 'object' && !Array.isArray(ext.fields)
      ? { ...ext.fields }
      : {},
    chain_runs: Array.isArray(ext.chain_runs) ? ext.chain_runs.map(sanitizeChainRun).filter(Boolean) : [],
  }
}

function sanitizeChainRun(run) {
  if (!run || typeof run !== 'object') return null
  return {
    id: run.id || null,
    chain_id: run.chain_id || null,
    status: run.status || 'pending_confirm',
    step_index: run.step_index != null ? Number(run.step_index) : 0,
    role_id: run.role_id || null,
    report_ids: Array.isArray(run.report_ids) ? run.report_ids.map(String) : [],
    confirmed_steps: Array.isArray(run.confirmed_steps) ? run.confirmed_steps.map(Number) : [],
    started_at: run.started_at || null,
    updated_at: run.updated_at || null,
  }
}

function serializeInterviewEvent(e) {
  if (!e || typeof e !== 'object') return null
  return {
    id: e.id || null,
    role_id: e.role_id || null,
    round: e.round != null ? Number(e.round) : 1,
    type: e.type || 'screen',
    scheduled_at: e.scheduled_at || null,
    notes: e.notes || '',
    interviewer_name: e.interviewer_name || null,
    created_at: e.created_at || null,
  }
}

export function serializeAccomplishment(a) {
  return {
    id: a.id,
    body_original: a.body_original,
    body_current: a.body_current,
    revisions: summarizeRevisions(a.revisions),
    status: a.status,
    archived_at: a.archived_at || null,
    role_id: a.role_id || null,
    employer: a.employer || null,
    project: a.project || null,
    tags: a.tags || [],
    checked: !!a.checked,
    promoted_role_id: a.promoted_role_id || null,
    promoted_bullet_id: a.promoted_bullet_id || null,
    promoted_at: a.promoted_at || null,
    promotion_snapshot: a.promotion_snapshot || null,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

export function serializePortfolio(p) {
  return {
    id: p.id,
    item_type: p.item_type || 'other',
    title: p.title,
    url: p.url || null,
    summary: p.summary || null,
    bullets: p.bullets || [],
    tags: p.tags || [],
    visibility: p.visibility || 'private',
    body_original: p.body_original || null,
    body_current: p.body_current || null,
    revisions: summarizeRevisions(p.revisions),
    promoted_project_id: p.promoted_project_id || null,
    promoted_at: p.promoted_at || null,
    promotion_snapshot: p.promotion_snapshot || null,
    archived_at: p.archived_at || null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

/** Migrate older packs up to current schema_version. */
export function migrateBoardPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('Invalid board pack')
  let version = pack.schema_version
  if (version == null) {
    // v1 packs used format careerops-board-pack/v1 without schema_version
    if (String(pack.format || '').includes('/v1')) version = 1
    else version = 1
  }
  let cur = { ...pack, schema_version: version }
  while (cur.schema_version < BOARD_PACK_SCHEMA_VERSION) {
    if (cur.schema_version === 1) cur = migrateV1toV2(cur)
    else if (cur.schema_version === 2) cur = migrateV2toV3(cur)
    else if (cur.schema_version === 3) cur = migrateV3toV4(cur)
    else throw new Error(`Unknown board pack schema_version ${cur.schema_version}`)
  }
  return cur
}

function migrateV1toV2(pack) {
  return {
    ...pack,
    schema_version: 2,
    format: `${BOARD_PACK_FORMAT}/v2`,
    doctrine: {
      ...(pack.doctrine || {}),
      no_auto_apply: true,
      no_invented_facts: true,
      resume_struct_canonical: true,
      memory_provenance: true,
    },
    accomplishments: Array.isArray(pack.accomplishments) ? pack.accomplishments : [],
    portfolio: Array.isArray(pack.portfolio) ? pack.portfolio : [],
    profile: pack.profile
      ? {
          ...pack.profile,
          resume_struct: pack.profile.resume_struct || null,
        }
      : pack.profile,
  }
}

function migrateV2toV3(pack) {
  return {
    ...pack,
    schema_version: 3,
    format: `${BOARD_PACK_FORMAT}/v3`,
    doctrine: {
      ...(pack.doctrine || {}),
      no_auto_apply: true,
      no_invented_facts: true,
      resume_struct_canonical: true,
      memory_provenance: true,
      no_auto_send: true,
    },
    stories: pack.stories != null ? pack.stories : '',
    outcomes: pack.outcomes && typeof pack.outcomes === 'object' ? pack.outcomes : {},
    roles: (pack.roles || []).map(r => ({
      ...r,
      sent_at: r.sent_at || null,
    })),
    materials: (pack.materials || []).map(m => ({
      ...m,
      display_name: m.display_name || null,
      sent_at: m.sent_at || null,
    })),
    reports: (pack.reports || []).map(r => ({
      ...r,
      display_name: r.display_name || null,
    })),
  }
}

function migrateV3toV4(pack) {
  const outcomes = {}
  for (const [roleId, o] of Object.entries(pack.outcomes && typeof pack.outcomes === 'object' ? pack.outcomes : {})) {
    if (!o || typeof o !== 'object') continue
    outcomes[roleId] = {
      ...o,
      base: o.base != null ? o.base : (o.base_amount != null ? o.base_amount : null),
      bonus: o.bonus != null ? o.bonus : (o.bonus_amount != null ? o.bonus_amount : null),
      equity_notes: o.equity_notes != null ? o.equity_notes : '',
      remote: o.remote != null ? o.remote : '',
      deadline: o.deadline != null ? o.deadline : (o.offer_deadline != null ? o.offer_deadline : null),
      currency: o.currency != null ? o.currency : 'USD',
    }
  }
  return {
    ...pack,
    schema_version: 4,
    format: `${BOARD_PACK_FORMAT}/v4`,
    doctrine: {
      ...(pack.doctrine || {}),
      no_auto_apply: true,
      no_invented_facts: true,
      resume_struct_canonical: true,
      memory_provenance: true,
      no_auto_send: true,
    },
    outcomes,
    interview_events: Array.isArray(pack.interview_events)
      ? pack.interview_events.map(serializeInterviewEvent).filter(Boolean)
      : [],
  }
}

/**
 * Round-trip: export then import should preserve stable ids + provenance fields.
 */
export function importBoardPack(raw) {
  const pack = migrateBoardPack(typeof raw === 'string' ? JSON.parse(raw) : raw)
  return {
    schema_version: pack.schema_version,
    profile: pack.profile,
    roles: pack.roles || [],
    reports: pack.reports || [],
    materials: pack.materials || [],
    accomplishments: (pack.accomplishments || []).map(normalizeImportedAccomplishment),
    portfolio: (pack.portfolio || []).map(normalizeImportedPortfolio),
    stories: pack.stories || '',
    find_prefs: pack.find_prefs || null,
    outcomes: pack.outcomes || {},
    interview_events: (pack.interview_events || []).filter(Boolean),
    doctrine: pack.doctrine || {},
    extensions: pack.extensions && typeof pack.extensions === 'object'
      ? sanitizeExtensions(pack.extensions)
      : { plugins: [], fields: {}, chain_runs: [] },
  }
}

export function roundTripOk(accomplishments, portfolio = []) {
  const pack = buildBoardPack({ accomplishments, portfolio })
  const json = JSON.stringify(pack)
  const imported = importBoardPack(json)
  if (imported.accomplishments.length !== accomplishments.length) return false
  for (let i = 0; i < accomplishments.length; i++) {
    const a = accomplishments[i]
    const b = imported.accomplishments[i]
    if (a.id !== b.id) return false
    if (a.body_original !== b.body_original) return false
    if (a.body_current !== b.body_current) return false
    if ((a.promoted_bullet_id || null) !== (b.promoted_bullet_id || null)) return false
    if ((a.promotion_snapshot || null) !== (b.promotion_snapshot || null)) return false
    if (a.status !== b.status) return false
  }
  return true
}

function normalizeImportedAccomplishment(a) {
  return {
    ...a,
    revisions: Array.isArray(a.revisions) ? a.revisions : [],
    tags: a.tags || [],
    checked: !!a.checked,
  }
}

function normalizeImportedPortfolio(p) {
  return {
    ...p,
    revisions: Array.isArray(p.revisions) ? p.revisions : [],
    bullets: p.bullets || [],
    tags: p.tags || [],
    visibility: p.visibility || 'private',
    item_type: p.item_type || 'other',
  }
}

function summarizeRevisions(revisions) {
  if (!Array.isArray(revisions)) return []
  return revisions.map(r => ({
    at: r.at,
    source: r.source,
    body: r.body,
  }))
}

function sanitizeProfile(p) {
  const out = {
    full_name: p.full_name,
    email: p.email,
    location: p.location,
    target_titles: p.target_titles,
    keywords: p.keywords,
    seniority: p.seniority,
    locations: p.locations,
    resume_text: p.resume_text,
    resume_struct: p.resume_struct || null,
    resume_struct_rev: p.resume_struct_rev || 0,
    structured_modified_at: p.structured_modified_at || null,
    bullet_memory_cadence: p.bullet_memory_cadence || 'off',
    cadence_timezone: p.cadence_timezone || null,
    cadence_anchor: p.cadence_anchor || null,
    last_entry_at: p.last_entry_at || null,
    story_bank: p.story_bank != null ? p.story_bank : undefined,
  }
  // strip secrets if caller passed full row
  delete out.ai_key
  delete out.kimi_key
  delete out.openai_key
  delete out.humanizer_pw
  delete out.humanizer_pass
  return out
}

/**
 * Versioned board pack import/export for Career OS Phase 1.
 * schema_version bumps require a migrator in the pack reader.
 */

export const BOARD_PACK_FORMAT = 'careerops-board-pack'
export const BOARD_PACK_SCHEMA_VERSION = 2

/**
 * Build sanitized pack (never includes API keys).
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
  exported_at = new Date().toISOString(),
} = {}) {
  const p = profile ? sanitizeProfile(profile) : null
  return {
    format: `${BOARD_PACK_FORMAT}/v${BOARD_PACK_SCHEMA_VERSION}`,
    schema_version: BOARD_PACK_SCHEMA_VERSION,
    exported_at,
    doctrine: {
      no_auto_apply: true,
      no_invented_facts: true,
      resume_struct_canonical: true,
      memory_provenance: true,
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
      })),
    reports: (reports || [])
      .filter(x => x.kind === 'match' || x.kind === 'evaluate' || x.kind === 'advisor')
      .map(x => ({
        id: x.id,
        role_id: x.role_id,
        kind: x.kind,
        match_score: x.match_score,
        missing_keywords: x.missing_keywords,
        rewritten: x.rewritten,
        created_at: x.created_at,
      })),
    accomplishments: (accomplishments || []).map(serializeAccomplishment),
    portfolio: (portfolio || []).map(serializePortfolio),
    outcomes: outcomes || {},
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
    doctrine: pack.doctrine || {},
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
  }
  // strip secrets if caller passed full row
  delete out.ai_key
  delete out.kimi_key
  delete out.openai_key
  delete out.humanizer_pw
  delete out.humanizer_pass
  return out
}

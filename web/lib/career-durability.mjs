/**
 * Career durability: outcomes, story bank, Sent / version display names.
 * Pure helpers for one-time localStorage → Supabase migrate + local fallback.
 * Doctrine: never invent outcomes; Sent is a freeze marker only (no auto-send).
 */

export const OUTCOME_KINDS = Object.freeze(['offer', 'reject', 'withdraw', 'ghost'])
export const DURABILITY_FLAG_PREFIX = 'co_durability_v1_'

/** localStorage key map (browser-era keys preserved for migrate + fallback). */
export function durabilityLocalKeys(userId) {
  const uid = userId || 'anon'
  return {
    stories: `co_stories_${uid}`,
    outcomes: `co_outcomes_${uid}`,
    sentRoles: 'co_sent',
    sentVers: 'co_sent_ver',
    verNames: 'rp2_ver_names',
    migrated: `${DURABILITY_FLAG_PREFIX}${uid}`,
  }
}

export function normalizeOutcome(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = String(raw.kind || '').trim()
  if (!OUTCOME_KINDS.includes(kind)) return null
  const date = String(raw.date || raw.outcome_date || '').trim()
  const note = String(raw.note || '')
  const at = String(raw.at || raw.recorded_at || '').trim() || new Date().toISOString()
  const baseRaw = raw.base != null ? raw.base : raw.base_amount
  const bonusRaw = raw.bonus != null ? raw.bonus : raw.bonus_amount
  const base = parseOptionalAmount(baseRaw)
  const bonus = parseOptionalAmount(bonusRaw)
  const equity_notes = String(raw.equity_notes || '')
  const remote = String(raw.remote || '').trim()
  const deadline = String(raw.deadline || raw.offer_deadline || '').trim()
  const currency = String(raw.currency || 'USD').trim() || 'USD'
  return {
    kind,
    date,
    note,
    at,
    base,
    bonus,
    equity_notes,
    remote,
    deadline,
    currency,
  }
}

function parseOptionalAmount(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '')
  if (!s) return null
  const mult = s.endsWith('k') ? 1000 : 1
  const num = Number(mult === 1000 ? s.slice(0, -1) : s)
  return Number.isFinite(num) ? num * mult : null
}

export function outcomesMapFromRows(rows) {
  const out = {}
  for (const row of rows || []) {
    const n = normalizeOutcome({
      kind: row.kind,
      date: row.outcome_date || row.date,
      note: row.note,
      at: row.recorded_at || row.at,
      base: row.base_amount != null ? row.base_amount : row.base,
      bonus: row.bonus_amount != null ? row.bonus_amount : row.bonus,
      equity_notes: row.equity_notes,
      remote: row.remote,
      deadline: row.offer_deadline || row.deadline,
      currency: row.currency,
    })
    if (n && row.role_id) out[row.role_id] = n
  }
  return out
}

export function outcomeRowFromLocal(roleId, outcome, owner) {
  const n = normalizeOutcome(outcome)
  if (!n || !roleId) return null
  return {
    owner: owner || undefined,
    role_id: roleId,
    kind: n.kind,
    outcome_date: n.date || null,
    note: n.note || '',
    recorded_at: n.at,
    base_amount: n.base,
    bonus_amount: n.bonus,
    equity_notes: n.equity_notes || '',
    remote: n.remote || '',
    offer_deadline: n.deadline || null,
    currency: n.currency || 'USD',
  }
}

export function readLocalCareerTruth(storage, userId) {
  const keys = durabilityLocalKeys(userId)
  const get = (k, fallback) => {
    try {
      const raw = storage.getItem(k)
      if (raw == null || raw === '') return fallback
      return typeof fallback === 'string' ? String(raw) : JSON.parse(raw)
    } catch (_e) {
      return fallback
    }
  }
  const stories = get(keys.stories, '')
  const outcomesRaw = get(keys.outcomes, {}) || {}
  const outcomes = {}
  for (const [roleId, o] of Object.entries(outcomesRaw)) {
    const n = normalizeOutcome(o)
    if (n) outcomes[roleId] = n
  }
  return {
    stories: typeof stories === 'string' ? stories : '',
    outcomes,
    sentRoles: asFlagMap(get(keys.sentRoles, {})),
    sentVers: asFlagMap(get(keys.sentVers, {})),
    verNames: asStringMap(get(keys.verNames, {})),
  }
}

export function writeLocalCareerTruth(storage, userId, truth) {
  const keys = durabilityLocalKeys(userId)
  const t = truth || {}
  storage.setItem(keys.stories, String(t.stories || ''))
  storage.setItem(keys.outcomes, JSON.stringify(t.outcomes || {}))
  storage.setItem(keys.sentRoles, JSON.stringify(asFlagMap(t.sentRoles)))
  storage.setItem(keys.sentVers, JSON.stringify(asFlagMap(t.sentVers)))
  storage.setItem(keys.verNames, JSON.stringify(asStringMap(t.verNames)))
  return t
}

export function isDurabilityMigrated(storage, userId) {
  return storage.getItem(durabilityLocalKeys(userId).migrated) === '1'
}

export function markDurabilityMigrated(storage, userId) {
  storage.setItem(durabilityLocalKeys(userId).migrated, '1')
}

/**
 * Build remote snapshot maps from DB rows / profile fields.
 */
export function remoteCareerTruthFromDb({
  story_bank = '',
  outcomeRows = [],
  roles = [],
  reports = [],
} = {}) {
  const sentRoles = {}
  for (const r of roles || []) {
    if (r.sent_at) sentRoles[r.id] = 1
  }
  const sentVers = {}
  const verNames = {}
  for (const rep of reports || []) {
    if (rep.sent_at) sentVers[rep.id] = 1
    if (rep.display_name) verNames[rep.id] = String(rep.display_name)
  }
  return {
    stories: String(story_bank || ''),
    outcomes: outcomesMapFromRows(outcomeRows),
    sentRoles,
    sentVers,
    verNames,
  }
}

/**
 * One-time migrate plan: fill remote gaps from local; never invent.
 * Prefer remote when both have a value for the same key.
 */
export function planDurabilityMigrate({ local, remote, now = new Date().toISOString() } = {}) {
  const L = local || emptyTruth()
  const R = remote || emptyTruth()

  let story_bank = null
  if (!String(R.stories || '').trim() && String(L.stories || '').trim()) {
    story_bank = L.stories
  }

  const outcomeUpserts = []
  for (const [roleId, o] of Object.entries(L.outcomes || {})) {
    if (R.outcomes && R.outcomes[roleId]) continue
    const row = outcomeRowFromLocal(roleId, o)
    if (row) outcomeUpserts.push(row)
  }

  const roleSentUpserts = []
  for (const roleId of Object.keys(L.sentRoles || {})) {
    if (R.sentRoles && R.sentRoles[roleId]) continue
    roleSentUpserts.push({ role_id: roleId, sent_at: now })
  }

  const versionMetaUpserts = []
  const verIds = new Set([
    ...Object.keys(L.sentVers || {}),
    ...Object.keys(L.verNames || {}),
  ])
  for (const id of verIds) {
    const remoteSent = !!(R.sentVers && R.sentVers[id])
    const remoteName = R.verNames && R.verNames[id]
    const localSent = !!(L.sentVers && L.sentVers[id])
    const localName = L.verNames && L.verNames[id]
    const patch = { id }
    let needed = false
    if (!remoteSent && localSent) {
      patch.sent_at = now
      needed = true
    }
    if (!remoteName && localName) {
      patch.display_name = localName
      needed = true
    }
    if (needed) versionMetaUpserts.push(patch)
  }

  const hasWork =
    story_bank != null ||
    outcomeUpserts.length > 0 ||
    roleSentUpserts.length > 0 ||
    versionMetaUpserts.length > 0

  return {
    story_bank,
    outcomeUpserts,
    roleSentUpserts,
    versionMetaUpserts,
    hasWork,
  }
}

/**
 * Merge remote over local for runtime cache: remote wins when present;
 * keep local-only keys so offline edits survive until sync.
 */
export function mergeCareerTruth(local, remote) {
  const L = local || emptyTruth()
  const R = remote || emptyTruth()
  const stories = String(R.stories || '').trim() ? R.stories : L.stories || ''
  const outcomes = { ...(L.outcomes || {}), ...(R.outcomes || {}) }
  const sentRoles = { ...(L.sentRoles || {}), ...(R.sentRoles || {}) }
  const sentVers = { ...(L.sentVers || {}), ...(R.sentVers || {}) }
  const verNames = { ...(L.verNames || {}), ...(R.verNames || {}) }
  // Remote clear of sent: if remote explicitly loaded and role missing, prefer remote map when remote was authoritative.
  // Callers that want remote-authoritative after migrate should pass local=empty or use applyRemoteOnly.
  return { stories, outcomes, sentRoles, sentVers, verNames }
}

/** After successful DB load post-migrate, remote is source of truth. */
export function applyRemoteAuthoritative(remote) {
  const R = remote || emptyTruth()
  return {
    stories: String(R.stories || ''),
    outcomes: { ...(R.outcomes || {}) },
    sentRoles: asFlagMap(R.sentRoles),
    sentVers: asFlagMap(R.sentVers),
    verNames: asStringMap(R.verNames),
  }
}

export function emptyTruth() {
  return { stories: '', outcomes: {}, sentRoles: {}, sentVers: {}, verNames: {} }
}

function asFlagMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    if (v) out[k] = 1
  }
  return out
}

function asStringMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && String(v).trim()) out[k] = String(v)
  }
  return out
}

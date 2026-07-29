/**
 * Bullet memory provenance helpers (pure — no DOM / Supabase).
 * Doctrine: docs/DOCTRINE_MEMORY.md
 */

const STATUSES = new Set(['inbox', 'ready', 'promoted', 'archived', 'orphaned'])

/** @param {string} body */
export function createAccomplishment(body, opts = {}) {
  const text = String(body || '').trim()
  if (!text) throw new Error('Accomplishment body required')
  const now = opts.now || new Date().toISOString()
  const id = opts.id || cryptoRandomId()
  return {
    id,
    body_original: text,
    body_current: text,
    revisions: [],
    status: opts.status && STATUSES.has(opts.status) ? opts.status : 'inbox',
    archived_at: null,
    role_id: opts.role_id || null,
    employer: opts.employer || null,
    project: opts.project || null,
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    checked: !!opts.checked,
    promoted_role_id: null,
    promoted_bullet_id: null,
    promoted_at: null,
    promotion_snapshot: null,
    polish_candidate: null,
    polish_model: null,
    polish_at: null,
    created_at: now,
    updated_at: now,
  }
}

/** Edit working text; never mutates body_original. */
export function editAccomplishment(row, nextBody, opts = {}) {
  const text = String(nextBody || '').trim()
  if (!text) throw new Error('body_current required')
  if (row.body_original == null) throw new Error('missing body_original')
  const now = opts.now || new Date().toISOString()
  const revisions = Array.isArray(row.revisions) ? row.revisions.slice() : []
  if (text !== row.body_current) {
    revisions.push({ at: now, body: row.body_current, source: 'user' })
  }
  return {
    ...row,
    body_current: text,
    body_original: row.body_original,
    revisions,
    status: row.status === 'archived' ? row.status : (row.status === 'promoted' ? 'promoted' : 'ready'),
    updated_at: now,
  }
}

export function archiveAccomplishment(row, opts = {}) {
  const now = opts.now || new Date().toISOString()
  return {
    ...row,
    status: 'archived',
    archived_at: now,
    updated_at: now,
  }
}

export function restoreAccomplishment(row, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const status = row.promoted_bullet_id ? 'promoted' : 'ready'
  return { ...row, status, archived_at: null, updated_at: now }
}

/** Store polish candidate without touching body_current. */
export function setPolishCandidate(row, candidate, opts = {}) {
  const text = String(candidate || '').trim()
  if (!text) throw new Error('polish candidate required')
  const drift = detectMetricEntityDrift(row.body_current, text)
  return {
    row: {
      ...row,
      polish_candidate: text,
      polish_model: opts.model || null,
      polish_at: opts.now || new Date().toISOString(),
      updated_at: opts.now || new Date().toISOString(),
    },
    drift,
  }
}

/** Accept polish → body_current + revision source polish_accept. Rejects hard drift. */
export function acceptPolish(row, opts = {}) {
  const cand = String(row.polish_candidate || '').trim()
  if (!cand) throw new Error('No polish candidate to accept')
  const drift = detectMetricEntityDrift(row.body_current, cand)
  if (drift.blocked) {
    const err = new Error(drift.reason || 'Polish changes metrics/entities')
    err.drift = drift
    throw err
  }
  const now = opts.now || new Date().toISOString()
  const revisions = Array.isArray(row.revisions) ? row.revisions.slice() : []
  revisions.push({ at: now, body: row.body_current, source: 'polish_accept' })
  return {
    ...row,
    body_current: cand,
    body_original: row.body_original,
    revisions,
    polish_candidate: null,
    polish_model: null,
    polish_at: null,
    status: row.status === 'archived' ? 'archived' : (row.status === 'promoted' ? 'promoted' : 'ready'),
    updated_at: now,
  }
}

export function rejectPolish(row, opts = {}) {
  return {
    ...row,
    polish_candidate: null,
    polish_model: null,
    polish_at: null,
    updated_at: opts.now || new Date().toISOString(),
  }
}

/**
 * Detect metric / entity drift between original/current and candidate.
 * Block: numbers, %, $, company-like Proper Nouns that appear/disappear, ownership verbs flip.
 */
export function detectMetricEntityDrift(fromText, toText) {
  const from = String(fromText || '')
  const to = String(toText || '')
  const fromNums = extractNumbers(from)
  const toNums = extractNumbers(to)
  if (!sameMultiset(fromNums, toNums)) {
    return { blocked: true, reason: 'Numbers/metrics changed', kind: 'metric', from: fromNums, to: toNums }
  }
  const fromEnt = extractEntities(from)
  const toEnt = extractEntities(to)
  const added = toEnt.filter(e => !fromEnt.includes(e))
  const removed = fromEnt.filter(e => !toEnt.includes(e))
  if (added.length || removed.length) {
    return { blocked: true, reason: 'Entities changed', kind: 'entity', added, removed }
  }
  const fromOwn = ownershipSignal(from)
  const toOwn = ownershipSignal(to)
  if (fromOwn !== toOwn) {
    return { blocked: true, reason: 'Ownership/scope changed', kind: 'ownership', from: fromOwn, to: toOwn }
  }
  return { blocked: false, reason: null }
}

/** Simple word-level diff for UI. */
export function wordDiff(a, b) {
  const aw = String(a || '').split(/(\s+)/)
  const bw = String(b || '').split(/(\s+)/)
  const out = []
  let i = 0, j = 0
  while (i < aw.length || j < bw.length) {
    if (i < aw.length && j < bw.length && aw[i] === bw[j]) {
      out.push({ type: 'eq', text: aw[i] }); i++; j++; continue
    }
    if (j < bw.length && (i >= aw.length || aw[i] !== bw[j])) {
      // look ahead for match
      const ni = aw.indexOf(bw[j], i)
      if (ni > i && ni < i + 4) {
        while (i < ni) { out.push({ type: 'del', text: aw[i++] }) }
        continue
      }
      out.push({ type: 'ins', text: bw[j++] }); continue
    }
    if (i < aw.length) { out.push({ type: 'del', text: aw[i++] }); continue }
    break
  }
  return out
}

export function markOrphaned(row, opts = {}) {
  return {
    ...row,
    status: 'orphaned',
    updated_at: opts.now || new Date().toISOString(),
  }
}

function extractNumbers(s) {
  const m = String(s).match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || []
  return m.map(x => x.replace(/,/g, '').toLowerCase()).sort()
}

function extractEntities(s) {
  // Capitalized tokens / acronyms 2+ chars, skip sentence starts loosely by requiring mid-string or ALLCAPS
  const words = String(s).split(/\s+/)
  const out = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z0-9+#.-]/g, '')
    if (w.length < 2) continue
    if (/^[A-Z]{2,}$/.test(w) || (/^[A-Z][a-z]+/.test(w) && i > 0)) out.push(w.toLowerCase())
  }
  return [...new Set(out)].sort()
}

function ownershipSignal(s) {
  const t = s.toLowerCase()
  // Lead / ownership-inflation verbs (guardrail heuristic — not proof of truth).
  if (/\b(led|owned|drove|founded|built alone|spearheaded|championed|solely|single-handedly)\b/.test(t)) return 'lead'
  if (/\b(contributed|supported|helped|assisted|participated|collaborated)\b/.test(t)) return 'support'
  return 'neutral'
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

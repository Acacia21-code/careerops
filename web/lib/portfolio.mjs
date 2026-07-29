/**
 * Portfolio library — same provenance patterns as bullet memory.
 */

import { detectMetricEntityDrift } from './bullet-memory.mjs'

const TYPES = new Set(['code', 'design', 'product', 'other'])
const VIS = new Set(['private', 'resume_ok'])

export function createPortfolioItem(input = {}) {
  const title = String(input.title || '').trim()
  if (!title) throw new Error('Portfolio title required')
  const now = input.now || new Date().toISOString()
  const summary = String(input.summary || '').trim()
  const body = String(input.body_current || summary || title).trim()
  return {
    id: input.id || cryptoRandomId(),
    item_type: TYPES.has(input.item_type) ? input.item_type : 'other',
    title,
    url: input.url || null,
    summary: summary || null,
    bullets: normalizeBullets(input.bullets),
    tags: Array.isArray(input.tags) ? input.tags : [],
    started_on: input.started_on || null,
    ended_on: input.ended_on || null,
    visibility: VIS.has(input.visibility) ? input.visibility : 'private',
    body_original: body,
    body_current: body,
    revisions: [],
    polish_candidate: null,
    polish_model: null,
    polish_at: null,
    promoted_project_id: null,
    promoted_at: null,
    promotion_snapshot: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  }
}

export function editPortfolioItem(item, patch = {}, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const next = { ...item }
  if (patch.title != null) next.title = String(patch.title).trim()
  if (patch.url != null) next.url = patch.url
  if (patch.summary != null) next.summary = patch.summary
  if (patch.bullets != null) next.bullets = normalizeBullets(patch.bullets)
  if (patch.tags != null) next.tags = patch.tags
  if (patch.item_type && TYPES.has(patch.item_type)) next.item_type = patch.item_type
  if (patch.visibility && VIS.has(patch.visibility)) next.visibility = patch.visibility
  if (patch.body_current != null) {
    const text = String(patch.body_current).trim()
    if (text && text !== item.body_current) {
      next.revisions = [...(item.revisions || []), { at: now, body: item.body_current, source: 'user' }]
      next.body_current = text
    }
  }
  next.body_original = item.body_original
  next.updated_at = now
  return next
}

export function setPortfolioPolish(item, candidate, opts = {}) {
  const text = String(candidate || '').trim()
  if (!text) throw new Error('polish candidate required')
  const base = item.body_current || item.summary || item.title
  const drift = detectMetricEntityDrift(base, text)
  return {
    item: {
      ...item,
      polish_candidate: text,
      polish_model: opts.model || null,
      polish_at: opts.now || new Date().toISOString(),
      updated_at: opts.now || new Date().toISOString(),
    },
    drift,
  }
}

export function acceptPortfolioPolish(item, opts = {}) {
  const cand = String(item.polish_candidate || '').trim()
  if (!cand) throw new Error('No polish candidate')
  const base = item.body_current || item.summary || item.title
  const drift = detectMetricEntityDrift(base, cand)
  if (drift.blocked) {
    const err = new Error(drift.reason || 'Polish changes metrics/entities')
    err.drift = drift
    throw err
  }
  const now = opts.now || new Date().toISOString()
  return {
    ...item,
    body_current: cand,
    body_original: item.body_original,
    revisions: [...(item.revisions || []), { at: now, body: base, source: 'polish_accept' }],
    polish_candidate: null,
    polish_model: null,
    polish_at: null,
    updated_at: now,
  }
}

/** Builder ticks only resume_ok items. */
export function resumeOkItems(items) {
  return (items || []).filter(i => i.visibility === 'resume_ok' && !i.archived_at)
}

export function archivePortfolioItem(item, opts = {}) {
  const now = opts.now || new Date().toISOString()
  return { ...item, archived_at: now, updated_at: now }
}

function normalizeBullets(bullets) {
  if (!Array.isArray(bullets)) return []
  return bullets.map(b => {
    if (typeof b === 'string') return { id: cryptoRandomId(), text: b }
    return { id: b.id || cryptoRandomId(), text: b.text || '', ...(b.source_type ? { source_type: b.source_type, source_id: b.source_id } : {}) }
  }).filter(b => b.text)
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

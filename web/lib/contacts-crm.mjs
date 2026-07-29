/**
 * Recruiter / network CRM helpers.
 * Doctrine: draft + log only — never send, never OAuth mailbox sync.
 */

export const CONTACT_CHANNELS = Object.freeze(['email', 'linkedin', 'phone', 'other'])

export function normalizeContact(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim()
  if (!name) return null
  let channel = String(raw.channel || 'email').trim().toLowerCase()
  if (!CONTACT_CHANNELS.includes(channel)) channel = 'other'
  const company = String(raw.company || '').trim()
  const notes = String(raw.notes || '')
  const role_ids = normalizeRoleIds(raw.role_ids != null ? raw.role_ids : raw.role_id)
  const last_touch_at = raw.last_touch_at ? String(raw.last_touch_at) : null
  const id = raw.id != null ? String(raw.id) : null
  const created_at = raw.created_at ? String(raw.created_at) : null
  const updated_at = raw.updated_at ? String(raw.updated_at) : null
  return {
    id,
    name,
    channel,
    company,
    role_ids,
    last_touch_at,
    notes,
    created_at,
    updated_at,
  }
}

export function normalizeRoleIds(raw) {
  if (raw == null || raw === '') return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out = []
  const seen = new Set()
  for (const x of arr) {
    const id = String(x || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** DB row for upsert/insert (omit local-* ids). */
export function contactRowFromLocal(contact, owner) {
  const n = normalizeContact(contact)
  if (!n) return null
  const row = {
    owner: owner || undefined,
    name: n.name,
    channel: n.channel,
    company: n.company || '',
    role_ids: n.role_ids,
    last_touch_at: n.last_touch_at,
    notes: n.notes || '',
  }
  if (n.id && !String(n.id).startsWith('local-')) row.id = n.id
  return row
}

/**
 * Log a touch: bump last_touch_at, optionally append a note line.
 * Explicit user action only — never auto-called on send (there is no send).
 */
export function logTouch(contact, {
  at = new Date().toISOString(),
  noteLine = '',
  roleId = null,
} = {}) {
  const n = normalizeContact(contact)
  if (!n) return null
  const role_ids = [...n.role_ids]
  if (roleId) {
    const rid = String(roleId)
    if (!role_ids.includes(rid)) role_ids.push(rid)
  }
  let notes = n.notes || ''
  const line = String(noteLine || '').trim()
  if (line) {
    const stamp = String(at).slice(0, 10)
    notes = notes ? `${notes}\n[${stamp}] ${line}` : `[${stamp}] ${line}`
  }
  return {
    ...n,
    role_ids,
    last_touch_at: at,
    notes,
  }
}

/** Filter contacts by role id and/or company substring (case-insensitive). */
export function filterContacts(contacts, { roleId = null, company = '' } = {}) {
  const list = (contacts || []).map(normalizeContact).filter(Boolean)
  const rid = roleId != null && roleId !== '' ? String(roleId) : null
  const co = String(company || '').trim().toLowerCase()
  return list.filter(c => {
    if (rid && !c.role_ids.includes(rid)) return false
    if (co && !String(c.company || '').toLowerCase().includes(co)) return false
    return true
  }).sort((a, b) => {
    const ta = a.last_touch_at ? Date.parse(a.last_touch_at) : 0
    const tb = b.last_touch_at ? Date.parse(b.last_touch_at) : 0
    return tb - ta
  })
}

/** Suggest channel from draft kind (email / outreach / linkedin). */
export function channelFromDraftKind(kind) {
  const k = String(kind || '').toLowerCase()
  if (k === 'email' || k === 'salary' || k === 'why' || k === 'notice') return 'email'
  if (k.includes('linkedin')) return 'linkedin'
  if (k === 'research' || k === 'outreach') return 'email'
  return 'email'
}

export function serializeContact(c) {
  const n = normalizeContact(c)
  if (!n) return null
  return {
    id: n.id,
    name: n.name,
    channel: n.channel,
    company: n.company,
    role_ids: n.role_ids,
    last_touch_at: n.last_touch_at,
    notes: n.notes,
    created_at: n.created_at,
  }
}

/**
 * Atomic resume_struct ↔ resume_text sync + bidirectional promotion.
 * resume_struct is canonical.
 */

import { markOrphaned } from './bullet-memory.mjs'

/**
 * Render Experience (+ Projects) from struct into resume_text, preserving
 * non-Experience/Projects sections when possible.
 */
export function renderResumeTextFromStruct(struct, priorText = '') {
  const head = extractContactHead(priorText)
  const other = extractOtherSections(priorText) // skills, education, etc.
  const parts = []
  if (head) parts.push(head, '')

  if (struct?.summary) {
    parts.push('PROFESSIONAL SUMMARY')
    parts.push(struct.summary)
    parts.push('')
  } else if (other.summary) {
    parts.push('PROFESSIONAL SUMMARY')
    parts.push(other.summary)
    parts.push('')
  }

  parts.push('EXPERIENCE')
  for (const r of struct?.roles || []) {
    parts.push(r.header + (r.sub ? '\n' + r.sub : ''))
    for (const b of r.bullets || []) {
      parts.push('- ' + (b.text || ''))
    }
    parts.push('')
  }

  if ((struct?.projects || []).length) {
    parts.push('PROJECTS')
    for (const p of struct.projects) {
      parts.push(p.header || p.title || 'Project')
      if (p.sub || p.url) parts.push(p.sub || p.url)
      for (const b of p.bullets || []) {
        const t = typeof b === 'string' ? b : b.text
        parts.push('- ' + (t || ''))
      }
      parts.push('')
    }
  }

  if ((struct?.skills || []).length) {
    parts.push('SKILLS')
    for (const b of struct.skills) parts.push('- ' + (b.text || b))
    parts.push('')
  } else if (other.skills) {
    parts.push('SKILLS')
    parts.push(other.skills)
    parts.push('')
  }

  if ((struct?.education || []).length) {
    parts.push('EDUCATION')
    for (const b of struct.education) parts.push('- ' + (b.text || b))
    parts.push('')
  } else if (other.education) {
    parts.push('EDUCATION')
    parts.push(other.education)
    parts.push('')
  }

  if ((struct?.certs || []).length) {
    parts.push('CERTIFICATIONS')
    for (const b of struct.certs) parts.push('- ' + (b.text || b))
  }

  return parts.join('\n').trim()
}

/**
 * Promote accomplishment into a resume_struct role bullet + sync text.
 * @returns {{ struct, resume_text, accomplishment, resume_struct_rev, structured_modified_at, reconcile_needed }}
 */
export function promoteAccomplishment(profile, accomplishment, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const struct = cloneStruct(profile.resume_struct)
  if (!struct.roles) struct.roles = []
  if (!struct.projects) struct.projects = []

  const roleKey = opts.role_id || accomplishment.role_id
  if (!roleKey && !opts.roleHeader) {
    throw new Error('Pick a resume role before promoting')
  }

  let role = struct.roles.find(r => roleKey && (r.id === roleKey || stableRoleKey(r) === roleKey))
  if (!role && opts.roleHeader) {
    role = {
      id: opts.newRoleId || cryptoRandomId(),
      header: opts.roleHeader,
      sub: opts.roleSub || '',
      bullets: [],
    }
    struct.roles.push(role)
  }
  if (!role) throw new Error('Resume role not found for promotion')

  // Idempotent: already promoted to same bullet
  if (accomplishment.promoted_bullet_id) {
    const existing = (role.bullets || []).find(b => b.id === accomplishment.promoted_bullet_id)
    if (existing) {
      existing.text = accomplishment.body_current
      existing.source_type = 'accomplishment'
      existing.source_id = accomplishment.id
      const snap = accomplishment.body_current
      const nextAcc = {
        ...accomplishment,
        promoted_role_id: role.id || stableRoleKey(role),
        promoted_bullet_id: existing.id,
        promoted_at: accomplishment.promoted_at || now,
        promotion_snapshot: snap,
        status: 'promoted',
        updated_at: now,
      }
      return finalize(profile, struct, nextAcc, now)
    }
  }

  const bulletId = opts.bulletId || cryptoRandomId()
  const bullet = {
    id: bulletId,
    text: accomplishment.body_current,
    source_type: 'accomplishment',
    source_id: accomplishment.id,
  }
  role.bullets = role.bullets || []
  role.bullets.push(bullet)
  if (!role.id) role.id = stableRoleKey(role)

  const nextAcc = {
    ...accomplishment,
    promoted_role_id: role.id,
    promoted_bullet_id: bulletId,
    promoted_at: now,
    promotion_snapshot: accomplishment.body_current,
    status: 'promoted',
    updated_at: now,
  }
  return finalize(profile, struct, nextAcc, now)
}

/** Promote portfolio item into resume_struct.projects[] */
export function promotePortfolio(profile, item, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const struct = cloneStruct(profile.resume_struct)
  if (!struct.projects) struct.projects = []

  const projectId = item.promoted_project_id || opts.projectId || cryptoRandomId()
  let project = struct.projects.find(p => p.id === projectId)
  const bullets = normalizePortfolioBullets(item)
  if (!project) {
    project = {
      id: projectId,
      header: item.title,
      title: item.title,
      sub: item.url || '',
      url: item.url || '',
      bullets: bullets.map(t => ({
        id: cryptoRandomId(),
        text: t,
        source_type: 'portfolio',
        source_id: item.id,
      })),
      source_type: 'portfolio',
      source_id: item.id,
    }
    struct.projects.push(project)
  } else {
    project.header = item.title
    project.title = item.title
    project.sub = item.url || project.sub
    project.source_type = 'portfolio'
    project.source_id = item.id
  }

  const nextItem = {
    ...item,
    promoted_project_id: project.id,
    promoted_at: now,
    promotion_snapshot: item.title + '\n' + bullets.join('\n'),
    updated_at: now,
  }
  const rev = (profile.resume_struct_rev || 0) + 1
  const resume_text = renderResumeTextFromStruct(struct, profile.resume_text || '')
  return {
    struct,
    resume_text,
    portfolio: nextItem,
    resume_struct_rev: rev,
    structured_modified_at: now,
    resume_reconcile_needed: true,
  }
}

/**
 * After reparse/heal: preserve source_* by id or promotion_snapshot;
 * mark accomplishments orphaned when role gone.
 */
export function healSourceLinks(struct, accomplishments = []) {
  const liveRoles = new Map()
  for (const r of struct?.roles || []) {
    const key = r.id || stableRoleKey(r)
    if (!r.id) r.id = key
    liveRoles.set(key, r)
    for (const b of r.bullets || []) {
      // keep source_* as-is
    }
  }
  const next = []
  for (const a of accomplishments) {
    if (!a.promoted_bullet_id && !a.promoted_role_id) {
      next.push(a)
      continue
    }
    const role = liveRoles.get(a.promoted_role_id)
    if (!role) {
      next.push(markOrphaned(a))
      continue
    }
    let bullet = (role.bullets || []).find(b => b.id === a.promoted_bullet_id)
    if (!bullet && a.promotion_snapshot) {
      bullet = (role.bullets || []).find(b => b.text === a.promotion_snapshot)
      if (bullet) {
        bullet.source_type = 'accomplishment'
        bullet.source_id = a.id
        bullet.id = bullet.id || a.promoted_bullet_id
      }
    }
    if (!bullet) {
      next.push(markOrphaned(a))
      continue
    }
    if (!bullet.source_id) {
      bullet.source_type = 'accomplishment'
      bullet.source_id = a.id
    }
    next.push({ ...a, status: a.status === 'orphaned' ? 'promoted' : a.status })
  }
  return { struct, accomplishments: next }
}

/** Preserve source_* across normalize/heal of bullets. */
export function healBulletsPreserveSource(bullets) {
  return (bullets || []).map(b => {
    if (typeof b === 'string') return { id: cryptoRandomId(), text: b }
    return {
      id: b.id || cryptoRandomId(),
      text: b.text || '',
      ...(b.source_type ? { source_type: b.source_type } : {}),
      ...(b.source_id ? { source_id: b.source_id } : {}),
    }
  })
}

function finalize(profile, struct, nextAcc, now) {
  const rev = (profile.resume_struct_rev || 0) + 1
  const resume_text = renderResumeTextFromStruct(struct, profile.resume_text || '')
  return {
    struct,
    resume_text,
    accomplishment: nextAcc,
    resume_struct_rev: rev,
    structured_modified_at: now,
    resume_reconcile_needed: true,
  }
}

function cloneStruct(struct) {
  const s = struct ? JSON.parse(JSON.stringify(struct)) : { roles: [], skills: [], education: [], certs: [], projects: [], summary: '' }
  if (!s.roles) s.roles = []
  if (!s.projects) s.projects = []
  if (!s.skills) s.skills = []
  if (!s.education) s.education = []
  if (!s.certs) s.certs = []
  for (const r of s.roles) {
    if (!r.id) r.id = stableRoleKey(r)
    r.bullets = healBulletsPreserveSource(r.bullets)
  }
  return s
}

export function stableRoleKey(role) {
  if (role.id) return role.id
  const h = String(role.header || '').trim().toLowerCase().replace(/\s+/g, ' ')
  let hash = 0
  for (let i = 0; i < h.length; i++) hash = ((hash << 5) - hash) + h.charCodeAt(i)
  return 'role_' + (hash >>> 0).toString(16)
}

function normalizePortfolioBullets(item) {
  if (Array.isArray(item.bullets) && item.bullets.length) {
    return item.bullets.map(b => (typeof b === 'string' ? b : b.text || '')).filter(Boolean)
  }
  const body = item.body_current || item.summary || ''
  return String(body).split(/\n+/).map(x => x.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
}

function extractContactHead(text) {
  const lines = String(text || '').split(/\n/)
  const heads = /^(professional\s+summary|summary|experience|skills|education|projects|certifications)/i
  const out = []
  for (const l of lines) {
    if (heads.test(l.trim())) break
    out.push(l)
  }
  return out.join('\n').trim()
}

function extractOtherSections(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const heads = /^(professional\s+summary|summary|profile|experience|skills|education|projects|certifications)\s*:?\s*$/i
  const map = {}
  let cur = null
  for (const raw of lines) {
    if (heads.test(raw.trim())) {
      const key = raw.trim().toLowerCase()
      cur = /summary|profile/.test(key) ? 'summary'
        : /skills/.test(key) ? 'skills'
          : /education/.test(key) ? 'education'
            : null
      if (cur && !map[cur]) map[cur] = []
      continue
    }
    if (cur && map[cur]) map[cur].push(raw)
  }
  const join = k => (map[k] || []).join('\n').trim()
  return { summary: join('summary'), skills: join('skills'), education: join('education') }
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

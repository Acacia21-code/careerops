/**
 * Interview rounds + follow-up due dates from real event schedules.
 * Doctrine: user-provided schedules only; prep drafts are copy-only (never auto-send).
 */

export const INTERVIEW_EVENT_TYPES = Object.freeze([
  'screen',
  'phone',
  'onsite',
  'loop',
  'panel',
  'other',
])

/** Days after a past interview to nudge a thank-you / follow-up when no future round exists. */
export const FOLLOWUP_AFTER_EVENT_DAYS = 2
/** Fallback when no interview events (Applied / Interview stage). */
export const FOLLOWUP_FALLBACK_DAYS = 14

export function normalizeInterviewEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = String(raw.type || 'screen').trim().toLowerCase()
  if (!INTERVIEW_EVENT_TYPES.includes(type)) return null
  const round = Math.max(1, parseInt(raw.round, 10) || 1)
  const scheduled_at = raw.scheduled_at ? String(raw.scheduled_at).trim() : ''
  const notes = String(raw.notes || '')
  const interviewer_name = String(raw.interviewer_name || raw.interviewer || '').trim()
  const id = raw.id != null ? String(raw.id) : null
  const role_id = raw.role_id != null ? String(raw.role_id) : null
  const created_at = raw.created_at ? String(raw.created_at) : null
  const updated_at = raw.updated_at ? String(raw.updated_at) : null
  return {
    id,
    role_id,
    round,
    type,
    scheduled_at: scheduled_at || null,
    notes,
    interviewer_name: interviewer_name || null,
    created_at,
    updated_at,
  }
}

export function interviewEventRowFromLocal(event, owner) {
  const n = normalizeInterviewEvent(event)
  if (!n || !n.role_id) return null
  const row = {
    owner: owner || undefined,
    role_id: n.role_id,
    round: n.round,
    type: n.type,
    scheduled_at: n.scheduled_at,
    notes: n.notes || '',
    interviewer_name: n.interviewer_name,
  }
  if (n.id && !String(n.id).startsWith('local-')) row.id = n.id
  return row
}

export function eventsForRole(events, roleId) {
  const id = String(roleId || '')
  return (events || [])
    .map(normalizeInterviewEvent)
    .filter(e => e && String(e.role_id) === id)
    .sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round
      const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : 0
      const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : 0
      return ta - tb
    })
}

/**
 * Compute follow-up chip for a role.
 * Prefer real interview event dates; else created_at + FOLLOWUP_FALLBACK_DAYS.
 */
export function followupDueForRole(role, events = [], { now = Date.now(), afterDays = FOLLOWUP_AFTER_EVENT_DAYS, fallbackDays = FOLLOWUP_FALLBACK_DAYS } = {}) {
  if (!role) return null
  const stage = role.stage
  if (stage !== 'applied' && stage !== 'interview' && stage !== 'offer') return null

  const roleEvents = eventsForRole(events, role.id).filter(e => e.scheduled_at)
  const DAY = 864e5

  if (roleEvents.length) {
    const upcoming = roleEvents
      .map(e => ({ e, t: Date.parse(e.scheduled_at) }))
      .filter(x => !Number.isNaN(x.t) && x.t >= now)
      .sort((a, b) => a.t - b.t)

    if (upcoming.length) {
      const due = new Date(upcoming[0].t)
      return {
        role,
        due,
        overdue: false,
        source: 'interview_event',
        event: upcoming[0].e,
        labelKind: 'upcoming',
      }
    }

    const past = roleEvents
      .map(e => ({ e, t: Date.parse(e.scheduled_at) }))
      .filter(x => !Number.isNaN(x.t))
      .sort((a, b) => b.t - a.t)
    if (past.length) {
      const due = new Date(past[0].t + afterDays * DAY)
      return {
        role,
        due,
        overdue: due.getTime() <= now,
        source: 'interview_event',
        event: past[0].e,
        labelKind: 'followup',
      }
    }
  }

  const base = Date.parse(role.updated_at || role.created_at || now)
  const due = new Date((Number.isNaN(base) ? now : base) + fallbackDays * DAY)
  return {
    role,
    due,
    overdue: due.getTime() <= now,
    source: 'fallback',
    event: null,
    labelKind: 'followup',
  }
}

export function buildFollowupStrip(roles, events, opts = {}) {
  const out = []
  for (const r of roles || []) {
    const item = followupDueForRole(r, events, opts)
    if (item) out.push(item)
  }
  return out.sort((a, b) => a.due - b.due)
}

export function nextRoundNumber(events, roleId) {
  const list = eventsForRole(events, roleId)
  if (!list.length) return 1
  return Math.max(...list.map(e => e.round)) + 1
}

/** Payload for mt_reports.kind = 'interview' (prep draft). */
export function interviewReportRow({ roleId, text, owner, created_at } = {}) {
  const rewritten = String(text || '').trim()
  if (!roleId || !rewritten) return null
  return {
    role_id: roleId,
    owner: owner || undefined,
    kind: 'interview',
    rewritten,
    created_at: created_at || undefined,
  }
}

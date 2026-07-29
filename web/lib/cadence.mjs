/**
 * Calendar cadence for bullet memory nudges (not elapsed-since-entry).
 */

/**
 * @param {object} state
 * @param {string} state.cadence 'biweekly'|'monthly'|'off'
 * @param {string} [state.cadence_anchor] e.g. '1,15' or '1' for monthly day
 * @param {string} [state.cadence_timezone]
 * @param {string|null} state.last_entry_at ISO
 * @param {string|null} state.snoozed_until ISO
 * @param {Date} [now]
 */
export function shouldNudge(state, now = new Date()) {
  const cadence = state?.cadence || state?.bullet_memory_cadence || 'off'
  if (!cadence || cadence === 'off') return { due: false, reason: 'off' }

  const snooze = state.snoozed_until ? new Date(state.snoozed_until) : null
  if (snooze && now <= snooze) return { due: false, reason: 'snoozed' }

  const period = currentPeriod(cadence, state.cadence_anchor || '1,15', now, state.cadence_timezone)
  if (!period) return { due: false, reason: 'bad_anchor' }

  const last = state.last_entry_at ? new Date(state.last_entry_at) : null
  if (last && last >= period.start) return { due: false, reason: 'logged_this_period', period }

  return { due: true, reason: 'calendar_due', period }
}

/**
 * Period start/end for biweekly (anchor days) or monthly (day-of-month).
 * Biweekly: days in cadence_anchor like '1,15' within the current month.
 * Monthly: first number in anchor as day-of-month.
 */
export function currentPeriod(cadence, anchor, now = new Date(), _tz = 'UTC') {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const days = parseAnchorDays(anchor)

  if (cadence === 'monthly') {
    const day = days[0] || 1
    let start = new Date(y, m, Math.min(day, daysInMonth(y, m)), 0, 0, 0, 0)
    if (d < day) {
      const pm = m === 0 ? 11 : m - 1
      const py = m === 0 ? y - 1 : y
      start = new Date(py, pm, Math.min(day, daysInMonth(py, pm)), 0, 0, 0, 0)
    }
    const end = addMonths(start, 1)
    return { start, end }
  }

  if (cadence === 'biweekly') {
    const a = days[0] || 1
    const b = days[1] || 15
    const sorted = [a, b].sort((x, y) => x - y)
    // Find period containing today
    const candidates = []
    for (const offset of [-1, 0, 1]) {
      const mm = m + offset
      const yy = mm < 0 ? y - 1 : mm > 11 ? y + 1 : y
      const mo = ((mm % 12) + 12) % 12
      for (const day of sorted) {
        candidates.push(new Date(yy, mo, Math.min(day, daysInMonth(yy, mo)), 0, 0, 0, 0))
      }
    }
    candidates.sort((x, y) => x - y)
    for (let i = 0; i < candidates.length - 1; i++) {
      if (now >= candidates[i] && now < candidates[i + 1]) {
        return { start: candidates[i], end: candidates[i + 1] }
      }
    }
    // fallback: last pair
    const start = new Date(y, m, sorted[0], 0, 0, 0, 0)
    return { start, end: new Date(y, m, sorted[1] || sorted[0] + 14, 0, 0, 0, 0) }
  }

  return null
}

/** Changing cadence recomputes next due from anchor — returns next period start after now. */
export function nextDueFromAnchor(cadence, anchor, now = new Date()) {
  if (!cadence || cadence === 'off') return null
  const period = currentPeriod(cadence, anchor, now)
  if (!period) return null
  // If still in period without logging, due is period.start (already due) or period.end as next boundary
  return period.end
}

/** New capture only — promotion must NOT call this. */
export function recordNewCapture(state, now = new Date()) {
  return {
    ...state,
    last_entry_at: now.toISOString(),
  }
}

export function recordPrompted(state, now = new Date()) {
  return { ...state, last_prompted_at: now.toISOString() }
}

export function snoozeUntil(state, until) {
  return { ...state, snoozed_until: new Date(until).toISOString() }
}

function parseAnchorDays(anchor) {
  return String(anchor || '1,15')
    .split(/[,/\s]+/)
    .map(x => parseInt(x, 10))
    .filter(n => n >= 1 && n <= 31)
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate()
}

function addMonths(d, n) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

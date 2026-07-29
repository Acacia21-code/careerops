/**
 * Offer comparison helpers (user-provided numbers only — never invent).
 */

export const OFFER_REMOTE_VALUES = Object.freeze(['', 'remote', 'hybrid', 'onsite'])

/**
 * Parse a user-entered amount. Accepts "150000", "150,000", "150k".
 * Returns null when empty or unparseable — never invents a number.
 */
export function parseMoneyInput(raw) {
  if (raw == null) return null
  let s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '')
  if (!s) return null
  const mult = s.endsWith('k') ? 1000 : 1
  if (mult === 1000) s = s.slice(0, -1)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s) * mult
  return Number.isFinite(n) ? n : null
}

export function formatMoney(amount, currency = 'USD') {
  if (amount == null || amount === '' || Number.isNaN(Number(amount))) return '—'
  const n = Number(amount)
  const cur = String(currency || 'USD').trim() || 'USD'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur.length === 3 ? cur : 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch (_e) {
    return `${cur} ${n}`
  }
}

export function offerFieldsFromOutcome(o) {
  if (!o || typeof o !== 'object') {
    return {
      base: null,
      bonus: null,
      equity_notes: '',
      remote: '',
      deadline: '',
      currency: 'USD',
    }
  }
  const base = o.base != null ? o.base : o.base_amount
  const bonus = o.bonus != null ? o.bonus : o.bonus_amount
  return {
    base: base != null && base !== '' ? Number(base) : null,
    bonus: bonus != null && bonus !== '' ? Number(bonus) : null,
    equity_notes: String(o.equity_notes || ''),
    remote: String(o.remote || ''),
    deadline: String(o.deadline || o.offer_deadline || ''),
    currency: String(o.currency || 'USD').trim() || 'USD',
  }
}

/**
 * Build side-by-side rows for 2–3 offer outcomes.
 * entries: [{ roleId, company, title, outcome }]
 */
export function buildOfferCompare(entries = []) {
  const cols = (entries || [])
    .slice(0, 3)
    .map(e => {
      const offer = offerFieldsFromOutcome(e.outcome)
      return {
        role_id: e.roleId || e.role_id,
        company: e.company || '—',
        title: e.title || '',
        kind: e.outcome?.kind || '',
        date: e.outcome?.date || e.outcome?.outcome_date || '',
        note: e.outcome?.note || '',
        ...offer,
        base_label: formatMoney(offer.base, offer.currency),
        bonus_label: formatMoney(offer.bonus, offer.currency),
      }
    })
    .filter(c => c.kind === 'offer')

  const rows = [
    { key: 'company', label: 'Company', values: cols.map(c => c.company) },
    { key: 'title', label: 'Role', values: cols.map(c => c.title || '—') },
    { key: 'base', label: 'Base', values: cols.map(c => c.base_label) },
    { key: 'bonus', label: 'Bonus', values: cols.map(c => c.bonus_label) },
    { key: 'equity', label: 'Equity notes', values: cols.map(c => c.equity_notes || '—') },
    { key: 'remote', label: 'Remote', values: cols.map(c => c.remote || '—') },
    { key: 'deadline', label: 'Deadline', values: cols.map(c => c.deadline || '—') },
    { key: 'currency', label: 'Currency', values: cols.map(c => c.currency || '—') },
    { key: 'note', label: 'Notes', values: cols.map(c => c.note || '—') },
  ]

  return { columns: cols, rows, empty: cols.length < 2 }
}

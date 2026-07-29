/**
 * Posted compensation from ATS boards (Ashby etc.).
 * User-visible posted truth only — never invent a band.
 */

/**
 * Normalize Ashby `compensation` object into { min, max, currency, interval, label }.
 * Returns null when no usable posted numbers/label.
 */
export function normalizeAshbyCompensation(comp) {
  if (!comp || typeof comp !== 'object') return null
  const label =
    String(comp.scrapeableCompensationSalarySummary || '').trim()
    || String(comp.compensationTierSummary || '').trim()
    || ''

  let min = null
  let max = null
  let currency = 'USD'
  let interval = 'year'

  const fromComponents = (components) => {
    if (!Array.isArray(components)) return
    for (const c of components) {
      if (!c || typeof c !== 'object') continue
      const type = String(c.compensationType || c.type || '').toLowerCase()
      if (type && type !== 'salary') continue
      const lo = numOrNull(c.minValue != null ? c.minValue : c.min)
      const hi = numOrNull(c.maxValue != null ? c.maxValue : c.max)
      if (lo != null) min = min == null ? lo : Math.min(min, lo)
      if (hi != null) max = max == null ? hi : Math.max(max, hi)
      if (c.currencyCode) currency = String(c.currencyCode).trim() || currency
      const iv = String(c.interval || c.Interval || '').toUpperCase()
      if (iv.includes('YEAR') || iv === '1 YEAR') interval = 'year'
      else if (iv.includes('MONTH')) interval = 'month'
      else if (iv.includes('HOUR')) interval = 'hour'
    }
  }

  fromComponents(comp.summaryComponents)
  if (min == null && max == null && Array.isArray(comp.compensationTiers)) {
    for (const tier of comp.compensationTiers) {
      fromComponents(tier?.components)
    }
  }

  if (min == null && max == null && !label) return null
  return {
    min,
    max,
    currency,
    interval,
    label: label || formatCompLabel(min, max, currency),
  }
}

export function formatCompLabel(min, max, currency = 'USD') {
  const cur = String(currency || 'USD')
  const fmt = (n) => {
    if (n == null) return null
    if (n >= 1000) return `${cur} ${Math.round(n / 1000)}k`
    return `${cur} ${n}`
  }
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`
  if (min != null) return `from ${fmt(min)}`
  if (max != null) return `up to ${fmt(max)}`
  return ''
}

/** Persist shape for mt_roles.comp_range / comp_raw. */
export function roleCompFieldsFromAshby(comp) {
  const range = normalizeAshbyCompensation(comp)
  if (!range) return { comp_range: null, comp_raw: null }
  return {
    comp_range: {
      min: range.min,
      max: range.max,
      currency: range.currency,
      interval: range.interval,
      label: range.label,
    },
    comp_raw: range.label || null,
  }
}

export function normalizeCompRange(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    return { min: null, max: null, currency: 'USD', interval: 'year', label: s }
  }
  if (typeof raw !== 'object') return null
  const min = numOrNull(raw.min)
  const max = numOrNull(raw.max)
  const currency = String(raw.currency || 'USD').trim() || 'USD'
  const interval = String(raw.interval || 'year').trim() || 'year'
  const label = String(raw.label || '').trim() || formatCompLabel(min, max, currency)
  if (min == null && max == null && !label) return null
  return { min, max, currency, interval, label }
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Display string for cards/drawer — empty when absent (never invent). */
export function postedCompLabel(role) {
  if (!role) return ''
  const range = normalizeCompRange(role.comp_range)
  if (range?.label) return range.label
  const raw = String(role.comp_raw || '').trim()
  return raw
}

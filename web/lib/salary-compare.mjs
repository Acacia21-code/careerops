/**
 * Honest salary compare: profile target band vs posted ATS band vs structured offer.
 * Gaps are labeled as data differences — never "market average".
 * No third-party salary API.
 */

import { formatMoney, offerFieldsFromOutcome, parseMoneyInput } from './offer-compare.mjs'
import { normalizeCompRange, postedCompLabel } from './ats-comp.mjs'

/**
 * Profile target band from mt_profiles columns or pack profile fields.
 * Accepts target_band_min/max or nested target_band: { min, max, currency }.
 */
export function normalizeTargetBand(profileOrBand) {
  if (!profileOrBand || typeof profileOrBand !== 'object') {
    return { min: null, max: null, currency: 'USD' }
  }
  const nested = profileOrBand.target_band && typeof profileOrBand.target_band === 'object'
    ? profileOrBand.target_band
    : profileOrBand
  const min = numOrNull(
    nested.target_band_min != null ? nested.target_band_min : nested.min
  )
  const max = numOrNull(
    nested.target_band_max != null ? nested.target_band_max : nested.max
  )
  const currency = String(
    nested.target_band_currency || nested.currency || 'USD'
  ).trim() || 'USD'
  return { min, max, currency }
}

export function targetBandLabel(band) {
  const b = normalizeTargetBand(band)
  if (b.min == null && b.max == null) return ''
  if (b.min != null && b.max != null) {
    return `${formatMoney(b.min, b.currency)} – ${formatMoney(b.max, b.currency)}`
  }
  if (b.min != null) return `from ${formatMoney(b.min, b.currency)}`
  return `up to ${formatMoney(b.max, b.currency)}`
}

/**
 * Compare target vs posted vs offer for one role.
 * Returns labeled gaps; never invents missing numbers.
 */
export function buildSalaryCompare({
  profile = null,
  role = null,
  outcome = null,
} = {}) {
  const target = normalizeTargetBand(profile)
  const posted = normalizeCompRange(role?.comp_range)
  const postedLabel = postedCompLabel(role) || (posted?.label || '')
  const offer = outcome && (outcome.kind === 'offer' || outcome.base != null || outcome.base_amount != null)
    ? offerFieldsFromOutcome(outcome)
    : null

  const rows = [
    {
      key: 'target',
      label: 'Your target band',
      value: targetBandLabel(target) || '— (set in Settings)',
      min: target.min,
      max: target.max,
      currency: target.currency,
      source: 'profile',
    },
    {
      key: 'posted',
      label: 'Posted band (ATS)',
      value: postedLabel || '— (not on posting)',
      min: posted?.min ?? null,
      max: posted?.max ?? null,
      currency: posted?.currency || 'USD',
      source: 'ats',
    },
    {
      key: 'offer',
      label: 'Offer base',
      value: offer && offer.base != null
        ? formatMoney(offer.base, offer.currency)
        : '— (no offer numbers yet)',
      min: offer?.base ?? null,
      max: offer?.base ?? null,
      currency: offer?.currency || 'USD',
      source: 'outcome',
    },
  ]

  const gaps = []
  if (target.min != null && posted?.max != null && posted.max < target.min) {
    gaps.push({
      kind: 'posted_below_target',
      label: 'Posted max is below your target min (data gap — not a market average)',
      delta: posted.max - target.min,
    })
  }
  if (target.max != null && posted?.min != null && posted.min > target.max) {
    gaps.push({
      kind: 'posted_above_target',
      label: 'Posted min is above your target max (data gap — not a market average)',
      delta: posted.min - target.max,
    })
  }
  if (offer?.base != null && target.min != null && offer.base < target.min) {
    gaps.push({
      kind: 'offer_below_target',
      label: 'Offer base is below your target min (your numbers only)',
      delta: offer.base - target.min,
    })
  }
  if (offer?.base != null && posted?.min != null && offer.base < posted.min) {
    gaps.push({
      kind: 'offer_below_posted',
      label: 'Offer base is below posted min (posted vs your offer)',
      delta: offer.base - posted.min,
    })
  }
  if (offer?.base != null && posted?.max != null && offer.base > posted.max) {
    gaps.push({
      kind: 'offer_above_posted',
      label: 'Offer base is above posted max (posted vs your offer)',
      delta: offer.base - posted.max,
    })
  }

  return {
    rows,
    gaps,
    has_any: !!(target.min != null || target.max != null || postedLabel || (offer && offer.base != null)),
    doctrine: 'Gaps are differences between your numbers and posted/offer data — not market averages.',
  }
}

export function parseBandInput(minRaw, maxRaw) {
  return {
    min: parseMoneyInput(minRaw),
    max: parseMoneyInput(maxRaw),
  }
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

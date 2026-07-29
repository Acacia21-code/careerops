/**
 * JD triage — score a posting not yet on the board, then add as sourced.
 * Pure helpers only. Doctrine: no auto-apply, no invented experience.
 */

export function inferRoleLevel(title) {
  const t = String(title || '')
  if (/vp|vice president|chief/i.test(t)) return 'VP'
  if (/senior director|sr\.? director/i.test(t)) return 'Senior Director'
  if (/principal/i.test(t)) return 'Principal'
  if (/director/i.test(t)) return 'Director'
  return '—'
}

/**
 * Build mt_roles insert payload for triage → board.
 * stage is always `sourced` so Rank Sourced / Phase loop can pick it up.
 */
export function buildTriageRoleRow({ company, title, url, jd, ghost_risk }) {
  const row = {
    company: String(company || '').trim(),
    title: String(title || '').trim(),
    level: inferRoleLevel(title),
    url: (url && String(url).trim()) || null,
    source: 'manual',
    fit_score: '—',
    stage: 'sourced',
    ghost_risk: ghost_risk || 'low',
  }
  if (jd && String(jd).trim()) row.jd = String(jd).trim()
  return row
}

/** Same shape as drawer / batch match persistence. */
export function buildMatchReportRow({ role_id, match_score, missing_keywords }) {
  return {
    role_id,
    kind: 'match',
    match_score,
    missing_keywords: Array.isArray(missing_keywords) ? missing_keywords : [],
  }
}

/**
 * Split gap labels into “in your materials” vs “worth adding?” —
 * mirrors rp2MaterialsSet in the drawer.
 */
export function splitGapsByMaterials(gaps, resumeText, extraTexts = []) {
  const resume = String(resumeText || '').toLowerCase()
  const extra = (extraTexts || []).map(x => String(x || '').toLowerCase()).join('\n')
  const blob = resume + '\n' + extra
  const inMat = [], worth = []
  for (const g of (gaps || []).slice(0, 12)) {
    const t = String(g || '').trim()
    if (!t) continue
    const key = t.toLowerCase().split(/[^a-z0-9+]+/).filter(w => w.length > 3).slice(0, 3)
    const hit = key.length && key.every(w => blob.includes(w))
    ;(hit ? inMat : worth).push(t)
  }
  return { inMat, worth, total: inMat.length + worth.length }
}

/**
 * Validate before Add to board. JD required (triage without JD is pointless).
 * Company + title required (same as Add role).
 */
export function validateTriageAdd({ company, title, url, jd }) {
  const co = String(company || '').trim()
  const ti = String(title || '').trim()
  const j = String(jd || '').trim()
  const u = String(url || '').trim()
  if (!co || !ti) return 'Company and job title are required.'
  if (!j) return 'Paste the job description to triage before adding.'
  if (!u && !j) return 'Add a posting link and/or paste the job description.'
  return null
}

/**
 * Career advisor brief — structured, materials-only past, labeled market judgment.
 * Follow-ups reuse the same ranked selection + no-invent doctrine (not a freeform chat).
 */

import { rankForGenerate, assertNoUnsupportedClaims } from './generate-rank.mjs'

/**
 * Build advisor input context from ranked memory + portfolio (not newest-20).
 */
export function buildAdvisorContext({
  accomplishments = [],
  portfolio = [],
  profile = {},
  checkedIds = [],
  jd = '',
  gaps = [],
  cap = 20,
} = {}) {
  const memory = rankForGenerate(accomplishments, {
    jd,
    gaps,
    checkedIds,
    relevantRoleIds: (profile.resume_struct?.roles || []).map(r => r.id).filter(Boolean),
    cap,
  })
  const port = rankForGenerate(
    resumeOkOrAll(portfolio).map(p => ({
      ...p,
      body_current: [p.title, p.summary, p.body_current, ...(p.tags || [])].filter(Boolean).join(' '),
    })),
    { jd, gaps, checkedIds, cap },
  )
  return {
    observed_materials: {
      resume_excerpt: (profile.resume_text || '').slice(0, 4000),
      accomplishments: memory.map(a => ({
        id: a.id,
        body: a.body_current,
        original: a.body_original,
        employer: a.employer,
        project: a.project,
      })),
      portfolio: port.map(p => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        tags: p.tags,
        visibility: p.visibility,
      })),
      target_titles: profile.target_titles || [],
      keywords: profile.keywords || [],
    },
  }
}

/** Flat corpus string for unsupported-claim checks against ranked materials. */
export function materialsCorpusFromContext(ctx) {
  const m = ctx?.observed_materials || ctx || {}
  const parts = [
    m.resume_excerpt,
    ...(m.accomplishments || []).flatMap(a => [a.body, a.original, a.employer, a.project]),
    ...(m.portfolio || []).flatMap(p => [p.title, p.summary, ...(p.tags || [])]),
    ...(m.target_titles || []),
    ...(m.keywords || []),
  ]
  return parts.filter(Boolean).join('\n')
}

/**
 * System prompt fragment for advisor mode (brief + grounded follow-ups).
 */
export function advisorSystemPrompt() {
  return [
    'You are a career advisor inside CareerOps.',
    'Separate clearly:',
    '1) Observed in your materials — only facts present in the supplied materials.',
    '2) Suggested next skills / next steps — labeled as model judgment / market read, NOT as the user\'s experience.',
    'Market and compensation statements are model judgment, not live data.',
    'Never invent past employers, titles, dates, metrics, or shipped work.',
    'Any wording suggested for reuse is a draft — the user must polish/Accept before it becomes materials. Never present invented claims as pasteable facts.',
    'Never auto-apply or claim the user applied.',
    'Return a structured brief with sections:',
    'market_read (labeled judgment), fit, demand_gaps, acquisition_plan, resume_portfolio_moves.',
    'CTAs may deep-link to memory/portfolio actions the user must confirm.',
  ].join('\n')
}

/**
 * System prompt for a grounded follow-up on an existing brief (same doctrine as advise).
 */
export function advisorFollowUpSystemPrompt() {
  return [
    'You are answering a follow-up question about an existing CareerOps advisor brief.',
    'Ground every claim the same way the brief is grounded:',
    '1) Observed in your materials — only facts present in the supplied materials or the current brief\'s observed sections.',
    '2) Suggested next steps — labeled as model judgment, NOT as the user\'s experience.',
    'Market and compensation statements are model judgment, not live data.',
    'Never invent employers, titles, dates, metrics, or shipped work.',
    'Any wording for reuse is a draft requiring polish/Accept — never pasteable as fact.',
    'Never auto-apply.',
    'Return JSON with keys: observed_in_materials (string), suggested_next_steps (array of strings), market_notes (string, model judgment only).',
  ].join('\n')
}

/**
 * User message for a grounded follow-up (ranked materials + brief context).
 */
export function buildAdvisorFollowUpUserMessage({
  question = '',
  brief = {},
  observedMaterials = {},
  freeTier = false,
} = {}) {
  const materialsCap = freeTier ? 4000 : 10000
  const briefCtx = {
    market_read: brief.market_read,
    fit: brief.fit,
    observed_in_materials: brief.observed_in_materials,
    demand_gaps: brief.demand_gaps,
    acquisition_plan: brief.acquisition_plan,
    resume_portfolio_moves: brief.resume_portfolio_moves,
    suggested_next_skills: brief.suggested_next_skills,
  }
  const prior = (brief.follow_ups || []).slice(-6).map(f => ({
    q: f.question,
    observed: f.observed_in_materials,
    steps: f.suggested_next_steps,
  }))
  return [
    `Follow-up question: ${String(question || '').trim()}`,
    `Current brief context:\n${JSON.stringify(briefCtx).slice(0, freeTier ? 3000 : 8000)}`,
    prior.length ? `Prior follow-ups:\n${JSON.stringify(prior).slice(0, 2000)}` : '',
    `Materials (truth):\n${JSON.stringify(observedMaterials).slice(0, materialsCap)}`,
  ].filter(Boolean).join('\n\n')
}

/**
 * Normalize model JSON / text into a brief object for UI + mt_reports.kind=advisor.
 */
export function normalizeAdvisorBrief(raw, meta = {}) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      data = m ? JSON.parse(m[0]) : { raw_text: raw }
    } catch {
      data = { raw_text: raw }
    }
  }
  return {
    kind: 'advisor',
    created_at: meta.now || new Date().toISOString(),
    model: meta.model || null,
    free_tier: !!meta.free_tier,
    observed_in_materials: data.observed_in_materials || data.fit || null,
    market_read: labelJudgment(data.market_read || data.market || ''),
    fit: data.fit || '',
    demand_gaps: asList(data.demand_gaps || data.gaps),
    acquisition_plan: asList(data.acquisition_plan || data.plan),
    resume_portfolio_moves: asList(data.resume_portfolio_moves || data.moves),
    suggested_next_skills: asList(data.suggested_next_skills || data.skills_to_learn).map(s => ({
      text: typeof s === 'string' ? s : s.text,
      label: 'model_judgment',
    })),
    ctas: asList(data.ctas).map(c => ({
      action: c.action || c.type || 'open_memory',
      label: c.label || 'Review in CareerOps',
      confirm: true,
    })),
    follow_ups: asList(data.follow_ups).filter(f => f && (f.question || f.observed_in_materials)),
    raw_text: data.raw_text || null,
  }
}

/**
 * Normalize a follow-up model reply. Optional corpus runs unsupported-claim check on observed text.
 */
export function normalizeAdvisorFollowUp(raw, meta = {}) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      data = m ? JSON.parse(m[0]) : { observed_in_materials: raw }
    } catch {
      data = { observed_in_materials: raw }
    }
  }
  const observed = typeof data.observed_in_materials === 'string'
    ? data.observed_in_materials
    : (data.observed_in_materials ? JSON.stringify(data.observed_in_materials) : (data.answer || data.reply || ''))
  const steps = asList(data.suggested_next_steps || data.suggested_next_skills || data.next_steps)
    .map(s => (typeof s === 'string' ? s : s.text || JSON.stringify(s)))
  const market = labelJudgment(data.market_notes || data.market_read || '')
  let claimCheck = { ok: true, unsupported: [] }
  if (meta.corpus) {
    claimCheck = assertNoUnsupportedClaims(observed, meta.corpus)
  }
  return {
    question: meta.question || data.question || '',
    created_at: meta.now || new Date().toISOString(),
    model: meta.model || null,
    free_tier: !!meta.free_tier,
    observed_in_materials: observed,
    suggested_next_steps: steps.map(text => ({ text, label: 'model_judgment' })),
    market_notes: market,
    draft_reuse_only: true,
    claim_check: claimCheck,
  }
}

/** Append a follow-up exchange onto an advisor brief (additive, recoverable). */
export function appendAdvisorFollowUp(brief, exchange) {
  const base = brief && typeof brief === 'object' ? brief : {}
  const follow_ups = [...(base.follow_ups || []), exchange].filter(Boolean)
  return { ...base, follow_ups }
}

export function advisorReportRow(brief, roleId = null) {
  return {
    role_id: roleId,
    kind: 'advisor',
    rewritten: JSON.stringify(brief),
    match_score: null,
    missing_keywords: brief.demand_gaps || [],
    jd_text: null,
  }
}

function labelJudgment(text) {
  const t = typeof text === 'string' ? text : JSON.stringify(text || '')
  if (!t) return { label: 'model_judgment', text: '' }
  return { label: 'model_judgment', text: t }
}

function asList(x) {
  if (!x) return []
  if (Array.isArray(x)) return x
  return [x]
}

function resumeOkOrAll(items) {
  const ok = (items || []).filter(i => i.visibility === 'resume_ok' && !i.archived_at)
  return ok.length ? ok : (items || []).filter(i => !i.archived_at)
}

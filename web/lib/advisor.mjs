/**
 * Career advisor brief — structured, materials-only past, labeled market judgment.
 */

import { rankForGenerate } from './generate-rank.mjs'

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

/**
 * System prompt fragment for advisor mode.
 */
export function advisorSystemPrompt() {
  return [
    'You are a career advisor inside CareerOps.',
    'Separate clearly:',
    '1) Observed in your materials — only facts present in the supplied materials.',
    '2) Suggested next skills — labeled as model judgment / market read, NOT as the user\'s experience.',
    'Never invent past employers, titles, metrics, or projects.',
    'Never auto-apply or claim the user applied.',
    'Return a structured brief with sections:',
    'market_read (labeled judgment), fit, demand_gaps, acquisition_plan, resume_portfolio_moves.',
    'CTAs may deep-link to memory/portfolio actions the user must confirm.',
  ].join('\n')
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
    raw_text: data.raw_text || null,
  }
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

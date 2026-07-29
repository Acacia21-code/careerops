/**
 * Career OS Phase 4 — human-gated skill mode chains over a board pack.
 *
 * Declared pipelines (e.g. evaluate → rank → interview). Each step writes an
 * mt_reports row; advancing always requires an explicit human confirm.
 * Never auto-applies, never auto-sends, never invents experience.
 */

export const CHAIN_FORMAT = 'careerops-mode-chain'
export const CHAIN_SCHEMA_VERSION = 1

/** Modes allowed in chains (skill surface). */
export const CHAINABLE_MODES = Object.freeze([
  'scan',
  'evaluate',
  'rank',
  'tailor',
  'interview',
  'followup',
  'outcome',
  'advise',
])

/** Default report kind written per mode (pack.reports / mt_reports.kind). */
export const MODE_REPORT_KIND = Object.freeze({
  scan: 'evaluate',
  evaluate: 'evaluate',
  rank: 'rank',
  tailor: 'resume',
  interview: 'interview',
  followup: 'interview',
  outcome: 'evaluate',
  advise: 'advisor',
})

export const BUILTIN_CHAINS = Object.freeze({
  'prep-pipeline': {
    format: CHAIN_FORMAT,
    schema_version: CHAIN_SCHEMA_VERSION,
    id: 'prep-pipeline',
    name: 'Prep pipeline',
    description: 'evaluate → rank → interview over one board pack (human confirm between steps)',
    steps: [
      { mode: 'evaluate', report_kind: 'evaluate', label: 'Decision pack' },
      { mode: 'rank', report_kind: 'rank', label: 'Fit ranking' },
      { mode: 'interview', report_kind: 'interview', label: 'Interview prep' },
    ],
    human_confirm_between_steps: true,
    doctrine: {
      no_auto_apply: true,
      no_auto_send: true,
      no_invented_facts: true,
    },
  },
  'evaluate-interview': {
    format: CHAIN_FORMAT,
    schema_version: CHAIN_SCHEMA_VERSION,
    id: 'evaluate-interview',
    name: 'Evaluate then interview',
    description: 'evaluate → interview with human confirm between steps',
    steps: [
      { mode: 'evaluate', report_kind: 'evaluate', label: 'Decision pack' },
      { mode: 'interview', report_kind: 'interview', label: 'Interview prep' },
    ],
    human_confirm_between_steps: true,
    doctrine: {
      no_auto_apply: true,
      no_auto_send: true,
      no_invented_facts: true,
    },
  },
})

/**
 * @param {string} id
 * @returns {object}
 */
export function getChain(id) {
  const chain = BUILTIN_CHAINS[id]
  if (!chain) throw new Error(`Unknown chain: ${id}. Known: ${listChains().join(', ')}`)
  return structuredClone ? structuredClone(chain) : JSON.parse(JSON.stringify(chain))
}

export function listChains() {
  return Object.keys(BUILTIN_CHAINS)
}

/**
 * Validate a chain definition (builtin or custom).
 */
export function loadChainDefinition(raw) {
  const c = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!c || typeof c !== 'object') throw new Error('Chain definition must be an object')
  if (c.format !== CHAIN_FORMAT && c.format !== `${CHAIN_FORMAT}/v1`) {
    throw new Error(`Unknown chain format: ${c.format || '(missing)'}`)
  }
  if (!c.id || typeof c.id !== 'string') throw new Error('Chain requires id')
  if (!Array.isArray(c.steps) || c.steps.length === 0) throw new Error('Chain requires steps[]')
  if (c.human_confirm_between_steps !== true) {
    throw new Error('Chains must set human_confirm_between_steps: true')
  }
  const doctrine = {
    no_auto_apply: true,
    no_auto_send: true,
    no_invented_facts: true,
    ...(c.doctrine || {}),
  }
  if (doctrine.no_auto_apply !== true || doctrine.no_auto_send !== true || doctrine.no_invented_facts !== true) {
    throw new Error('Chain doctrine violated')
  }
  const steps = c.steps.map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`steps[${i}] invalid`)
    if (!CHAINABLE_MODES.includes(s.mode)) throw new Error(`steps[${i}] unknown mode ${s.mode}`)
    const report_kind = s.report_kind || MODE_REPORT_KIND[s.mode]
    if (!report_kind) throw new Error(`steps[${i}] missing report_kind`)
    return {
      mode: s.mode,
      report_kind,
      label: s.label || s.mode,
    }
  })
  return {
    format: CHAIN_FORMAT,
    schema_version: CHAIN_SCHEMA_VERSION,
    id: c.id,
    name: c.name || c.id,
    description: c.description || '',
    steps,
    human_confirm_between_steps: true,
    doctrine,
  }
}

function ensurePackExtensions(pack) {
  const next = { ...pack }
  const ext = next.extensions && typeof next.extensions === 'object' ? { ...next.extensions } : {}
  ext.plugins = Array.isArray(ext.plugins) ? [...ext.plugins] : []
  ext.fields = ext.fields && typeof ext.fields === 'object' ? { ...ext.fields } : {}
  ext.chain_runs = Array.isArray(ext.chain_runs) ? [...ext.chain_runs] : []
  next.extensions = ext
  next.reports = Array.isArray(next.reports) ? [...next.reports] : []
  return next
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Start a chain run on a board pack. Does not execute the first step body —
 * call writeStepReport then confirmStep to advance.
 *
 * @returns {{ pack, run, chain, brief }}
 */
export function startChain(pack, chainId, { roleId = null, now = new Date().toISOString() } = {}) {
  const chain = loadChainDefinition(getChain(chainId))
  const next = ensurePackExtensions(pack)
  const run = {
    id: newId('chain'),
    chain_id: chain.id,
    status: 'in_progress',
    step_index: 0,
    role_id: roleId,
    report_ids: [],
    confirmed_steps: [],
    started_at: now,
    updated_at: now,
  }
  next.extensions.chain_runs = [...next.extensions.chain_runs, run]
  return {
    pack: next,
    run,
    chain,
    brief: stepBrief(chain, run, next),
  }
}

/**
 * Build agent/CLI brief for the current step (materials-only instructions).
 */
export function stepBrief(chain, run, pack) {
  const step = chain.steps[run.step_index]
  if (!step) {
    return {
      done: true,
      message: 'Chain complete. No further steps. Human submits applications; never auto-apply.',
    }
  }
  const role = (pack.roles || []).find(r => r.id === run.role_id) || null
  return {
    done: false,
    chain_id: chain.id,
    run_id: run.id,
    step_index: run.step_index,
    mode: step.mode,
    report_kind: step.report_kind,
    label: step.label,
    role_id: run.role_id,
    role: role
      ? { id: role.id, company: role.company, title: role.title }
      : null,
    doctrine: {
      no_auto_apply: true,
      no_auto_send: true,
      no_invented_facts: true,
      human_confirm_required: true,
    },
    instructions: [
      `Run skill mode \`${step.mode}\` against the board pack.`,
      'Use only materials / accomplishments / portfolio / JD already in the pack — never invent experience.',
      `Write results as mt_reports kind \`${step.report_kind}\` (use writeStepReport / --report-file).`,
      'Do not apply, send email, or move board stages.',
      run.step_index > 0
        ? 'Previous step was human-confirmed. Wait for --confirm before the next step after writing this report.'
        : 'After writing this report, stop for human --confirm before the next step.',
    ],
  }
}

/**
 * Append a report for the current step. Does NOT advance the chain
 * (human must confirmStep).
 *
 * @returns {{ pack, run, report }}
 */
export function writeStepReport(pack, runId, {
  body,
  roleId = null,
  now = new Date().toISOString(),
  reportId = null,
} = {}) {
  if (body == null || String(body).trim() === '') {
    throw new Error('Step report body required (materials-based content only)')
  }
  const next = ensurePackExtensions(pack)
  const idx = next.extensions.chain_runs.findIndex(r => r.id === runId)
  if (idx < 0) throw new Error(`Unknown chain run ${runId}`)
  const run = { ...next.extensions.chain_runs[idx] }
  if (run.status === 'completed' || run.status === 'cancelled') {
    throw new Error(`Chain run ${runId} is ${run.status}`)
  }
  const chain = loadChainDefinition(getChain(run.chain_id))
  const step = chain.steps[run.step_index]
  if (!step) throw new Error('No current step — chain already complete')

  const report = {
    id: reportId || newId('rpt'),
    role_id: roleId || run.role_id || null,
    kind: step.report_kind,
    match_score: null,
    missing_keywords: null,
    rewritten: String(body),
    created_at: now,
    display_name: `${chain.id} · ${step.mode} · step ${run.step_index + 1}`,
  }
  next.reports = [...next.reports, report]
  run.report_ids = [...(run.report_ids || []), report.id]
  run.status = 'awaiting_confirm'
  run.updated_at = now
  next.extensions.chain_runs = [...next.extensions.chain_runs]
  next.extensions.chain_runs[idx] = run
  return { pack: next, run, report }
}

/**
 * Human confirm gate: mark current step confirmed and advance (or complete).
 * Refuses if no report was written for the current step.
 *
 * @returns {{ pack, run, chain, brief, advanced: boolean }}
 */
export function confirmStep(pack, runId, { confirm = false, now = new Date().toISOString() } = {}) {
  if (confirm !== true) {
    throw new Error('Human confirm required: pass confirm: true (CLI: --confirm)')
  }
  const next = ensurePackExtensions(pack)
  const idx = next.extensions.chain_runs.findIndex(r => r.id === runId)
  if (idx < 0) throw new Error(`Unknown chain run ${runId}`)
  const run = { ...next.extensions.chain_runs[idx] }
  if (run.status === 'completed') {
    const chain = loadChainDefinition(getChain(run.chain_id))
    return { pack: next, run, chain, brief: stepBrief(chain, run, next), advanced: false }
  }
  if (run.status === 'cancelled') throw new Error(`Chain run ${runId} was cancelled`)

  const chain = loadChainDefinition(getChain(run.chain_id))
  const step = chain.steps[run.step_index]
  if (!step) {
    run.status = 'completed'
    run.updated_at = now
    next.extensions.chain_runs = [...next.extensions.chain_runs]
    next.extensions.chain_runs[idx] = run
    return { pack: next, run, chain, brief: stepBrief(chain, run, next), advanced: false }
  }

  const reportsForStep = (run.report_ids || []).length
  const confirmedCount = (run.confirmed_steps || []).length
  // Need at least one new report since last confirm
  if (reportsForStep <= confirmedCount) {
    throw new Error('Write a step report before confirming (human gate: no empty advances)')
  }
  if (run.status !== 'awaiting_confirm' && run.status !== 'in_progress') {
    throw new Error(`Cannot confirm from status ${run.status}`)
  }

  run.confirmed_steps = [...(run.confirmed_steps || []), run.step_index]
  run.step_index = run.step_index + 1
  run.updated_at = now
  if (run.step_index >= chain.steps.length) {
    run.status = 'completed'
  } else {
    run.status = 'in_progress'
  }
  next.extensions.chain_runs = [...next.extensions.chain_runs]
  next.extensions.chain_runs[idx] = run
  return {
    pack: next,
    run,
    chain,
    brief: stepBrief(chain, run, next),
    advanced: true,
  }
}

/**
 * Cancel a run (human abort). Does not delete reports already written.
 */
export function cancelChain(pack, runId, { now = new Date().toISOString() } = {}) {
  const next = ensurePackExtensions(pack)
  const idx = next.extensions.chain_runs.findIndex(r => r.id === runId)
  if (idx < 0) throw new Error(`Unknown chain run ${runId}`)
  const run = { ...next.extensions.chain_runs[idx], status: 'cancelled', updated_at: now }
  next.extensions.chain_runs = [...next.extensions.chain_runs]
  next.extensions.chain_runs[idx] = run
  return { pack: next, run }
}

export function findActiveRun(pack, chainId = null) {
  const runs = pack?.extensions?.chain_runs || []
  return runs.find(r =>
    (r.status === 'in_progress' || r.status === 'awaiting_confirm') &&
    (chainId == null || r.chain_id === chainId),
  ) || null
}

/**
 * Apply pack mutations back onto a raw pack object for CLI save.
 * Ensures reports from chain steps survive rebuild via buildBoardPack.
 */
export function mergeChainPackState(basePack, mutatedPack) {
  return {
    ...basePack,
    ...mutatedPack,
    reports: mutatedPack.reports || [],
    extensions: mutatedPack.extensions || basePack.extensions,
  }
}

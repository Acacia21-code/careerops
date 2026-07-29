/**
 * Online promote via Postgres RPC (Track A2).
 * Offline / localStorage fallback stays in resume-sync.mjs (promoteAccomplishment / promotePortfolio).
 *
 * Track A3: Docker Postgres will assert rev-conflict aborts the whole transaction.
 */

export const RESUME_REV_CONFLICT = 'resume_struct_rev_conflict'

export function isResumeRevConflict(error) {
  if (!error) return false
  if (error.code === RESUME_REV_CONFLICT) return true
  const msg = String(error.message || error.details || error.hint || error || '')
  if (/resume_struct_rev_conflict/i.test(msg)) return true
  // PostgREST may surface Postgres SQLSTATE 40001 (serialization_failure)
  if ((error.code === '40001' || error.code === 'PGRST301') && /resume_struct_rev/i.test(msg)) return true
  return false
}

export function resumeRevConflictError(cause) {
  const err = new Error(
    'Resume changed elsewhere — reload Memory/Portfolio and reconcile before promoting again.',
  )
  err.code = RESUME_REV_CONFLICT
  err.cause = cause
  return err
}

/**
 * Apply RPC payload onto local PROFILE (+ optional row lists).
 * @returns {{ profilePatch, accomplishment?, portfolio? }}
 */
export function applyPromoteRpcResult(profile, data) {
  if (!data || typeof data !== 'object') throw new Error('Empty promote RPC result')
  const next = {
    ...profile,
    resume_struct: data.resume_struct ?? profile?.resume_struct,
    resume_text: data.resume_text ?? profile?.resume_text,
    resume_struct_rev: data.resume_struct_rev,
    structured_modified_at: data.structured_modified_at,
    resume_reconcile_needed: !!data.resume_reconcile_needed,
  }
  return {
    profile: next,
    accomplishment: data.accomplishment || null,
    portfolio: data.portfolio || null,
  }
}

/**
 * @param {object} sb Supabase client
 * @param {{ accomplishmentId: string, expectedRev: number, roleId?: string, roleHeader?: string, roleSub?: string, newRoleId?: string, bulletId?: string }} opts
 */
export async function rpcPromoteAccomplishment(sb, opts) {
  const { data, error } = await sb.rpc('promote_accomplishment', {
    p_accomplishment_id: opts.accomplishmentId,
    p_expected_rev: opts.expectedRev ?? 0,
    p_role_id: opts.roleId ?? null,
    p_role_header: opts.roleHeader ?? null,
    p_role_sub: opts.roleSub ?? null,
    p_new_role_id: opts.newRoleId ?? null,
    p_bullet_id: opts.bulletId ?? null,
  })
  if (error) {
    if (isResumeRevConflict(error)) throw resumeRevConflictError(error)
    throw error
  }
  return data
}

/**
 * @param {object} sb Supabase client
 * @param {{ portfolioId: string, expectedRev: number, projectId?: string }} opts
 */
export async function rpcPromotePortfolio(sb, opts) {
  const { data, error } = await sb.rpc('promote_portfolio', {
    p_portfolio_id: opts.portfolioId,
    p_expected_rev: opts.expectedRev ?? 0,
    p_project_id: opts.projectId ?? null,
  })
  if (error) {
    if (isResumeRevConflict(error)) throw resumeRevConflictError(error)
    throw error
  }
  return data
}

/**
 * Decide online RPC vs pure-JS offline path.
 * Online when DB flag is true and we have an authenticated user + rpc.
 */
export function shouldUsePromoteRpc({ dbOk, userId, sb } = {}) {
  return !!(dbOk && userId && sb && typeof sb.rpc === 'function')
}

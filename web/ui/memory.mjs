export {
  createAccomplishment,
  editAccomplishment,
  archiveAccomplishment,
  setPolishCandidate,
  acceptPolish,
  rejectPolish,
  wordDiff,
} from '../lib/bullet-memory.mjs'
export { shouldNudge, recordNewCapture, recordPrompted, snoozeUntil } from '../lib/cadence.mjs'
export { rankForGenerate, assertNoUnsupportedClaims } from '../lib/generate-rank.mjs'
export { classifyEnrichUrl, proposeEnrichCandidates, fetchPublicEnrichMeta, acceptEnrichCandidate } from '../lib/enrich-inbox.mjs'

export function activeAccomplishments(rows) {
  return (rows || []).filter((row) => row.status !== 'archived')
}

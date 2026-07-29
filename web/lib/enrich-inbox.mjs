/**
 * GitHub / LinkedIn URL → inbox candidates (portfolio / accomplishments).
 * Doctrine: never auto-promote into resume_struct; Accept required.
 * Fetch is best-effort public metadata; caller may pass pasted text when fetch blocked.
 */

import { createAccomplishment } from './bullet-memory.mjs'
import { createPortfolioItem } from './portfolio.mjs'

const GITHUB_REPO = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)\/?/i
const GITHUB_USER = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/?$/i
const LINKEDIN_PROFILE = /^https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/in\/([^/?#\s]+)\/?/i
const LINKEDIN_JOB = /^https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/jobs\/view\/(\d+)/i

export function classifyEnrichUrl(url) {
  const u = String(url || '').trim()
  if (!u) return null
  let m = u.match(GITHUB_REPO)
  if (m) {
    return {
      kind: 'github_repo',
      url: `https://github.com/${m[1]}/${m[2].replace(/\.git$/i, '')}`,
      owner: m[1],
      repo: m[2].replace(/\.git$/i, ''),
    }
  }
  m = u.match(GITHUB_USER)
  if (m && !['settings', 'explore', 'topics', 'marketplace', 'orgs', 'organizations'].includes(m[1].toLowerCase())) {
    return { kind: 'github_user', url: `https://github.com/${m[1]}`, owner: m[1] }
  }
  m = u.match(LINKEDIN_PROFILE)
  if (m) {
    return {
      kind: 'linkedin_profile',
      url: `https://www.linkedin.com/in/${m[1]}`,
      handle: m[1],
    }
  }
  m = u.match(LINKEDIN_JOB)
  if (m) {
    return {
      kind: 'linkedin_job',
      url: `https://www.linkedin.com/jobs/view/${m[1]}`,
      jobId: m[1],
    }
  }
  return null
}

/**
 * Build inbox candidate(s) from classified URL + optional pasted excerpt / fetch JSON.
 * Never sets status beyond inbox; never touches resume_struct.
 */
export function proposeEnrichCandidates({
  url,
  pastedText = '',
  fetchMeta = null,
  now = new Date().toISOString(),
} = {}) {
  const classified = classifyEnrichUrl(url)
  if (!classified) {
    return { ok: false, error: 'unsupported_url', candidates: [] }
  }
  const excerpt = String(pastedText || '').trim()
  const meta = fetchMeta && typeof fetchMeta === 'object' ? fetchMeta : null
  const candidates = []

  if (classified.kind === 'github_repo') {
    const title = meta?.full_name || meta?.name || `${classified.owner}/${classified.repo}`
    const desc = String(meta?.description || '').trim()
    const body = [
      `Source: ${classified.url}`,
      desc ? `Description: ${desc}` : null,
      meta?.language ? `Language: ${meta.language}` : null,
      excerpt ? `Excerpt:\n${excerpt}` : null,
    ].filter(Boolean).join('\n')
    const item = createPortfolioItem({
      title: String(title).slice(0, 200),
      url: classified.url,
      item_type: 'code',
      summary: desc || excerpt.slice(0, 400) || `GitHub repo ${classified.owner}/${classified.repo}`,
      body_current: body || `GitHub repo ${classified.url}`,
      tags: ['enrichment', 'github', ...(meta?.language ? [String(meta.language).toLowerCase()] : [])],
      visibility: 'private',
    })
    item.status = 'inbox'
    item._enrich = { source: 'github_repo', url: classified.url, at: now }
    candidates.push({ type: 'portfolio', item })
  } else if (classified.kind === 'github_user') {
    const bio = String(meta?.bio || excerpt || '').trim()
    const body = [
      `Source: ${classified.url}`,
      bio ? `About:\n${bio}` : 'Paste About/README text if fetch was blocked.',
    ].join('\n')
    const row = createAccomplishment(body, {
      status: 'inbox',
      project: `github:${classified.owner}`,
      tags: ['enrichment', 'github'],
    })
    row._enrich = { source: 'github_user', url: classified.url, at: now }
    candidates.push({ type: 'accomplishment', item: row })
  } else if (classified.kind === 'linkedin_profile' || classified.kind === 'linkedin_job') {
    const body = [
      `Source: ${classified.url}`,
      excerpt
        ? `User-pasted excerpt (LinkedIn fetch often blocked — paste About / role text):\n${excerpt}`
        : 'Paste public About / experience / job text here before Accept. CareerOps does not silently scrape LinkedIn into your resume.',
    ].join('\n')
    if (classified.kind === 'linkedin_job') {
      const item = createPortfolioItem({
        title: meta?.title || `LinkedIn job ${classified.jobId}`,
        url: classified.url,
        item_type: 'other',
        summary: excerpt.slice(0, 400) || 'LinkedIn job posting excerpt (inbox until Accept)',
        body_current: body,
        tags: ['enrichment', 'linkedin'],
        visibility: 'private',
      })
      item._enrich = { source: 'linkedin_job', url: classified.url, at: now }
      candidates.push({ type: 'portfolio', item })
    } else {
      const row = createAccomplishment(body, {
        status: 'inbox',
        project: `linkedin:${classified.handle}`,
        tags: ['enrichment', 'linkedin'],
      })
      row._enrich = { source: 'linkedin_profile', url: classified.url, at: now }
      candidates.push({ type: 'accomplishment', item: row })
    }
  }

  return {
    ok: true,
    classified,
    candidates,
    auto_promote: false,
    doctrine: 'Inbox only until Accept — never auto-promote into resume_struct.',
  }
}

/**
 * Best-effort public GitHub API fetch (no token). Returns null on failure.
 * LinkedIn is not fetched here (ToS / login walls) — use pasted text.
 */
export async function fetchPublicEnrichMeta(classified, fetchImpl = globalThis.fetch) {
  if (!classified || !fetchImpl) return null
  try {
    if (classified.kind === 'github_repo') {
      const r = await fetchImpl(
        `https://api.github.com/repos/${encodeURIComponent(classified.owner)}/${encodeURIComponent(classified.repo)}`,
        { headers: { Accept: 'application/vnd.github+json' } }
      )
      if (!r.ok) return null
      const j = await r.json()
      return {
        full_name: j.full_name,
        name: j.name,
        description: j.description,
        language: j.language,
        html_url: j.html_url,
      }
    }
    if (classified.kind === 'github_user') {
      const r = await fetchImpl(
        `https://api.github.com/users/${encodeURIComponent(classified.owner)}`,
        { headers: { Accept: 'application/vnd.github+json' } }
      )
      if (!r.ok) return null
      const j = await r.json()
      return { login: j.login, bio: j.bio, name: j.name, html_url: j.html_url }
    }
  } catch (_e) {
    return null
  }
  return null
}

/** Accept = persist candidate as-is into inbox rows; still never promotes to resume. */
export function acceptEnrichCandidate(candidate) {
  if (!candidate || !candidate.item) return null
  const item = { ...candidate.item }
  delete item._enrich
  if (candidate.type === 'portfolio') {
    return { type: 'portfolio', item: { ...item, visibility: item.visibility || 'private' } }
  }
  return {
    type: 'accomplishment',
    item: { ...item, status: 'inbox' },
  }
}

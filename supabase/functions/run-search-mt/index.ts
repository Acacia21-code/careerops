// Multi-source ATS Find — Greenhouse / Ashby / Lever / SmartRecruiters / Workday public JSON.
// Default board pack: boards.default.json (90+ verified company boards).
// Override via body.boards or mt_profiles.ats_boards. Cap: 10 searches/day.
// Ideas inspired by multi-source aggregators (JobFunnel / portal sweeps) — original CareerOps code.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import DEFAULT_BOARDS from './boards.default.json' with { type: 'json' }

const SEARCH_CAP = 10
const CONCURRENCY = 16
/** Hard cap — never dump hundreds of weak matches onto the board in one run. */
const ADD_CAP = 40

type Hit = { co: string; title: string; loc: string; url: string; source: string; score: number }
type WorkdayBoard = { t: string; host: string; site: string }
type Boards = {
  greenhouse?: string[]
  ashby?: string[]
  lever?: string[]
  smartrecruiters?: string[]
  workday?: WorkdayBoard[]
}

const fp = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const prettyCo = (slug: string) => slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const normCo = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Roles that almost never belong on a commercial / partnerships / ops search unless the user asked for them. */
const BAN_RE = /(software engineer|staff engineer|senior engineer|\b swe\b|frontend|backend|full[\s-]?stack|devops|sre\b|data scien|machine learning|ml engineer|recruit(er|ing)|talent acquisition|people ops|hr business|payroll|accountant|controller\b|counsel\b|\blegal\b|paralegal|nurse|clinical|physician|housekeep|front desk|line cook|\bserver\b|bartender|maintenance tech|security guard|warehouse associate|driver\b|cashier)/i

function normalizeBoards(raw: unknown): Boards {
  const base = DEFAULT_BOARDS as Boards
  if (!raw || typeof raw !== 'object') return { ...base }
  const o = raw as Record<string, unknown>
  return {
    greenhouse: Array.isArray(o.greenhouse) ? o.greenhouse.map(String) : base.greenhouse,
    ashby: Array.isArray(o.ashby) ? o.ashby.map(String) : base.ashby,
    lever: Array.isArray(o.lever) ? o.lever.map(String) : base.lever,
    smartrecruiters: Array.isArray(o.smartrecruiters) ? o.smartrecruiters.map(String) : (base.smartrecruiters || []),
    workday: Array.isArray(o.workday) ? (o.workday as WorkdayBoard[]) : (base.workday || []),
  }
}

function listTerms(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter((s) => s.length >= 2)
}

function hitCount(title: string, terms: string[]): number {
  const t = title.toLowerCase()
  let n = 0
  for (const term of terms) {
    if (t.includes(term.toLowerCase())) n++
  }
  return n
}

/**
 * Strict Find filter:
 * - If target_titles set → at least one title term must appear in the job title
 * - If keywords set → at least one keyword must appear
 * - If seniority set → at least one seniority term must appear
 * - Always drop banned off-lane titles unless the user explicitly searched for them
 * Returns a score for ranking (higher = better fit to prefs).
 */
function buildScorer(prof: Record<string, unknown>, prefs: { remote_pref?: string }) {
  const titles = listTerms(prof.target_titles)
  const keywords = listTerms(prof.keywords)
  const seniority = listTerms(prof.seniority)
  const locations = listTerms(prof.locations)
  const userAskedBan = [...titles, ...keywords].some((t) => BAN_RE.test(t))

  const locRe = locations.length ? new RegExp(locations.map(escapeRe).join('|'), 'i') : null
  const wantRemote = locations.some((l) => /remote/i.test(l)) || prefs.remote_pref === 'remote_only' || prefs.remote_pref === 'prefer_remote'
  const remoteOnly = prefs.remote_pref === 'remote_only'

  // No prefs at all → require a senior commercial-ish title (don't dump the whole internet)
  const fallbackTitleRe = /(director|vp\b|vice president|head of|principal|partner|commercial|partnership|business develop|go[\s-]?to[\s-]?market|alliances|channel)/i

  return (title: string, loc: string): number => {
    if (!title || !title.trim()) return 0
    if (!userAskedBan && BAN_RE.test(title)) return 0

    const titleHits = titles.length ? hitCount(title, titles) : 0
    const kwHits = keywords.length ? hitCount(title, keywords) : 0
    const senHits = seniority.length ? hitCount(title, seniority) : 0

    if (titles.length && titleHits === 0) return 0
    if (keywords.length && kwHits === 0) return 0
    if (seniority.length && senHits === 0) return 0

    if (!titles.length && !keywords.length && !seniority.length) {
      if (!fallbackTitleRe.test(title)) return 0
    }

    const locStr = loc || ''
    const looksRemote = /remote|anywhere|distributed|work from home|wfh/i.test(locStr) || /remote/i.test(title)
    const looksOnsite = /\bon[\s-]?site\b|\bin[\s-]?office\b/i.test(locStr) && !looksRemote
    if (remoteOnly && looksOnsite) return 0
    if (locRe && locStr.trim()) {
      const okLoc = locRe.test(locStr) || (wantRemote && looksRemote)
      if (!okLoc && !looksRemote) return 0
    }

    // Rank: title matches matter most, then keywords, then seniority, remote bonus
    return titleHits * 5 + kwHits * 3 + senHits * 2 + (looksRemote && wantRemote ? 1 : 0) + 1
  }
}

function isBlocked(company: string, blocklist: string[]) {
  const n = normCo(company)
  if (!n) return false
  return blocklist.some((b) => {
    const bn = normCo(b)
    return bn && (n.includes(bn) || bn.includes(n))
  })
}

const diag: Record<string, number> = {}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

async function gh(slug: string, scoreOf: (t: string, l: string) => number, out: Hit[]) {
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)
    if (!r.ok) { diag['gh:' + slug] = -r.status; return }
    const j = await r.json()
    let n = 0
    for (const x of (j.jobs || [])) {
      const title = x.title || ''
      const loc = x.location?.name || ''
      const score = scoreOf(title, loc)
      if (score > 0) {
        out.push({ co: slug, title, loc, url: x.absolute_url, source: 'greenhouse', score })
        n++
      }
    }
    diag['gh:' + slug] = n
  } catch (_) { diag['gh:' + slug] = -1 }
}

async function ashby(org: string, scoreOf: (t: string, l: string) => number, out: Hit[]) {
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`)
    if (!r.ok) { diag['ashby:' + org] = -r.status; return }
    const d = await r.json()
    let n = 0
    for (const x of (d.jobs || [])) {
      const title = x.title || ''
      const loc = x.location || ''
      const score = scoreOf(title, loc)
      if (score > 0) {
        out.push({ co: org, title, loc, url: x.jobUrl || x.applyUrl, source: 'ashby', score })
        n++
      }
    }
    diag['ashby:' + org] = n
  } catch (_) { diag['ashby:' + org] = -1 }
}

async function lever(co: string, scoreOf: (t: string, l: string) => number, out: Hit[]) {
  try {
    const r = await fetch(`https://api.lever.co/v0/postings/${co}?mode=json`)
    if (!r.ok) { diag['lever:' + co] = -r.status; return }
    const j = await r.json()
    let n = 0
    for (const x of (j || [])) {
      const loc = x.categories?.location || ''
      const score = scoreOf(x.text, loc)
      if (score > 0) {
        out.push({ co, title: x.text, loc, url: x.hostedUrl || x.applyUrl, source: 'lever', score })
        n++
      }
    }
    diag['lever:' + co] = n
  } catch (_) { diag['lever:' + co] = -1 }
}

async function smartrecruiters(co: string, scoreOf: (t: string, l: string) => number, out: Hit[]) {
  try {
    const r = await fetch(`https://api.smartrecruiters.com/v1/companies/${co}/postings`)
    if (!r.ok) { diag['sr:' + co] = -r.status; return }
    const d = await r.json()
    let n = 0
    for (const x of (d.content || [])) {
      const title = x.name || x.title || ''
      const loc = x.location?.city || x.location?.country || ''
      const url = x.ref || x.applyUrl || (x.id ? `https://jobs.smartrecruiters.com/${co}/${x.id}` : '')
      const score = scoreOf(title, loc)
      if (url && score > 0) {
        out.push({ co, title, loc, url, source: 'smartrecruiters', score })
        n++
      }
    }
    diag['sr:' + co] = n
  } catch (_) { diag['sr:' + co] = -1 }
}

async function workday(w: WorkdayBoard, scoreOf: (t: string, l: string) => number, out: Hit[], queries: string[]) {
  let n = 0
  for (const q of queries.slice(0, 4)) {
    try {
      const r = await fetch(`https://${w.host}/wday/cxs/${w.t}/${w.site}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
      })
      if (!r.ok) continue
      const j = await r.json()
      for (const p of (j.jobPostings || [])) {
        const score = scoreOf(p.title, p.locationsText || '')
        if (score > 0) {
          out.push({
            co: w.t,
            title: p.title,
            loc: p.locationsText || '',
            url: `https://${w.host}/en-US/${w.site}/job${(p.externalPath || '').replace(/^\/job/, '')}`,
            source: 'workday',
            score,
          })
          n++
        }
      }
    } catch (_) { /* ignore */ }
  }
  diag['wd:' + w.t] = n
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') || ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: cors })

  const body = await req.json().catch(() => ({}))
  const today = new Date().toISOString().slice(0, 10)

  const { data: usage } = await sb.from('mt_usage').select('searches').eq('owner', user.id).eq('day', today).maybeSingle()
  const searches = usage?.searches ?? 0
  if (searches >= SEARCH_CAP) {
    return new Response(JSON.stringify({ error: 'daily_limit', used: searches, cap: SEARCH_CAP }), { headers: cors })
  }

  const { data: prof } = await sb.from('mt_profiles').select('target_titles,keywords,seniority,locations,ats_boards').eq('owner', user.id).maybeSingle()
  const boards = normalizeBoards(body.boards ?? prof?.ats_boards)
  const blocklist = Array.isArray(body.blocklist) ? body.blocklist.map(String) : []
  const prefs = {
    remote_pref: String(body.remote_pref || 'any'),
    max_age_days: Number(body.max_age_days || 0) || 0,
  }
  const addCap = Math.min(200, Math.max(5, Number(body.max_add || ADD_CAP) || ADD_CAP))
  const scoreOf = buildScorer(prof || {}, prefs)
  const wdQueries = [
    ...(Array.isArray(prof?.keywords) ? prof!.keywords.map(String) : []),
    ...(Array.isArray(prof?.target_titles) ? prof!.target_titles.map(String) : []),
  ].filter(Boolean)
  if (!wdQueries.length) wdQueries.push('director', 'partnerships')

  Object.keys(diag).forEach((k) => delete diag[k])
  const out: Hit[] = []

  type Job = { kind: string; id: string }
  const jobs: Job[] = [
    ...(boards.greenhouse || []).map((id) => ({ kind: 'gh', id })),
    ...(boards.ashby || []).map((id) => ({ kind: 'ashby', id })),
    ...(boards.lever || []).map((id) => ({ kind: 'lever', id })),
    ...(boards.smartrecruiters || []).map((id) => ({ kind: 'sr', id })),
  ]
  await mapPool(jobs, CONCURRENCY, async (job) => {
    if (job.kind === 'gh') await gh(job.id, scoreOf, out)
    else if (job.kind === 'ashby') await ashby(job.id, scoreOf, out)
    else if (job.kind === 'lever') await lever(job.id, scoreOf, out)
    else if (job.kind === 'sr') await smartrecruiters(job.id, scoreOf, out)
  })
  for (const w of (boards.workday || [])) await workday(w, scoreOf, out, wdQueries)

  // URL dedupe within this scan, then best matches first
  const seenUrl = new Set<string>()
  const uniq = out
    .filter((o) => o.url && !seenUrl.has(o.url) && seenUrl.add(o.url))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

  const { data: existing } = await sb.from('mt_roles').select('url,title,company')
  const knownUrls = new Set((existing || []).map((r: { url?: string }) => r.url).filter(Boolean))
  const knownFp = new Set((existing || []).map((r: { company?: string; title?: string }) => fp((r.company || '') + ' ' + (r.title || ''))))

  let added = 0
  let skippedDup = 0
  let skippedBlock = 0
  let skippedCap = 0
  const addedRoles: string[] = []
  for (const o of uniq) {
    if (added >= addCap) { skippedCap++; continue }
    if (knownUrls.has(o.url)) { skippedDup++; continue }
    const coName = prettyCo(o.co)
    if (isBlocked(coName, blocklist) || isBlocked(o.co, blocklist)) { skippedBlock++; continue }
    if (knownFp.has(fp(coName + ' ' + o.title))) { skippedDup++; continue }
    const level = /vp|vice president|chief/i.test(o.title) ? 'VP'
      : /senior director|sr\.? director/i.test(o.title) ? 'Senior Director'
      : /principal/i.test(o.title) ? 'Principal'
      : /director/i.test(o.title) ? 'Director'
      : '—'
    const { error } = await sb.from('mt_roles').insert({
      company: coName,
      title: o.title,
      level,
      url: o.url,
      source: 'run-search:' + o.source,
      fit_score: String(o.score),
      stage: 'sourced',
      ghost_risk: 'low',
    })
    if (error) continue
    knownFp.add(fp(coName + ' ' + o.title))
    knownUrls.add(o.url)
    added++
    addedRoles.push(coName + ' — ' + o.title)
  }

  if (usage) {
    await sb.from('mt_usage').update({ searches: searches + 1 }).eq('owner', user.id).eq('day', today)
  } else {
    await sb.from('mt_usage').insert({ owner: user.id, day: today, searches: 1, ai_calls: 0 })
  }

  const live = Object.entries(diag).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const boardCount =
    (boards.greenhouse || []).length +
    (boards.ashby || []).length +
    (boards.lever || []).length +
    (boards.smartrecruiters || []).length +
    (boards.workday || []).length

  return new Response(JSON.stringify({
    found: uniq.length,
    added,
    addedRoles: addedRoles.slice(0, 40),
    skippedDup,
    skippedBlock,
    skippedCap,
    addCap,
    boardsScanned: boardCount,
    boardsHit: live.length,
    topBoards: live.slice(0, 12),
    boardsUsed: {
      greenhouse: (boards.greenhouse || []).length,
      ashby: (boards.ashby || []).length,
      lever: (boards.lever || []).length,
      smartrecruiters: (boards.smartrecruiters || []).length,
      workday: (boards.workday || []).length,
    },
  }), { headers: cors })
})

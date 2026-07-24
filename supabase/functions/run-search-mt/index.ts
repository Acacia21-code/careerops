// Configurable ATS job search — Greenhouse / Ashby / Lever public JSON boards.
// Board list comes from request body, profile.ats_boards, or the bundled example defaults.
// No proprietary company spider list. Cap: 10 searches/day per user (mt_usage).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SEARCH_CAP = 10

/** Small illustrative defaults — replace via Settings / body.boards / ats_boards. */
const DEFAULT_BOARDS = {
  greenhouse: ['openai', 'stripe', 'anthropic', 'databricks', 'notion'],
  ashby: ['ramp', 'mercury', 'linear'],
  lever: ['netflix', 'spotify'],
  workday: [] as { t: string; host: string; site: string }[],
}

type Hit = { co: string; title: string; loc: string; url: string }
type Boards = {
  greenhouse?: string[]
  ashby?: string[]
  lever?: string[]
  workday?: { t: string; host: string; site: string }[]
}

const fp = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

function buildMatchers(prof: Record<string, unknown>) {
  const titles = (Array.isArray(prof.target_titles) ? prof.target_titles : []).map(String).filter(Boolean)
  const keywords = (Array.isArray(prof.keywords) ? prof.keywords : []).map(String).filter(Boolean)
  const seniority = (Array.isArray(prof.seniority) ? prof.seniority : []).map(String).filter(Boolean)
  const locations = (Array.isArray(prof.locations) ? prof.locations : []).map(String).filter(Boolean)

  const titleRe = titles.length
    ? new RegExp(titles.map(escapeRe).join('|'), 'i')
    : /(director|vp\b|vice president|head of|principal|manager|lead|staff)/i
  const kwRe = keywords.length
    ? new RegExp(keywords.map(escapeRe).join('|'), 'i')
    : /./i
  const seniorRe = seniority.length
    ? new RegExp(seniority.map(escapeRe).join('|'), 'i')
    : null
  const locRe = locations.length
    ? new RegExp(locations.map(escapeRe).join('|'), 'i')
    : null
  const wantRemote = locations.some((l) => /remote/i.test(l))

  return (title: string, loc: string) => {
    if (!titleRe.test(title)) return false
    if (!kwRe.test(title) && keywords.length) {
      // keywords may appear only in title for board APIs without JD text
      if (!keywords.some((k) => title.toLowerCase().includes(k.toLowerCase()))) return false
    }
    if (seniorRe && !seniorRe.test(title)) return false
    if (locRe) {
      const okLoc = locRe.test(loc) || (wantRemote && /remote|anywhere|distributed/i.test(loc))
      if (!okLoc && loc.trim()) return false
    }
    return true
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeBoards(raw: unknown): Boards {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOARDS }
  const o = raw as Record<string, unknown>
  return {
    greenhouse: Array.isArray(o.greenhouse) ? o.greenhouse.map(String) : DEFAULT_BOARDS.greenhouse,
    ashby: Array.isArray(o.ashby) ? o.ashby.map(String) : DEFAULT_BOARDS.ashby,
    lever: Array.isArray(o.lever) ? o.lever.map(String) : DEFAULT_BOARDS.lever,
    workday: Array.isArray(o.workday) ? (o.workday as Boards['workday']) : [],
  }
}

const diag: Record<string, number> = {}

async function gh(slug: string, ok: (t: string, l: string) => boolean, out: Hit[]) {
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)
    if (!r.ok) { diag['gh:' + slug] = -r.status; return }
    const j = await r.json()
    let n = 0
    for (const x of (j.jobs || [])) {
      if (ok(x.title, x.location?.name || '')) {
        out.push({ co: slug, title: x.title, loc: x.location?.name || '', url: x.absolute_url })
        n++
      }
    }
    diag['gh:' + slug] = n
  } catch (_) { diag['gh:' + slug] = -1 }
}

async function ashby(org: string, ok: (t: string, l: string) => boolean, out: Hit[]) {
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`)
    if (!r.ok) { diag['ashby:' + org] = -r.status; return }
    const d = await r.json()
    let n = 0
    for (const x of (d.jobs || [])) {
      if (ok(x.title, x.location || '')) {
        out.push({ co: org, title: x.title, loc: x.location || '', url: x.jobUrl || x.applyUrl })
        n++
      }
    }
    diag['ashby:' + org] = n
  } catch (_) { diag['ashby:' + org] = -1 }
}

async function lever(co: string, ok: (t: string, l: string) => boolean, out: Hit[]) {
  try {
    const r = await fetch(`https://api.lever.co/v0/postings/${co}?mode=json`)
    if (!r.ok) { diag['lever:' + co] = -r.status; return }
    const j = await r.json()
    let n = 0
    for (const x of (j || [])) {
      const loc = x.categories?.location || ''
      if (ok(x.text, loc)) {
        out.push({ co, title: x.text, loc, url: x.hostedUrl || x.applyUrl })
        n++
      }
    }
    diag['lever:' + co] = n
  } catch (_) { diag['lever:' + co] = -1 }
}

async function workday(w: { t: string; host: string; site: string }, ok: (t: string, l: string) => boolean, out: Hit[], queries: string[]) {
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
        if (ok(p.title, p.locationsText || '')) {
          out.push({
            co: w.t,
            title: p.title,
            loc: p.locationsText || '',
            url: `https://${w.host}/en-US/${w.site}/job${(p.externalPath || '').replace(/^\/job/, '')}`,
          })
        }
      }
    } catch (_) { /* ignore board errors */ }
  }
}

function prettyCo(slug: string) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
  const ok = buildMatchers(prof || {})
  const wdQueries = [
    ...(Array.isArray(prof?.keywords) ? prof!.keywords.map(String) : []),
    ...(Array.isArray(prof?.target_titles) ? prof!.target_titles.map(String) : []),
    'manager',
  ].filter(Boolean)

  Object.keys(diag).forEach((k) => delete diag[k])
  const out: Hit[] = []
  await Promise.all([
    ...(boards.greenhouse || []).map((s) => gh(s, ok, out)),
    ...(boards.ashby || []).map((o) => ashby(o, ok, out)),
    ...(boards.lever || []).map((c) => lever(c, ok, out)),
    ...(boards.workday || []).map((w) => workday(w, ok, out, wdQueries)),
  ])

  const seen = new Set<string>()
  const uniq = out.filter((o) => o.url && !seen.has(o.url) && seen.add(o.url))

  // RLS scopes rows to the signed-in user (owner DEFAULT auth.uid()).
  const { data: existing } = await sb.from('mt_roles').select('url,title,company')
  const knownUrls = new Set((existing || []).map((r: { url?: string }) => r.url).filter(Boolean))
  const knownFp = new Set((existing || []).map((r: { company?: string; title?: string }) => fp((r.company || '') + ' ' + (r.title || ''))))

  let added = 0
  const addedRoles: string[] = []
  for (const o of uniq) {
    if (knownUrls.has(o.url)) continue
    const coName = prettyCo(o.co)
    if (knownFp.has(fp(coName + ' ' + o.title))) continue
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
      source: 'run-search',
      fit_score: '—',
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
  return new Response(JSON.stringify({
    found: uniq.length,
    added,
    addedRoles,
    boardsHit: live.length,
    topBoards: live.slice(0, 10),
    boardsUsed: {
      greenhouse: (boards.greenhouse || []).length,
      ashby: (boards.ashby || []).length,
      lever: (boards.lever || []).length,
      workday: (boards.workday || []).length,
    },
  }), { headers: cors })
})

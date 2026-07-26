/**
 * Shared Find matching — used by run-search-mt and Node regression tests.
 * Sterile: no user PII, no vault paths.
 */

/** Roles that almost never belong unless the user explicitly searched for them. */
export const BAN_RE =
  /(software engineer|staff engineer|senior engineer|\b swe\b|frontend|backend|full[\s-]?stack|devops|sre\b|data scien|machine learning|ml engineer|applied ai architect|ai architect|account executive|\bae\b[, ]|enterprise security|security sales|administrative business partner|channel partner|alliance rvp|finance business partner|hr business|hr operations|recruit(er|ing)|talent acquisition|people ops|payroll|accountant|controller\b|counsel\b|\blegal\b|paralegal|nurse|clinical|physician|housekeep|front desk|line cook|\bserver\b|bartender|maintenance tech|security guard|warehouse associate|driver\b|cashier)/i

/** Domain tokens for travel / distribution lane searches. */
export const DOMAIN_RE =
  /\b(travel|airline|aviation|hospitality|hotel|lodging|ota|gds|ndc|tmc|tourism|cruise|rail|metasearch|destination|dmo)\b|\bair\b/i

const FALLBACK_TITLE_RE =
  /(director|vp\b|vice president|head of|principal|partner|commercial|partnership|business develop|go[\s-]?to[\s-]?market|alliances|channel)/i

export function listTerms(v) {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x || '').trim())
    .filter((s) => s.length >= 2)
}

export function hitCount(title, terms) {
  const t = title.toLowerCase()
  let n = 0
  for (const term of terms) {
    if (t.includes(term.toLowerCase())) n++
  }
  return n
}

export function prefsWantDomain(titles, keywords) {
  return [...titles, ...keywords].some((t) => DOMAIN_RE.test(t))
}

export function significantTokens(terms) {
  const out = []
  for (const term of terms) {
    for (const w of String(term)
      .toLowerCase()
      .split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !/^(with|from|that|this|have|your|into|over|senior|director)$/.test(w)) {
        out.push(w)
      }
    }
  }
  return [...new Set(out)]
}

/**
 * Why a role fails the user's Find lane (client soft-hide + bulk close).
 * Returns null when the role is in-lane (or prefs are empty).
 */
export function roleOffLaneReason(role, prof) {
  const title = String(role?.title || '')
  const company = String(role?.company || '')
  const blob = `${title} ${company}`
  if (!title.trim()) return 'empty_title'
  if (BAN_RE.test(title)) return 'banned_title'

  const titles = listTerms(prof?.target_titles)
  const keywords = listTerms(prof?.keywords)
  const seniority = listTerms(prof?.seniority)
  if (!titles.length && !keywords.length && !seniority.length) return null

  const hay = title.toLowerCase()
  if (titles.length && hitCount(title, titles) === 0) {
    // Allow token overlap for multi-word title prefs (e.g. "travel partnerships" → partnerships)
    const toks = significantTokens(titles)
    if (!toks.some((w) => hay.includes(w))) return 'title_miss'
  }
  if (keywords.length && hitCount(title, keywords) === 0) {
    const toks = significantTokens(keywords)
    if (!toks.some((w) => hay.includes(w))) {
      if (!(prefsWantDomain(titles, keywords) && DOMAIN_RE.test(blob))) return 'keyword_miss'
    }
  }
  if (seniority.length && hitCount(title, seniority) === 0) return 'seniority_miss'

  if (prefsWantDomain(titles, keywords) && !DOMAIN_RE.test(blob)) {
    const strong = titles.some((t) => t.length >= 10 && hay.includes(t.toLowerCase()))
    if (!strong) return 'domain_miss'
  }
  return null
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Non-US / offshore pins — reject when user prefs are US-centric. */
export const NON_US_GEO_RE =
  /\b(indonesia|jakarta|bali|surabaya|bangkok|thailand|singapore|manila|philippines|india|bangalore|bengaluru|hyderabad|mumbai|delhi|pune|chennai|vietnam|hanoi|ho chi minh|saigon|malaysia|kuala lumpur|china|shanghai|beijing|shenzhen|hong kong|taiwan|taipei|japan|tokyo|osaka|korea|seoul|australia|sydney|melbourne|brisbane|new zealand|auckland|london|england|scotland|wales|united kingdom|\buk\b|ireland|dublin|germany|berlin|munich|frankfurt|france|paris|netherlands|amsterdam|spain|madrid|barcelona|portugal|lisbon|italy|milan|rome|poland|warsaw|brazil|s[aã]o paulo|mexico\b|mexico city|canada|toronto|vancouver|montreal|emea|apac|latam|mena|africa|dubai|uae|israel|tel aviv|zurich|switzerland|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|austria|vienna|belgium|brussels|czech|prague|romania|bucharest|hungary|budapest|turkey|istanbul|egypt|cairo|nigeria|lagos|kenya|nairobi|colombia|bogota|argentina|buenos aires|chile|santiago|peru|lima)\b/i

export const US_GEO_RE =
  /\b(united states|\bu\.?\s?s\.?\s?a\.?\b|\busa\b|\bus-only\b|\bus based\b|\bbased in the us\b|america|new york|nyc|chicago|san francisco|\bsf\b|bay area|los angeles|\bla\b|seattle|austin|denver|boston|atlanta|dallas|miami|philadelphia|phoenix|san diego|portland|minneapolis|detroit|houston|washington\s?d\.?c\.?|remote[\s-]*(us|usa|united states))\b/i

/** Merge Settings locations + “where you're based”. */
export function effectiveLocations(prof) {
  const locs = listTerms(prof?.locations)
  const home = String(prof?.location || '').trim()
  if (home && !locs.some((l) => l.toLowerCase() === home.toLowerCase())) locs.push(home)
  return locs
}

function isRemoteOnlyTerm(l) {
  return /^remote([\s-]*(only|ok|friendly))?$/i.test(String(l || '').trim())
}

function prefsWantRemote(locations, prefs) {
  return (
    locations.some((l) => /remote/i.test(l)) ||
    prefs.remote_pref === 'remote_only' ||
    prefs.remote_pref === 'prefer_remote' ||
    prefs.remote_pref === 'remote_us'
  )
}

function prefsAreUsCentric(locations, prefs = {}) {
  if (prefs.remote_pref === 'remote_us') return true
  const concrete = locations.filter((l) => !isRemoteOnlyTerm(l))
  if (!concrete.length) return false
  return concrete.some((l) => US_GEO_RE.test(l) || /^(us|usa|u\.s\.a?\.?)$/i.test(l.trim()))
}

/** Word-bounded preference match — bare "US" must not match inside "Business" / "Russia". */
export function buildLocPreferenceRe(locations) {
  const parts = []
  for (const raw of locations) {
    const l = String(raw || '').trim()
    if (!l || isRemoteOnlyTerm(l)) continue
    if (/^(us|usa|u\.s\.a?\.?)$/i.test(l)) {
      parts.push(String.raw`\b(?:united states|u\.?\s?s\.?\s?a?\.?|usa)\b`)
      continue
    }
    if (/^(uk|u\.k\.)$/i.test(l)) {
      parts.push(String.raw`\b(?:united kingdom|u\.?\s?k\.?|england|scotland|wales)\b`)
      continue
    }
    parts.push(`\\b${escapeRe(l)}\\b`)
  }
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

/**
 * Geo gate for Find. Remote worldwide used to bypass location prefs —
 * "Remote – Indonesia" and empty-loc Jakarta titles slipped through.
 * Returns null if OK, else a short reason code.
 */
export function locationRejectReason(loc, title, locations, prefs = {}) {
  const locs = listTerms(locations)
  const remoteUs = prefs.remote_pref === 'remote_us'
  // remote_us implies a US market even when Locations only say "Remote"
  if (!locs.length && !remoteUs) return null

  const locStr = String(loc || '')
  const hay = `${locStr} ${title || ''}`
  const wantRemote = prefsWantRemote(locs, prefs)
  const remoteOnly = prefs.remote_pref === 'remote_only' || remoteUs
  const looksRemote =
    /remote|anywhere|distributed|work from home|\bwfh\b/i.test(hay) || /remote/i.test(String(title || ''))
  const looksOnsite = /\bon[\s-]?site\b|\bin[\s-]?office\b/i.test(hay) && !looksRemote
  if (remoteOnly && looksOnsite) return 'not_remote'

  const locRe = buildLocPreferenceRe(locs)
  const prefHit = !!(locRe && locRe.test(hay))
  const usCentric = prefsAreUsCentric(locs, prefs)
  const foreignPin = NON_US_GEO_RE.test(hay)
  const usPin = US_GEO_RE.test(hay)

  // Pinned foreign market vs US prefs — even if posting says Remote
  if (usCentric && foreignPin && !usPin && !prefHit) return 'wrong_geo'

  // Remote · US only: bare "Remote" / empty loc without a US pin is not enough
  if (remoteUs) {
    if (usPin || prefHit) return null
    if (looksRemote && !foreignPin && !locStr.trim()) return 'remote_not_us'
    if (looksRemote && !usPin) return 'remote_not_us'
    if (locStr.trim() && !usPin && !prefHit) return 'wrong_geo'
    if (!locStr.trim()) return 'remote_not_us'
    return null
  }

  // Concrete city/country prefs: unmarked remote OK; remote+other-country already caught
  if (locRe) {
    if (prefHit) return null
    // US-centric prefs accept any US pin even if the city isn't listed (e.g. SF when prefs say Chicago + US)
    if (usCentric && usPin && !foreignPin) return null
    if (wantRemote && looksRemote && !(usCentric && foreignPin)) return null
    if (locStr.trim()) return 'wrong_geo'
    // Empty ATS location: reject only when title itself screams a non-matching place
    if (foreignPin && usCentric) return 'wrong_geo'
  }
  return null
}

/**
 * Strict Find filter → score (0 = reject).
 * scoreOf(title, loc, company?)
 */
export function buildScorer(prof, prefs = {}) {
  const titles = listTerms(prof?.target_titles)
  const keywords = listTerms(prof?.keywords)
  const seniority = listTerms(prof?.seniority)
  const locations = effectiveLocations(prof)
  const userAskedBan = [...titles, ...keywords].some((t) => BAN_RE.test(t))
  const wantDomain = prefsWantDomain(titles, keywords)
  const wantRemote = prefsWantRemote(locations, prefs)

  return (title, loc, company = '') => {
    if (!title || !title.trim()) return 0
    if (!userAskedBan && BAN_RE.test(title)) return 0

    const hay = title.toLowerCase()
    const titleHits = titles.length ? hitCount(title, titles) : 0
    const kwHits = keywords.length ? hitCount(title, keywords) : 0
    const senHits = seniority.length ? hitCount(title, seniority) : 0
    const titleTok = titles.length ? significantTokens(titles).some((w) => hay.includes(w)) : false
    const kwTok = keywords.length ? significantTokens(keywords).some((w) => hay.includes(w)) : false

    if (titles.length && titleHits === 0 && !titleTok) return 0
    if (keywords.length && kwHits === 0 && !kwTok) {
      // Domain hit in title/company can satisfy travel-lane keywords (e.g. "Air Partner")
      if (!(wantDomain && DOMAIN_RE.test(`${title} ${company || ''}`))) return 0
    }
    if (seniority.length && senHits === 0) return 0

    if (!titles.length && !keywords.length && !seniority.length) {
      if (!FALLBACK_TITLE_RE.test(title)) return 0
    }

    const blob = `${title} ${company || ''}`
    if (wantDomain && !DOMAIN_RE.test(blob)) {
      const strong = titles.some((t) => t.length >= 10 && hay.includes(t.toLowerCase()))
      if (!strong) return 0
    }

    if (locationRejectReason(loc, title, locations, prefs)) return 0

    const locStr = loc || ''
    const looksRemote =
      /remote|anywhere|distributed|work from home|\bwfh\b/i.test(`${locStr} ${title}`) ||
      /remote/i.test(title)

    const tScore = titleHits * 5 + (titleTok && !titleHits ? 2 : 0)
    const kScore = kwHits * 3 + (kwTok && !kwHits ? 2 : 0)
    return tScore + kScore + senHits * 2 + (looksRemote && wantRemote ? 1 : 0) + 1
  }
}

/** Match stamp for notes / UI (sterile). */
export function matchStamp(title, prof) {
  const titles = listTerms(prof?.target_titles)
  const keywords = listTerms(prof?.keywords)
  const hits = []
  for (const t of titles) {
    if (title.toLowerCase().includes(t.toLowerCase())) hits.push('title:' + t)
  }
  for (const t of keywords) {
    if (title.toLowerCase().includes(t.toLowerCase())) hits.push('kw:' + t)
  }
  if (!hits.length) {
    const toks = significantTokens([...titles, ...keywords]).filter((w) =>
      title.toLowerCase().includes(w),
    )
    for (const w of toks.slice(0, 3)) hits.push('token:' + w)
  }
  return hits.slice(0, 4).join(' · ') || 'score>0'
}

/**
 * Generate materials ranking: checked → role-linked → relevance → recency tie-break.
 * Hard cap applies AFTER ranking (not newest-N).
 */

/**
 * @param {object[]} items accomplishments or portfolio-like { id, body_current|summary, role_id, checked, tags, created_at, employer, project }
 * @param {object} ctx
 * @param {string} [ctx.jd]
 * @param {string[]} [ctx.gaps]
 * @param {string[]} [ctx.relevantRoleIds] resume_struct role ids relevant to target job
 * @param {Set<string>|string[]} [ctx.checkedIds]
 * @param {number} [ctx.cap=20]
 */
export function rankForGenerate(items, ctx = {}) {
  const cap = ctx.cap == null ? 20 : ctx.cap
  const checked = toSet(ctx.checkedIds)
  const roleIds = toSet(ctx.relevantRoleIds)
  const tokens = tokenize([ctx.jd, ...(ctx.gaps || [])].filter(Boolean).join(' '))

  const scored = (items || [])
    .filter(x => x && x.status !== 'archived')
    .map(item => {
      const text = itemText(item)
      const isChecked = checked.has(item.id) || !!item.checked
      const roleLinked = item.role_id && roleIds.has(item.role_id)
      const rel = relevanceScore(text, tokens, item.tags)
      const recency = item.created_at ? Date.parse(item.created_at) || 0 : 0
      // Tier bits for stable sort: checked first, then role-linked, then relevance, then recency
      const tier = (isChecked ? 4 : 0) + (roleLinked ? 2 : 0) + (rel > 0 ? 1 : 0)
      return { item, isChecked, roleLinked, rel, recency, tier, text }
    })

  scored.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier
    if (b.isChecked !== a.isChecked) return (b.isChecked ? 1 : 0) - (a.isChecked ? 1 : 0)
    if (b.roleLinked !== a.roleLinked) return (b.roleLinked ? 1 : 0) - (a.roleLinked ? 1 : 0)
    if (b.rel !== a.rel) return b.rel - a.rel
    return b.recency - a.recency // tie-break only
  })

  return scored.slice(0, cap).map(s => ({
    ...s.item,
    _rank: { tier: s.tier, rel: s.rel, checked: s.isChecked, roleLinked: s.roleLinked },
  }))
}

/** Extract claim-like phrases from generated text for unsupported-claim checks. */
export function extractClaimSeeds(text) {
  const lines = String(text || '').split(/\n/).map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  const seeds = []
  for (const line of lines) {
    const nums = line.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || []
    if (nums.length) seeds.push({ line, nums })
    const orgs = line.match(/\b[A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+){0,3}\b/g) || []
    if (orgs.length >= 1 && /\b(at|for|with)\b/i.test(line)) seeds.push({ line, orgs })
  }
  return seeds
}

/**
 * E2E helper: every metric/entity claim in generated output must appear in materials corpus.
 * @returns {{ ok: boolean, unsupported: string[] }}
 */
export function assertNoUnsupportedClaims(generated, materialsCorpus) {
  const corpus = String(materialsCorpus || '').toLowerCase()
  const unsupported = []
  const seeds = extractClaimSeeds(generated)
  for (const s of seeds) {
    for (const n of s.nums || []) {
      const norm = n.replace(/,/g, '').toLowerCase()
      if (!corpus.includes(norm) && !corpus.includes(n.toLowerCase())) {
        unsupported.push(`metric ${n} in: ${s.line.slice(0, 80)}`)
      }
    }
    for (const o of s.orgs || []) {
      if (o.length < 3) continue
      // skip section headers
      if (/^(professional|experience|skills|education|summary)$/i.test(o)) continue
      if (!corpus.includes(o.toLowerCase())) {
        unsupported.push(`entity ${o} in: ${s.line.slice(0, 80)}`)
      }
    }
  }
  return { ok: unsupported.length === 0, unsupported }
}

function itemText(item) {
  return [item.body_current, item.body_original, item.summary, item.title, item.employer, item.project, ...(item.tags || [])]
    .filter(Boolean).join(' ')
}

function tokenize(s) {
  return [...new Set(String(s).toLowerCase().split(/[^a-z0-9+#]+/).filter(w => w.length > 2))]
}

function relevanceScore(text, tokens, tags) {
  if (!tokens.length) return 0
  const hay = String(text || '').toLowerCase()
  const tagSet = new Set((tags || []).map(t => String(t).toLowerCase()))
  let score = 0
  for (const t of tokens) {
    if (hay.includes(t)) score += 2
    if (tagSet.has(t)) score += 3
  }
  return score
}

function toSet(x) {
  if (!x) return new Set()
  if (x instanceof Set) return x
  return new Set(Array.isArray(x) ? x : [x])
}

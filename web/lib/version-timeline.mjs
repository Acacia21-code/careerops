/**
 * Version timeline ("What shipped"): match history, Sent freeze, linked outcome.
 * No ML / A/B — just durable facts the user already recorded.
 */

export function buildVersionTimeline({
  reports = [],
  outcome = null,
  role = null,
  displayNames = {},
  sentVerIds = {},
} = {}) {
  const events = []

  for (const r of reports || []) {
    if (!r || typeof r !== 'object') continue
    const kind = String(r.kind || '')
    const created = r.created_at || null
    const id = r.id != null ? String(r.id) : null
    const name = (id && (displayNames[id] || r.display_name)) || null

    if (kind === 'match' && r.match_score != null) {
      events.push({
        at: created,
        type: 'match',
        label: `Match ${Number(r.match_score)}%`,
        detail: name || null,
        report_id: id,
        match_score: Number(r.match_score),
      })
    }

    if ((kind === 'resume' || kind === 'cover') && (r.sent_at || (id && sentVerIds[id]))) {
      const sentAt = r.sent_at || created
      events.push({
        at: sentAt,
        type: 'sent',
        label: `Sent ${kind}${name ? ` — ${name}` : ''}`,
        detail: name || null,
        report_id: id,
        kind,
      })
    }
  }

  if (role?.sent_at) {
    // Role-level Sent without a version row
    const hasVerSent = events.some(e => e.type === 'sent')
    if (!hasVerSent) {
      events.push({
        at: role.sent_at,
        type: 'sent',
        label: 'Sent (role marked)',
        detail: null,
        report_id: null,
        kind: 'role',
      })
    }
  }

  if (outcome && outcome.kind) {
    const bits = [outcome.kind]
    if (outcome.date) bits.push(outcome.date)
    if (outcome.kind === 'offer' && outcome.base != null) bits.push(`base ${outcome.base}`)
    events.push({
      at: outcome.at || (outcome.date ? `${outcome.date}T12:00:00Z` : null),
      type: 'outcome',
      label: `Outcome: ${bits.join(' · ')}`,
      detail: outcome.note || null,
      kind: outcome.kind,
    })
  }

  events.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0
    const tb = b.at ? Date.parse(b.at) : 0
    return ta - tb
  })

  const sent = events.filter(e => e.type === 'sent')
  const matches = events.filter(e => e.type === 'match')
  const outcomeEvent = events.find(e => e.type === 'outcome') || null
  const latestMatch = matches.length ? matches[matches.length - 1] : null
  const firstSent = sent.length ? sent[0] : null

  let answer = 'No Sent version or outcome recorded yet.'
  if (firstSent && outcomeEvent) {
    answer = `You sent ${firstSent.label.replace(/^Sent\s+/, '')}; outcome was ${outcomeEvent.kind}.`
  } else if (firstSent) {
    answer = `You sent ${firstSent.label.replace(/^Sent\s+/, '')}; no outcome recorded yet.`
  } else if (outcomeEvent) {
    answer = `Outcome ${outcomeEvent.kind} recorded; no Sent version on file.`
  } else if (latestMatch) {
    answer = `Latest match ${latestMatch.match_score}%; nothing marked Sent yet.`
  }

  return {
    events,
    summary: {
      answer,
      sent_count: sent.length,
      match_count: matches.length,
      latest_match: latestMatch ? latestMatch.match_score : null,
      outcome_kind: outcomeEvent ? outcomeEvent.kind : null,
      first_sent_at: firstSent?.at || null,
    },
  }
}

/** Compact HTML-safe lines for SPA paint (caller escapes). */
export function timelineLines(timeline) {
  const t = timeline || buildVersionTimeline({})
  return (t.events || []).map(e => ({
    at: e.at ? String(e.at).slice(0, 10) : '—',
    type: e.type,
    label: e.label,
    detail: e.detail,
  }))
}

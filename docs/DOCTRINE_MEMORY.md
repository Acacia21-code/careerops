# Bullet memory & resume sync doctrine

CareerOps Phase 1 locks these rules before schema or UI. They are non-negotiable.

## Category

CareerOps is an **open-source operating system for managing your career** — not “AI writes resumes.” Bullet memory is the compounding evidence asset between searches. Portfolio and advisor reuse the same truth loop.

## Provenance (not naive append-only)

| Field / concept | Rule |
| --- | --- |
| `body_original` | Immutable at create — answers “what did the user first write?” |
| `body_current` | Editable working text |
| `revisions` | JSONB array of `{ at, body, source: user \| polish_accept }` |
| Soft archive | `archived_at` (no hard delete in v1) |
| Status | `inbox` \| `ready` \| `promoted` \| `archived` (also `orphaned` when promote target disappears) |

CareerOps must always answer: **which user-written fact produced this resume bullet, and what did the original entry say?**

## Promotion — bidirectional

On the accomplishment:

- `promoted_role_id` (resume_struct role id / stable role key)
- `promoted_bullet_id`
- `promoted_at`
- `promotion_snapshot` (text of bullet at promote time)

On the resume bullet (`resume_struct.roles[].bullets[]` or `projects[]`):

```js
{ id, text, source_type: 'accomplishment' | 'portfolio', source_id: '<uuid>' }
```

Reparse/heal **preserves** `source_*` when matching by id or snapshot. If the role disappears, keep the source link and mark promotion `orphaned` for UI repair — never orphan silently.

## Resume synchronization — one canonical rule

**`resume_struct` is canonical** for structured editing. Promotion (memory or portfolio) goes through a **single write path** that:

1. Updates `resume_struct` (bullet + source links)
2. Regenerates or patches the corresponding Experience/Projects section in `resume_text` **atomically** in the same save
3. Sets `resume_struct_rev` / `structured_modified_at` so the UI never pretends text and struct are independent

If full round-trip render is imperfect for free-form resume text, show an explicit **“Structured resume modified — reconcile”** state. Never an optional checkbox that leaves dual truth to the user.

## Role linkage at capture

- Optional `role_id` → existing `resume_struct.roles[]` entry (preferred for promotion)
- Free-text `employer` / `project` for entries without a matching role
- Promotion UX prefers linked role; otherwise user picks a role before promote

## Generate retrieval (not newest-20)

Order of inclusion:

1. User-**checked** accomplishments
2. Entries **linked** to roles relevant to the target job
3. **Skill / semantic relevance** to JD + gaps (keyword overlap first)
4. **Recency only as tie-breaker**

Hard cap (e.g. 20) applies **after** ranking.

## AI polish provenance

Polish never silently replaces `body_current`:

- Keep `body_original` forever
- Show **diff**: current vs polished candidate
- Store candidate with `model` / provider when available
- User must **Accept** → writes `body_current` + revision (`source: polish_accept`)
- No changes to numbers, entities, scope, ownership, or outcomes; reject/warn if detected

## Cadence

Calendar-based (not elapsed-since-entry drift):

- `bullet_memory_cadence`: `biweekly` \| `monthly` \| `off`
- `cadence_timezone`, `cadence_anchor`
- `last_entry_at` — last **new capture** only (**promotion does not count**)
- `last_prompted_at`, `snoozed_until`

Nudge when cadence is due by calendar AND `now > snoozed_until` AND no entry in the current period.

## Portfolio & advisor

Same sync/provenance doctrine. Portfolio promotes into `resume_struct.projects[]` with `source_type: 'portfolio'`. Advisor briefs separate **Observed in your materials** from **Suggested next skills** (labeled market judgment) and use the same ranked selection — never newest-20. Grounded follow-ups live inside Advise (same inputs + doctrine); there is no standalone freeform chat. Follow-up exchanges append to the advisor artifact (`follow_ups` on `mt_reports.kind='advisor'`). Any wording suggested for reuse is draft-only until polish/Accept.

## Interview events

Interview rounds are durable facts about the search, not invented prep:

- Persist rounds (`role_id`, `round`, `scheduled_at`, `type`, `notes`, optional interviewer name) — survive refresh/devices
- Prep drafts are `mt_reports.kind='interview'` — recoverable, **copy-only** (never auto-send thank-you / follow-up)
- Follow-up due dates prefer real event dates when present
- Skill `interview` / `followup` read events + story bank; they do not invent interviewer bios or rounds the user did not record

## Structured offers

Offer comparison uses **user-entered** numbers only:

- Structured fields: `base`, `bonus`, `equity_notes`, `remote`, `deadline`, `currency`, free-text `note`
- Side-by-side compare is arithmetic/display over stored fields — never invent comp
- Posted band / target band / offer gaps are labeled as **data from materials or user input**, not “market average”
- Skill `outcome` reads/writes structured fields via board pack; no third-party salary fantasy DB in core doctrine

## Enrichment as inbox candidates (Accept)

GitHub / LinkedIn (and similar) enrichment follows polish/accept and accomplishment inbox:

- Fetch public metadata only where ToS-safe, or accept pasted source text
- Propose `mt_portfolio_items` / `mt_accomplishments` with `body_original` = source excerpt; status **inbox** until Accept
- Never auto-promote enrichment into `resume_struct`
- Never silent scrape into the live resume

## Explicitly deferred forever (unless doctrine changes)

Auto-apply; auto-send email; silent LinkedIn (or similar) scrape into resume; invented salary bands; ungated multi-agent writes of experience without accept.

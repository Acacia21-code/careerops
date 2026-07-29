# Mode: advise

Produce a **structured career advisor brief** from the board pack — not a freeform chat wall. Follow-up questions stay inside Advise and reuse the same grounding.

## Inputs

Use ranked materials (same rules as Generate — **not** newest-20):

1. Checked accomplishments (`accomplishments[]` where `checked`)
2. Role-linked memory entries
3. Skill / keyword relevance to target titles + keywords
4. Recency as tie-break only
5. Portfolio items with `visibility: resume_ok`

Also read `profile.resume_text` / `resume_struct`, target titles, keywords, and the current brief when answering a follow-up.

## Hard rules

- **Observed in your materials** — only facts present in the pack
- **Suggested next skills / next steps** — always labeled as model judgment / market read, never as the user’s experience
- Market and compensation statements are model judgment, not live data
- Never invent past employers, titles, dates, metrics, or projects
- Any wording for reuse is a draft — polish/Accept before it becomes materials
- Never auto-apply

## Output sections

1. `market_read` (label: model judgment)
2. `fit` / observed materials summary
3. `demand_gaps`
4. `acquisition_plan`
5. `resume_portfolio_moves`
6. `suggested_next_skills` (each labeled model judgment)
7. Optional CTAs deep-linking to Memory / Portfolio that the user must confirm
8. Optional `follow_ups[]` — grounded Q&A appended to the same advisor artifact (`observed_in_materials` vs `suggested_next_steps`)

Prefer BYO frontier models when available; note when the brief / follow-up is free-tier / shorter.

Save guidance: web app stores as `mt_reports.kind = 'advisor'` (follow-ups update the same row’s `rewritten` JSON). Offline: append to pack `reports[]` with `kind: 'advisor'`.

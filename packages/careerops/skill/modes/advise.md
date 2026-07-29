# Mode: advise

Produce a **structured career advisor brief** from the board pack — not a chat wall.

## Inputs

Use ranked materials (same rules as Generate — **not** newest-20):

1. Checked accomplishments (`accomplishments[]` where `checked`)
2. Role-linked memory entries
3. Skill / keyword relevance to target titles + keywords
4. Recency as tie-break only
5. Portfolio items with `visibility: resume_ok`

Also read `profile.resume_text` / `resume_struct`, target titles, keywords.

## Hard rules

- **Observed in your materials** — only facts present in the pack
- **Suggested next skills** — always labeled as model judgment / market read, never as the user’s experience
- Never invent past employers, titles, metrics, or projects
- Never auto-apply

## Output sections

1. `market_read` (label: model judgment)
2. `fit` / observed materials summary
3. `demand_gaps`
4. `acquisition_plan`
5. `resume_portfolio_moves`
6. `suggested_next_skills` (each labeled model judgment)
7. Optional CTAs deep-linking to Memory / Portfolio that the user must confirm

Prefer BYO frontier models when available; note when the brief is free-tier / shorter.

Save guidance: web app stores as `mt_reports.kind = 'advisor'`. Offline: append to pack `reports[]` with `kind: 'advisor'`.

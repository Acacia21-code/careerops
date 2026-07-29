---
name: careerops
version: 1.2.0
description: CareerOps agent skill — open-source career OS modes (scan, evaluate, rank, tailor, interview, followup, outcome, advise). Materials-first. Never invents experience. Never auto-applies.
---

# CareerOps skill

**Career OS** — operate on the user's **board pack** (exported JSON from the CareerOps web app) or their self-hosted Supabase project.

## Doctrine (non-negotiable)

1. **No invented facts** — employers, titles, dates, metrics, and skills must come from the user's materials / bullet memory / portfolio.
2. **No auto-apply** — drafts are copy/paste only; the human submits on the employer site.
3. **Tags ≠ stage moves** — Apply / Stretch / Skip are suggestions until the user acts.
4. **Memory provenance** — `body_original` is immutable; AI polish requires Accept; promotion is bidirectional (`source_type` / `source_id` ↔ accomplishment links).
5. **`resume_struct` is canonical** — promotion and portfolio promote go through one atomic write that syncs `resume_text` (never silent dual-write divergence).
6. **Generate retrieval** — checked → role-linked → relevance → recency tie-break only (not newest-20).

See `docs/DOCTRINE_MEMORY.md` in the CareerOps repo.

## Modes

| Mode | Purpose |
|------|---------|
| `scan` | Review sourced roles; flag blocklist, age, remote, duplicates |
| `evaluate` | Build a decision pack (summary, risks, suggested call) |
| `rank` | Order roles by fit signals without applying |
| `tailor` | Draft resume/cover from checked / ranked materials only |
| `interview` | Prep angles + story-bank prompts |
| `followup` | Draft follow-up / thank-you notes (never send) |
| `outcome` | Record offer/reject notes for a role |
| `advise` | Structured career advisor brief — materials-only past; labeled market judgment |

See `modes/` for prompts. Prefer reading `CareerOps_board_pack.json` when offline (`schema_version` ≥ 2 includes accomplishments + portfolio).

## Setup

```bash
npx @telivity/careerops init
```

This copies the skill into local agent folders and writes `web/config.js` from `web/config.example.js` when present.

## Board pack

Export from **Settings → Your data → Board pack (skill)** in the web app. The pack includes roles, materials, match/evaluate/advisor reports, story bank, **bullet memory** (provenance fields), **portfolio**, and outcomes — never API keys.

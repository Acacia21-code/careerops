# CareerOps web app

Static SPA for the job-search dashboard.

## Configure

```bash
cp config.example.js config.js
```

Set:

- `supabaseUrl` — your Supabase project URL  
- `supabaseAnonKey` — anon or publishable key (safe for browser; protect data with RLS)  
- `donateUrl` — optional  
- `analyticsId` — optional Google Analytics Measurement ID (for example `G-XXXXXXXXXX`). Leave empty to disable analytics.

`config.js` is gitignored in the public repo.

### Google Analytics (optional)

To enable Google Analytics on your deployment, set `analyticsId` in `web/config.js`.

If `analyticsId` is left empty, no Google Analytics script is loaded.

## Deploy

From repo root:

```bash
./scripts/deploy-web.sh
```

Or from this folder: `npx vercel deploy --prod`

## Schema

Point the app at a Supabase project that has the CareerOps tables (`mt_roles`, `mt_profiles`, `mt_reports`, `mt_accomplishments`, `mt_portfolio_items`, `mt_outcomes`, `mt_interview_events`, `mt_contacts`, …) and auth. Apply `supabase/schema.sql` or Phase 1–3 migrations under `supabase/migrations/`. Use your own project — do not reuse someone else’s demo credentials.

SPA table/bucket cheat-sheet (client-derived): [SCHEMA.md](SCHEMA.md).

Pure Career OS helpers used by the SPA live in `lib/` (bullet memory, cadence, ranking, resume sync, board pack, portfolio, advisor, career durability, interview events, offer compare, version timeline, contacts CRM, ATS comp, salary compare, enrich inbox) and are covered by `npm run test:career-os`.

### Export / import

- **Board pack** (`CareerOps_board_pack.json`) — skill modes + Settings import (upsert). Schema v5 adds contacts, posted `comp_range`/`comp_raw`, and profile target band. API keys never exported or imported.
- **Full JSON** / **CSV** — Settings → Your data.

## Edge functions

> **Source note:** the implementations of these functions are **not included in this public repo**. `web/ui/state.mjs` calls them by name via `sb.functions.invoke(...)`, assuming a Supabase project with matching Edge Functions deployed. If you're self-hosting, you'll need to write and deploy your own implementations (or point at a hosted backend that provides them) — see `web/config.js` for wiring the Supabase URL/anon key.

| Function | When the UI calls it | Required for a board-only install? |
|---|---|---|
| `run-search-mt` | User clicks **Run job search** (or the onboarding "Run my first search") — scans configured company career boards for matching roles. | **Optional.** Board CRUD works without it; you can add roles manually via **＋ Add role**. |
| `fetch-jd` | Auto-loads a job description from a posting URL — when opening a role's drawer/panel, on ATS "liveness" checks for a card, and after adding a role via LinkedIn/URL search. | **Optional.** You can paste the JD manually via "Edit / paste" instead. |
| `resume-match` | User clicks **Check my match** to score a resume against a JD. | **Optional if** a BYO OpenAI-compatible key is set in Settings (the match runs client-side instead). **Required** for match scoring otherwise. |
| `resume-rewrite` | **Tailor resume**, cover letter, and single-bullet rewrite actions. | Same as above — optional with a BYO key, otherwise required for AI tailoring. |
| `chat` | The in-app AI chat / advisor brief. | Same bypass logic — optional with a BYO key, otherwise required for chat/advisor. |
| `ai-free` | Settings screen, to show remaining free-tier daily uses. | **Optional** — cosmetic only; affects the usage display, not functionality. |
| `humanize` | **Humanize wording** button. | **Optional** — only used if the user has connected an ai-text-humanizer.com account. |

**Minimal viable install:** none of the 7 functions are strictly required. Core board operations (add/drag/tag roles, verdicts, outcomes, notes) call Supabase tables directly (`sb.from('mt_roles')`, etc.), not Edge Functions. Search and JD auto-fetch need `run-search-mt` / `fetch-jd`; AI scoring/tailoring/chat need the rest (or a BYO key to skip them entirely)
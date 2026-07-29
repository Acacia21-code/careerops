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

`config.js` is gitignored in the public repo.

## Deploy

From repo root:

```bash
./scripts/deploy-web.sh
```

Or from this folder: `npx vercel deploy --prod`

## Schema

Point the app at a Supabase project that has the CareerOps tables (`mt_roles`, `mt_profiles`, `mt_reports`, `mt_accomplishments`, `mt_portfolio_items`, `mt_outcomes`, `mt_interview_events`, `mt_contacts`, …) and auth. Apply `supabase/schema.sql` or Phase 1–3 migrations under `supabase/migrations/`. Use your own project — do not reuse someone else’s demo credentials.

Pure Career OS helpers used by the SPA live in `lib/` (bullet memory, cadence, ranking, resume sync, board pack, portfolio, advisor, career durability, interview events, offer compare, version timeline, contacts CRM, ATS comp, salary compare, enrich inbox) and are covered by `npm run test:career-os`.

### Export / import

- **Board pack** (`CareerOps_board_pack.json`) — skill modes + Settings import (upsert). Schema v5 adds contacts, posted `comp_range`/`comp_raw`, and profile target band. API keys never exported or imported.
- **Full JSON** / **CSV** — Settings → Your data.

# Supabase (self-host)

1. Apply [`schema.sql`](schema.sql) in the SQL editor (fresh project), **or** apply migrations under [`migrations/`](migrations/) on an existing project — including Phase 1 (`20260729_career_os_phase1.sql`), durability (`20260729_career_os_durability.sql` / `_app_schema.sql`), Phase 2 interview/offers, and Phase 3 contacts + posted-comp/target-band (`20260729_career_os_phase3_contacts.sql` / `_app_schema.sql`, `20260729_career_os_phase3_comp_salary.sql` / `_app_schema.sql`).  
2. Deploy functions under [`functions/`](functions/) (`npm run deploy:functions`).  
3. Optional: seed search boards from [`boards.example.json`](boards.example.json) into `mt_profiles.ats_boards`.

See [`functions/README.md`](functions/README.md) for secrets and auth model.

## Board pack formats (self-hosters)

| Format | File | Contents |
|--------|------|----------|
| Board pack (skill) | `CareerOps_board_pack.json` | Sanitized profile (no keys), roles (incl. `comp_range`/`comp_raw`), materials, reports, accomplishments, portfolio, contacts, outcomes, interview events, stories, find prefs. `schema_version` 5. |
| Full JSON export | `CareerOps_export.json` | Profile + roles + reports (still strips AI keys on export). |
| Board CSV | `CareerOps_board.csv` | Flat role columns for spreadsheets. |

Import board pack from Settings → upserts by stable id. Keys are never imported.

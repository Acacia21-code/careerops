# Supabase (self-host)

1. Apply [`schema.sql`](schema.sql) in the SQL editor (fresh project), **or** apply migrations under [`migrations/`](migrations/) on an existing project — including `20260729_career_os_phase1.sql` for bullet memory, portfolio, cadence columns, and advisor-friendly reports.  
2. Deploy functions under [`functions/`](functions/) (`npm run deploy:functions`).  
3. Optional: seed search boards from [`boards.example.json`](boards.example.json) into `mt_profiles.ats_boards`.

See [`functions/README.md`](functions/README.md) for secrets and auth model.

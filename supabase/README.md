# Supabase (self-host)

1. Apply [`schema.sql`](schema.sql) in the SQL editor.  
2. Deploy functions under [`functions/`](functions/) (`npm run deploy:functions`).  
3. Optional: seed search boards from [`boards.example.json`](boards.example.json) into `mt_profiles.ats_boards`.

See [`functions/README.md`](functions/README.md) for secrets and auth model.

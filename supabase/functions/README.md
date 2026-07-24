# Supabase Edge Functions (CareerOps)

TypeScript edge functions the dashboard SPA invokes for match, tailor, chat, free AI, and configurable ATS search.

## Functions

| Function | Purpose |
|----------|---------|
| `resume-match` | Recruiter-style fit score (BYO keys → free tier → keyword overlap) |
| `resume-rewrite` | Tailor résumé / cover / single bullet (truthful; never invents) |
| `chat` | Board-aware assistant |
| `ai-free` | Shared free-tier LLM proxy (env `FREE_AI_*`) |
| `run-search-mt` | Scan user-configured Greenhouse / Ashby / Lever boards |

## Auth model

- Caller sends the user’s Supabase JWT (`Authorization: Bearer …`).
- Functions read BYO keys from `mt_profiles` (`ai_key`, `kimi_key`) for that user.
- Free tier uses project secrets, not the user’s keys.

## Environment / secrets

Set on the Supabase project (Dashboard → Edge Functions → Secrets, or CLI):

| Secret | Used by |
|--------|---------|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | All (usually auto-injected) |
| `SUPABASE_SERVICE_ROLE_KEY` | `ai-free` optional config table read |
| `FREE_AI_ENDPOINT` | OpenAI-compatible base URL (no trailing slash path beyond `/v1`) |
| `FREE_AI_TOKEN` | Bearer token for free tier |
| `FREE_AI_MODEL` | Model id |
| `FREE_AI_ALLOW` | `*` (all users) or comma-separated user UUIDs |

## Deploy

```bash
# once: link your project
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF

npm run deploy:functions
# or individually:
npx supabase functions deploy resume-rewrite
npx supabase functions deploy resume-match
npx supabase functions deploy chat
npx supabase functions deploy ai-free
npx supabase functions deploy run-search-mt
```

Apply [`../schema.sql`](../schema.sql) before first use. Copy [`../boards.example.json`](../boards.example.json) into profile `ats_boards` (or pass `body.boards`) to customize search.

These sources are the **reference** implementation for self-host. Production project credentials stay private.

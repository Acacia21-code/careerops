# Supabase Edge Functions (CareerOps)

TypeScript edge functions the dashboard SPA invokes for match, tailor, Advise follow-ups (via `chat`), free AI, configurable ATS search, and provider-secret vault RPCs.

## Functions

| Function | Purpose |
|----------|---------|
| `resume-match` | Recruiter-style fit score (BYO keys → free tier → keyword overlap) |
| `resume-rewrite` | Tailor résumé / cover / single bullet (truthful; never invents) |
| `chat` | Frontier invoke path for Advise (brief + grounded follow-ups); not a freeform chat UI |
| `ai-free` | Shared free-tier LLM proxy (env `FREE_AI_*`) |
| `run-search-mt` | Scan user-configured Greenhouse / Ashby / Lever boards |
| `upsert_provider_secret` | Write-only: store Claude / Kimi / humanizer secret (vault or plaintext) |
| `clear_provider_secret` | Write-only: delete a provider secret |

Shared crypto/load helpers live in [`_shared/credentials.ts`](_shared/credentials.ts).

## Auth model

- Caller sends the user’s Supabase JWT (`Authorization: Bearer …`).
- Functions that need BYO keys decrypt server-side via `loadProviderSecrets` (vault first, plaintext profile fallback). **Decrypted secrets are never returned to the browser.**
- Free tier uses project secrets, not the user’s keys.
- Settings UI shows “key on file” from `*_on_file` flags (or self-host plaintext presence).

## Environment / secrets

Set on the Supabase project (Dashboard → Edge Functions → Secrets, or CLI):

| Secret | Used by |
|--------|---------|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | All (usually auto-injected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vault read/write, `ai-free` optional config table read |
| `CREDENTIALS_KEK` | AES-256-GCM key material (passphrase or 32-byte base64). When set, provider secrets are encrypted in `mt_provider_secrets`. When unset, self-host plaintext profile columns are used. |
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
npx supabase functions deploy upsert_provider_secret
npx supabase functions deploy clear_provider_secret
```

Apply [`../schema.sql`](../schema.sql) (or migrations including `20260729_credential_vault*.sql`) before first use. Copy [`../boards.example.json`](../boards.example.json) into profile `ats_boards` (or pass `body.boards`) to customize search.

These sources are the **reference** implementation for self-host. Production project credentials stay private.

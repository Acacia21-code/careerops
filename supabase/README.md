# Supabase (self-host)

1. Apply [`schema.sql`](schema.sql) in the SQL editor (fresh project), **or** apply migrations under [`migrations/`](migrations/) on an existing project — including Phase 1 (`20260729_career_os_phase1.sql`), durability (`20260729_career_os_durability.sql` / `_app_schema.sql`), Phase 2 interview/offers, Phase 3 contacts + posted-comp/target-band, schema hardening, promote RPC, and **credential vault** (`20260729_credential_vault.sql` / `_app_schema.sql`).  
2. Deploy functions under [`functions/`](functions/) (`npm run deploy:functions`).  
3. Optional: seed search boards from [`boards.example.json`](boards.example.json) into `mt_profiles.ats_boards`.

See [`functions/README.md`](functions/README.md) for secrets and auth model.

## Provider secrets (vault vs plaintext)

| Mode | When | Where secrets live | Client sees |
|------|------|--------------------|-------------|
| **Simple self-host** | `CREDENTIALS_KEK` unset | Plaintext `mt_profiles.ai_key` / `kimi_key` / `humanizer_pw` / `humanizer_email` | Values (RLS owner-only). Explicit tradeoff for easier setup. |
| **Vault (hosted / hardened)** | Edge secret `CREDENTIALS_KEK` set | AES-GCM rows in `mt_provider_secrets` (service-role only) | Presence flags only (`*_on_file`). Never decrypted values. |

- Canonical password column name is **`humanizer_pw`** (legacy `humanizer_pass` is copied forward if present; do not add new `humanizer_pass` usage).
- Settings writes secrets via edge RPCs `upsert_provider_secret` / `clear_provider_secret`.
- **Encrypt-in-place is not done in SQL migrations** — the KEK lives in edge secrets and is unavailable in CI. With KEK configured, edge `loadProviderSecrets` lazily migrates leftover plaintext into the vault and clears profile columns. Until then, re-enter keys in Settings after enabling the vault if you cleared plaintext manually.
- Hosted (`*_app_schema` migration) replaces `public.mt_profiles` with a view that **omits** secret columns so anon/authenticated clients cannot SELECT them.

## Board pack formats (self-hosters)

| Format | File | Contents |
|--------|------|----------|
| Board pack (skill) | `CareerOps_board_pack.json` | Sanitized profile (no keys), roles (incl. `comp_range`/`comp_raw`), materials, reports, accomplishments, portfolio, contacts, outcomes, interview events, stories, find prefs. `schema_version` 5. |
| Full JSON export | `CareerOps_export.json` | Profile + roles + reports (still strips AI keys on export). |
| Board CSV | `CareerOps_board.csv` | Flat role columns for spreadsheets. |

Import board pack from Settings → upserts by stable id. Keys are never imported.

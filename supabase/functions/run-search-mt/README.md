# Deploy (placeholder tokens only)

```bash
npx supabase functions deploy run-search-mt --project-ref YOUR_PROJECT_REF
# Access token example shape (never commit a real one): sbp_xxxxxxxx
```

Configure boards via profile `ats_boards`, request `body.boards`, or the bundled [`boards.default.json`](./boards.default.json) (90+ verified public ATS boards).

Pass Find hygiene on invoke:

```js
sb.functions.invoke('run-search-mt', {
  body: { blocklist: ['Acme'], remote_pref: 'remote_only', max_age_days: 30 }
})
```

Server skips blocklisted companies and dedupes by URL + company/title fingerprint before insert.

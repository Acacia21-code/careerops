# CareerOps roadmap

Phase 1 (live on careerops.telivity.app): bullet memory with provenance, portfolio, career advisor, ranked Generate, board-pack v2 — see [DOCTRINE_MEMORY.md](DOCTRINE_MEMORY.md).

Phases 2–4 turn the **search pipeline** into a durable operating system without becoming another spammy AI job tool.

**Doctrine (unchanged):** no invented experience; no auto-apply / no auto-send; AI polish only with accept; labeled market/salary judgment; enrichment lands as inbox candidates. See [DOCTRINE_MEMORY.md](DOCTRINE_MEMORY.md).

Reuse Phase 1: `mt_reports` kinds, resume sync, board pack, accomplishment inbox/accept, skill modes (`interview`, `followup`, `outcome`, `advise`).

---

## Prerequisite — durability (shipped)

Move browser-local career truth into Supabase so analytics and multi-device work. Without this, Phase 2 analytics lie.

**Ship (done):**
- Outcomes, story bank, and Sent / version display metadata synced to Supabase with RLS
- Local fallback when offline / unauthenticated
- One-time migrate from existing `localStorage` data
- Board pack **`schema_version` 3** — durable outcomes, Sent markers, version display names, stories

**Acceptance:** refresh and multi-device see the same Sent flags, outcomes, and story bank; pack export/import round-trips them.

---

## Phase 2 — Decide / Interview / Offer depth

Goal: make the kanban’s right half as serious as Find → Write.

**Order:** durability (done) → interview events → offer schema/UI → version analytics (analytics needs Sent + outcomes in DB).

### 2.1 Resume version analytics

**Today:** append-only `mt_reports` resume/cover/match + Sent freeze; no outcome join in the builder.

**Ship:**
- Sent markers + version display names already in DB / pack (durability)
- Per-role **version timeline**: match score over time, which version was Sent, linked outcome
- One “What shipped” panel in builder/drawer — no ML, no A/B magic

**Out of scope:** A/B testing frameworks, auto-picking a “winning” resume version.

**Acceptance:** user can answer “which resume version did I send, and did that role convert?”

### 2.2 Interview tracking

**Today:** `interview` stage, ~14d follow-up strip, ephemeral prep drafts, story bank, skill `interview` / `followup`.

**Ship:**
- Table `mt_interview_events`: `role_id`, `round`, `scheduled_at`, `type` (screen / onsite / loop / …), `notes`, optional interviewer name
- Drawer: add/edit rounds; persist prep drafts as `mt_reports.kind='interview'`
- Follow-up due strip reads real event dates when present
- Board pack carries interview events (further schema bump after v3)

**Out of scope:** calendar OAuth, auto-send thank-you mail, invented interviewer bios.

**Acceptance:** rounds survive refresh/devices; prep is recoverable; still copy-only drafts.

### 2.3 Offer comparison

**Today:** `offer` stage + unstructured outcome notes.

**Ship:**
- Structured outcome/offer fields: `base`, `bonus`, `equity_notes`, `remote`, `deadline`, `currency`, free-text `note`
- Side-by-side compare for 2–3 roles in Offer (and saved outcomes)
- Skill `outcome` reads/writes structured fields via board pack

**Out of scope:** invented comp numbers, third-party salary APIs.

**Acceptance:** compare two offers without a spreadsheet; no invented comp numbers.

**Phase 2 done when:** track interview rounds, compare offers, see which resume version was Sent and what happened.

---

## Phase 3 — Network, ATS I/O, honest comp

Goal: expand surface without violating no-send / no-invent.

**Order:** contacts table → `comp_range` on roles + pack import → target band compare UI.

### 3.1 Recruiter CRM (no integrations that send)

**Today:** Conversation stage, outreach/email *drafts* only.

**Ship:**
- `mt_contacts`: name, channel, company, linked `role_id`(s), `last_touch_at`, notes
- Log touches when user copies outreach/email (explicit “Log touch”)
- Simple contact list filtered by role/company

**Out of scope:** Gmail/Outlook OAuth, auto-send, sequences. “Integrations” here means draft + log, not mailbox sync.

### 3.2 ATS import/export

**Today:** strong Find scrape + CSV/JSON/board-pack export; weak structured re-import.

**Ship:**
- Board-pack **import** upserts roles/materials/accomplishments/portfolio (keys never imported) — schema migrator already started in v2+
- Persist optional `comp_range` / `comp_raw` on `mt_roles` from boards that expose it
- Document export formats for self-hosters

**Out of scope:** applying into employer ATS; application-status webhooks.

### 3.3 Salary intelligence (posted truth, not a market fantasy DB)

**Today:** materials-only negotiation draft; salary noise stripped from match keywords.

**Ship:**
- Show stored posted band on cards/drawer when present
- User **target band** on profile
- Compare posted vs target vs structured offer — label gaps as data, not “market average”
- Advisor/chat may discuss negotiation only from these numbers + user notes

**Out of scope:** third-party salary API in v1 (paid, noisy, invents confidence). Revisit later as optional plugin.

**Phase 3 done when:** remember recruiters, import/export full career pack, see posted pay vs your target.

---

## Phase 4 — Enrichment, extensibility, multi-agent

Goal: OSS-power-user leverage without silent claim invention.

**Order:** enrichment inbox (reuses Phase 1 accept UX) → pack/plugin registry → mode chains.

### 4.1 GitHub / LinkedIn enrichment (user-confirmed)

**Pattern:** same as polish/accept and accomplishment inbox.

**Ship:**
- Paste GitHub repo or LinkedIn profile/job URL → fetch public metadata only where ToS-safe (or client-side paste of README/About text if fetch blocked)
- Propose `mt_portfolio_items` / `mt_accomplishments` candidates with `body_original` = source excerpt; status inbox until Accept
- Never auto-promote into `resume_struct`

**Out of scope:** silent scrape into resume; auto-promote enrichment.

### 4.2 Plugin system (hooks, not a browser extension)

**Today:** swappable `ats_boards`; npm skill init.

**Ship:**
- Documented extension points: board source adapters, `mt_reports` kind handlers, board-pack schema plugins
- Small registry in SPA/edge (function map + manifest JSON) — bump pack `schema_version` as needed
- Example plugin: extra board pack or custom report renderer

**Out of scope:** Chrome extension, arbitrary code upload in hosted demo.

### 4.3 Multi-agent workflows (mode chains)

**Today:** discrete skill modes + single chat.

**Ship:**
- Declared **mode chains** (e.g. `evaluate → rank → interview`) over one board pack
- Each step writes `mt_reports`; **human confirm** gate between steps
- CLI / skill surface: `careerops run-chain <name>` reading/writing pack only

**Out of scope:** autonomous apply, unsupervised parallel agents inventing bullets.

**Phase 4 done when:** confirm GitHub/LinkedIn suggestions into memory/portfolio; extend boards/reports; run gated mode pipelines.

---

## Explicitly deferred forever (unless doctrine changes)

- Auto-apply
- Auto-send email
- Silent LinkedIn (or similar) scrape into resume
- Invented salary bands
- Opaque / ungated multi-agent that writes experience without accept

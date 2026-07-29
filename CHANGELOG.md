# Changelog

All notable changes to the public CareerOps repo and `@telivity/careerops` are documented here.

## [1.2.1] — 2026-07-29

### Added
- Engineering-10 hardening: schema CHECKs + `updated_at` triggers, transactional promote RPCs, hosted credential vault, SPA `web/ui/*` split, Board / Memory / Portfolio / Advise section nav, pg-integration + Playwright memory-promote CI.
- Conversion README homepage: hook, hero GIF, quick start, 30-second story, Why not ChatGPT table, career-loop mermaid, Built for, collapsed demo gallery.
- Public-safe demo assets under [`docs/assets/`](docs/assets/) (GIFs + stills from a seeded fictional profile).

### Docs
- Removed the old “drop screenshots later” placeholder; Roadmap linked to [`docs/ROADMAP.md`](docs/ROADMAP.md).

## [1.2.0] — 2026-07-29

### Added
- Bullet memory with provenance (`body_original` immutable, revisions, soft archive, bidirectional promote).
- Portfolio library (code/design/product) under the same sync/provenance rules.
- Career advisor brief + skill mode `advise` (materials-only past; labeled market judgment).
- Grounded Advise follow-ups (ranked materials; observed vs suggested next steps; persisted on `mt_reports.kind='advisor'`). Standalone freeform Chat surface removed.
- Calendar cadence nudges; ranked Generate selection (checked → role-linked → relevance → recency).
- Board pack `schema_version` 2 with accomplishments/portfolio round-trip tests.
- Doctrine: [docs/DOCTRINE_MEMORY.md](docs/DOCTRINE_MEMORY.md); roadmap Phases 2–4 in [docs/ROADMAP.md](docs/ROADMAP.md).

## [1.1.0] — 2026-07-24

### Added
- `@telivity/careerops` CLI: `npx @telivity/careerops init` installs the Open Agent Skill (scan / evaluate / rank / tailor / interview / followup / outcome) and optionally wires `web/config.js`.
- Web dashboard: Find hygiene (blocklist, max posting age, remote preference), Sourced triage, drawer evaluate pack, builder section locks / Review draft / Sent freeze, OpenAI-compatible BYO keys, Board pack export.
- Smoke tests (`npm test`) for critical control IDs + doctrine strings; GitHub Actions smoke on PR.
- Release workflow: tagging `v*` can publish to npm when `NPM_TOKEN` is configured.

### Fixed
- Builder Generate now surfaces errors in the builder (not only the hidden drawer), always sends resume materials, and keeps a successful draft even if version history insert fails.
- Brand UI uses the full Telivity palette (teal primary CTA + navy / orange / gold secondary chrome) instead of teal-on-white only.

### Docs
- Neutral public README “What you get” covering Find → Decide → Write → BYO / skill — no competitor narrative.

## [0.1.0] — 2026-07-24

- Initial npm package publish (superseded by 1.1.0).

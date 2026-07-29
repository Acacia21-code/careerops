# CareerOps

## Everything you need to manage your career. Nothing you don’t.

A local-first Career Operating System that remembers your accomplishments, tailors resumes from real evidence, prepares interviews, tracks applications, compares offers, and keeps your career data under your control.

[Live Demo](https://careerops.telivity.app) · [Quick Start](#quick-start) · [Docs](docs/)

![Memory → Promote → Resume → Interview](docs/assets/memory-promote.gif)

*Memory → Promote → Resume → Interview*

Apache 2.0 · Local-first · Self-host · AI-assisted · No subscriptions

---

## Product journey

### 1. Remember what you actually did

Capture accomplishments while they’re fresh. Originals stay immutable; you promote what belongs on a resume when you’re ready.

![Bullet Memory → Promote](docs/assets/memory-promote.gif)

### 2. Run your job search

Fill a kanban from public ATS boards (or add roles yourself). Triage, track stages, and keep the search in one place—not a spreadsheet.

![Application board](docs/assets/application-board.gif)

### 3. Tailor resumes from evidence

Generate drafts from ranked, user-authored memory—not invented metrics. Edit, version, export, then you apply on the employer site.

![Tailor from evidence](docs/assets/tailor-resume.gif)

### 4. Prepare interviews

Pull interview angles from the same story bank and evidence you already captured—no blank-page prep before every round.

![Interview prep](docs/assets/interview-prep.gif)

### 5. Compare offers

Side-by-side comparison of terms you enter. Decide with structure, not scattered notes.

![Offer compare](docs/assets/offer-compare.gif)

### 6. Build your portfolio

Promote work into projects and portfolio evidence from the same memory you use for resumes and interviews.

![Bullet memory & portfolio evidence](docs/assets/bullet-memory.png)

### The Career Loop

```mermaid
flowchart LR
  Work --> Capture --> Promote --> Tailor --> Interview --> Offer --> Work
```

Capture while you work. Promote into structured history. Tailor for a real JD. Prep interviews from the same facts. Compare offers. Start the next loop with memory already built.

---

## Why CareerOps instead of another job search tool?

| Instead of… | CareerOps |
|-------------|-----------|
| Resume builders | Remembers your entire career, not just one document |
| Job trackers | Stores accomplishments, interview history, offers, contacts, portfolio, and applications in one place |
| AI resume generators | Only uses user-authored evidence. AI rewrites, never invents. |
| Cloud SaaS | Local-first. You own your data. |
| Monthly subscriptions | Apache 2.0. Self-host. No lock-in. |
| Multiple disconnected apps | One career operating system. |

> CareerOps isn’t another AI resume builder or job tracker. It’s the system you keep using between job searches so your next search starts with years of organized evidence instead of a blank page.

### Category check

| | CareerOps | Typical Job Tracker |
|--|-----------|---------------------|
| Local-first | Yes | No |
| Open source | Yes | No |
| Own your data | Yes | Often limited |
| Bullet memory / provenance | Yes | No |
| AI invents accomplishments | No | Often |
| Self-host | Yes | No |
| Forever free | Yes | No |

You apply on the employer site. CareerOps does **not** auto-apply.

---

## Why people switch

**“I forgot what I shipped six months ago.”**  
CareerOps had already saved it.

**“I had seven resume versions in Google Drive.”**  
CareerOps generated them from one source of truth.

**“I was paying for three different job search tools.”**  
CareerOps replaced them with one local-first application.

---

## Quick Start

```bash
npx @telivity/careerops init
```

≈5 minutes. Done.

Self-host, schema, deploy, and agent skill details: [docs/](docs/) · [CONTRIBUTING.md](CONTRIBUTING.md) · [web/README.md](web/README.md)

---

## Architecture & Engineering

Technical depth lives in `docs/` — not on the critical path for starring or trying the product.

| Topic | Doc |
|-------|-----|
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Security model | [SECURITY.md](SECURITY.md) · [supabase/README.md](supabase/README.md) |
| Resume provenance | [docs/DOCTRINE_MEMORY.md](docs/DOCTRINE_MEMORY.md) |
| Transactional promotion | [docs/DOCTRINE_MEMORY.md](docs/DOCTRINE_MEMORY.md#promotion--bidirectional) |
| Database schema | [supabase/README.md](supabase/README.md) · [`supabase/schema.sql`](supabase/schema.sql) |
| Plugin system | [docs/PLUGINS.md](docs/PLUGINS.md) |
| AI architecture / skill | [docs/SKILL.md](docs/SKILL.md) · [docs/CHAINS.md](docs/CHAINS.md) |
| Local-first design | [docs/LOCAL_FIRST.md](docs/LOCAL_FIRST.md) |
| Privacy model | [docs/PRIVACY.md](docs/PRIVACY.md) |
| Roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |

<details>
<summary>Repo map (optional)</summary>

| Path | Purpose |
|------|---------|
| `web/` | Dashboard SPA |
| `supabase/functions/` | Edge functions |
| `supabase/schema.sql` | Tables + RLS |
| `training/` | Optional train/eval *code* |
| `.agents/skills/careerops/` | Open Agent Skill |
| `packages/careerops` | `npx @telivity/careerops init` |

</details>

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Community norms: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Releases: [CHANGELOG.md](CHANGELOG.md).

---

## License

Copyright © Telivity and contributors.  
Licensed under the [Apache License, Version 2.0](LICENSE).

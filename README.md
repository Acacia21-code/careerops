# CareerOps

Replace your resume builder, job tracker, interview notes, accomplishment journal, and offer spreadsheet with one local-first application.

For engineers, PMs, designers, and anyone else who wants a durable record of their work—not another document generator.

[Live Demo](https://careerops.telivity.app) · [Quick Start](#quick-start)

![Memory → Promote → Resume → Interview](docs/assets/memory-promote.gif)

*Memory → Promote → Resume → Interview*

Apache 2.0 · Local-first · Self-host · AI-assisted · No subscriptions

---

## How it works

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

```mermaid
flowchart LR
  Work --> Capture --> Promote --> Tailor --> Interview --> Offer --> Work
```

Capture while you work. Promote into structured history. Tailor for a real JD. Prep interviews from the same facts. Compare offers. Start the next loop with memory already built.

---

## Why use CareerOps instead of Teal, Huntr, Simplify, or AI resume builders?

| | CareerOps | Typical alternatives |
|--|-----------|----------------------|
| Data model | Local-first; you own your data | Cloud SaaS |
| License | Open source (Apache 2.0) | Proprietary |
| Evidence | User-authored accomplishments only; AI rewrites, never invents | AI-generated claims common |
| Persistence | Accomplishment history you keep between searches | One-off document generation |
| Scope | Memory, board, resumes, interviews, offers, portfolio in one app | Multiple disconnected tools |

You apply on the employer site. CareerOps does **not** auto-apply.

That’s why we call it a Career Operating System. CareerOps is the system you keep between job searches so your next search starts with years of organized evidence instead of a blank page.

---

## Quick Start

```bash
npx @telivity/careerops init
```

≈5 minutes. Done.

Self-host, schema, deploy, and agent skill details: [docs/](docs/) · [CONTRIBUTING.md](CONTRIBUTING.md) · [web/README.md](web/README.md)

---

## Why people switch

**“I forgot what I shipped six months ago.”**  
CareerOps had already saved it.

**“I had seven resume versions in Google Drive.”**  
CareerOps generated them from one source of truth.

**“I was paying for three different job search tools.”**  
CareerOps replaced them with one local-first application.

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

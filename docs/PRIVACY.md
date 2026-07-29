# Privacy model

CareerOps treats career data as yours.

- **Evidence stays user-authored.** AI may rewrite wording you provided; it must not invent employers, titles, metrics, or education. Doctrine: [DOCTRINE_MEMORY.md](DOCTRINE_MEMORY.md).
- **Secrets stay out of packs.** Board pack / export strips API keys. Import never writes keys.
- **Hosted vault (optional).** With `CREDENTIALS_KEK`, provider secrets live in a service-role vault — clients see presence flags only. Details: [supabase/README.md](../supabase/README.md).
- **Training hygiene.** Never commit real résumés or personal eval sets; see [training/README.md](../training/README.md).
- **Vulnerabilities.** Report privately via [SECURITY.md](../SECURITY.md).

Demo screenshots and GIFs use a seeded fictional profile — not live user data.

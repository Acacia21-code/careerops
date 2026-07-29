#!/usr/bin/env bash
# Deploy the CareerOps dashboard (web/) to Vercel in one command.
#
# web/config.js is optional. The shipped SPA inlines Supabase URL/anon key in
# web/ui/state.mjs and does not load config.js. Keep config.js only if you are
# self-hosting with local overrides (see web/config.example.js); it stays
# gitignored and is never required for this deploy path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
cd "$WEB"
if [[ -f config.js ]]; then
  echo "Note: web/config.js present (optional self-host override; not required for deploy)."
fi
if ! command -v npx >/dev/null; then
  echo "Need Node/npx installed"
  exit 1
fi
echo "Deploying web/ to Vercel (production)…"
npx --yes vercel deploy --prod --yes
echo "Done."

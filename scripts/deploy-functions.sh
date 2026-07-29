#!/usr/bin/env bash
# Deploy CareerOps edge functions to a linked Supabase project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f .sb_token ]]; then
  echo "Refusing to read .sb_token (gitignored secret). Export SUPABASE_ACCESS_TOKEN instead."
  exit 1
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_ACCESS_TOKEN."
  echo "  npx supabase login"
  echo "  # or: export SUPABASE_ACCESS_TOKEN=sbp_…"
  exit 1
fi

if [[ ! -d supabase/functions/resume-rewrite ]]; then
  echo "Missing supabase/functions — clone a complete CareerOps tree."
  exit 1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" && -f supabase/.temp/project-ref ]]; then
  echo "Found supabase/.temp/project-ref (local link). Prefer: export SUPABASE_PROJECT_REF=…"
  PROJECT_REF="$(cat supabase/.temp/project-ref)"
fi

FNS=(resume-rewrite resume-match chat ai-free run-search-mt upsert_provider_secret clear_provider_secret)
echo "Deploying edge functions: ${FNS[*]}"

for fn in "${FNS[@]}"; do
  echo "▶ $fn"
  if [[ -n "$PROJECT_REF" ]]; then
    npx --yes supabase@2 functions deploy "$fn" --project-ref "$PROJECT_REF"
  else
    npx --yes supabase@2 functions deploy "$fn"
  fi
done
echo "Done. Ensure schema.sql (or credential vault migrations) are applied."
echo "Optional: set CREDENTIALS_KEK for encrypted provider secrets; FREE_AI_* for free tier."

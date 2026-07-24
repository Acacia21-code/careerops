#!/usr/bin/env bash
# Deploy functions then web. Fails clearly if config/token missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/deploy-functions.sh"
"$ROOT/scripts/deploy-web.sh"

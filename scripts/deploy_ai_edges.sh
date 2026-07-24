#!/usr/bin/env bash
# Compatibility wrapper — use npm run deploy:functions
exec "$(cd "$(dirname "$0")" && pwd)/deploy-functions.sh" "$@"

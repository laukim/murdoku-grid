#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npx wrangler d1 migrations apply murdoku-layouts --remote
npx wrangler deploy

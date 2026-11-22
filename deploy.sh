#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Sessions need SESSION_SECRET on the Worker before sign-in works:
#   openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
npx wrangler d1 migrations apply murdoku-layouts --remote
npx wrangler deploy

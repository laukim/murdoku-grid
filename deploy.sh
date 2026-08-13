#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npx netlify-cli deploy --dir=. --prod

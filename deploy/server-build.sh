#!/usr/bin/env bash
# Builds the bot on its Linux machine, light: its runtime dependencies only (not the Cloudflare
# tools), TypeScript apart in .tools/ to compile it, and the game's faction list from EDSM.
# Run by server-setup.sh, server-update.sh and the admin page's updates.
#   bash deploy/server-build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --omit=dev --no-audit --no-fund --loglevel=error
[ -x .tools/node_modules/.bin/tsc ] || npm install --prefix .tools --no-audit --no-fund --loglevel=error typescript@5
node scripts/build-factions.mjs
.tools/node_modules/.bin/tsc -p tsconfig.node.json

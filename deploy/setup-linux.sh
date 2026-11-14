#!/usr/bin/env bash
# The EDCH bot's setup from a Linux (or macOS) PC: installs what the setup needs, then opens the
# setup page in the browser (deploy/setup.mjs), where everything else happens: install or update
# on Cloudflare or on a Linux machine over SSH, and that machine's admin page.
#   bash deploy/setup-linux.sh
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
command -v node >/dev/null || fail "Node.js 20 or newer is needed (https://nodejs.org or your distribution's package)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "Node.js 20 or newer is needed."
command -v git >/dev/null || fail "git is needed."

printf '\n\033[1;33m==> %s\033[0m\n' "The setup's tools (npm install, a minute the first time)"
npm install --no-audit --no-fund --loglevel=error
node deploy/setup.mjs

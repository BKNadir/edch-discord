#!/usr/bin/env bash
# Updates the EDCH bot from a Linux PC, where deploy/install-linux.sh installed it: Cloudflare
# (deploy again, with the game's faction list rebuilt) or the Linux machine (over SSH).
#   bash deploy/update-linux.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .edch-install ] || { echo "Not installed from this PC yet: bash deploy/install-linux.sh" >&2; exit 1; }
get() { grep -E "^$1=" .edch-install | tail -n1 | cut -d= -f2- ; }

printf '\n\033[1;33m==> %s\033[0m\n' "These scripts, up to date"
git pull --ff-only -q

if [ "$(get MODE)" = cloudflare ]; then
  npm install --no-audit --no-fund --loglevel=error
  npm run update
else
  ssh -t -p "$(get SSH_PORT)" "$(get SSH_TARGET)" 'bash ~/edch-discord/deploy/server-update.sh'
fi

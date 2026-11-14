#!/usr/bin/env bash
# Installs the EDCH bot from a Linux PC, either on Cloudflare (a free Worker) or on a Linux
# machine reached with SSH (service, HTTPS through DuckDNS and Caddy, admin page, nightly updates).
#   bash deploy/install-linux.sh
# A page opens in the browser for the settings (deploy/setup-page.mjs). The answers without
# secrets are kept in .edch-install for the update and admin scripts; secrets go to Cloudflare or
# to the machine only.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 is needed: $2"; }

need node "install Node.js 20 or newer (https://nodejs.org or your distribution's package)"
need git "install git"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "Node.js 20 or newer is needed"

SETTINGS="$(mktemp)"
chmod 600 "$SETTINGS"
trap 'rm -f "$SETTINGS"' EXIT

say "Settings (a page opens in your browser)"
node deploy/setup-page.mjs "$SETTINGS" .edch-install
get() { grep -E "^$1=" "$SETTINGS" | tail -n1 | cut -d= -f2- ; }
MODE="$(get MODE)"

# The answers to keep, without any secret.
remember() {
  {
    for key in MODE DISCORD_APPLICATION_ID DISCORD_GUILD_ID "$@"; do printf '%s=%s\n' "$key" "$(get "$key")"; done
  } > .edch-install
}

if [ "$MODE" = cloudflare ]; then
  say "Tools (npm install)"
  npm install --no-audit --no-fund --loglevel=error
  say "Cloudflare account"
  npx wrangler whoami 2>/dev/null | grep -qi "associated with the email" || npx wrangler login
  remember
  # Deployed first: Cloudflare keeps secrets for an existing Worker.
  say "Deploying"
  npm run update
  say "Secrets, kept by Cloudflare"
  get DISCORD_PUBLIC_KEY | npx wrangler secret put DISCORD_PUBLIC_KEY
  get DISCORD_BOT_TOKEN | npx wrangler secret put DISCORD_BOT_TOKEN
  # Made once: changing it would cancel every member's key.
  if ! npx wrangler secret list 2>/dev/null | grep -q '"LINK_SECRET"'; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | npx wrangler secret put LINK_SECRET
  fi
  say "Done"
  echo "Developer portal → General Information → Interactions Endpoint URL:"
  echo "  the workers.dev address printed above, followed by /interactions"
  echo "(Discord checks it at once; the bot then declares /bgs by itself.)"
else
  need ssh "install OpenSSH (openssh-client)"
  TARGET="$(get SSH_TARGET)"
  PORT="$(get SSH_PORT)"
  say "The Linux machine ($TARGET)"
  # The settings travel through SSH only, into a file only that user can read; the setup script
  # deletes it once read.
  grep -E '^(DISCORD_|DUCKDNS_)' "$SETTINGS" | ssh -p "$PORT" "$TARGET" 'umask 077; cat > ~/.edch-setup.env'
  ssh -p "$PORT" "$TARGET" "tr -d '\r' > ~/edch-server-setup.sh" < deploy/server-setup.sh
  ssh -t -p "$PORT" "$TARGET" 'bash ~/edch-server-setup.sh ~/.edch-setup.env; status=$?; rm -f ~/edch-server-setup.sh; exit $status'
  remember SSH_TARGET SSH_PORT DUCKDNS_DOMAIN
  echo
  echo "Admin page later: bash deploy/admin-linux.sh   Updates: bash deploy/update-linux.sh"
fi

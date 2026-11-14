#!/usr/bin/env bash
# Opens the bot's admin page (settings, updates) from a Linux PC: an SSH tunnel to the Linux
# machine, then the page in the browser. The page is never reachable from the Internet.
#   bash deploy/admin-linux.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .edch-install ] || { echo "Not installed from this PC yet: bash deploy/install-linux.sh" >&2; exit 1; }
get() { grep -E "^$1=" .edch-install | tail -n1 | cut -d= -f2- ; }
[ "$(get MODE)" = server ] || { echo "The admin page is for a bot on a Linux machine; on Cloudflare, use deploy/update-linux.sh." >&2; exit 1; }
TARGET="$(get SSH_TARGET)"
PORT="$(get SSH_PORT)"
LOCAL_PORT=18788

TOKEN="$(ssh -p "$PORT" "$TARGET" "grep -E '^ADMIN_TOKEN=' ~/edch-discord/bot.env | cut -d= -f2-")"
[ -n "$TOKEN" ] || { echo "No admin page on $TARGET: run the install script again." >&2; exit 1; }
# The tunnel goes to the background once connected (after the password, if SSH asks for one);
# its control socket closes it at the end.
SOCKET="$(mktemp -u /tmp/edch-admin.XXXXXX)"
ssh -f -N -M -S "$SOCKET" -o ExitOnForwardFailure=yes -p "$PORT" -L "$LOCAL_PORT:127.0.0.1:8788" "$TARGET"
trap 'ssh -S "$SOCKET" -O exit "$TARGET" 2>/dev/null' EXIT
URL="http://127.0.0.1:$LOCAL_PORT/?t=$TOKEN"
xdg-open "$URL" >/dev/null 2>&1 || echo "Open this address in your browser: $URL"
read -r -p "The admin page is open. Press Enter here to close the connection. "

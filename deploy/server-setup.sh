#!/usr/bin/env bash
# Sets up the EDCH bot on a Linux machine (Debian, Ubuntu, Fedora and their relatives). Run on
# that machine by the setup page of a PC, over SSH (deploy/setup.mjs); it can be run by hand too:
#   bash server-setup.sh <settings file>
# The settings file holds KEY=value lines: DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY,
# DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DUCKDNS_DOMAIN, DUCKDNS_TOKEN, and optionally HTTP_PORT and
# HTTPS_PORT (Caddy's ports on this machine, 80 and 443 by default). It is deleted once read;
# nothing secret is printed. The key-signing secret (LINK_SECRET) is made here, once.
#
# What it does, idempotent (running it again updates):
#   - Node.js 22 (official build in /opt/node when the system's is older), git, curl
#   - the bot's code in ~/edch-discord (git clone or pull), built (npm ci, faction list, build:node)
#   - bot.env next to it, readable by this user only
#   - a systemd service "edch-discord" (starts at boot, restarts when it stops), with its admin
#     page on 127.0.0.1:8788 (reached through SSH) and nightly updates from GitHub
#   - DuckDNS kept up to date with this network's IP (a systemd timer, every 5 minutes)
#   - Caddy: HTTPS for <domain>.duckdns.org (Let's Encrypt) in front of the bot
#   - the firewall (ufw or firewalld, when active): Caddy's ports open (80 and 443, or the
#     HTTP_PORT and HTTPS_PORT given when those are taken)
set -euo pipefail

SETTINGS="${1:?usage: server-setup.sh <settings file>}"
REPO_URL="https://github.com/BKNadir/edch-discord.git"
APP_DIR="$HOME/edch-discord"
NODE_MAJOR=22
PORT=8787
ADMIN_PORT=8788

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$SETTINGS" ] || fail "settings file not found: $SETTINGS"
# The secrets it holds don't stay on the machine, whatever happens.
trap 'rm -f "$SETTINGS"' EXIT
[ "$(id -u)" -ne 0 ] || fail "run it as a normal user with sudo rights, not as root"
command -v sudo >/dev/null || fail "sudo is needed"
command -v systemctl >/dev/null || fail "systemd is needed"

# The settings, read without running them as a script (Windows line ends removed).
get() { tr -d '\r' < "$SETTINGS" | grep -E "^$1=" | tail -n1 | cut -d= -f2- ; }
DUCKDNS_DOMAIN="$(get DUCKDNS_DOMAIN)"
DUCKDNS_TOKEN="$(get DUCKDNS_TOKEN)"
[[ "$DUCKDNS_DOMAIN" =~ ^[a-z0-9-]+$ ]] || fail "DUCKDNS_DOMAIN must be the name only (\"mybot\" for mybot.duckdns.org)"
[ -n "$DUCKDNS_TOKEN" ] || fail "DUCKDNS_TOKEN is missing"
HOST="$DUCKDNS_DOMAIN.duckdns.org"
# The ports Caddy listens on, on this machine: 80 and 443, or others when they are taken (the
# router then forwards the Internet's 80 and 443 to them: Let's Encrypt and Discord use those).
HTTP_PORT="$(get HTTP_PORT)"; HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="$(get HTTPS_PORT)"; HTTPS_PORT="${HTTPS_PORT:-443}"
[[ "$HTTP_PORT" =~ ^[0-9]{2,5}$ && "$HTTPS_PORT" =~ ^[0-9]{2,5}$ && "$HTTP_PORT" != "$HTTPS_PORT" ]] || fail "HTTP_PORT and HTTPS_PORT must be two different port numbers"

say "Sudo (installs packages and services)"
sudo -v

if command -v apt-get >/dev/null; then PKG=apt
elif command -v dnf >/dev/null; then PKG=dnf
else fail "only apt (Debian, Ubuntu…) and dnf (Fedora…) systems are supported"; fi

install_packages() {
  if [ "$PKG" = apt ]; then sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  else sudo dnf install -y -q "$@"; fi
}

say "Tools: git, curl"
install_packages git curl ca-certificates tar xz-utils 2>/dev/null || install_packages git curl ca-certificates tar xz

say "Node.js $NODE_MAJOR"
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if [ "$(node_major)" -lt "$NODE_MAJOR" ] 2>/dev/null || ! command -v node >/dev/null; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) fail "unsupported processor: $(uname -m)" ;;
  esac
  # The newest Node 22 release, from nodejs.org (the official builds, checksum verified).
  BASE="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E "node-v[0-9.]+-linux-$ARCH\.tar\.xz$" | awk '{print $2}')"
  SUM="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E " $FILE$" | awk '{print $1}')"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  echo "$SUM  $TMP/$FILE" | sha256sum -c --quiet || fail "Node.js download corrupted"
  sudo rm -rf /opt/node && sudo mkdir -p /opt/node
  sudo tar -xJf "$TMP/$FILE" -C /opt/node --strip-components=1
  rm -rf "$TMP"
  sudo ln -sf /opt/node/bin/node /usr/local/bin/node
  sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
  sudo ln -sf /opt/node/bin/npx /usr/local/bin/npx
  hash -r
fi
NODE="$(command -v node)"
echo "Node $(node -v) at $NODE"

say "The bot's code in $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only -q
else git clone -q "$REPO_URL" "$APP_DIR"; fi

say "Settings (bot.env, readable by you only)"
# The key-signing secret is made here once and kept: changing it would cancel every member's key.
old() { [ -f "$APP_DIR/bot.env" ] && grep -E "^$1=" "$APP_DIR/bot.env" | tail -n1 | cut -d= -f2- || true; }
random() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
LINK_SECRET="$(old LINK_SECRET)"; [ -n "$LINK_SECRET" ] || LINK_SECRET="$(random 32)"
# The admin page's key (deploy/admin-*.sh opens the page with it) and the nightly updates.
ADMIN_TOKEN="$(old ADMIN_TOKEN)"; [ -n "$ADMIN_TOKEN" ] || ADMIN_TOKEN="$(random 24)"
AUTO_UPDATE="$(old AUTO_UPDATE)"; [ -n "$AUTO_UPDATE" ] || AUTO_UPDATE=daily
umask 077
{
  for key in DISCORD_APPLICATION_ID DISCORD_PUBLIC_KEY DISCORD_BOT_TOKEN DISCORD_GUILD_ID; do
    printf '%s=%s\n' "$key" "$(get "$key")"
  done
  printf 'LINK_SECRET=%s\nPUBLIC_URL=https://%s\nPORT=%s\n' "$LINK_SECRET" "$HOST" "$PORT"
  printf 'ADMIN_PORT=%s\nADMIN_TOKEN=%s\nAUTO_UPDATE=%s\n' "$ADMIN_PORT" "$ADMIN_TOKEN" "$AUTO_UPDATE"
} > "$APP_DIR/bot.env"
chmod 600 "$APP_DIR/bot.env"
umask 022
[ -n "$(get DISCORD_APPLICATION_ID)" ] && [ -n "$(get DISCORD_PUBLIC_KEY)" ] && [ -n "$(get DISCORD_BOT_TOKEN)" ] ||
  fail "the Discord application id, public key and bot token are needed"

say "Building (dependencies, the game's faction list from EDSM, the bot)"
cd "$APP_DIR"
bash deploy/server-build.sh

say "Service edch-discord (starts at boot)"
sudo tee /etc/systemd/system/edch-discord.service >/dev/null <<UNIT
[Unit]
Description=EDCH Discord bot
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE $APP_DIR/scripts/server.mjs $APP_DIR/bot.env
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

say "DuckDNS: $HOST follows this network's IP"
# Next to the bot, readable by this user only (the admin page can change the token).
umask 077
printf 'DUCKDNS_DOMAIN=%s\nDUCKDNS_TOKEN=%s\n' "$DUCKDNS_DOMAIN" "$DUCKDNS_TOKEN" > "$APP_DIR/duckdns.env"
umask 022
# The token stays out of command lines: curl reads the address from its standard input.
sudo tee /usr/local/bin/edch-duckdns-update >/dev/null <<'SCRIPT'
#!/bin/sh
# Tells DuckDNS this network's IP (empty ip: the address the request comes from). Answer: OK or KO.
. "${1:?usage: edch-duckdns-update <duckdns.env>}"
printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$DUCKDNS_DOMAIN" "$DUCKDNS_TOKEN" |
  curl -fsS --max-time 20 -K - | grep -q OK
SCRIPT
sudo chmod 755 /usr/local/bin/edch-duckdns-update
sudo tee /etc/systemd/system/edch-duckdns.service >/dev/null <<UNIT
[Unit]
Description=Update the EDCH bot's DuckDNS address
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
ExecStart=/usr/local/bin/edch-duckdns-update $APP_DIR/duckdns.env
UNIT
sudo tee /etc/systemd/system/edch-duckdns.timer >/dev/null <<'UNIT'
[Unit]
Description=Update the EDCH bot's DuckDNS address every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl start edch-duckdns.service || fail "DuckDNS refused the update: check the domain and the token"
sudo systemctl enable -q --now edch-duckdns.timer

say "Caddy: HTTPS for $HOST"
if ! command -v caddy >/dev/null; then
  if [ "$PKG" = apt ]; then
    # Caddy's official package repository.
    install_packages debian-keyring debian-archive-keyring apt-transport-https gnupg 2>/dev/null || true
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    install_packages caddy
  else
    install_packages caddy
  fi
fi
CADDYFILE=/etc/caddy/Caddyfile
BLOCK="# EDCH bot (written by server-setup.sh)
$HOST {
	reverse_proxy 127.0.0.1:$PORT
}
# End of EDCH bot"
PORTS_BLOCK=""
if [ "$HTTP_PORT" != 80 ] || [ "$HTTPS_PORT" != 443 ]; then
  # Caddy's global options: they must come first in the file.
  PORTS_BLOCK="# EDCH bot ports (written by server-setup.sh)
{
	http_port $HTTP_PORT
	https_port $HTTPS_PORT
}
# End of EDCH bot ports"
fi
sudo mkdir -p /etc/caddy
# The file without what this script wrote before.
REST="$( (sudo cat "$CADDYFILE" 2>/dev/null || true) | sed '/^# EDCH bot (written/,/^# End of EDCH bot$/d; /^# EDCH bot ports (written/,/^# End of EDCH bot ports$/d')"
if [ -z "$(printf '%s' "$REST" | grep -vE '^\s*(#.*)?$')" ] ||
  { printf '%s\n' "$REST" | grep -qE '^:80 *\{' && ! printf '%s\n' "$REST" | grep -qvE '^\s*(#.*)?$|^:80|^\s*root|^\s*file_server|^\}'; }; then
  # Empty, or the package's example page only: the file is ours.
  REST=""
elif [ -n "$PORTS_BLOCK" ]; then
  fail "Caddy already serves other sites on this machine: other ports for the bot would move them too. Keep ports 80 and 443, or set Caddy's http_port and https_port yourself in $CADDYFILE."
fi
{
  [ -n "$PORTS_BLOCK" ] && printf '%s\n\n' "$PORTS_BLOCK"
  [ -n "$REST" ] && printf '%s\n\n' "$REST"
  printf '%s\n' "$BLOCK"
} | sudo tee "$CADDYFILE" >/dev/null
sudo caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null || fail "Caddy's configuration is invalid: see $CADDYFILE"

say "Firewall: ports $HTTP_PORT and $HTTPS_PORT"
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow "$HTTP_PORT/tcp" >/dev/null && sudo ufw allow "$HTTPS_PORT/tcp" >/dev/null
elif command -v firewall-cmd >/dev/null && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd -q --permanent --add-port="$HTTP_PORT/tcp" --add-port="$HTTPS_PORT/tcp" && sudo firewall-cmd -q --reload
else
  echo "No active firewall found."
fi

say "Starting"
sudo systemctl enable -q edch-discord caddy
sudo systemctl restart edch-discord
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy
sleep 3
if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null; then echo "The bot answers on this machine."
else fail "the bot doesn't answer: sudo journalctl -u edch-discord -n 50"; fi

PUBLIC_OK=no
for _ in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 "https://$HOST/" >/dev/null 2>&1; then PUBLIC_OK=yes; break; fi
  sleep 10
done

say "Done"
echo "Bot address:            https://$HOST"
echo "Interactions Endpoint:  https://$HOST/interactions   (developer portal → General Information)"
echo "Admin page:             from your PC, the setup page's \"Open the admin page\" (through SSH)"
if [ "$PUBLIC_OK" = yes ]; then
  echo "It answers from the Internet with HTTPS."
else
  cat <<NOTE
It doesn't answer from the Internet yet. Check:
  - your router forwards the Internet's ports 80 and 443 (TCP) to this machine
    ($(hostname -I 2>/dev/null | awk '{print $1}')), to its ports $HTTP_PORT and $HTTPS_PORT;
  - on a rented server (VPS): its provider's firewall lets ports 80 and 443 in;
  - your Internet provider gives you a public IP (no CGNAT; some providers turn it off on request);
  - then: sudo systemctl restart caddy, and wait a minute for the certificate.
Logs: sudo journalctl -u caddy -n 50   and   sudo journalctl -u edch-discord -n 50
NOTE
fi

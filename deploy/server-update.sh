#!/usr/bin/env bash
# Updates the EDCH bot on its Linux machine: new code, dependencies, the game's faction list, the
# build, then a restart. Run by the update scripts of a PC over SSH, or by hand:
#   bash ~/edch-discord/deploy/server-update.sh
# The bot declares /bgs to Discord itself at its first request after the restart.
set -euo pipefail

APP_DIR="$HOME/edch-discord"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[ -d "$APP_DIR/.git" ] || { echo "No bot in $APP_DIR: run the install script first." >&2; exit 1; }
cd "$APP_DIR"
say "New code"
git pull --ff-only -q
say "Building"
npm install --no-audit --no-fund --loglevel=error
node scripts/build-factions.mjs
npm run -s build:node
say "Restarting"
sudo systemctl restart edch-discord
sleep 3
PORT="$(grep -E '^PORT=' bot.env | cut -d= -f2)"
# Its first request makes the bot check /bgs with Discord.
if curl -fsS "http://127.0.0.1:${PORT:-8787}/" >/dev/null; then echo "Done: the bot is up to date."
else echo "The bot doesn't answer: sudo journalctl -u edch-discord -n 50" >&2; exit 1; fi

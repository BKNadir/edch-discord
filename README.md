# EDCH-Discord

The code of **EDCH**, the Discord bot of the [EDCH](https://github.com/BKNadir/edch) app (Elite Dangerous Companion Helper): a
squadron's members send what they did for their minor factions (their own and allied ones; missions and their influence,
bounties, combat bonds, trade, cartography, and what counted against it), and `/bgs summary` shows
the squadron's work system by system.

Each squadron hosts its own copy (below): on Cloudflare's free plan (a Worker, nothing to keep
running) or on a Linux machine of its own, installed from a PC by a setup page.

## Where the data is

**The bot keeps nothing.** Each server's data lives in that server's own channels:

- **`#edch-sync`** (admins and the bot only): the settings (factions followed, role, channels, cancelled
  keys) in a message the bot pins, and each report in messages of the bot, the data compressed in
  a spoiler.
- **`#edch-bgs`** (the `BGS` role, admins and the bot), a forum, read-only (only the bot writes;
  set up again to apply it to an older channel). Forums need a Community server: elsewhere it is a
  text channel with threads, and `/bgs setup` says so. One post (or thread) per system
  where the squadron works or a followed faction is, with a line per report ("@member · 3 missions
  (+7 inf.) · trade 12M") and a line when a member's visit shows the influence or states changed
  ("🛰️ @member · Faction 34.2 % (Boom) · closest Rival 30.1 %").
  Discord archives a thread after 3 days without a line (a quiet system); the next report about it
  reopens it. After each BGS tick, the first report posts the past day's recap there (a post of
  its own in a forum).

A server's data is read only for that server: Discord signs every command with the server it comes
from, and the key a member gives EDCH is signed by the bot with its server and channel (it can't be
changed to name another). The tests check that a server never reads or writes another's
(`test/bot.test.mjs`, "isolation"). Deleting the two channels deletes everything.

**Systems seen are shared.** When a member arrives in a system where a followed faction is, EDCH
sends what the game shows there (factions, influence, states, conflicts: public game data). The bot
keeps the newest of each system for 7 days and gives it to the other members' EDCH
(`GET /v1/systems`), which shows it in its BGS page as private data, marked with a Discord icon.
Systems without a followed faction are dropped.

No commander names: a report is tied to the member's Discord account. EDCH sends nothing unless
the member pastes their key and ticks the box.

A squadron's copy answers its own server only (`DISCORD_GUILD_ID`): its token reaches no other
squadron's data, and no one else's bot reaches yours.

## Commands

Commands leave nothing in the channel: every answer is seen by the member only.

| Command                                      | Who                           | What                                                                                                                                                          |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/bgs setup [faction] [role] [link_channel]` | admins (Manage Server)        | creates the `BGS` role, `#edch-sync` and `#edch-bgs` if missing; `faction`: added to those followed; `link_channel`: the only channel where `/bgs link` works |
| `/bgs faction add name`                      | admins                        | follows one more faction (up to 10: yours and allies on the same server); the game's factions are offered as you type                                         |
| `/bgs faction remove name`                   | admins                        | stops following a faction (what was reported for it stays)                                                                                                    |
| `/bgs faction default name`                  | admins                        | the faction shown first                                                                                                                                       |
| `/bgs faction list`                          | members with the role, admins | the factions followed, as a card; admins also get menus there to change the default or remove one                                                             |
| `/bgs revoke member`                         | admins                        | cancels a member's keys                                                                                                                                       |
| `/bgs link`                                  | members with the role         | their EDCH key, by direct message (in the answer, seen by them only, when their DMs are closed)                                                               |
| `/bgs unlink`                                | anyone                        | cancels their own keys                                                                                                                                        |
| `/bgs summary [period] [faction]`            | members with the role, admins | the squadron's work since the tick, 24 hours or 7 days: one card per faction, or the one chosen                                                               |

EDCH asks the bot which factions the server follows and sends a report for each one its commander
worked for. With several factions, the thread lines name the faction.

While an admin types a faction to add, the bot offers the factions the members saw in their
systems over the last 7 days (the server's own data) and the game's minor factions from a list
bundled with the bot: `npm run update` builds it from EDSM's nightly dump of the populated systems
(scripts/build-factions.mjs; no website is asked while typing). A faction newer than the list can
still be typed in full. The factions already
followed are offered in `remove`, `default` and `summary`.

`setup`, `revoke` and `faction add|remove|default` are listed to everyone (Discord shows every subcommand) but the bot refuses
them to anyone without the Administrator or Manage Server right. Removing the role stops a member's reports at once; their past
reports still count.

## Hosting your squadron's bot

The bot runs either on **Cloudflare** (a free Worker: nothing to keep switched on) or on **a Linux
machine of yours** (a Raspberry Pi, a home server…), reached from your PC with SSH. One script per
PC system opens a setup page in your browser, where everything happens: install, update, settings.

### 1. Discord application

[Developer portal](https://discord.com/developers/applications) → New Application "EDCH". Note the
**Application ID** and the **Public Key** (General Information). Bot → Reset Token: note the
**token** (keep it secret). Installation → Default Install Settings → Guild Install: scopes `bot`
and `applications.commands`; permissions Manage Roles, Manage Channels, View Channels, Send
Messages, Manage Messages, Pin Messages, Read Message History, Create Public Threads, Send Messages
in Threads. No privileged intent is needed.

### 2. The setup, from your PC

Install [Node.js](https://nodejs.org) 20 or newer and [Git](https://git-scm.com), then:

```
git clone https://github.com/BKNadir/edch-discord.git
cd edch-discord
```

- **Windows**: `powershell -ExecutionPolicy Bypass -File deploy\setup-windows.ps1`
- **Linux** (or macOS): `bash deploy/setup-linux.sh`

The script installs the setup's tools (`npm install`) and opens the **setup page** in your browser. Before installing anything, the page **checks** what is needed, on this PC for Cloudflare
(Node.js, npm, the tools, Cloudflare and EDSM reachable) or on the Linux machine (system, systemd,
sudo, processor, disk space, ports 80 and 443, Internet): what is missing is installed by the setup
(Node.js 22, git, curl, Caddy, the tools), and what blocks is shown with the reason.
It runs on your PC only (`127.0.0.1`, a one-time address); keep the script's window open while you
use it. Passwords and secrets stay in memory while it runs and go to Cloudflare or to your machine
only. `.edch-install` keeps the answers without any secret (where the bot runs, the SSH address,
the machine's key fingerprint) for next time.

Run the same script again to **update** the bot: on Cloudflare, it deploys the new version; on a
Linux machine, it updates it (or use the admin page, below). Either way the **game's faction list**
offered by `/bgs faction add` is rebuilt from EDSM's nightly dump. Someone else can update the bot
from their own PC: with access to the Cloudflare account, or the machine's SSH address and a user
with sudo rights.

### 3a. On Cloudflare

Needs a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. "Sign in and check" opens
Cloudflare's sign-in, then tells whether an EDCH bot is already on that account:

- **No bot yet**: give the Discord settings and install. The setup deploys the Worker and keeps
  every setting as a Cloudflare secret (the ids too), so later deploys, from any PC, never change
  them. The key-signing secret is made once.
- **A bot is there**: "Update" deploys the new version. The settings are optional: empty, they are
  kept; filled in, they replace the old ones. The key-signing secret never changes, so the members'
  keys stay valid.

The bot's address is `https://edch-discord.<you>.workers.dev`.

### 3b. On your Linux machine

Debian, Ubuntu, Raspberry Pi OS, Fedora and their relatives. Before the setup:

- **SSH**: the machine's address, and a user with sudo rights. The page asks for the password (and
  the sudo password if it differs); an SSH key from `~/.ssh` is used when there is one. The
  machine's key is remembered: if it changes later, the setup stops (another machine, or someone in
  between).
- **DuckDNS**: create a free name on [duckdns.org](https://www.duckdns.org) (`mysquadron` for
  `mysquadron.duckdns.org`) and note its token. The machine keeps it pointed at your network's IP.
- **Your router**: forward ports **80** and **443** (TCP) to the machine. Port 80 is used only to
  get the HTTPS certificate (Let's Encrypt).
- Some Internet providers share one IP between customers (**CGNAT**): ports can't be forwarded
  then. Many give a public IP on request.

"Connect and check" tells whether the bot is already on the machine. A new install sets up Node.js
22, the bot in `~/edch-discord` (its settings in `bot.env`, readable by that user only), a systemd
service `edch-discord` that starts at boot, DuckDNS updates every 5 minutes,
[Caddy](https://caddyserver.com) for HTTPS in front of the bot, and opens ports 80 and 443 in the
firewall (ufw or firewalld) when one is active. It ends with the bot's address,
`https://<name>.duckdns.org`, and checks it answers from the Internet. The progress shows in the
page, line by line.

On a machine that has the bot, the page offers **Update the bot**, **Open the admin page**, and
setting it up again with new settings (another DuckDNS name, a new token…).

**Admin page**: opened through the setup's SSH connection (keep the setup page open while you use
it). It shows the version and the updates, changes the Discord ids and secrets or the DuckDNS token,
and updates the bot from GitHub: with a button, or **every night by itself** (on by default). An
update that fails to build puts the previous version back. The page listens on the machine itself
only (`127.0.0.1:8788`) and needs its own key: it can't be reached from the Internet.

Logs on the machine: `sudo journalctl -u edch-discord` (the bot), `sudo journalctl -u caddy`
(HTTPS).

### 4. Then, in the developer portal

General Information → **Interactions Endpoint URL**: the bot's address followed by `/interactions`
(the setup shows it; Discord checks it right away). Installation: open the install link and add the
bot to your server (it needs the Manage Server right there). The bot declares `/bgs` itself, with
its own token, at its first request after each deploy or restart, and only when it changed.

The key `/bgs link` gives contains your bot's address: EDCH asks each member to confirm it the
first time.

### By hand (Cloudflare)

`npm install`, `npx wrangler login`, then `npx wrangler secret put` for `DISCORD_APPLICATION_ID`,
`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `LINK_SECRET` (any long random text; changing it cancels
every key) and optionally `DISCORD_GUILD_ID`, and `npm run update` (faction list, deploy).

## Setting it up on your server

1. `/bgs setup`: the bot creates the **`BGS`** role, **`#edch-sync`** and **`#edch-bgs`** when
   they're missing, and pins its settings. Then `/bgs faction add` for your faction, and again for
   allied ones (or `faction:"Your faction"` in `setup`). Options:
   `role:@YourRole` for another role, `link_channel:#channel` to allow `/bgs link` there only.
   Without the Manage Roles and Manage Channels rights, create them yourself (private; in
   `#edch-sync` the bot sees, reads the history, sends, manages and pins; in `#edch-bgs` it also
   creates posts or threads and writes in them) and give `role`.
2. Give the role to the members who report.
3. Each member: `/bgs link`, then in EDCH, Sync → Connect to the Discord bot, paste the key from
   the direct message and tick "Send BGS reports". The message also says to mute `#edch-bgs`.

## Development

```
npm test            # compiles to dist-test/ and runs the tests (no Discord, no Cloudflare)
npm run dev         # wrangler dev
npm run build:node  # the Node build (dist-node/) that scripts/server.mjs runs on a Linux machine
```

The request handler (`src/handler.ts`) is the same on Cloudflare (`src/index.ts`) and on a machine
(`scripts/server.mjs`, with the admin page in `scripts/admin.mjs`). The install and update scripts
are in `deploy/`: `setup.mjs` and `setup-page.html` (the setup page), `setup-windows.ps1` and
`setup-linux.sh` (start it), `server-setup.sh` and `server-update.sh` (run on the Linux machine).

The report format is EDCH's `docs/BGS_SYNC.md`.

## Licence

MIT, like EDCH. Elite Dangerous is a trademark of Frontier Developments plc. Unofficial,
non-commercial community tool.

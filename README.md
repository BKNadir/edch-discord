# EDCH-Discord

The code of **EDCH**, the Discord bot of the [EDCH](https://github.com/BKNadir/edch) app (Elite Dangerous Companion Helper): a
squadron's members send what they did for their minor factions (their own and allied ones; missions and their influence,
bounties, combat bonds, trade, cartography, and what counted against it), and `/bgs summary` shows
the squadron's work system by system.

Each squadron hosts its own copy (below): on Cloudflare's free plan (a Worker, nothing to keep
running) or on a Linux machine of its own, installed from a PC by a script.

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
machine of yours** (a Raspberry Pi, a home server…), reached from your PC with SSH. Scripts do the
whole installation from your PC, Windows or Linux; a page opens in your browser for the settings.
About twenty minutes, once.

### 1. Discord application

[Developer portal](https://discord.com/developers/applications) → New Application "EDCH". Note the
**Application ID** and the **Public Key** (General Information). Bot → Reset Token: note the
**token** (keep it secret). Installation → Default Install Settings → Guild Install: scopes `bot`
and `applications.commands`; permissions Manage Roles, Manage Channels, View Channels, Send
Messages, Manage Messages, Pin Messages, Read Message History, Create Public Threads, Send Messages
in Threads. No privileged intent is needed.

### 2. On your PC

Install [Node.js](https://nodejs.org) 20 or newer and [Git](https://git-scm.com), then:

```
git clone https://github.com/BKNadir/edch-discord.git
cd edch-discord
```

| Your PC | Install                                                               | Update                        | Admin page (Linux machine)   |
| ------- | --------------------------------------------------------------------- | ----------------------------- | ---------------------------- |
| Windows | `powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1` | `…\update-windows.ps1`        | `…\admin-windows.ps1`        |
| Linux   | `bash deploy/install-linux.sh`                                        | `bash deploy/update-linux.sh` | `bash deploy/admin-linux.sh` |

The install script opens a setup page in your browser (on your PC only, `127.0.0.1`, a one-time
address): where the bot runs, the Discord ids and secrets, and for a Linux machine its SSH address
and DuckDNS name. The answers without secrets are kept in `.edch-install` for the update and admin
scripts; secrets go to Cloudflare or to the machine, nowhere else.

### 3a. On Cloudflare

Needs a free [Cloudflare](https://dash.cloudflare.com/sign-up) account: the script signs you in,
deploys, and keeps the secrets in Cloudflare. Its address is `https://edch-discord.<you>.workers.dev`.

### 3b. On your Linux machine

Debian, Ubuntu, Raspberry Pi OS, Fedora and their relatives. Before running the script:

- **SSH**: you can log in to the machine from your PC (`ssh user@address`) with a user that has
  sudo rights. An [SSH key](https://www.ssh.com/academy/ssh/keygen) saves typing the password each
  time.
- **DuckDNS**: create a free name on [duckdns.org](https://www.duckdns.org) (`mysquadron` for
  `mysquadron.duckdns.org`) and note its token. The machine keeps it pointed at your network's IP.
- **Your router**: forward ports **80** and **443** (TCP) to the machine. Port 80 is used only to
  get the HTTPS certificate (Let's Encrypt).
- Some Internet providers share one IP between customers (**CGNAT**): ports can't be forwarded
  then. Many give a public IP on request.

The script installs on the machine: Node.js 22, the bot in `~/edch-discord` (its settings in
`bot.env`, readable by that user only), a systemd service `edch-discord` that starts at boot,
DuckDNS updates every 5 minutes, [Caddy](https://caddyserver.com) for HTTPS in front of the bot,
and opens ports 80 and 443 in the firewall (ufw or firewalld) when one is active. It ends with the
bot's address, `https://<name>.duckdns.org`, and checks it answers from the Internet.

**Admin page**: the admin script opens an SSH tunnel and the page in your browser. It shows the
version and the updates, changes the Discord ids and secrets or the DuckDNS token, and updates the
bot from GitHub: with a button, or **every night by itself** (on by default). An update that fails
to build puts the previous version back. The page listens on the machine itself only
(`127.0.0.1:8788`) and needs its own key: it can't be reached from the Internet.

Logs: `sudo journalctl -u edch-discord` (the bot), `sudo journalctl -u caddy` (HTTPS).

### 4. Then, in the developer portal

General Information → **Interactions Endpoint URL**: the bot's address followed by `/interactions`
(Discord checks it right away). Installation: open the install link and add the bot to your server
(it needs the Manage Server right there). The bot declares `/bgs` itself, with its own token, at its
first request after each deploy or restart, and only when it changed.

The key `/bgs link` gives contains your bot's address: EDCH asks each member to confirm it the
first time.

### By hand (Cloudflare)

`npm install`, `npx wrangler login`, `DISCORD_APPLICATION_ID` and `DISCORD_GUILD_ID` in
`wrangler.toml`, then `npx wrangler secret put` for `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` and
`LINK_SECRET` (any long random text; changing it cancels every key), and `npm run update`.

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
are in `deploy/`.

The report format is EDCH's `docs/BGS_SYNC.md`.

## Licence

MIT, like EDCH. Elite Dangerous is a trademark of Frontier Developments plc. Unofficial,
non-commercial community tool.

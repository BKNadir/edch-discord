# EDCH-Discord

The code of **EDCH**, the Discord bot of the [EDCH](https://github.com/BKNadir/edch) app (Elite Dangerous Companion Helper): a
squadron's members send what they did for their minor factions (their own and allied ones; missions and their influence,
bounties, combat bonds, trade, cartography, and what counted against it), and `/bgs summary` shows
the squadron's work system by system.

It runs as a Cloudflare Worker that answers Discord's interactions: nothing to keep running.

## Where the data is

**The bot keeps nothing.** Each server's data lives in that server's own channels:

- **`#edch-sync`** (admins and the bot only): the settings (factions followed, role, channels, cancelled
  keys) in a message the bot pins, and each report in messages of the bot, the data compressed in
  a spoiler.
- **`#edch-bgs`** (the `BGS` role, admins and the bot), read-only (only the bot writes; set up
  again to apply it to an older channel): one thread per system
  where the squadron works or a followed faction is, with a line per report ("@member · 3 missions
  (+7 inf.) · trade 12M") and a line when a member's visit shows the influence or states changed
  ("🛰️ @member · Faction 34.2 % (Boom) · closest Rival 30.1 %").
  Discord archives a thread after 3 days without a line (a quiet system); the next report about it
  reopens it. After each BGS tick, the first report posts the past day's recap there.

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

The shared bot's token can reach these channels on every server it was added to. A squadron that
doesn't want to depend on anyone can run its own copy (below).

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

## For a squadron (shared bot)

1. An admin adds the bot with the link given in EDCH (Sync → Connect to the Discord bot) or by its
   host.
2. `/bgs setup`: the bot creates the **`BGS`** role, **`#edch-sync`** and **`#edch-bgs`** when
   they're missing, and pins its settings. Then `/bgs faction add` for your faction, and again for
   allied ones (or `faction:"Your faction"` in `setup`). Options:
   `role:@YourRole` for another role, `link_channel:#channel` to allow `/bgs link` there only.
   Without the Manage Roles and Manage Channels rights, create them yourself (private; in
   `#edch-sync` the bot sees, reads the history, sends, manages and pins; in `#edch-bgs` it also
   creates threads and writes in them) and give `role`.
3. Give the role to the members who report.
4. Each member: `/bgs link`, then in EDCH, Sync → Connect to the Discord bot, paste the key from
   the direct message and tick "Send BGS reports".

## Hosting it (the shared bot, or a squadron's own copy)

You need a Discord account and a Cloudflare account (the free plan is enough).

1. **Discord**: [developer portal](https://discord.com/developers/applications) → New Application
   "EDCH". Note the **Application ID** and the **Public Key** (General Information). Bot →
   Reset Token: note the **token** (keep it secret).
   Installation → Default Install Settings → Guild Install: scopes `bot` and
   `applications.commands`; permissions Manage Roles, Manage Channels, View Channels, Send
   Messages, Manage Messages, Pin Messages, Read Message History, Create Public Threads, Send
   Messages in Threads. Bot: no privileged intent is needed.
2. **Cloudflare**: `npm install`, then `npx wrangler login`.
3. In `wrangler.toml`: `DISCORD_APPLICATION_ID`, and for your own copy `DISCORD_GUILD_ID` (your
   server's id: the bot then refuses every other server).
4. Secrets:
   ```
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put LINK_SECRET        # any long random text; changing it cancels every key
   ```
5. `npm run deploy` (builds the faction list, then deploys): note the address
   (`https://edch-discord.<you>.workers.dev`).
6. Developer portal → General Information → **Interactions Endpoint URL**:
   `https://edch-discord.<you>.workers.dev/interactions` (Discord checks it right away).
7. Add the bot to your server with the developer portal's Installation link. The bot declares
   `/bgs` itself (with its own token, the secret above) at its first request after each deploy,
   and only when it changed.

After a change to the bot: `npm run update` (builds the faction list, deploys, and wakes the bot
up so it declares `/bgs`; nothing to type).

EDCH knows the shared bot's address. For your own copy, the key `/bgs link` gives contains your
address: EDCH asks you to confirm it the first time.

## Development

```
npm test     # compiles to dist-test/ and runs the tests (no Discord, no Cloudflare)
npm run dev  # wrangler dev
```

The report format is EDCH's `docs/BGS_SYNC.md`.

## Licence

MIT, like EDCH. Elite Dangerous is a trademark of Frontier Developments plc. Unofficial,
non-commercial community tool.

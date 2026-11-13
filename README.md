# EDCH-Discord

The code of **EDCH**, the Discord bot of the [EDCH](https://github.com/BKNadir/edch) app (Elite Dangerous Companion Helper): a
squadron's members send what they did for their minor faction (missions and their influence,
bounties, combat bonds, trade, cartography, and what counted against it), and `/bgs summary` shows
the squadron's work system by system.

It runs as a Cloudflare Worker that answers Discord's interactions: nothing to keep running.

## Where the data is

**The bot keeps nothing.** Each server's data lives in that server's private `#edch-bgs` channel:

- the settings (faction, role allowed, cancelled keys) in a message the bot pins;
- each report in messages of the bot (a readable line, the data compressed in a spoiler).

A server's data is read only for that server: Discord signs every command with the server it comes
from, and the key a member gives EDCH is signed by the bot with its server and channel (it can't be
changed to name another). The tests check that a server never reads or writes another's
(`test/bot.test.mjs`, "isolation"). Deleting the channel deletes everything.

No commander names: a report is tied to the member's Discord account. EDCH sends nothing unless
the member pastes their key and ticks the box.

The shared bot's token can reach the `#edch-bgs` channel of every server it was added to. A
squadron that doesn't want to depend on anyone can run its own copy (below).

## Commands

| Command                   | Who                           | What                                                          |
| ------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `/bgs setup role faction` | admins (Manage Server)        | the faction followed and the role allowed; run in `#edch-bgs` |
| `/bgs link`               | members with the role         | a key for EDCH (only they see it)                             |
| `/bgs unlink`             | anyone                        | cancels their own keys                                        |
| `/bgs revoke member`      | admins                        | cancels a member's keys                                       |
| `/bgs summary [period]`   | members with the role, admins | the squadron's work since the tick, 24 hours or 7 days        |

Removing the role stops a member's reports at once; their past reports still count.

## For a squadron (shared bot)

1. An admin adds the bot with the link given in EDCH (Sync → Connect to the Discord bot) or by its host.
2. Create a private text channel named **`#edch-bgs`**: the bot needs to see it, read its history,
   send and manage messages (to pin its settings). Members don't need to see it.
3. In that channel: `/bgs setup role:@YourRole faction:"Your faction"`.
4. Each member: `/bgs link`, then in EDCH, Sync → Connect to the Discord bot, paste the key and tick "Send BGS
   reports".

## Hosting it (the shared bot, or a squadron's own copy)

You need a Discord account and a Cloudflare account (the free plan is enough).

1. **Discord**: [developer portal](https://discord.com/developers/applications) → New Application
   "EDCH". Note the **Application ID** and the **Public Key** (General Information). Bot →
   Reset Token: note the **token** (keep it secret).
2. **Cloudflare**: `npm install`, then `npx wrangler login`.
3. In `wrangler.toml`: `DISCORD_APPLICATION_ID`, and for your own copy `DISCORD_GUILD_ID` (your
   server's id: the bot then refuses every other server).
4. Secrets:
   ```
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put LINK_SECRET        # any long random text; changing it cancels every key
   ```
5. `npm run deploy`: note the address (`https://edch-discord.<you>.workers.dev`).
6. Developer portal → General Information → **Interactions Endpoint URL**:
   `https://edch-discord.<you>.workers.dev/interactions` (Discord checks it right away).
7. `DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… npm run commands`: declares `/bgs` and prints the
   link that adds the bot to a server.

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

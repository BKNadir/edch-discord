// The readable side of #edch-bgs, for admins and members:
// - one thread per system where the squadron works (named like the system): each report adds a
//   line there ("<@member> · 3 missions (+7 inf.) · trade 12M"). A thread with no new line for
//   3 days is archived by Discord itself (a system gone quiet); the next report about that system
//   writes to it again, which reopens it.
// - after each BGS tick, the first report of the new BGS day posts the past day's recap in the
//   reading channel (the same text as /bgs summary).
// All of it in #edch-bgs, the channel the BGS role reads (the data stay in #edch-sync).
// The raw data stays in the bot's spoiler messages (storage.ts); this is only for reading.

import { summaryEmbeds, totalsBySystem, type SystemTotals, shortCredits } from "./summary.js";
import type { DiscordApi, GuildConfig, StoredAction } from "./types.js";
import { readActions, writeConfig } from "./storage.js";

/** Discord archives a thread after this long without a message: 3 days, "stable". */
export const ARCHIVE_AFTER_MINUTES = 3 * 24 * 60;
/** Systems written to per report at most (the busiest), to stay within the Worker's limits. */
export const MAX_THREADS_PER_REPORT = 12;
const MAX_NAME = 100;

/** A system's name as a thread name. */
export const threadName = (system: string) => system.trim().slice(0, MAX_NAME);

/** One member's line in a system's thread (with the faction when the server follows several). */
export function threadLine(userId: string, t: SystemTotals, faction?: string): string {
  const parts = [
    t.missions
      ? `${t.missions} mission${t.missions > 1 ? "s" : ""} (${t.influence >= 0 ? "+" : ""}${t.influence} inf.)`
      : "",
    t.bounties ? `bounties ${shortCredits(t.bounties)}` : "",
    t.combatBonds ? `bonds ${shortCredits(t.combatBonds)}` : "",
    t.trade ? `trade ${shortCredits(t.trade)}` : "",
    t.exploration ? `cartography ${shortCredits(t.exploration)}` : "",
    t.against ? `⚠️ ${t.against} against the faction` : "",
  ].filter(Boolean);
  return `<@${userId}>${faction ? ` · **${faction}**` : ""} · ${parts.length ? parts.join(" · ") : "activity"}`;
}

/** The channel's threads by name, archived ones included (the most recent of each name). */
async function threadsByName(api: DiscordApi, guildId: string, channelId: string): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const thread of await api.archivedThreads(channelId)) byName.set(thread.name.toLowerCase(), thread.id);
  for (const thread of await api.activeThreads(guildId))
    if (thread.parentId === channelId) byName.set(thread.name.toLowerCase(), thread.id);
  return byName;
}

/** Writes a report's lines to the systems' threads (creating those that don't exist yet). */
export async function writeThreadLines(
  api: DiscordApi,
  guildId: string,
  channelId: string,
  userId: string,
  actions: StoredAction[],
  faction?: string,
): Promise<number> {
  const totals = totalsBySystem(actions).slice(0, MAX_THREADS_PER_REPORT);
  if (!totals.length) return 0;
  const threads = await threadsByName(api, guildId, channelId);
  let written = 0;
  for (const t of totals) {
    const name = threadName(t.system);
    let threadId = threads.get(name.toLowerCase());
    if (!threadId) {
      threadId = await api.createThread(channelId, name, ARCHIVE_AFTER_MINUTES);
      threads.set(name.toLowerCase(), threadId);
    }
    await api.sendMessage(threadId, threadLine(userId, t, faction));
    written += 1;
  }
  return written;
}

/**
 * After a new tick: the past BGS day's recap in the reading channel, once (the tick it was made for is
 * kept in the settings). The first time, only the tick is noted.
 */
export async function postRecapIfNewTick(
  api: DiscordApi,
  channelId: string,
  readChannelId: string,
  botId: string,
  config: GuildConfig,
  configMessageId: string,
  tick: string | null,
): Promise<boolean> {
  if (!tick || config.recapTick === tick) return false;
  const previous = config.recapTick;
  await writeConfig(api, channelId, { ...config, recapTick: tick }, configMessageId);
  if (!previous || previous > tick) return false;
  const actions = (await readActions(api, channelId, botId, previous)).filter((a) => a.at < tick);
  const day = `BGS day ${previous.slice(0, 16).replace("T", " ")} → ${tick.slice(11, 16)} UTC`;
  await api.sendMessage(readChannelId, {
    content: "📊 **Daily recap**",
    embeds: summaryEmbeds(config.factions, day, actions),
  });
  return true;
}

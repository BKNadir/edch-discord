// The readable side of #edch-bgs, for admins and members:
// - one thread per system where the squadron works or a followed faction is (named like the
//   system): each report adds a line there ("<@member> · 3 missions (+7 inf.) · trade 12M"), and
//   so does a member's visit when the factions' influence or states changed ("🛰️ <@member> ·
//   Faction 34.2 % (Boom) · closest Rival 30.1 %"). A thread with no new line for 3 days is
//   archived by Discord itself (a system gone quiet or stable); the next line reopens it.
// - after each BGS tick, the first report of the new BGS day posts the past day's recap in the
//   reading channel (the same text as /bgs summary).
// All of it in #edch-bgs, the channel the BGS role reads (the data stay in #edch-sync).
// The raw data stays in the bot's spoiler messages (storage.ts); this is only for reading.

import { summaryEmbeds, totalsBySystem, type SystemTotals, shortCredits } from "./summary.js";
import type { DiscordApi, GuildConfig, StoredAction } from "./types.js";
import { readActions, writeConfig } from "./storage.js";
import { changedSince, snapshotLine, type StoredSnapshot, type SystemSnapshot } from "./systems.js";

/** Discord archives a thread after this long without a message: 3 days, "stable". */
export const ARCHIVE_AFTER_MINUTES = 3 * 24 * 60;
/** A recap post is archived a day after (it gets no other message). */
const RECAP_ARCHIVE_MINUTES = 24 * 60;
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
export async function threadsByName(api: DiscordApi, guildId: string, channelId: string): Promise<Map<string, string>> {
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
  forum = false,
): Promise<number> {
  const totals = totalsBySystem(actions).slice(0, MAX_THREADS_PER_REPORT);
  if (!totals.length) return 0;
  const threads = await threadsByName(api, guildId, channelId);
  for (const t of totals) await writeLine(api, channelId, threads, t.system, threadLine(userId, t, faction), forum);
  return totals.length;
}

/**
 * Writes a line to a system's thread: the existing one (archived ones reopen when written to),
 * or a new one (in a forum, a post that starts with the line).
 */
async function writeLine(
  api: DiscordApi,
  channelId: string,
  threads: Map<string, string>,
  system: string,
  line: string,
  forum: boolean,
) {
  const name = threadName(system);
  const threadId = threads.get(name.toLowerCase());
  if (threadId) {
    await api.sendMessage(threadId, line);
    return;
  }
  const created = forum
    ? await api.createThread(channelId, name, ARCHIVE_AFTER_MINUTES, line)
    : await api.createThread(channelId, name, ARCHIVE_AFTER_MINUTES);
  threads.set(name.toLowerCase(), created);
  if (!forum) await api.sendMessage(created, line);
}

/**
 * Writes what a member saw in each system to its thread, when it changed since the newest
 * snapshot the server had (`previous`): a stable system gets no line, so Discord archives its
 * thread after 3 days; a change reopens it.
 */
export async function writeSnapshotLines(
  api: DiscordApi,
  guildId: string,
  channelId: string,
  userId: string,
  snapshots: SystemSnapshot[],
  followed: string[],
  previous: StoredSnapshot[],
  forum = false,
): Promise<number> {
  const before = new Map(previous.map((s) => [s.system.toLowerCase(), s]));
  const changed = [...snapshots]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((s, i, all) => all.findIndex((o) => o.system.toLowerCase() === s.system.toLowerCase()) === i)
    .filter((s) => {
      const known = before.get(s.system.toLowerCase());
      return (!known || s.at > known.at) && changedSince(known, s, followed);
    })
    .slice(0, MAX_THREADS_PER_REPORT);
  if (!changed.length) return 0;
  const threads = await threadsByName(api, guildId, channelId);
  for (const snapshot of changed)
    await writeLine(api, channelId, threads, snapshot.system, snapshotLine(userId, snapshot, followed), forum);
  return changed.length;
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
  const recap = { content: "📊 **Daily recap**", embeds: summaryEmbeds(config.factions, day, actions) };
  // In a forum, every message is in a post: the recap is a post of its own.
  if (config.bgsForum)
    await api.createThread(readChannelId, `📊 Recap ${previous.slice(0, 10)}`, RECAP_ARCHIVE_MINUTES, recap);
  else await api.sendMessage(readChannelId, recap);
  return true;
}

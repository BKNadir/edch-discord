// Where the data lives: the server's own channels, and nowhere else.
// - #edch-sync (admins and the bot only): the settings (faction, role, channels, cancelled keys)
//   in a pinned message of the bot, as JSON, and each report as messages of the bot, the actions
//   and the systems seen (systems.ts) compressed in a spoiler (Discord allows 2000 characters per
//   message).
// - #edch-bgs (the BGS role, admins, the bot): what people read, one thread per system and
//   the daily recap (threads.ts).
// Reading or writing always goes through a channel the request was checked against (index.ts):
// a server's data can't be read from another server.

import { base64Url, fromBase64Url } from "./crypto.js";
import { messageSnapshots, type StoredSnapshot } from "./systems.js";
import {
  ACTION_KINDS,
  type DiscordApi,
  type GuildConfig,
  type PermissionOverwrite,
  type ReportAction,
  type StoredAction,
} from "./types.js";

/** The channel of the data, seen by the admins and the bot only. */
export const SYNC_CHANNEL = "edch-sync";
/** The channel people read (threads by system, daily recap), seen by the role. */
export const BGS_CHANNEL = "edch-bgs";
/** The role /bgs setup creates when none is given (or reuses, by this name). */
export const ROLE_NAME = "BGS";
const CONFIG_MARK = '"edch":"config"';
const REPORT_MARK = "edch:r1:";
/** Room for the data in one message, after the readable line. */
const MAX_DATA_CHARS = 1700;
const MAX_PAGES = 40;
/** Factions a server can follow at once (its own and its allies). */
export const MAX_FACTIONS = 10;

/** The server's text channel of that name (the data channel by default), if there is one. */
export async function findChannel(api: DiscordApi, guildId: string, name = SYNC_CHANNEL): Promise<string | null> {
  const channels = await api.guildChannels(guildId);
  return channels.find((channel) => channel.type === 0 && channel.name === name)?.id ?? null;
}

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_MESSAGES = 1n << 13n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const USE_APPLICATION_COMMANDS = 1n << 31n;
const PIN_MESSAGES = 1n << 51n;
const CREATE_PUBLIC_THREADS = 1n << 35n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
/**
 * What the role can't do in #edch-bgs: it's read-only, only the bot writes there. (Discord lets a
 * bot deny only the permissions it has itself, so private threads aren't in it: nobody could
 * write in one anyway.)
 */
const WRITE = SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PUBLIC_THREADS;

const hidden = (guildId: string): PermissionOverwrite => ({
  id: guildId,
  type: 0,
  allow: "0",
  deny: String(VIEW_CHANNEL),
});

/** #edch-sync: hidden from @everyone; the bot reads, writes, manages and pins. Admins see all. */
export function syncOverwrites(guildId: string, botId: string): PermissionOverwrite[] {
  return [
    hidden(guildId),
    {
      id: botId,
      type: 1,
      allow: String(VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES | READ_MESSAGE_HISTORY | PIN_MESSAGES),
      deny: "0",
    },
  ];
}

/**
 * #edch-bgs: hidden from @everyone; the role reads it (read-only: no messages, no threads, the
 * /bgs commands still work); the bot writes the threads and the recap.
 */
export function bgsOverwrites(guildId: string, roleId: string, botId: string): PermissionOverwrite[] {
  return [
    hidden(guildId),
    {
      id: roleId,
      type: 0,
      allow: String(VIEW_CHANNEL | READ_MESSAGE_HISTORY | USE_APPLICATION_COMMANDS),
      deny: String(WRITE),
    },
    {
      id: botId,
      type: 1,
      allow: String(
        VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | CREATE_PUBLIC_THREADS | SEND_MESSAGES_IN_THREADS,
      ),
      deny: "0",
    },
  ];
}

/** The role named ROLE_NAME (any case), created when the server has none. */
export async function ensureRole(api: DiscordApi, guildId: string): Promise<{ id: string; created: boolean }> {
  const existing = (await api.guildRoles(guildId)).find((r) => r.name.toLowerCase() === ROLE_NAME.toLowerCase());
  return existing
    ? { id: existing.id, created: false }
    : { id: await api.createRole(guildId, ROLE_NAME), created: true };
}

/** The text channel of that name, created with these permissions when the server has none. */
export async function ensureChannel(
  api: DiscordApi,
  guildId: string,
  name: string,
  overwrites: PermissionOverwrite[],
): Promise<{ id: string; created: boolean }> {
  const existing = await findChannel(api, guildId, name);
  if (existing) {
    // Set up again: the bot's own permissions are applied again (only those, others are kept).
    for (const overwrite of overwrites) await api.setChannelPermission(existing, overwrite);
    return { id: existing, created: false };
  }
  return { id: await api.createChannel(guildId, name, overwrites), created: true };
}

/** The settings pinned in the channel by the bot (`botId`), with the message holding them. */
export async function readConfig(
  api: DiscordApi,
  channelId: string,
  botId: string,
): Promise<{ config: GuildConfig; messageId: string } | null> {
  for (const message of await api.pinnedMessages(channelId)) {
    if (message.author.id !== botId || !message.content.includes(CONFIG_MARK)) continue;
    const json = /```json\n([\s\S]*?)\n```/.exec(message.content)?.[1];
    try {
      const raw = JSON.parse(json ?? "");
      if (typeof raw.role !== "string") continue;
      // Older settings held one faction; now a list, the default first.
      const listed: unknown[] = Array.isArray(raw.factions) ? raw.factions : [raw.faction];
      const factions = listed
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0 && f.length <= 120)
        .slice(0, MAX_FACTIONS);
      const revoked: Record<string, number> = {};
      for (const [user, time] of Object.entries(raw.revoked ?? {}))
        if (/^\d{17,20}$/.test(user) && Number.isInteger(time)) revoked[user] = time as number;
      const recapTick = typeof raw.recap === "string" && Number.isFinite(Date.parse(raw.recap)) ? raw.recap : undefined;
      const id = (value: unknown) => (typeof value === "string" && /^\d{17,20}$/.test(value) ? value : undefined);
      return {
        config: {
          factions,
          roleId: raw.role,
          bgsChannelId: id(raw.bgs),
          linkChannelId: id(raw.link),
          revoked,
          recapTick,
        },
        messageId: message.id,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** The settings message's text (the JSON is what the bot reads back). */
export function configMessage(config: GuildConfig): string {
  const json = JSON.stringify({
    edch: "config",
    v: 1,
    factions: config.factions,
    role: config.roleId,
    bgs: config.bgsChannelId,
    link: config.linkChannelId,
    revoked: config.revoked,
    recap: config.recapTick,
  });
  const followed = config.factions.length ? config.factions.map((f) => `**${f}**`).join(", ") : "none yet";
  return `**EDCH settings** (written by the bot: change them with /bgs setup and /bgs faction)\nFactions: ${followed} · role: <@&${config.roleId}>\n\`\`\`json\n${json}\n\`\`\``;
}

/** Writes the settings: edits the pinned message, or posts and pins a new one. */
export async function writeConfig(api: DiscordApi, channelId: string, config: GuildConfig, messageId?: string) {
  const content = configMessage(config);
  if (messageId) return api.editMessage(channelId, messageId, content);
  const message = await api.sendMessage(channelId, content);
  await api.pinMessage(channelId, message.id);
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).text();
}

type Row = [number, number, string, number | null, number | null, 0 | 1];
const row = (a: ReportAction): Row => [
  Math.round(Date.parse(a.at) / 1000),
  ACTION_KINDS.indexOf(a.kind),
  a.system,
  a.influence ?? null,
  a.credits ?? null,
  a.against ? 1 : 0,
];

/** The data of some actions as stored in a message. */
async function encode(userId: string, faction: string, rows: Row[]): Promise<string> {
  return REPORT_MARK + base64Url(await deflate(JSON.stringify({ u: userId, f: faction, a: rows })));
}

/**
 * The messages of a report: as many as needed for the data to fit, each with the readable line
 * ("<@member> · 12 actions") and its share of the actions.
 */
export async function reportMessages(userId: string, faction: string, actions: ReportAction[]): Promise<string[]> {
  const messages: string[] = [];
  let pending: Row[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const count = pending.length;
    messages.push(
      `📥 <@${userId}> · ${faction} · ${count} action${count > 1 ? "s" : ""}\n||${await encode(userId, faction, pending)}||`,
    );
    pending = [];
  };
  for (const action of actions) {
    pending.push(row(action));
    if ((await encode(userId, faction, pending)).length > MAX_DATA_CHARS) {
      const last = pending.pop()!;
      await flush();
      pending = [last];
    }
  }
  await flush();
  return messages;
}

/** The actions of a message written by `reportMessages` (none when it isn't one). */
export async function messageActions(content: string): Promise<StoredAction[]> {
  const data = new RegExp(`${REPORT_MARK}([A-Za-z0-9_-]+)`).exec(content)?.[1];
  const bytes = data ? fromBase64Url(data) : null;
  if (!bytes) return [];
  try {
    const raw = JSON.parse(await inflate(bytes));
    if (typeof raw.u !== "string" || !Array.isArray(raw.a)) return [];
    return (raw.a as Row[])
      .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && ACTION_KINDS[r[1]] && typeof r[2] === "string")
      .map((r) => ({
        userId: raw.u,
        faction: typeof raw.f === "string" ? raw.f : undefined,
        at: new Date(r[0] * 1000).toISOString(),
        kind: ACTION_KINDS[r[1]],
        system: r[2],
        influence: r[3] ?? undefined,
        credits: r[4] ?? undefined,
        against: r[5] === 1,
      }));
  } catch {
    return [];
  }
}

/** Discord's id of a moment: messages after it were sent after that time. */
export function snowflakeAt(time: number): string {
  const DISCORD_EPOCH = 1420070400000n;
  return ((BigInt(Math.max(0, Math.floor(time))) - DISCORD_EPOCH) << 22n).toString();
}

/**
 * What was reported since `since` (ISO), read from the bot's messages of the channel in one pass:
 * the actions (the same action sent twice, EDCH retrying, counts once) and the systems seen.
 */
export async function readData(
  api: DiscordApi,
  channelId: string,
  botId: string,
  since: string,
): Promise<{ actions: StoredAction[]; snapshots: StoredSnapshot[] }> {
  const seen = new Set<string>();
  const actions: StoredAction[] = [];
  const snapshots: StoredSnapshot[] = [];
  let after = snowflakeAt(Date.parse(since) - 60_000);
  for (let page = 0; page < MAX_PAGES; page++) {
    const messages = await api.messagesAfter(channelId, after);
    if (!messages.length) break;
    for (const message of messages) {
      if (message.author.id !== botId) continue;
      for (const action of await messageActions(message.content)) {
        const key = `${action.userId}|${action.at}|${action.kind}|${action.system}|${action.credits ?? ""}`;
        if (action.at < since || seen.has(key)) continue;
        seen.add(key);
        actions.push(action);
      }
      for (const snapshot of await messageSnapshots(message.content))
        if (snapshot.at >= since) snapshots.push(snapshot);
    }
    after = messages[messages.length - 1].id;
    if (messages.length < 100) break;
  }
  return { actions, snapshots };
}

/** The actions reported since `since` (ISO). */
export async function readActions(
  api: DiscordApi,
  channelId: string,
  botId: string,
  since: string,
): Promise<StoredAction[]> {
  return (await readData(api, channelId, botId, since)).actions;
}

// Shapes shared by the bot's parts: the Worker's environment, a server's settings, the actions
// EDCH reports, and the few Discord calls the bot makes (real ones in discordRest.ts, a fake one
// in the tests).

/** The Worker's settings and secrets (wrangler.toml, `wrangler secret put`). */
export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  /** Signs the keys given to EDCH (HMAC-SHA256). Changing it cancels every key. */
  LINK_SECRET: string;
  /** Empty for the shared bot; a server id for a squadron's own copy (that server only). */
  DISCORD_GUILD_ID?: string;
}

/** A server's settings, kept in a pinned message of its #edch-sync channel. */
export interface GuildConfig {
  /** The minor faction the squadron follows. */
  faction: string;
  /** The role a member needs to link EDCH and to report. */
  roleId: string;
  /** The channel people read (threads by system, daily recap); the data channel when missing. */
  bgsChannelId?: string;
  /** The only channel where /bgs link works, when the admins chose one. */
  linkChannelId?: string;
  /** Keys cancelled by /bgs revoke: member → keys issued before this time (Unix seconds) refused. */
  revoked: Record<string, number>;
  /** The tick of the last daily recap (ISO), so each BGS day gets one (threads.ts). */
  recapTick?: string;
}

/** What EDCH counts (docs/BGS_SYNC.md in EDCH). */
export const ACTION_KINDS = [
  "mission",
  "missionFailed",
  "missionAbandoned",
  "bounty",
  "combatBond",
  "trade",
  "blackMarket",
  "exploration",
  "crime",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** One action of a report, checked. */
export interface ReportAction {
  at: string;
  kind: ActionKind;
  system: string;
  influence?: number;
  credits?: number;
  against: boolean;
}

/** An action read back from the channel, with who reported it. */
export interface StoredAction extends ReportAction {
  userId: string;
}

/** A Discord message, as far as the bot needs it. */
export interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string };
  timestamp: string;
}

/** A channel permission overwrite: a role (type 0) or a member (type 1), bits as strings. */
export interface PermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

/** A server's channel, as far as the bot needs it. */
export interface DiscordChannel {
  id: string;
  name: string;
  /** 0 = text channel. */
  type: number;
}

/**
 * The Discord calls the bot makes. Every one names the server or channel it works on: the bot
 * only ever passes those of the request it answers (a signed interaction, or a signed key).
 */
export interface DiscordApi {
  /** The member's roles on the server, or null when they're not (or no longer) a member. */
  memberRoles(guildId: string, userId: string): Promise<string[] | null>;
  guildChannels(guildId: string): Promise<DiscordChannel[]>;
  guildRoles(guildId: string): Promise<{ id: string; name: string }[]>;
  /** Creates a role without any permission of its own (needs Manage Roles). */
  createRole(guildId: string, name: string): Promise<string>;
  /** Creates a text channel with these permission overwrites (needs Manage Channels). */
  createChannel(guildId: string, name: string, overwrites: PermissionOverwrite[]): Promise<string>;
  /** The server's active threads, with the channel each belongs to. */
  activeThreads(guildId: string): Promise<{ id: string; name: string; parentId: string }[]>;
  /** The channel's archived public threads (the most recent ones). */
  archivedThreads(channelId: string): Promise<{ id: string; name: string }[]>;
  /** Creates a public thread in the channel, archived by Discord after that long without messages. */
  createThread(channelId: string, name: string, autoArchiveMinutes: number): Promise<string>;
  /** The channel's server (to check that a channel belongs to the server a key names). */
  channelGuild(channelId: string): Promise<string | null>;
  pinnedMessages(channelId: string): Promise<DiscordMessage[]>;
  /** Messages after `afterId` (oldest first), at most 100. */
  messagesAfter(channelId: string, afterId: string): Promise<DiscordMessage[]>;
  sendMessage(channelId: string, content: string): Promise<DiscordMessage>;
  editMessage(channelId: string, messageId: string, content: string): Promise<void>;
  pinMessage(channelId: string, messageId: string): Promise<void>;
  /** Sends a direct message; false when the member doesn't accept them from the server's members. */
  sendDirectMessage(userId: string, content: string): Promise<boolean>;
  /** Replaces the answer to an interaction that was deferred (its token is valid 15 minutes). */
  editInteractionReply(applicationId: string, interactionToken: string, content: string): Promise<void>;
}

/** Discord refused a call; `status` 403 means the bot lacks a permission. */
export class DiscordHttpError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`Discord ${what}: ${status}`);
  }
}

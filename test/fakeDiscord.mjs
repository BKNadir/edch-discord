// An in-memory Discord for the tests: servers, channels, members with roles, messages and pins,
// with Discord's rules for what the bot can reach (a channel belongs to one server).

// Ids are Discord "snowflakes": they carry their time (here 2026-11-13 19:30 UTC, then later).
import { DiscordHttpError } from "../dist-test/types.js";

let nextId = (BigInt(Date.parse("2026-11-13T19:30:00Z")) - 1420070400000n) << 22n;
const newId = () => String(nextId++);

export const BOT_ID = "1100000000000000001";

export function fakeDiscord() {
  /** guildId → { channels: [{id, name, type}], members: Map(userId → roles[]) } */
  const guilds = new Map();
  /** channelId → { guildId, messages: [], pins: Set } */
  const channels = new Map();
  const replies = [];
  /** Direct messages sent: { userId, content }. Members in `closedDms` don't accept them. */
  const dms = [];
  const closedDms = new Set();
  const calls = [];

  const api = {
    async memberRoles(guildId, userId) {
      calls.push(["memberRoles", guildId]);
      return guilds.get(guildId)?.members.get(userId) ?? null;
    },
    async guildChannels(guildId) {
      calls.push(["guildChannels", guildId]);
      return guilds.get(guildId)?.channels ?? [];
    },
    async channelGuild(channelId) {
      return channels.get(channelId)?.guildId ?? null;
    },
    async pinnedMessages(channelId) {
      calls.push(["pins", channelId]);
      const c = channels.get(channelId);
      return c ? c.messages.filter((m) => c.pins.has(m.id)) : [];
    },
    async messagesAfter(channelId, afterId) {
      calls.push(["messages", channelId]);
      const c = channels.get(channelId);
      return c ? c.messages.filter((m) => BigInt(m.id) > BigInt(afterId)).slice(0, 100) : [];
    },
    async sendMessage(channelId, content) {
      calls.push(["send", channelId]);
      const c = channels.get(channelId);
      if (!c) throw new Error("unknown channel");
      if (content.length > 2000) throw new Error("message too long");
      c.archived = false;
      const message = { id: newId(), content, author: { id: BOT_ID }, timestamp: new Date().toISOString() };
      c.messages.push(message);
      return message;
    },
    async editMessage(channelId, messageId, content) {
      const m = channels.get(channelId)?.messages.find((x) => x.id === messageId);
      if (!m) throw new Error("unknown message");
      m.content = content;
    },
    async pinMessage(channelId, messageId) {
      channels.get(channelId).pins.add(messageId);
    },
    async sendDirectMessage(userId, content) {
      if (closedDms.has(userId)) return false;
      dms.push({ userId, content });
      return true;
    },
    async editInteractionReply(appId, token, content) {
      replies.push({ appId, token, content });
    },
    async guildRoles(guildId) {
      return guilds.get(guildId)?.roles ?? [];
    },
    async createRole(guildId, name) {
      const g = guilds.get(guildId);
      if (g.readOnly) throw new DiscordHttpError(403, "POST roles");
      const id = newId();
      g.roles.push({ id, name });
      return id;
    },
    async activeThreads(guildId) {
      return [...channels.entries()]
        .filter(([, c]) => c.guildId === guildId && c.parent && !c.archived)
        .map(([id, c]) => ({ id, name: c.name, parentId: c.parent }));
    },
    async archivedThreads(channelId) {
      return [...channels.entries()]
        .filter(([, c]) => c.parent === channelId && c.archived)
        .map(([id, c]) => ({ id, name: c.name }));
    },
    async createThread(channelId, name, autoArchiveMinutes) {
      const parent = channels.get(channelId);
      if (!parent) throw new Error("unknown channel");
      const id = newId();
      channels.set(id, {
        guildId: parent.guildId,
        parent: channelId,
        name,
        autoArchiveMinutes,
        messages: [],
        pins: new Set(),
      });
      return id;
    },
    async createChannel(guildId, name, overwrites) {
      const g = guilds.get(guildId);
      if (g.readOnly) throw new DiscordHttpError(403, "POST channels");
      const id = newId();
      g.channels.push({ id, name, type: 0, overwrites });
      channels.set(id, { guildId, messages: [], pins: new Set() });
      return id;
    },
  };

  return {
    api,
    replies,
    dms,
    closedDms,
    calls,
    addGuild(guildId, { channelName = "edch-sync", withChannel = true, readOnly = false } = {}) {
      const channelId = newId();
      guilds.set(guildId, {
        channels: withChannel ? [{ id: channelId, name: channelName, type: 0 }] : [],
        roles: [],
        members: new Map(),
        readOnly,
      });
      if (withChannel) channels.set(channelId, { guildId, messages: [], pins: new Set() });
      return channelId;
    },
    guild(guildId) {
      return guilds.get(guildId);
    },
    setMember(guildId, userId, roles) {
      guilds.get(guildId).members.set(userId, roles);
    },
    removeMember(guildId, userId) {
      guilds.get(guildId).members.delete(userId);
    },
    messages(channelId) {
      return channels.get(channelId).messages;
    },
    /** The threads of a channel: name → { id, messages, archived }. */
    threads(channelId) {
      return Object.fromEntries(
        [...channels.entries()].filter(([, c]) => c.parent === channelId).map(([id, c]) => [c.name, { id, ...c }]),
      );
    },
    archive(threadId) {
      channels.get(threadId).archived = true;
    },
    /** A message someone else wrote (not the bot). */
    postAs(channelId, userId, content) {
      channels.get(channelId).messages.push({ id: newId(), content, author: { id: userId }, timestamp: "" });
    },
  };
}

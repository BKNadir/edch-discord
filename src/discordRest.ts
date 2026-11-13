// The Discord calls (REST API v10) with the bot's token. Mentions in the bot's messages never
// notify anyone (allowed_mentions: none); a rate limit gets one short wait and one retry.

import {
  type DiscordApi,
  type DiscordChannel,
  DiscordHttpError,
  type DiscordMessage,
  type MessagePayload,
} from "./types.js";

/** A message as Discord's JSON: no mention ever notifies anyone. */
const asBody = (message: string | MessagePayload) => ({
  ...(typeof message === "string" ? { content: message } : message),
  allowed_mentions: { parse: [] },
});

const API = "https://discord.com/api/v10";

export function discordRest(botToken: string): DiscordApi {
  async function call(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "EDCH-Discord (https://github.com/BKNadir/edch, 1)",
        ...(auth ? { Authorization: `Bot ${botToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let response = await fetch(API + path, init);
    if (response.status === 429) {
      const wait = Number(
        (
          (await response
            .clone()
            .json()
            .catch(() => ({}))) as { retry_after?: number }
        ).retry_after ?? 1,
      );
      if (wait <= 3) {
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        response = await fetch(API + path, init);
      }
    }
    return response;
  }
  async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    if (!response.ok) throw new DiscordHttpError(response.status, `${method} ${path.split("?")[0]}`);
    return (await response.json()) as T;
  }
  const quiet = { allowed_mentions: { parse: [] } };

  return {
    async memberRoles(guildId, userId) {
      const response = await call("GET", `/guilds/${guildId}/members/${userId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Discord member: ${response.status}`);
      return ((await response.json()) as { roles: string[] }).roles;
    },
    guildChannels: (guildId) => json<DiscordChannel[]>("GET", `/guilds/${guildId}/channels`),
    guildRoles: (guildId) => json<{ id: string; name: string }[]>("GET", `/guilds/${guildId}/roles`),
    async createRole(guildId, name) {
      const role = await json<{ id: string }>("POST", `/guilds/${guildId}/roles`, {
        name,
        permissions: "0",
        mentionable: false,
      });
      return role.id;
    },
    async activeThreads(guildId) {
      const answer = await json<{ threads: { id: string; name: string; parent_id: string }[] }>(
        "GET",
        `/guilds/${guildId}/threads/active`,
      );
      return answer.threads.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id }));
    },
    async archivedThreads(channelId) {
      const answer = await json<{ threads: { id: string; name: string }[] }>(
        "GET",
        `/channels/${channelId}/threads/archived/public?limit=100`,
      );
      return answer.threads.map((t) => ({ id: t.id, name: t.name }));
    },
    async createThread(channelId, name, autoArchiveMinutes) {
      // 11 = public thread (in a private channel, only those who see the channel see it).
      const thread = await json<{ id: string }>("POST", `/channels/${channelId}/threads`, {
        name,
        type: 11,
        auto_archive_duration: autoArchiveMinutes,
      });
      return thread.id;
    },
    async createChannel(guildId, name, overwrites) {
      const channel = await json<{ id: string }>("POST", `/guilds/${guildId}/channels`, {
        name,
        type: 0,
        topic: "EDCH: the squadron's BGS reports (written by the bot). Members link EDCH with /bgs link.",
        permission_overwrites: overwrites,
      });
      return channel.id;
    },
    async setChannelPermission(channelId, overwrite) {
      const response = await call("PUT", `/channels/${channelId}/permissions/${overwrite.id}`, {
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny,
      });
      if (!response.ok) throw new DiscordHttpError(response.status, "PUT channel permission");
    },
    async channelGuild(channelId) {
      const response = await call("GET", `/channels/${channelId}`);
      if (!response.ok) return null;
      return ((await response.json()) as { guild_id?: string }).guild_id ?? null;
    },
    pinnedMessages: (channelId) => json<DiscordMessage[]>("GET", `/channels/${channelId}/pins`),
    async messagesAfter(channelId, afterId) {
      const messages = await json<DiscordMessage[]>(
        "GET",
        `/channels/${channelId}/messages?after=${afterId}&limit=100`,
      );
      // Discord gives them newest first.
      return messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    },
    sendMessage: (channelId, message) =>
      json<DiscordMessage>("POST", `/channels/${channelId}/messages`, asBody(message)),
    async editMessage(channelId, messageId, content) {
      await json("PATCH", `/channels/${channelId}/messages/${messageId}`, { content, ...quiet });
    },
    async pinMessage(channelId, messageId) {
      const response = await call("PUT", `/channels/${channelId}/pins/${messageId}`);
      if (!response.ok) throw new Error(`Discord pin: ${response.status}`);
    },
    async sendDirectMessage(userId, content) {
      try {
        const dm = await json<{ id: string }>("POST", "/users/@me/channels", { recipient_id: userId });
        await json("POST", `/channels/${dm.id}/messages`, { content, ...quiet });
        return true;
      } catch (error) {
        // 403: the member blocks direct messages from this server's members.
        if (error instanceof DiscordHttpError && error.status === 403) return false;
        throw error;
      }
    },
    async editInteractionReply(appId, interactionToken, message) {
      // The interaction's own token authorises this call, not the bot's.
      const response = await call(
        "PATCH",
        `/webhooks/${appId}/${interactionToken}/messages/@original`,
        asBody(message),
        false,
      );
      if (!response.ok) throw new DiscordHttpError(response.status, "PATCH interaction reply");
    },
  };
}

// The Discord calls (REST API v10) with the bot's token. Mentions in the bot's messages never
// notify anyone (allowed_mentions: none); a rate limit gets one short wait and one retry.

import type { DiscordApi, DiscordChannel, DiscordMessage } from "./types.js";

const API = "https://discord.com/api/v10";

export function discordRest(botToken: string, applicationId: string): DiscordApi {
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
    if (!response.ok) throw new Error(`Discord ${method} ${path.split("?")[0]}: ${response.status}`);
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
    sendMessage: (channelId, content) =>
      json<DiscordMessage>("POST", `/channels/${channelId}/messages`, { content, ...quiet }),
    async editMessage(channelId, messageId, content) {
      await json("PATCH", `/channels/${channelId}/messages/${messageId}`, { content, ...quiet });
    },
    async pinMessage(channelId, messageId) {
      const response = await call("PUT", `/channels/${channelId}/pins/${messageId}`);
      if (!response.ok) throw new Error(`Discord pin: ${response.status}`);
    },
    async editInteractionReply(interactionToken, content) {
      // The interaction's own token authorises this call, not the bot's.
      await call(
        "PATCH",
        `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        { content, ...quiet },
        false,
      );
    },
  };
}

// The /bgs command, answered from Discord's signed interactions. Discord tells which server, which
// member and their roles and permissions: the bot trusts those (the signature is checked first,
// index.ts) and never a server or channel typed by someone.
//
//   /bgs setup faction [role] admins: the faction followed; creates the BGS role and the private
//                             #edch-bgs channel when the server has none
//   /bgs link                 members with the role: a key for their EDCH (only they see it)
//   /bgs unlink               a member cancels their own keys
//   /bgs revoke member        admins: cancel a member's keys
//   /bgs summary [period]     members with the role: what the squadron did, by system
//
// Answers that need Discord's API are deferred (Discord gives 3 seconds) and written after.

import { makeKey } from "./key.js";
import {
  CHANNEL_NAME,
  ensureChannel,
  ensureRole,
  findChannel,
  readActions,
  readConfig,
  writeConfig,
} from "./storage.js";
import { summaryText } from "./summary.js";
import { type DiscordApi, DiscordHttpError, type Env, type GuildConfig } from "./types.js";

/** Permission bits: Administrator, Manage Server. */
const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;
/** Interaction answers: pong, message, deferred message; message flag: only the member sees it. */
const PONG = 1;
const MESSAGE = 4;
const DEFERRED = 5;
const EPHEMERAL = 64;

export const TICK_URL = "https://tick.edcd.io/api/tick";

export interface Context {
  env: Env;
  api: DiscordApi;
  /** The bot's own address (https://…), written into the keys. */
  botUrl: string;
  now: number;
  /** The last BGS tick (ISO), or null when unknown. */
  tick: () => Promise<string | null>;
}

/** What to answer now, and the work that finishes the answer afterwards. */
export interface Answer {
  response: Record<string, unknown>;
  later?: () => Promise<void>;
}

interface Interaction {
  type: number;
  token: string;
  /** The bot's application (also its user id): Discord sends it with every interaction. */
  application_id: string;
  guild_id?: string;
  member?: { user: { id: string }; roles: string[]; permissions: string };
  data?: { name: string; options?: { name: string; options?: { name: string; value: unknown }[] }[] };
}

const reply = (content: string): Answer => ({
  response: { type: MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

const isAdmin = (permissions: string) => {
  try {
    const bits = BigInt(permissions);
    return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
};

const NO_CHANNEL = `The EDCH bot isn't set up on this server yet (no **#${CHANNEL_NAME}** channel): an admin runs \`/bgs setup faction:…\`, which creates it.`;
const MISSING_PERMISSIONS = `The bot couldn't create the role or the channel: it needs **Manage Roles** and **Manage Channels** (re-add it with the link, or give it these rights). Or create a private text channel **#${CHANNEL_NAME}** and a role yourself, then run \`/bgs setup\` again with \`role\`.`;
const NOT_SET_UP = "The EDCH bot isn't set up on this server yet: an admin runs `/bgs setup` first.";

/** Answers one interaction. */
export async function handleInteraction(interaction: Interaction, ctx: Context): Promise<Answer> {
  if (interaction.type === 1) return { response: { type: PONG } };
  if (interaction.type !== 2 || interaction.data?.name !== "bgs") return reply("Unknown command.");
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) return reply("The EDCH bot works in a server, not in direct messages.");
  if (ctx.env.DISCORD_GUILD_ID && guildId !== ctx.env.DISCORD_GUILD_ID)
    return reply("This copy of the EDCH bot belongs to another squadron: it does nothing here.");

  const sub = interaction.data.options?.[0];
  const option = (name: string) => sub?.options?.find((o) => o.name === name)?.value;
  const userId = member.user.id;
  // The bot's id: from the settings, or from Discord's own message when it isn't set.
  const botId = ctx.env.DISCORD_APPLICATION_ID || interaction.application_id;
  const admin = isAdmin(member.permissions);

  /** Runs `work` after a deferred answer, then writes its result as the answer. */
  const deferred = (work: () => Promise<string>): Answer => ({
    response: { type: DEFERRED, data: { flags: EPHEMERAL } },
    later: async () => {
      let content: string;
      try {
        content = await work();
      } catch (error) {
        // Shown in `wrangler tail`: what failed, never a secret.
        console.error(`/bgs ${sub?.name}: ${(error as Error)?.message ?? error}`);
        content =
          error instanceof DiscordHttpError && error.status === 401
            ? "The bot's token is wrong: its host sets DISCORD_BOT_TOKEN again (wrangler secret put) and deploys."
            : error instanceof DiscordHttpError && error.status === 403
              ? MISSING_PERMISSIONS
              : "Something went wrong talking to Discord. Try again in a moment.";
      }
      try {
        await ctx.api.editInteractionReply(interaction.application_id, interaction.token, content);
      } catch (error) {
        console.error(`/bgs ${sub?.name}: the answer couldn't be written: ${(error as Error)?.message ?? error}`);
      }
    },
  });

  /** The server's channel and settings, or the message saying what is missing. */
  const load = async (): Promise<{ channelId: string; config: GuildConfig; messageId: string } | string> => {
    const channelId = await findChannel(ctx.api, guildId);
    if (!channelId) return NO_CHANNEL;
    const found = await readConfig(ctx.api, channelId, botId);
    return found ? { channelId, ...found } : NOT_SET_UP;
  };

  switch (sub?.name) {
    case "setup": {
      if (!admin) return reply("Only admins (Manage Server) can set the EDCH bot up.");
      const givenRole = String(option("role") ?? "");
      const faction = String(option("faction") ?? "")
        .trim()
        .slice(0, 120);
      if (!faction || (givenRole && !/^\d{17,20}$/.test(givenRole)))
        return reply("Give the faction (and a role, if you want another one than BGS).");
      return deferred(async () => {
        const made: string[] = [];
        let roleId = givenRole;
        let channelId: string;
        try {
          if (!roleId) {
            const role = await ensureRole(ctx.api, guildId);
            roleId = role.id;
            if (role.created) made.push(`the role <@&${roleId}>`);
          }
          const channel = await ensureChannel(ctx.api, guildId, roleId, botId);
          channelId = channel.id;
          if (channel.created) made.push(`the private channel <#${channelId}>`);
        } catch (error) {
          if (error instanceof DiscordHttpError && error.status === 403) return MISSING_PERMISSIONS;
          throw error;
        }
        const found = await readConfig(ctx.api, channelId, botId);
        const config: GuildConfig = { faction, roleId, revoked: found?.config.revoked ?? {} };
        await writeConfig(ctx.api, channelId, config, found?.messageId);
        return [
          made.length ? `Created ${made.join(" and ")}.` : "",
          `Set up: the squadron follows **${faction}**. Give <@&${roleId}> to the members who report; they link EDCH with \`/bgs link\`. Reports go to <#${channelId}>.`,
        ]
          .filter(Boolean)
          .join("\n");
      });
    }

    case "link":
      return deferred(async () => {
        const loaded = await load();
        if (typeof loaded === "string") return loaded;
        if (!member.roles.includes(loaded.config.roleId))
          return `You need the <@&${loaded.config.roleId}> role to link EDCH: ask an admin.`;
        const key = await makeKey(
          { bot: ctx.botUrl, guildId, channelId: loaded.channelId, userId, issuedAt: Math.floor(ctx.now / 1000) },
          ctx.env.LINK_SECRET,
        );
        return [
          `Your EDCH key for **${loaded.config.faction}** (only you can see this message):`,
          "```",
          key,
          "```",
          'In EDCH: Sync → Connect to the Discord bot → paste the key and tick "Send BGS reports". Keep it to yourself: it reports in your name. `/bgs unlink` cancels it.',
        ].join("\n");
      });

    case "unlink":
    case "revoke": {
      const target = sub.name === "unlink" ? userId : String(option("member") ?? "");
      if (sub.name === "revoke" && !admin) return reply("Only admins (Manage Server) can cancel someone's keys.");
      if (!/^\d{17,20}$/.test(target)) return reply("Choose a member.");
      return deferred(async () => {
        const loaded = await load();
        if (typeof loaded === "string") return loaded;
        loaded.config.revoked[target] = Math.floor(ctx.now / 1000);
        await writeConfig(ctx.api, loaded.channelId, loaded.config, loaded.messageId);
        return sub.name === "unlink"
          ? "Your EDCH keys are cancelled. `/bgs link` gives you a new one."
          : `<@${target}>'s EDCH keys are cancelled. They need the role and \`/bgs link\` to report again.`;
      });
    }

    case "summary": {
      const period = String(option("period") ?? "tick");
      return deferred(async () => {
        const loaded = await load();
        if (typeof loaded === "string") return loaded;
        if (!admin && !member.roles.includes(loaded.config.roleId))
          return `You need the <@&${loaded.config.roleId}> role to see the summary.`;
        let since: string;
        let label: string;
        const tick = period === "tick" ? await ctx.tick() : null;
        if (tick) {
          since = tick;
          label = "since the last BGS tick";
        } else {
          const days = period === "7d" ? 7 : 1;
          since = new Date(ctx.now - days * 86_400_000).toISOString();
          label = days === 7 ? "last 7 days" : "last 24 hours";
        }
        const actions = await readActions(ctx.api, loaded.channelId, botId, since);
        // What a member reported before their keys were cancelled still counts: it was done.
        return summaryText(loaded.config.faction, label, actions);
      });
    }

    default:
      return reply("Unknown command.");
  }
}

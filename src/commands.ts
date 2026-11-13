// The bot's commands, answered from Discord's signed interactions. Discord tells which server,
// channel and member, with the member's roles and permissions: the bot trusts those (the signature
// is checked first, index.ts) and never a server or channel typed by someone.
//
// Admins only (Administrator or Manage Server; Discord lists subcommands to everyone, so the
// bot checks the rights Discord signed with the command):
//   /bgs setup [faction] [role] [link_channel]   creates the BGS role, #edch-sync (data, admins
//       only) and #edch-bgs (reading, the role) when missing; faction: added to those followed;
//       link_channel: the only channel where /bgs link works
//   /bgs faction add|remove|default name         the factions followed (allies on the same server):
//       up to MAX_FACTIONS, the default first; EDCH sends a report for each
//   /bgs revoke member                            cancels a member's keys
// Members with the role (admins too):
//   /bgs faction list      the factions followed, as a card; admins also get menus to change them
//   /bgs link              their EDCH key, by direct message
//   /bgs unlink            a member cancels their own keys
//   /bgs summary [period] [faction]   what the squadron did, one card per faction
// Slash commands leave nothing in the channel: every answer is seen by the member only.
// Answers that need Discord's API are deferred (Discord gives 3 seconds) and written after.
// Faction names are offered as you type (autocomplete): the game's factions (EliteBGS) when one is
// added, those the server follows elsewhere.

import { makeKey } from "./key.js";
import {
  BGS_CHANNEL,
  bgsOverwrites,
  ensureChannel,
  ensureRole,
  findChannel,
  MAX_FACTIONS,
  readActions,
  readConfig,
  ROLE_NAME,
  SYNC_CHANNEL,
  syncOverwrites,
  writeConfig,
} from "./storage.js";
import { sameFaction } from "./report.js";
import { EMBED_COLOR, summaryEmbeds } from "./summary.js";
import { type DiscordApi, DiscordHttpError, type Env, type GuildConfig, type MessagePayload } from "./types.js";

/** Permission bits: Administrator, Manage Server. */
const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;
/** Interactions Discord sends: ping, command, a menu chosen in a message, typing an option. */
const PING = 1;
const COMMAND = 2;
const COMPONENT = 3;
const AUTOCOMPLETE = 4;
/** Interaction answers; message flag: only the member sees it. */
const PONG = 1;
const MESSAGE = 4;
const DEFERRED = 5;
const DEFERRED_UPDATE = 6;
const AUTOCOMPLETE_RESULT = 8;
const EPHEMERAL = 64;
/** Message components: a row, a menu of texts. */
const ACTION_ROW = 1;
const STRING_SELECT = 3;
/** The menus of /bgs faction list (their custom_id). */
const MENU_DEFAULT = "bgs:faction:default";
const MENU_REMOVE = "bgs:faction:remove";
/** Discord: a menu option's value and label, at most 100 characters; a faction name too here. */
export const MAX_FACTION_NAME = 100;

export const TICK_URL = "https://tick.edcd.io/api/tick";
/** EliteBGS (public BGS data): the game's factions whose name starts with what an admin types. */
export const FACTION_SEARCH_URL = "https://elitebgs.app/api/ebgs/v5/factions";
/** Discord waits 3 seconds for the choices: the search gets half of it. */
const SEARCH_TIMEOUT_MS = 1500;

/** The game's factions starting with `typed` (EliteBGS), or [] when it doesn't answer in time. */
export async function searchGameFactions(typed: string): Promise<string[]> {
  if (typed.trim().length < 2) return [];
  try {
    const url = `${FACTION_SEARCH_URL}?minimal=true&beginsWith=${encodeURIComponent(typed.trim())}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const answer = (await response.json()) as { docs?: { name?: unknown }[] };
    return (answer.docs ?? [])
      .map((d) => d.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= MAX_FACTION_NAME);
  } catch {
    return [];
  }
}

export interface Context {
  env: Env;
  api: DiscordApi;
  /** The bot's own address (https://…), written into the keys. */
  botUrl: string;
  now: number;
  /** The last BGS tick (ISO), or null when unknown. */
  tick: () => Promise<string | null>;
  /** The game's factions starting with a text (autocomplete of /bgs faction add). */
  searchFactions?: (typed: string) => Promise<string[]>;
}

/** What to answer now, and the work that finishes the answer afterwards. */
export interface Answer {
  response: Record<string, unknown>;
  later?: () => Promise<void>;
}

/** A command's option; subcommand groups and subcommands carry their own options. */
interface InteractionOption {
  name: string;
  type?: number;
  value?: unknown;
  focused?: boolean;
  options?: InteractionOption[];
}

interface Interaction {
  type: number;
  token: string;
  /** The bot's application (also its user id): Discord sends it with every interaction. */
  application_id: string;
  guild_id?: string;
  /** The channel the command was typed in. */
  channel_id?: string;
  member?: { user: { id: string }; roles: string[]; permissions: string };
  data?: {
    name?: string;
    options?: InteractionOption[];
    /** A menu's id and what was chosen in it (components). */
    custom_id?: string;
    values?: string[];
  };
}

/** The factions followed, as a card: the default first, starred. */
export function factionListPayload(config: GuildConfig, admin: boolean): MessagePayload {
  const lines = config.factions.map((f, i) => (i === 0 ? `⭐ **${f}** (default)` : `• ${f}`));
  const embed = {
    title: "Factions followed",
    color: EMBED_COLOR,
    description: lines.length ? lines.join("\n") : "None yet: an admin adds one with `/bgs faction add`.",
    footer: {
      text: `${config.factions.length}/${MAX_FACTIONS} · EDCH sends a report for each faction its commander works for`,
    },
  };
  // Menus for admins only (the member's rights are checked again when one is used).
  const menu = (customId: string, placeholder: string, factions: string[]) => ({
    type: ACTION_ROW,
    components: [
      {
        type: STRING_SELECT,
        custom_id: customId,
        placeholder,
        options: factions.map((f) => ({ label: f, value: f })),
      },
    ],
  });
  const components = [];
  if (admin && config.factions.length > 1)
    components.push(menu(MENU_DEFAULT, "Make another faction the default", config.factions.slice(1)));
  if (admin && config.factions.length) components.push(menu(MENU_REMOVE, "Stop following a faction", config.factions));
  return { embeds: [embed], components };
}

/** The options of a command, down to the subcommand: [group?, subcommand, its options]. */
function commandPath(options: InteractionOption[] | undefined): { path: string; options: InteractionOption[] } {
  const first = options?.[0];
  if (!first) return { path: "", options: [] };
  // 2 = subcommand group: its first option is the subcommand.
  if (first.type === 2 && first.options?.[0])
    return { path: `${first.name} ${first.options[0].name}`, options: first.options[0].options ?? [] };
  return { path: first.name, options: first.options ?? [] };
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

const NO_CHANNEL = `The EDCH bot isn't set up on this server yet (no **#${SYNC_CHANNEL}** channel): an admin runs \`/bgs setup\`, which creates it.`;
const MISSING_PERMISSIONS = `The bot couldn't create the role or the channels: it needs **Manage Roles** and **Manage Channels** (re-add it with the link, or give it these rights). Or create the private text channels **#${SYNC_CHANNEL}** (admins and the bot) and **#${BGS_CHANNEL}** (the role and the bot) and a role yourself, then run \`/bgs setup\` again with \`role\`.`;
const NOT_SET_UP = "The EDCH bot isn't set up on this server yet: an admin runs `/bgs setup` first.";

/** Answers one interaction. */
export async function handleInteraction(interaction: Interaction, ctx: Context): Promise<Answer> {
  if (interaction.type === PING) return { response: { type: PONG } };
  const known =
    ((interaction.type === COMMAND || interaction.type === AUTOCOMPLETE) && interaction.data?.name === "bgs") ||
    (interaction.type === COMPONENT && interaction.data?.custom_id?.startsWith("bgs:"));
  if (!known) return reply("Unknown command.");
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) return reply("The EDCH bot works in a server, not in direct messages.");
  if (ctx.env.DISCORD_GUILD_ID && guildId !== ctx.env.DISCORD_GUILD_ID)
    return reply("This copy of the EDCH bot belongs to another squadron: it does nothing here.");

  const { path, options } = commandPath(interaction.data?.options);
  const option = (name: string) => options.find((o) => o.name === name)?.value;
  const userId = member.user.id;
  // The bot's id: from the settings, or from Discord's own message when it isn't set.
  const botId = ctx.env.DISCORD_APPLICATION_ID || interaction.application_id;
  const admin = isAdmin(member.permissions);
  const ADMIN_ONLY = new Set(["setup", "revoke", "faction add", "faction remove", "faction default"]);
  const NOT_ADMIN = "Only admins (Administrator or Manage Server) can configure the EDCH bot.";
  // Configuring is for admins; every subcommand is listed to everyone, so it's checked here.
  if (interaction.type === COMMAND && ADMIN_ONLY.has(path) && !admin) return reply(NOT_ADMIN);

  /** The server's channel and settings, or the message saying what is missing. */
  const load = async (): Promise<{ channelId: string; config: GuildConfig; messageId: string } | string> => {
    const channelId = await findChannel(ctx.api, guildId);
    if (!channelId) return NO_CHANNEL;
    const found = await readConfig(ctx.api, channelId, botId);
    return found ? { channelId, ...found } : NOT_SET_UP;
  };

  // Typing a faction's name (Discord shows at most 25 choices):
  // - /bgs faction add: the game's factions starting with it (EliteBGS), what was typed first;
  // - elsewhere: those the server follows that contain it.
  if (interaction.type === AUTOCOMPLETE) {
    const typed = String(options.find((o) => o.focused)?.value ?? "")
      .trim()
      .slice(0, MAX_FACTION_NAME);
    let names: string[] = [];
    if (path === "faction add" || path === "setup") {
      const found = admin && ctx.searchFactions ? await ctx.searchFactions(typed) : [];
      names = [...(typed ? [typed] : []), ...found.filter((f) => !sameFaction(f, typed))];
    } else {
      try {
        const loaded = await load();
        if (typeof loaded !== "string")
          names = loaded.config.factions.filter((f) => f.toLowerCase().includes(typed.toLowerCase()));
      } catch {
        // Nothing offered; the member can still type the name.
      }
    }
    const choices = names.slice(0, 25).map((f) => ({ name: f, value: f }));
    return { response: { type: AUTOCOMPLETE_RESULT, data: { choices } } };
  }

  /**
   * Runs `work` after a deferred answer, then writes its result as the answer. `update`: the
   * answer replaces the message whose menu was used (components) instead of a new one.
   */
  const deferred = (work: () => Promise<string | MessagePayload>, update = false): Answer => ({
    response: update ? { type: DEFERRED_UPDATE } : { type: DEFERRED, data: { flags: EPHEMERAL } },
    later: async () => {
      let content: string | MessagePayload;
      try {
        content = await work();
      } catch (error) {
        // Shown in `wrangler tail`: what failed, never a secret.
        console.error(`/bgs ${path || interaction.data?.custom_id}: ${(error as Error)?.message ?? error}`);
        content =
          error instanceof DiscordHttpError && error.status === 401
            ? "The bot's token is wrong: its host sets DISCORD_BOT_TOKEN again (wrangler secret put) and deploys."
            : error instanceof DiscordHttpError && error.status === 403
              ? MISSING_PERMISSIONS
              : "Something went wrong talking to Discord. Try again in a moment.";
      }
      try {
        // A text answer to a menu replaces the card: no embed or menu stays behind.
        const message = update && typeof content === "string" ? { content, embeds: [], components: [] } : content;
        await ctx.api.editInteractionReply(interaction.application_id, interaction.token, message);
      } catch (error) {
        console.error(
          `/bgs ${path || interaction.data?.custom_id}: the answer couldn't be written: ${(error as Error)?.message ?? error}`,
        );
      }
    },
  });

  /** Changes the factions followed (admins), then shows the list again. */
  const changeFactions = (change: (factions: string[]) => string[] | string, update = false): Answer => {
    if (!admin) return reply(NOT_ADMIN);
    return deferred(async () => {
      const loaded = await load();
      if (typeof loaded === "string") return loaded;
      const changed = change([...loaded.config.factions]);
      if (typeof changed === "string") return changed;
      const config = { ...loaded.config, factions: changed };
      await writeConfig(ctx.api, loaded.channelId, config, loaded.messageId);
      return factionListPayload(config, true);
    }, update);
  };
  const findFaction = (factions: string[], name: string) => factions.findIndex((f) => sameFaction(f, name));
  const removeFaction = (name: string) => (factions: string[]) => {
    const index = findFaction(factions, name);
    if (index < 0) return `**${name}** isn't followed: \`/bgs faction list\` shows those that are.`;
    factions.splice(index, 1);
    return factions;
  };
  const makeDefault = (name: string) => (factions: string[]) => {
    const index = findFaction(factions, name);
    if (index < 0) return `**${name}** isn't followed: add it first with \`/bgs faction add\`.`;
    return [factions[index], ...factions.filter((_, i) => i !== index)];
  };

  // A menu of the factions card.
  if (interaction.type === COMPONENT) {
    const chosen = String(interaction.data?.values?.[0] ?? "");
    if (!chosen) return reply("Nothing chosen.");
    if (interaction.data?.custom_id === MENU_DEFAULT) return changeFactions(makeDefault(chosen), true);
    if (interaction.data?.custom_id === MENU_REMOVE) return changeFactions(removeFaction(chosen), true);
    return reply("Unknown command.");
  }

  const factionName = String(option("name") ?? option("faction") ?? "")
    .trim()
    .slice(0, MAX_FACTION_NAME);

  switch (path) {
    case "faction add":
      if (!factionName) return reply("Give the faction's name, as the game writes it.");
      return changeFactions((factions) => {
        if (findFaction(factions, factionName) >= 0) return `**${factionName}** is followed already.`;
        if (factions.length >= MAX_FACTIONS)
          return `The bot follows ${MAX_FACTIONS} factions at most: remove one first (\`/bgs faction remove\`).`;
        return [...factions, factionName];
      });

    case "faction remove":
      if (!factionName) return reply("Choose a faction.");
      return changeFactions(removeFaction(factionName));

    case "faction default":
      if (!factionName) return reply("Choose a faction.");
      return changeFactions(makeDefault(factionName));

    case "faction list":
      return deferred(async () => {
        const loaded = await load();
        if (typeof loaded === "string") return loaded;
        if (!admin && !member.roles.includes(loaded.config.roleId))
          return `You need the <@&${loaded.config.roleId}> role to see the factions.`;
        return factionListPayload(loaded.config, admin);
      });

    case "setup": {
      const givenRole = String(option("role") ?? "");
      const linkChannel = String(option("link_channel") ?? "");
      const faction = factionName;
      const snowflake = (value: string) => !value || /^\d{17,20}$/.test(value);
      if (!snowflake(givenRole) || !snowflake(linkChannel))
        return reply(`Choose a role (if you want another one than ${ROLE_NAME}) and a text channel.`);
      return deferred(async () => {
        const made: string[] = [];
        let roleId = givenRole;
        let syncId: string;
        let bgsId: string;
        try {
          if (!roleId) {
            const role = await ensureRole(ctx.api, guildId);
            roleId = role.id;
            if (role.created) made.push(`the role <@&${roleId}>`);
          }
          const sync = await ensureChannel(ctx.api, guildId, SYNC_CHANNEL, syncOverwrites(guildId, botId));
          syncId = sync.id;
          if (sync.created) made.push(`<#${syncId}> (data, admins only)`);
          const bgs = await ensureChannel(ctx.api, guildId, BGS_CHANNEL, bgsOverwrites(guildId, roleId, botId));
          bgsId = bgs.id;
          if (bgs.created) made.push(`<#${bgsId}> (for the role)`);
        } catch (error) {
          if (error instanceof DiscordHttpError && error.status === 403) return MISSING_PERMISSIONS;
          throw error;
        }
        const found = await readConfig(ctx.api, syncId, botId);
        // Setting up again keeps the factions followed; a faction given is added (the first one is the default).
        const factions = [...(found?.config.factions ?? [])];
        let factionNote = "";
        if (faction && findFaction(factions, faction) < 0) {
          if (factions.length < MAX_FACTIONS) factions.push(faction);
          else factionNote = `**${faction}** isn't added: the bot follows ${MAX_FACTIONS} factions at most.`;
        }
        const config: GuildConfig = {
          factions,
          roleId,
          bgsChannelId: bgsId,
          linkChannelId: linkChannel || undefined,
          revoked: found?.config.revoked ?? {},
          recapTick: found?.config.recapTick,
        };
        await writeConfig(ctx.api, syncId, config, found?.messageId);
        return [
          made.length ? `Created ${made.join(", ")}.` : "",
          factionNote,
          factions.length
            ? `Set up: the squadron follows ${factions.map((f) => `**${f}**`).join(", ")} (\`/bgs faction add\` adds an allied faction).`
            : "Set up. Now add the faction to follow: `/bgs faction add`.",
          `Give <@&${roleId}> to the members who report; they link EDCH with \`/bgs link\`${linkChannel ? ` in <#${linkChannel}>` : ""}. The squadron's work shows in <#${bgsId}>.`,
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
        if (loaded.config.linkChannelId && interaction.channel_id !== loaded.config.linkChannelId)
          return `\`/bgs link\` works in <#${loaded.config.linkChannelId}> only.`;
        const key = await makeKey(
          { bot: ctx.botUrl, guildId, channelId: loaded.channelId, userId, issuedAt: Math.floor(ctx.now / 1000) },
          ctx.env.LINK_SECRET,
        );
        const text = [
          `Your EDCH key for ${loaded.config.factions.map((f) => `**${f}**`).join(", ") || "this server"}:`,
          "```",
          key,
          "```",
          'In EDCH: Sync → Connect to the Discord bot → paste the key and tick "Send BGS reports". Keep it to yourself: it reports in your name. `/bgs unlink` cancels it.',
        ].join("\n");
        // By direct message, so it stays with the member; only they see this answer anyway.
        if (await ctx.api.sendDirectMessage(userId, text)) return "Your EDCH key is in your direct messages.";
        return `${text}\n(Your direct messages are closed to this server, so the key is here: only you can see it.)`;
      });

    case "unlink":
    case "revoke": {
      const target = path === "unlink" ? userId : String(option("member") ?? "");
      if (!/^\d{17,20}$/.test(target)) return reply("Choose a member.");
      return deferred(async () => {
        const loaded = await load();
        if (typeof loaded === "string") return loaded;
        loaded.config.revoked[target] = Math.floor(ctx.now / 1000);
        await writeConfig(ctx.api, loaded.channelId, loaded.config, loaded.messageId);
        return path === "unlink"
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
        // What a member reported before their keys were cancelled still counts: it was done.
        const actions = await readActions(ctx.api, loaded.channelId, botId, since);
        let factions = loaded.config.factions;
        let own = actions;
        if (factionName) {
          const index = findFaction(factions, factionName);
          if (index < 0) return `**${factionName}** isn't followed: \`/bgs faction list\` shows those that are.`;
          // Actions stored before factions were recorded count for the default one.
          own = actions.filter((a) => sameFaction(a.faction ?? factions[0] ?? "", factions[index]));
          factions = [factions[index]];
        }
        const shown = summaryEmbeds(factions, label, own);
        return shown.length ? { embeds: shown } : `Nothing reported ${label}.`;
      });
    }

    default:
      return reply("Unknown command.");
  }
}

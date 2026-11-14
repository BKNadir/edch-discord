// The /bgs command as Discord shows it: its subcommands and their options. The bot declares it
// itself (syncCommands.ts) when it starts, with its own token: no one has to run a script for it.

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;
const STRING = 3;
const USER = 6;
const ROLE = 8;

const CHANNEL = 7;
/** Servers only (not direct messages), installed on a server. */
const inServers = { contexts: [0], integration_types: [0] };

/** A faction the server follows, offered as the admin types (autocomplete). */
const factionChoice = {
  type: STRING,
  name: "name",
  description: "A faction the server follows",
  required: true,
  autocomplete: true,
  max_length: 100,
};

/** What Discord shows for /bgs (its subcommands and their options). */
export const COMMANDS: Record<string, unknown>[] = [
  {
    name: "bgs",
    description: "EDCH: your squadron's BGS work, reported by the EDCH app",
    ...inServers,
    options: [
      {
        type: SUB_COMMAND,
        name: "setup",
        description: "Admins: creates the BGS role, #edch-sync and #edch-bgs (and adds a faction)",
        options: [
          {
            type: STRING,
            name: "faction",
            description: "A minor faction to follow, as the game writes it (more with /bgs faction add)",
            autocomplete: true,
            max_length: 100,
          },
          { type: ROLE, name: "role", description: "Another role than BGS for the members who report" },
          {
            type: CHANNEL,
            name: "link_channel",
            description: "The only channel where /bgs link works (anywhere by default)",
            channel_types: [0],
          },
        ],
      },
      {
        type: SUB_COMMAND_GROUP,
        name: "faction",
        description: "The factions the squadron follows (yours and allied ones)",
        options: [
          { type: SUB_COMMAND, name: "list", description: "The factions followed (admins can change them there)" },
          {
            type: SUB_COMMAND,
            name: "add",
            description: "Admins: follow one more faction (an ally on this server)",
            options: [
              {
                type: STRING,
                name: "name",
                description: "The minor faction, as the game writes it (the game's factions are offered as you type)",
                required: true,
                autocomplete: true,
                max_length: 100,
              },
            ],
          },
          {
            type: SUB_COMMAND,
            name: "remove",
            description: "Admins: stop following a faction (its reports stay)",
            options: [factionChoice],
          },
          {
            type: SUB_COMMAND,
            name: "default",
            description: "Admins: the faction shown first",
            options: [factionChoice],
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "revoke",
        description: "Admins: cancel a member's EDCH keys",
        options: [{ type: USER, name: "member", description: "The member", required: true }],
      },
      { type: SUB_COMMAND, name: "link", description: "Get the key that links your EDCH (by direct message)" },
      { type: SUB_COMMAND, name: "unlink", description: "Cancel your EDCH keys" },
      {
        type: SUB_COMMAND,
        name: "summary",
        description: "What the squadron did for its factions, by system",
        options: [
          {
            type: STRING,
            name: "period",
            description: "Since the last BGS tick (default), the last 24 hours or the last 7 days",
            choices: [
              { name: "Since the last tick", value: "tick" },
              { name: "Last 24 hours", value: "24h" },
              { name: "Last 7 days", value: "7d" },
            ],
          },
          {
            // Optional: no "required" key (Discord leaves defaults out when it lists commands).
            type: STRING,
            name: "faction",
            description: "Only this faction (all followed by default)",
            autocomplete: true,
            max_length: 100,
          },
        ],
      },
    ],
  },
];

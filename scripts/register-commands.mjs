// Declares /bgs and /bgs-admin to Discord (once after creating the application, and after changing
// the commands), then prints the link that adds the bot to a server.
//   DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… node scripts/register-commands.mjs
// The token is read from the environment only; it is never written anywhere.

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !token) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.");
  process.exit(1);
}

const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;
const ROLE = 8;

const CHANNEL = 7;
/** Manage Server: who sees /bgs-admin by default (server admins can change it in Integrations). */
const MANAGE_GUILD = String(1n << 5n);
/** Servers only (not direct messages), installed on a server. */
const inServers = { contexts: [0], integration_types: [0] };

const commands = [
  {
    name: "bgs-admin",
    description: "EDCH: configure the bot (admins)",
    default_member_permissions: MANAGE_GUILD,
    ...inServers,
    options: [
      {
        type: SUB_COMMAND,
        name: "setup",
        description: "The faction followed; creates the EDCH-BGS role, #edch-sync and #edch-bgs if needed",
        options: [
          {
            type: STRING,
            name: "faction",
            description: "The minor faction, as the game writes it",
            required: true,
            max_length: 120,
          },
          { type: ROLE, name: "role", description: "Another role than EDCH-BGS for the members who report" },
          {
            type: CHANNEL,
            name: "link_channel",
            description: "The only channel where /bgs link works (anywhere by default)",
            channel_types: [0],
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "revoke",
        description: "Cancel a member's EDCH keys",
        options: [{ type: USER, name: "member", description: "The member", required: true }],
      },
    ],
  },
  {
    name: "bgs",
    description: "EDCH: your squadron's BGS work, reported by the EDCH app",
    ...inServers,
    options: [
      { type: SUB_COMMAND, name: "link", description: "Get the key that links your EDCH (by direct message)" },
      { type: SUB_COMMAND, name: "unlink", description: "Cancel your EDCH keys" },
      {
        type: SUB_COMMAND,
        name: "summary",
        description: "What the squadron did for the faction, by system",
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
        ],
      },
    ],
  },
];

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!response.ok) {
  console.error(`Discord refused the commands: ${response.status} ${await response.text()}`);
  process.exit(1);
}
console.log("/bgs and /bgs-admin are declared.");

// What the bot needs: create the EDCH-BGS role and its two channels (/bgs-admin setup); in
// #edch-sync see it, read its history, send, manage and pin messages; in #edch-bgs write one
// thread per system.
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_MESSAGES = 1n << 13n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const PIN_MESSAGES = 1n << 51n;
const MANAGE_CHANNELS = 1n << 4n;
const MANAGE_ROLES = 1n << 28n;
const CREATE_PUBLIC_THREADS = 1n << 35n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
const permissions =
  MANAGE_CHANNELS |
  MANAGE_ROLES |
  VIEW_CHANNEL |
  SEND_MESSAGES |
  MANAGE_MESSAGES |
  READ_MESSAGE_HISTORY |
  PIN_MESSAGES |
  CREATE_PUBLIC_THREADS |
  SEND_MESSAGES_IN_THREADS;
console.log(
  `Add the bot to a server (needs Manage Server there):\nhttps://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${permissions}`,
);

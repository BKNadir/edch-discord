// Declares the /bgs command to Discord (once after creating the application, and after changing
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

const commands = [
  {
    name: "bgs",
    description: "EDCH: your squadron's BGS work, reported by the EDCH app",
    // Servers only (not direct messages), installed on a server.
    contexts: [0],
    integration_types: [0],
    options: [
      {
        type: SUB_COMMAND,
        name: "setup",
        description: "Admins: the faction followed; creates the BGS role and the #edch-bgs channel if needed",
        options: [
          {
            type: STRING,
            name: "faction",
            description: "The minor faction, as the game writes it",
            required: true,
            max_length: 120,
          },
          { type: ROLE, name: "role", description: "Another role than BGS for the members who report" },
        ],
      },
      { type: SUB_COMMAND, name: "link", description: "Get the key that links your EDCH (only you see it)" },
      { type: SUB_COMMAND, name: "unlink", description: "Cancel your EDCH keys" },
      {
        type: SUB_COMMAND,
        name: "revoke",
        description: "Admins: cancel a member's EDCH keys",
        options: [{ type: USER, name: "member", description: "The member", required: true }],
      },
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
console.log("/bgs is declared.");

// What the bot needs: create the BGS role and the #edch-bgs channel (/bgs setup), then in that
// channel see it, read its history, send messages, pin (the settings).
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_MESSAGES = 1n << 13n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const PIN_MESSAGES = 1n << 51n;
const MANAGE_CHANNELS = 1n << 4n;
const MANAGE_ROLES = 1n << 28n;
const permissions =
  MANAGE_CHANNELS | MANAGE_ROLES | VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES | READ_MESSAGE_HISTORY | PIN_MESSAGES;
console.log(
  `Add the bot to a server (needs Manage Server there):\nhttps://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${permissions}`,
);

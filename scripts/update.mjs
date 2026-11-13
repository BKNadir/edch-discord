// Puts the bot online after a change, in one go: deploys the Worker, then declares /bgs again.
//   npm run update
// The bot token is asked for (hidden as you type) unless DISCORD_BOT_TOKEN is set; it is only
// sent to Discord, never written anywhere. The application id comes from wrangler.toml.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** Reads a line without showing what is typed. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const applicationId = /DISCORD_APPLICATION_ID\s*=\s*"(\d+)"/.exec(readFileSync("wrangler.toml", "utf8"))?.[1];
if (!applicationId) {
  console.error("Set DISCORD_APPLICATION_ID in wrangler.toml first (developer portal → General Information).");
  process.exit(1);
}

console.log("1/2 Deploying the Worker…");
execSync("npx wrangler deploy", { stdio: "inherit" });

console.log("2/2 Declaring /bgs to Discord…");
const token = process.env.DISCORD_BOT_TOKEN || (await askHidden("Bot token (hidden): "));
if (!token) {
  console.error("No token: /bgs wasn't declared again. Run npm run update when you have it.");
  process.exit(1);
}
execSync("node scripts/register-commands.mjs", {
  stdio: "inherit",
  env: { ...process.env, DISCORD_APPLICATION_ID: applicationId, DISCORD_BOT_TOKEN: token },
});
console.log("Done: the bot is up to date.");

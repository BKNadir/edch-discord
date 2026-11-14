// Puts the bot online after a change, in one go: builds the game's faction list (EDSM's dump),
// deploys the Worker, then wakes it up so it declares /bgs to Discord itself (with its own token,
// a Worker secret: nothing to type here).
//   npm run update

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

console.log("1/3 Building the faction list…");
execSync("node scripts/build-factions.mjs", { stdio: "inherit" });

// The ids given to the install script (.edch-install, no secret in it) go with the deploy, so
// wrangler.toml stays as in the repository.
const answers = {};
try {
  for (const line of readFileSync(".edch-install", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(\d*)$/.exec(line.trim());
    if (match) answers[match[1]] = match[2];
  }
} catch {
  // Set up by hand: wrangler.toml holds them.
}
const vars = ["DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID"]
  .filter((key) => answers[key])
  .map((key) => ` --var ${key}:${answers[key]}`)
  .join("");

console.log("2/3 Deploying the Worker…");
const output = execSync(`npx wrangler deploy${vars}`, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
process.stdout.write(output);

console.log("3/3 Declaring /bgs…");
const url = /https:\/\/[^\s]+\.workers\.dev/.exec(output)?.[0];
if (url) {
  // Its first request makes the bot compare /bgs with Discord's and send it again if it changed.
  await fetch(url).catch(() => undefined);
  console.log("Done: the bot is up to date (it declares /bgs itself, within a few seconds).");
} else {
  console.log("Done. The bot declares /bgs itself at its next request (any command, or opening its address).");
}

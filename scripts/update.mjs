// Puts the bot online after a change, in one go: builds the game's faction list (EDSM's dump),
// deploys the Worker, then wakes it up so it declares /bgs to Discord itself (with its own token,
// a Worker secret: nothing to type here).
//   npm run update

import { execSync } from "node:child_process";

console.log("1/3 Building the faction list…");
execSync("node scripts/build-factions.mjs", { stdio: "inherit" });

console.log("2/3 Deploying the Worker…");
const output = execSync("npx wrangler deploy", { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
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

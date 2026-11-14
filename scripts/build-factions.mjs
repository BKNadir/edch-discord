// Builds the list of the game's minor factions offered by /bgs faction add: downloads EDSM's
// nightly dump of the populated systems, keeps every faction name (and the controlling ones),
// and writes them sorted, one per line, to src/generated/factions.txt (bundled with the Worker).
//   node scripts/build-factions.mjs [a local copy of the dump, .json.gz]
// Run by `npm run update`. If EDSM can't be reached, the list already there is kept.

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const DUMP = "https://www.edsm.net/dump/systemsPopulated.json.gz";
const OUT = "src/generated/factions.txt";
const MAX_NAME = 100;

mkdirSync("src/generated", { recursive: true });

/** Answers the dump's stream (following a redirect or two). */
function download(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "EDCH-Discord (https://github.com/BKNadir/edch-discord)" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume();
        resolve(download(new URL(response.headers.location, url).toString(), redirects - 1));
      } else if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`EDSM answered ${response.statusCode}`));
      } else resolve(response);
    }).on("error", reject);
  });
}

try {
  if (!process.argv[2]) console.log("Downloading EDSM's populated systems (a few tens of MB)…");
  const names = new Set();
  let systems = 0;
  const source = process.argv[2] ? createReadStream(process.argv[2]) : await download(DUMP);
  const lines = createInterface({ input: source.pipe(createGunzip()), crlfDelay: Infinity });
  // The dump is a JSON array with one system per line.
  for await (const raw of lines) {
    const line = raw.trim().replace(/,$/, "");
    if (!line.startsWith("{")) continue;
    let system;
    try {
      system = JSON.parse(line);
    } catch {
      continue;
    }
    systems += 1;
    for (const faction of [...(system.factions ?? []), system.controllingFaction]) {
      const name = typeof faction?.name === "string" ? faction.name.trim() : "";
      if (name && name.length <= MAX_NAME && !name.includes("\n")) names.add(name);
    }
  }
  if (!systems || names.size < 1000) throw new Error(`only ${names.size} factions in ${systems} systems`);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  writeFileSync(OUT, sorted.join("\n") + "\n");
  console.log(`${sorted.length} factions from ${systems} systems written to ${OUT}.`);
} catch (error) {
  if (existsSync(OUT) && statSync(OUT).size > 0) {
    console.warn(`The faction list wasn't updated (${error.message}): the previous one is kept.`);
  } else {
    // Empty: the bot still offers the factions members saw, and the name typed.
    createWriteStream(OUT).end("");
    console.warn(`No faction list (${error.message}): /bgs faction add offers the factions members saw only.`);
  }
}

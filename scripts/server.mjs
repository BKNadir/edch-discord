// Runs the bot on a machine of its own (Windows or Linux) instead of Cloudflare: the same handler
// (src/handler.ts, built to dist-node/ by `npm run build:node`) behind a small HTTP server on
// 127.0.0.1. A reverse proxy (Caddy, set up by the install scripts) gives it HTTPS and the public
// address Discord and EDCH reach.
//   node scripts/server.mjs [path to bot.env]
// Settings and secrets come from bot.env (KEY=value lines, written by the install script, readable
// by its owner only); the environment overrides them. Nothing secret is ever printed. With
// ADMIN_PORT and ADMIN_TOKEN, the admin page (scripts/admin.mjs) starts too.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 1024 * 1024;
const REQUIRED = ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID", "LINK_SECRET", "PUBLIC_URL"];

/** KEY=value lines; blank lines and # comments ignored; quotes around a value removed. */
function readEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

const envPath = process.argv[2] ?? join(ROOT, "bot.env");
let fileEnv = {};
try {
  fileEnv = readEnvFile(envPath);
} catch {
  console.error(`No settings file at ${envPath}: run the install script first.`);
  process.exit(1);
}
const env = { DISCORD_GUILD_ID: "", ...fileEnv };
for (const key of [...REQUIRED, "DISCORD_GUILD_ID", "PORT", "ADMIN_PORT"])
  if (process.env[key]) env[key] = process.env[key];
const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length) {
  console.error(`Missing in ${envPath}: ${missing.join(", ")}`);
  process.exit(1);
}
const publicOrigin = new URL(env.PUBLIC_URL).origin;
if (!publicOrigin.startsWith("https://")) {
  console.error("PUBLIC_URL must be the bot's https:// address.");
  process.exit(1);
}

const { createHandler } = await import(join(ROOT, "dist-node", "handler.js")).catch(() => {
  console.error("The bot isn't built: run npm run build:node (the update script does it).");
  process.exit(1);
});
const factionsFile = join(ROOT, "src", "generated", "factions.txt");
const handle = createHandler(() => {
  try {
    return readFileSync(factionsFile, "utf8");
  } catch {
    return "";
  }
}, publicOrigin);

/** Work that goes on after an answer (the deferred Discord replies): kept running, errors logged. */
const background = {
  waitUntil: (work) => void work.catch((error) => console.error(`background: ${error?.message ?? error}`)),
};

const server = createServer(async (req, res) => {
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end("Too large");
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    const method = req.method ?? "GET";
    const request = new Request(new URL(req.url ?? "/", publicOrigin), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, env, background);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(`request: ${error?.message ?? error}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const port = Number(env.PORT) || 8787;
// Only on this machine: the reverse proxy is what the Internet reaches.
server.listen(port, "127.0.0.1", () => console.log(`EDCH bot listening on 127.0.0.1:${port} for ${publicOrigin}`));

// The admin page (settings, updates), when bot.env asks for it: 127.0.0.1 only, reached through SSH.
if (env.ADMIN_PORT && env.ADMIN_TOKEN) {
  const { startAdmin } = await import("./admin.mjs");
  startAdmin({ root: ROOT, envPath, env });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

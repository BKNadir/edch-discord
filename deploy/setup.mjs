// The bot's setup, from a PC (Windows, Linux or macOS), all in a page of the browser: install or
// update the bot on Cloudflare (a free Worker) or on a Linux machine reached with SSH, and open
// that machine's admin page. Started by deploy/setup-windows.ps1 or deploy/setup-linux.sh.
//   node deploy/setup.mjs
// The page runs on this PC only (127.0.0.1, a one-time address). Passwords and secrets stay in
// memory while it runs and go to Cloudflare or to the machine only; .edch-install keeps the
// answers without any secret (where the bot runs, the SSH address, the machine's key fingerprint)
// for next time.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANSWERS = join(ROOT, ".edch-install");
const IS_WINDOWS = process.platform === "win32";
const ADMIN_REMOTE_PORT = 8788;

// ---------------------------------------------------------------- answers kept between runs

/** KEY=value lines of .edch-install (no secret in it). */
function readAnswers() {
  const values = {};
  try {
    for (const line of readFileSync(ANSWERS, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2];
    }
  } catch {
    // First run on this PC.
  }
  return values;
}

/** The keys .edch-install may hold: never a password, token or key. */
const KEPT = ["MODE", "SSH_HOST", "SSH_PORT", "SSH_USER", "SSH_KEY_FILE", "SSH_HOST_KEY", "DUCKDNS_DOMAIN"];
function saveAnswers(values) {
  const kept = { ...readAnswers(), ...values };
  const text = KEPT.filter((k) => kept[k] !== undefined && kept[k] !== "")
    .map((k) => `${k}=${kept[k]}`)
    .join("\n");
  writeFileSync(ANSWERS, text + "\n");
}

// ---------------------------------------------------------------- the job shown in the page

/** One task at a time; the page polls its lines and its end. */
const job = { running: false, lines: [], done: false, ok: false, result: {} };
const SECRET_WORDS = [];
/** A line for the page, with any secret given in this session masked. */
function log(text) {
  let line = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  for (const secret of SECRET_WORDS) if (secret) line = line.split(secret).join("***");
  for (const part of line.split(/\r?\n/)) if (part.trim()) job.lines.push(part.replace(/\r/g, ""));
  if (job.lines.length > 2000) job.lines.splice(0, job.lines.length - 2000);
}
function hide(...secrets) {
  for (const secret of secrets) if (secret && secret.length >= 4) SECRET_WORDS.push(secret);
}
async function runJob(work) {
  if (job.running) return false;
  Object.assign(job, { running: true, lines: [], done: false, ok: false, result: {} });
  try {
    job.result = (await work()) ?? {};
    job.ok = true;
  } catch (error) {
    log(`✖ ${error?.message ?? error}`);
    job.ok = false;
  } finally {
    job.running = false;
    job.done = true;
  }
  return true;
}

// ---------------------------------------------------------------- local commands (Cloudflare)

/** Runs a command in the bot's folder, its output in the page; resolves with it, rejects on failure. */
function local(command, args, { input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    // npm and npx are .cmd files on Windows: they need the shell there. Node itself doesn't (and
    // its path, "C:\Program Files\…", would be cut at the space by the shell).
    const shell = IS_WINDOWS && (command === "npm" || command === "npx");
    const child = spawn(command, args, { cwd: ROOT, shell, env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";
    const take = (chunk) => {
      output += chunk;
      if (!quiet) log(chunk.toString());
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    if (input !== undefined) child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} ${args.slice(0, 2).join(" ")} failed (${code})`)),
    );
  });
}
const wrangler = (args, options) => local("npx", ["wrangler", ...args], options);

/** The account wrangler is signed in to, or null. */
async function cloudflareAccount() {
  try {
    const out = await wrangler(["whoami"], { quiet: true });
    const email = /associated with the email ([^\s.]+@[^\s]+?)\.?\s/i.exec(out)?.[1];
    return /not authenticated/i.test(out) ? null : (email ?? "signed in");
  } catch {
    return null;
  }
}

/** The bot's secrets on Cloudflare (their names), or null when the account has no EDCH bot. */
async function cloudflareSecrets() {
  try {
    const out = await wrangler(["secret", "list", "--format", "json"], { quiet: true });
    const list = JSON.parse(out.slice(out.indexOf("[")));
    return list.map((s) => s.name);
  } catch {
    return null;
  }
}

async function cloudflareInstall(form) {
  if (!existsSync(join(ROOT, "node_modules", "wrangler"))) {
    log("▶ npm install");
    await local("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
  }
  const before = await cloudflareSecrets();
  const exists = before !== null && before.includes("DISCORD_BOT_TOKEN");
  log(exists ? "▶ EDCH bot found on this account: update" : "▶ No EDCH bot on this account yet: install");
  log("▶ The game's faction list (EDSM's dump of the populated systems, about a minute)");
  await local(process.execPath, ["scripts/build-factions.mjs"]);
  log("▶ Deploying");
  const output = await wrangler(["deploy"]);
  const url = /https:\/\/[^\s]+\.workers\.dev/.exec(output)?.[0] ?? "";
  // Secrets: given now (all needed for a new bot), else kept as they are.
  const secrets = {
    DISCORD_APPLICATION_ID: form.DISCORD_APPLICATION_ID,
    DISCORD_PUBLIC_KEY: form.DISCORD_PUBLIC_KEY,
    DISCORD_BOT_TOKEN: form.DISCORD_BOT_TOKEN,
    DISCORD_GUILD_ID: form.DISCORD_GUILD_ID,
  };
  const names = before ?? [];
  if (!names.includes("LINK_SECRET")) secrets.LINK_SECRET = randomBytes(32).toString("hex");
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    log(`▶ Secret ${name}`);
    await wrangler(["secret", "put", name], { input: value });
  }
  const after = (await cloudflareSecrets()) ?? [];
  const missing = ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"].filter(
    (n) => !after.includes(n),
  );
  if (missing.length)
    throw new Error(`Still missing on Cloudflare: ${missing.join(", ")}. Fill them in and run it again.`);
  // Its first request makes the bot check /bgs with Discord.
  if (url) await fetch(url).catch(() => undefined);
  saveAnswers({ MODE: "cloudflare" });
  log("✔ Done");
  return { url, endpoint: url ? `${url}/interactions` : "" };
}

// ---------------------------------------------------------------- SSH (Linux machine)

let ssh2;
async function loadSsh2() {
  ssh2 ??= (await import("ssh2")).default;
  return ssh2;
}

/** The private keys tried when no password works (or with it): the usual files in ~/.ssh. */
function defaultKeyFile(given) {
  if (given) return given;
  for (const name of ["id_ed25519", "id_ecdsa", "id_rsa"]) {
    const path = join(homedir(), ".ssh", name);
    if (existsSync(path)) return path;
  }
  return "";
}

/**
 * Connects to the machine. The host key is checked against the one seen the first time (kept in
 * .edch-install): a different key stops everything (another machine, or someone in between).
 */
async function connect(form) {
  const { Client, utils } = await loadSsh2();
  const keyFile = defaultKeyFile(form.SSH_KEY_FILE);
  let privateKey = keyFile ? readFileSync(keyFile) : undefined;
  // A key found in ~/.ssh but locked by a passphrase not given: left out, the password is tried.
  if (
    privateKey &&
    !form.SSH_KEY_FILE &&
    utils.parseKey(privateKey, form.SSH_KEY_PASSPHRASE || undefined) instanceof Error
  )
    privateKey = undefined;
  const known = readAnswers();
  const knownKey = known.SSH_HOST === form.SSH_HOST && known.SSH_PORT === form.SSH_PORT ? known.SSH_HOST_KEY : "";
  let seenKey = "";
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve).on("error", reject);
    conn.connect({
      host: form.SSH_HOST,
      port: Number(form.SSH_PORT) || 22,
      username: form.SSH_USER,
      password: form.SSH_PASSWORD || undefined,
      privateKey,
      passphrase: form.SSH_KEY_PASSPHRASE || undefined,
      tryKeyboard: true,
      readyTimeout: 20_000,
      hostHash: "sha256",
      hostVerifier: (hash) => {
        seenKey = hash;
        if (knownKey && knownKey !== hash) {
          log(`✖ This machine's key changed (was ${knownKey.slice(0, 16)}…, now ${hash.slice(0, 16)}…).`);
          return false;
        }
        return true;
      },
    });
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) =>
      finish(prompts.map(() => form.SSH_PASSWORD ?? "")),
    );
  }).catch((error) => {
    const message = String(error?.message ?? error);
    throw new Error(
      /authentication/i.test(message)
        ? "SSH refused the user, password or key."
        : /key changed|verification/i.test(message) || (knownKey && seenKey && knownKey !== seenKey)
          ? "The machine's key isn't the one seen before: if you reinstalled the machine, clear SSH_HOST_KEY in .edch-install."
          : `SSH: ${message}`,
    );
  });
  if (!knownKey) log(`▶ Connected. Machine's key (SHA-256): ${seenKey}`);
  saveAnswers({
    SSH_HOST: form.SSH_HOST,
    SSH_PORT: form.SSH_PORT,
    SSH_USER: form.SSH_USER,
    SSH_KEY_FILE: form.SSH_KEY_FILE,
    SSH_HOST_KEY: seenKey,
  });
  return conn;
}

/**
 * Runs a command on the machine in a terminal (so sudo can ask), its output in the page; answers
 * sudo's password prompts with the sudo password. Resolves with the output, rejects on failure.
 */
function remote(conn, command, { sudoPassword = "", input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: input === undefined ? { term: "dumb", cols: 160 } : false }, (error, stream) => {
      if (error) return reject(error);
      let output = "";
      let tail = "";
      const take = (chunk) => {
        const text = chunk.toString();
        output += text;
        tail = (tail + text).slice(-200);
        if (!quiet) log(text);
        if (/\[sudo\] password for|^Password:|password:\s*$/im.test(tail)) {
          tail = "";
          if (!sudoPassword) {
            stream.close();
            return reject(new Error("sudo asks for a password: fill in the sudo password (or the SSH password)."));
          }
          stream.write(`${sudoPassword}\n`);
        }
      };
      stream.on("data", take);
      stream.stderr.on("data", take);
      if (input !== undefined) stream.end(input);
      stream.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`exit ${code ?? "?"}`))));
    });
  });
}

/** What the machine already has: the bot, and its admin page key. */
async function machineState(conn) {
  const out = await remote(conn, "test -f ~/edch-discord/bot.env && echo INSTALLED || echo NONE", { quiet: true });
  return out.includes("INSTALLED");
}

async function machineInstall(form) {
  const conn = await connect(form);
  try {
    const sudo = form.SUDO_PASSWORD || form.SSH_PASSWORD || "";
    const installed = await machineState(conn);
    if (installed && !form.DISCORD_BOT_TOKEN) {
      log("▶ EDCH bot found on this machine: update (new code, faction list, build, restart)");
      await remote(conn, "bash ~/edch-discord/deploy/server-update.sh", { sudoPassword: sudo });
    } else {
      log(
        installed
          ? "▶ EDCH bot found on this machine: set up again with the new settings"
          : "▶ Installing on this machine",
      );
      const settings = [
        "DISCORD_APPLICATION_ID",
        "DISCORD_PUBLIC_KEY",
        "DISCORD_BOT_TOKEN",
        "DISCORD_GUILD_ID",
        "DUCKDNS_DOMAIN",
        "DUCKDNS_TOKEN",
      ]
        .map((k) => `${k}=${form[k] ?? ""}`)
        .join("\n");
      // Only that user can read it; server-setup.sh deletes it once read.
      await remote(conn, "umask 077; cat > ~/.edch-setup.env", { input: settings + "\n", quiet: true });
      const script = readFileSync(join(ROOT, "deploy", "server-setup.sh"), "utf8").replace(/\r/g, "");
      await remote(conn, "cat > ~/edch-server-setup.sh", { input: script, quiet: true });
      await remote(
        conn,
        "bash ~/edch-server-setup.sh ~/.edch-setup.env; status=$?; rm -f ~/edch-server-setup.sh; exit $status",
        {
          sudoPassword: sudo,
        },
      );
    }
    saveAnswers({ MODE: "server", DUCKDNS_DOMAIN: form.DUCKDNS_DOMAIN || readAnswers().DUCKDNS_DOMAIN });
    const domain = form.DUCKDNS_DOMAIN || readAnswers().DUCKDNS_DOMAIN;
    log("✔ Done");
    return {
      url: domain ? `https://${domain}.duckdns.org` : "",
      endpoint: domain ? `https://${domain}.duckdns.org/interactions` : "",
    };
  } finally {
    conn.end();
  }
}

/** The admin page tunnel: a local port forwarded to the machine's 127.0.0.1:8788, kept open. */
let adminTunnel = null;
async function openAdmin(form) {
  const conn = await connect(form);
  const token = (
    await remote(conn, "grep -E '^ADMIN_TOKEN=' ~/edch-discord/bot.env | cut -d= -f2-", { quiet: true })
  ).trim();
  if (!token) {
    conn.end();
    throw new Error("No admin page on this machine: install the bot first.");
  }
  adminTunnel?.close();
  adminTunnel = createTcpServer((socket) => {
    conn.forwardOut("127.0.0.1", 0, "127.0.0.1", ADMIN_REMOTE_PORT, (error, stream) => {
      if (error) return socket.destroy();
      socket.pipe(stream).pipe(socket);
      socket.on("error", () => stream.close());
    });
  });
  await new Promise((resolve) => adminTunnel.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${adminTunnel.address().port}/?t=${token}`;
  hide(token);
  log("✔ Admin page open in a new tab (this page keeps the connection: leave it open while you use it)");
  return { adminUrl: url };
}

// ---------------------------------------------------------------- checks of the form

const SNOWFLAKE = /^\d{17,20}$/;
const CHECKS = {
  DISCORD_APPLICATION_ID: (v) => SNOWFLAKE.test(v),
  DISCORD_PUBLIC_KEY: (v) => /^[0-9a-f]{64}$/i.test(v),
  DISCORD_BOT_TOKEN: (v) => v.length >= 50 && !/\s/.test(v),
  DISCORD_GUILD_ID: (v) => SNOWFLAKE.test(v),
  SSH_HOST: (v) => /^[A-Za-z0-9.:-]+$/.test(v),
  SSH_PORT: (v) => /^\d{1,5}$/.test(v) && +v > 0 && +v < 65536,
  SSH_USER: (v) => /^[A-Za-z0-9._-]+$/.test(v),
  SSH_KEY_FILE: (v) => existsSync(v),
  DUCKDNS_DOMAIN: (v) => /^[a-z0-9-]{1,63}$/.test(v),
  DUCKDNS_TOKEN: (v) => /^[0-9a-f-]{36}$/i.test(v),
};
/** Fields that are wrong, and those missing where `required`. */
function badFields(form, required) {
  return Object.keys(CHECKS).filter((key) => {
    const value = form[key] ?? "";
    if (!value) return required.includes(key);
    return !CHECKS[key](value);
  });
}
const DISCORD_ALL = ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"];
const SSH_ALL = ["SSH_HOST", "SSH_PORT", "SSH_USER"];

// ---------------------------------------------------------------- the local server

const token = randomBytes(16).toString("hex");
const page = readFileSync(join(ROOT, "deploy", "setup-page.html"), "utf8");

const server = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };
  if (req.method === "GET" && url.pathname === "/") {
    if (url.searchParams.get("t") !== token) return send(403, "Forbidden", "text/plain");
    return send(200, page.replace("__TOKEN__", token), "text/html; charset=utf-8");
  }
  // The page's calls carry the token in a header: a page from elsewhere can't send it.
  if (req.headers["x-setup-token"] !== token) return send(403, { error: "forbidden" });
  let form = {};
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 50_000) return send(413, { error: "tooLarge" });
    }
    try {
      form = Object.fromEntries(Object.entries(JSON.parse(raw || "{}")).map(([k, v]) => [k, String(v ?? "").trim()]));
    } catch {
      return send(400, { error: "badJson" });
    }
    hide(
      form.DISCORD_BOT_TOKEN,
      form.DISCORD_PUBLIC_KEY,
      form.DUCKDNS_TOKEN,
      form.SSH_PASSWORD,
      form.SUDO_PASSWORD,
      form.SSH_KEY_PASSPHRASE,
    );
  }
  const answers = readAnswers();
  switch (`${req.method} ${url.pathname}`) {
    case "GET /api/state":
      return send(200, { answers, job: { running: job.running } });
    case "GET /api/job":
      return send(200, { ...job, lines: job.lines.slice(Number(url.searchParams.get("from")) || 0) });
    case "POST /api/cloudflare/account": {
      if (job.running) return send(409, { error: "busy" });
      void runJob(async () => {
        if (!existsSync(join(ROOT, "node_modules", "wrangler"))) {
          log("▶ npm install (first time, a minute or two)");
          await local("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
        }
        let account = await cloudflareAccount();
        if (!account) {
          log("▶ Sign in to Cloudflare in the browser tab that opens");
          await wrangler(["login"]);
          account = await cloudflareAccount();
        }
        if (!account) throw new Error("Not signed in to Cloudflare.");
        const secrets = await cloudflareSecrets();
        const exists = secrets !== null && secrets.includes("DISCORD_BOT_TOKEN");
        log(`✔ Cloudflare: ${account}. ${exists ? "An EDCH bot is already there." : "No EDCH bot there yet."}`);
        // What a bot set up by hand or by an older version still lacks: asked for in the page.
        const missing = exists
          ? ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"].filter((n) => !secrets.includes(n))
          : [];
        return { account, exists, missing };
      });
      return send(200, { ok: true });
    }
    case "POST /api/cloudflare/install": {
      const exists = form.exists === "true";
      const missing = String(form.missing ?? "")
        .split(",")
        .filter((k) => DISCORD_ALL.includes(k));
      const bad = badFields(form, exists ? missing : DISCORD_ALL).filter((k) => k.startsWith("DISCORD_"));
      if (bad.length) return send(400, { bad });
      if (job.running) return send(409, { error: "busy" });
      void runJob(() => cloudflareInstall(form));
      return send(200, { ok: true });
    }
    case "POST /api/machine/check": {
      const bad = badFields(form, SSH_ALL).filter((k) => k.startsWith("SSH_"));
      if (bad.length) return send(400, { bad });
      if (job.running) return send(409, { error: "busy" });
      void runJob(async () => {
        log(`▶ SSH ${form.SSH_USER}@${form.SSH_HOST}:${form.SSH_PORT}`);
        const conn = await connect(form);
        try {
          const installed = await machineState(conn);
          log(installed ? "✔ An EDCH bot is already on this machine." : "✔ No EDCH bot on this machine yet.");
          return { installed };
        } finally {
          conn.end();
        }
      });
      return send(200, { ok: true });
    }
    case "POST /api/machine/install": {
      const installed = form.installed === "true";
      // A new install, or new settings: everything; an update: the SSH fields only.
      const update = installed && !form.DISCORD_BOT_TOKEN;
      const required = update ? SSH_ALL : [...SSH_ALL, ...DISCORD_ALL, "DUCKDNS_DOMAIN", "DUCKDNS_TOKEN"];
      const bad = badFields(form, required);
      if (bad.length) return send(400, { bad });
      if (job.running) return send(409, { error: "busy" });
      void runJob(() => machineInstall(form));
      return send(200, { ok: true });
    }
    case "POST /api/machine/admin": {
      const bad = badFields(form, SSH_ALL).filter((k) => k.startsWith("SSH_"));
      if (bad.length) return send(400, { bad });
      if (job.running) return send(409, { error: "busy" });
      void runJob(() => openAdmin(form));
      return send(200, { ok: true });
    }
    case "POST /api/quit":
      send(200, { ok: true });
      setTimeout(() => process.exit(0), 300);
      return;
    default:
      return send(404, { error: "notFound" });
  }
});

/** Opens the page in the default browser. */
function openBrowser(address) {
  const [command, args] = IS_WINDOWS
    ? ["cmd", ["/c", "start", "", address]]
    : process.platform === "darwin"
      ? ["open", [address]]
      : ["xdg-open", [address]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => console.log("Open the address above in your browser."));
    child.unref();
  } catch {
    // No browser to open: the address is printed below.
  }
}

server.listen(0, "127.0.0.1", () => {
  const address = `http://127.0.0.1:${server.address().port}/?t=${token}`;
  console.log(`EDCH bot setup: ${address}`);
  console.log("The page opens in your browser. Keep this window open while you use it (Ctrl+C to stop).");
  openBrowser(address);
});

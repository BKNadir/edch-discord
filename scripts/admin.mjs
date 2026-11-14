// The bot's admin page, on its own Linux machine: the settings (Discord ids and secrets, the
// DuckDNS token), where it stands (version, uptime, updates), and updates from GitHub, by a button
// or every night. Started by server.mjs when bot.env has ADMIN_PORT and ADMIN_TOKEN.
// It listens on 127.0.0.1 only: reach it from your PC through SSH (the setup page's "Open the
// admin page", deploy/setup.mjs), never from the Internet. On top of that:
// - a sign-in (scripts/admin-auth.mjs): the account is made at the first visit, only with
//   ADMIN_TOKEN (readable over SSH in bot.env, given by the setup); sessions in an HttpOnly,
//   SameSite=Strict cookie;
// - only requests for 127.0.0.1 or localhost are answered (no DNS rebinding), changes need the
//   page's own header and origin (no cross-site requests);
// - a strict Content-Security-Policy: the page runs its own script file and nothing else, and it
//   puts every value in the page as text.
// After a change of settings or an update, the bot stops and systemd starts it again.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth, sameSecret } from "./admin-auth.mjs";

const PAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "admin-page");
/** The page's files: the only things served without signing in (none holds any data). */
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
};
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};
const COOKIE = "edch_admin";
/** Only these host names: a page of another site pointed at 127.0.0.1 (DNS rebinding) is refused. */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

/** The settings the page can change, and what each accepts. */
const EDITABLE = {
  DISCORD_APPLICATION_ID: (v) => /^\d{17,20}$/.test(v),
  DISCORD_PUBLIC_KEY: (v) => /^[0-9a-f]{64}$/i.test(v),
  DISCORD_BOT_TOKEN: (v) => v.length >= 50 && !/\s/.test(v),
  DISCORD_GUILD_ID: (v) => v === "" || /^\d{17,20}$/.test(v),
};
/** Shown blank on the page and kept when left blank: never sent back to the browser. */
const SECRET = new Set(["DISCORD_BOT_TOKEN"]);
/** The nightly update runs in this hour (the machine's time). */
const AUTO_UPDATE_HOUR = 4;
const STEP_TIMEOUT_MS = 10 * 60_000;

/** Runs a command in the bot's folder; resolves with its output, rejects with it. */
function run(root, command, args) {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      { cwd: root, timeout: STEP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`${command} ${args[0] ?? ""}: ${(stderr || error.message).trim().slice(-400)}`))
          : resolve(stdout.trim()),
    ),
  );
}

/** KEY=value lines of a file, in order (for rewriting it with some values changed). */
function readLines(path) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function writeValues(path, values) {
  const lines = readLines(path);
  const seen = new Set();
  const out = lines.map((line) => {
    const key = line.split("=")[0];
    if (key in values) {
      seen.add(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) out.push(`${key}=${value}`);
  writeFileSync(path, out.join("\n") + "\n", { mode: 0o600 });
}

/**
 * Starts the admin page. `envPath`: bot.env; `env`: its values as the bot read them.
 * `restart`: stops the bot so systemd starts it again with the new code or settings.
 */
export function startAdmin({ root, envPath, env, restart = () => process.exit(0) }) {
  const port = Number(env.ADMIN_PORT);
  const token = String(env.ADMIN_TOKEN ?? "");
  if (!port || token.length < 16) return null;
  const duckdnsPath = join(root, "duckdns.env");
  const statePath = join(root, ".update-state.json");
  const startedAt = Date.now();

  /** What the last update check or update did (kept across restarts). */
  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
  const saveState = (patch) => {
    state = { ...state, ...patch };
    try {
      writeFileSync(statePath, JSON.stringify(state));
    } catch {
      // Not kept: shown until the next restart only.
    }
  };
  let busy = false;

  const git = (...args) => run(root, "git", args);

  /** The commits on GitHub this copy doesn't have yet (subjects, newest first). */
  async function checkUpdates() {
    await git("fetch", "-q", "origin");
    const log = await git("log", "--format=%h %s", "HEAD..@{upstream}");
    const pending = log ? log.split("\n").slice(0, 30) : [];
    saveState({ checkedAt: new Date().toISOString(), pending });
    return pending;
  }

  /**
   * Updates from GitHub: the new code, its dependencies, the faction list and the build. When a
   * step fails, the previous code and build come back and the bot goes on as it was.
   */
  async function update(reason) {
    if (busy) return { ok: false, message: "busy" };
    busy = true;
    const before = await git("rev-parse", "HEAD");
    try {
      const pending = await checkUpdates();
      if (!pending.length) {
        saveState({ result: "upToDate" });
        return { ok: true, message: "upToDate" };
      }
      console.log(`update (${reason}): ${pending.length} new commit(s)`);
      await git("pull", "--ff-only", "-q");
      await run(root, "bash", ["deploy/server-build.sh"]);
      const after = await git("log", "-1", "--format=%h %s");
      saveState({ result: "updated", updatedAt: new Date().toISOString(), version: after, pending: [] });
      console.log(`update: now at ${after}, restarting`);
      setTimeout(restart, 500);
      return { ok: true, message: "updated" };
    } catch (error) {
      console.error(`update failed, back to ${before.slice(0, 7)}: ${error.message}`);
      try {
        await git("reset", "--hard", "-q", before);
        await run(root, "bash", ["deploy/server-build.sh"]);
      } catch (restoreError) {
        console.error(`restoring the previous version failed: ${restoreError.message}`);
      }
      saveState({ result: "failed", failedAt: new Date().toISOString(), error: error.message.slice(0, 400) });
      return { ok: false, message: "failed", error: error.message.slice(0, 400) };
    } finally {
      busy = false;
    }
  }

  // Every night, when automatic updates are on (the default).
  setInterval(() => {
    const now = new Date();
    if (env.AUTO_UPDATE === "off" || now.getHours() !== AUTO_UPDATE_HOUR) return;
    if (state.autoAt && Date.now() - Date.parse(state.autoAt) < 20 * 3600_000) return;
    saveState({ autoAt: now.toISOString() });
    void update("nightly");
  }, 10 * 60_000).unref();

  async function status() {
    let version = "";
    try {
      version = await git("log", "-1", "--format=%h %s (%cs)");
    } catch {
      version = "?";
    }
    let factions = 0;
    try {
      factions = readFileSync(join(root, "src", "generated", "factions.txt"), "utf8")
        .split("\n")
        .filter(Boolean).length;
    } catch {
      factions = 0;
    }
    const duck = Object.fromEntries(readLines(duckdnsPath).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
    return {
      version,
      startedAt: new Date(startedAt).toISOString(),
      publicUrl: env.PUBLIC_URL,
      factions,
      autoUpdate: env.AUTO_UPDATE !== "off",
      busy,
      state,
      settings: Object.fromEntries(Object.keys(EDITABLE).map((k) => [k, SECRET.has(k) ? "" : (env[k] ?? "")])),
      duckdnsDomain: duck.DUCKDNS_DOMAIN ?? "",
    };
  }

  const auth = createAuth(join(root, "admin-credentials.json"));
  const sessionOf = (req) =>
    String(req.headers.cookie ?? "")
      .split(/;\s*/)
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? "";
  const cookie = (id, maxAge) => `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (code, body, type = "application/json", extra = {}) => {
      res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    const host = String(req.headers.host ?? "");
    if (!LOCAL_HOST.test(host)) return send(421, { error: "badHost" });

    const file = req.method === "GET" ? FILES[url.pathname] : undefined;
    if (file) return send(200, readFileSync(join(PAGE_DIR, file[0])), file[1]);
    if (!url.pathname.startsWith("/api/")) return send(404, { error: "notFound" });

    // Calls come from the page itself: its header (other sites can't send it without asking
    // first, and this server never says yes) and, when the browser tells it, its origin.
    const origin = req.headers.origin;
    if (req.headers["x-edch"] !== "1" || (origin && origin !== `http://${host}`))
      return send(403, { error: "forbidden" });

    let body = {};
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20_000) return send(413, { error: "tooLarge" });
      }
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(400, { error: "badJson" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return send(400, { error: "badJson" });
    }
    const route = `${req.method} ${url.pathname}`;
    const session = sessionOf(req);

    // Signing in.
    if (route === "GET /api/session") return send(200, { signedIn: auth.check(session), stage: auth.stage() });
    if (route === "POST /api/create") {
      // The first account needs the key only SSH access can read: someone on the machine
      // without it can't take the page.
      if (!sameSecret(body.key, token)) return send(403, { error: "noKey" });
      const made = await auth.create(String(body.user ?? ""), String(body.password ?? ""));
      if (made.error) return send(400, made);
      console.log("admin page: account made");
      return send(200, { ok: true }, "application/json", { "Set-Cookie": cookie(made.session, 8 * 3600) });
    }
    if (route === "POST /api/login") {
      const signed = await auth.login(String(body.user ?? ""), String(body.password ?? ""));
      if (signed.error) return send(signed.error === "locked" ? 429 : 401, signed);
      return send(200, { ok: true }, "application/json", { "Set-Cookie": cookie(signed.session, 8 * 3600) });
    }
    if (route === "POST /api/logout") {
      auth.logout(session);
      return send(200, { ok: true }, "application/json", { "Set-Cookie": cookie("", 0) });
    }

    // Everything else: signed in only.
    if (!auth.check(session)) return send(401, { error: "expired" });
    try {
      if (route === "POST /api/password") {
        const changed = await auth.changePassword(String(body.current ?? ""), String(body.next ?? ""));
        if (changed.error) return send(400, changed);
        console.log("admin page: password changed");
        return send(200, { ok: true }, "application/json", { "Set-Cookie": cookie(changed.session, 8 * 3600) });
      }
      if (route === "GET /api/status") return send(200, await status());
      if (route === "POST /api/check") return send(200, { pending: await checkUpdates() });
      if (route === "POST /api/update") return send(200, await update("button"));
      if (route === "POST /api/auto-update") {
        env.AUTO_UPDATE = body.on === true ? "daily" : "off";
        writeValues(envPath, { AUTO_UPDATE: env.AUTO_UPDATE });
        return send(200, { ok: true });
      }
      if (route === "POST /api/settings") {
        const changes = {};
        const bad = [];
        for (const [key, check] of Object.entries(EDITABLE)) {
          const value = String(body[key] ?? "").trim();
          if (SECRET.has(key) && value === "") continue; // left blank: kept
          if (!check(value)) bad.push(key);
          else if (value !== env[key]) changes[key] = value;
        }
        const duckToken = String(body.DUCKDNS_TOKEN ?? "").trim();
        if (duckToken && !/^[0-9a-f-]{36}$/i.test(duckToken)) bad.push("DUCKDNS_TOKEN");
        if (bad.length) return send(400, { bad });
        if (duckToken) writeValues(duckdnsPath, { DUCKDNS_TOKEN: duckToken });
        if (!Object.keys(changes).length) return send(200, { ok: true, restart: false });
        writeValues(envPath, changes);
        console.log(`settings changed (${Object.keys(changes).join(", ")}), restarting`);
        setTimeout(restart, 500);
        return send(200, { ok: true, restart: true });
      }
      return send(404, { error: "notFound" });
    } catch (error) {
      console.error(`admin page: ${String(error?.message ?? error).slice(0, 300)}`);
      return send(500, { error: "internal" });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`admin page on 127.0.0.1:${port} (through SSH only)`));
  return server;
}

/** A new admin token (the install script writes one to bot.env). */
export const newAdminToken = () => randomBytes(24).toString("hex");

// The bot's admin page, on its own Linux machine: the settings (Discord ids and secrets, the
// DuckDNS token), where it stands (version, uptime, updates), and updates from GitHub, by a button
// or every night. Started by server.mjs when bot.env has ADMIN_PORT and ADMIN_TOKEN.
// It listens on 127.0.0.1 only: reach it from your PC through SSH (deploy/admin-linux.sh,
// deploy/admin-windows.ps1), never from the Internet. Every call needs ADMIN_TOKEN.
// After a change of settings or an update, the bot stops and systemd starts it again.

import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

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
      await run(root, "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
      await run(root, process.execPath, ["scripts/build-factions.mjs"]);
      await run(root, "npm", ["run", "-s", "build:node"]);
      const after = await git("log", "-1", "--format=%h %s");
      saveState({ result: "updated", updatedAt: new Date().toISOString(), version: after, pending: [] });
      console.log(`update: now at ${after}, restarting`);
      setTimeout(restart, 500);
      return { ok: true, message: "updated" };
    } catch (error) {
      console.error(`update failed, back to ${before.slice(0, 7)}: ${error.message}`);
      try {
        await git("reset", "--hard", "-q", before);
        await run(root, "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
        await run(root, "npm", ["run", "-s", "build:node"]);
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

  const authorised = (given) => {
    const a = Buffer.from(String(given ?? ""));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (req.method === "GET" && url.pathname === "/") {
      if (!authorised(url.searchParams.get("t"))) return send(403, "Forbidden", "text/plain");
      return send(200, PAGE, "text/html; charset=utf-8");
    }
    // The page's calls carry the token in a header: a page from elsewhere can't send it.
    if (!authorised(req.headers["x-admin-token"])) return send(403, { error: "forbidden" });
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
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/status") return send(200, await status());
      if (req.method === "POST" && url.pathname === "/api/check") return send(200, { pending: await checkUpdates() });
      if (req.method === "POST" && url.pathname === "/api/update") return send(200, await update("button"));
      if (req.method === "POST" && url.pathname === "/api/auto-update") {
        env.AUTO_UPDATE = body.on ? "daily" : "off";
        writeValues(envPath, { AUTO_UPDATE: env.AUTO_UPDATE });
        return send(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/settings") {
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
      return send(500, { error: String(error?.message ?? error).slice(0, 300) });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`admin page on 127.0.0.1:${port} (through SSH only)`));
  return server;
}

/** A new admin token (the install script writes one to bot.env). */
export const newAdminToken = () => randomBytes(24).toString("hex");

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EDCH bot admin</title>
<style>
:root{--bg:#0d0f12;--card:#171a1f;--line:#2a2f37;--text:#e8e6e1;--sub:#9aa0a8;--accent:#f07b05;--bad:#e5484d;--ok:#3fb950}
@media (prefers-color-scheme: light){:root{--bg:#f6f5f2;--card:#fff;--line:#ddd;--text:#1b1d21;--sub:#5d636b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0}h1 span{color:var(--accent)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
h2{font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--sub)}dd{margin:0;overflow-wrap:anywhere}
label{display:block;margin:12px 0 4px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit}
input.bad{border-color:var(--bad)}.sub{color:var(--sub);font-size:13px}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
button{background:var(--accent);color:#111;border:0;border-radius:8px;padding:9px 16px;font:600 14px system-ui;cursor:pointer}
button.ghost{background:none;color:var(--text);border:1px solid var(--line)}button:disabled{opacity:.5;cursor:default}
.msg{font-size:14px}.ok{color:var(--ok)}.bad{color:var(--bad)}ul{margin:6px 0 0;padding-left:18px}.lang{float:right}.lang button{background:none;color:var(--sub);padding:4px 6px;font-weight:400}
</style></head><body><main>
<div class="lang"><button data-lang="en">EN</button><button data-lang="fr">FR</button></div>
<h1><span>EDCH</span> bot admin</h1>
<section><h2 data-t="status"></h2><dl id="status"></dl></section>
<section><h2 data-t="updates"></h2>
<label class="row" style="font-weight:400"><input type="checkbox" id="auto"> <span data-t="auto"></span></label>
<div id="pending" class="sub"></div>
<div class="row"><button class="ghost" id="check" data-t="check"></button><button id="update" data-t="update"></button><span class="msg" id="updateMsg"></span></div></section>
<section><h2 data-t="settings"></h2><form id="form">
<label for="DISCORD_APPLICATION_ID">Application ID</label><input type="text" id="DISCORD_APPLICATION_ID" name="DISCORD_APPLICATION_ID">
<label for="DISCORD_PUBLIC_KEY">Public Key</label><input type="text" id="DISCORD_PUBLIC_KEY" name="DISCORD_PUBLIC_KEY" spellcheck="false">
<label for="DISCORD_BOT_TOKEN" data-t="token"></label><input type="password" id="DISCORD_BOT_TOKEN" name="DISCORD_BOT_TOKEN" autocomplete="off"><div class="sub" data-t="blankKeeps"></div>
<label for="DISCORD_GUILD_ID" data-t="guild"></label><input type="text" id="DISCORD_GUILD_ID" name="DISCORD_GUILD_ID">
<label for="DUCKDNS_TOKEN" data-t="duck"></label><input type="password" id="DUCKDNS_TOKEN" name="DUCKDNS_TOKEN" autocomplete="off"><div class="sub" data-t="blankKeeps"></div>
<div class="row"><button type="submit" data-t="save"></button><span class="msg" id="saveMsg"></span></div></form>
<p class="sub" data-t="domainNote"></p></section>
</main><script>
const TEXT = {
  en: { status: "Status", updates: "Updates from GitHub", auto: "Update automatically every night (back to the previous version if an update fails)", check: "Check now", update: "Update now",
    settings: "Settings", token: "Bot token", guild: "Discord server ID (empty: any server)", duck: "DuckDNS token", blankKeeps: "Left blank: unchanged.", save: "Save and restart",
    domainNote: "To change the DuckDNS name or the machine, run the install script again from your PC.",
    version: "Version", running: "Running since", address: "Address", factionList: "Game factions known", lastCheck: "Last check", lastResult: "Last update",
    upToDate: "Up to date.", updated: "Updated: the bot restarts, reload this page in a few seconds.", failed: "The update failed; the bot kept its previous version.", busy: "An update is already running.",
    pending: (n) => n + " new change(s) on GitHub:", none: "No new change on GitHub.", saved: "Saved.", restarting: "Saved: the bot restarts, reload this page in a few seconds.", badFields: "Some fields need a look.", working: "Working…" },
  fr: { status: "État", updates: "Mises à jour depuis GitHub", auto: "Mettre à jour automatiquement chaque nuit (retour à la version précédente si une mise à jour échoue)", check: "Vérifier", update: "Mettre à jour",
    settings: "Réglages", token: "Token du bot", guild: "ID du serveur Discord (vide : tous les serveurs)", duck: "Token DuckDNS", blankKeeps: "Laissé vide : inchangé.", save: "Enregistrer et redémarrer",
    domainNote: "Pour changer le nom DuckDNS ou la machine, relance le script d'installation depuis ton PC.",
    version: "Version", running: "En marche depuis", address: "Adresse", factionList: "Factions du jeu connues", lastCheck: "Dernière vérification", lastResult: "Dernière mise à jour",
    upToDate: "À jour.", updated: "Mis à jour : le bot redémarre, recharge la page dans quelques secondes.", failed: "La mise à jour a échoué ; le bot a gardé sa version précédente.", busy: "Une mise à jour est déjà en cours.",
    pending: (n) => n + " nouveauté(s) sur GitHub :", none: "Rien de nouveau sur GitHub.", saved: "Enregistré.", restarting: "Enregistré : le bot redémarre, recharge la page dans quelques secondes.", badFields: "Quelques champs sont à revoir.", working: "En cours…" },
};
const token = new URLSearchParams(location.search).get("t");
history.replaceState(null, "", location.pathname);
let lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
try { lang = localStorage.getItem("edch.admin.lang") || lang; } catch {}
const $ = (id) => document.getElementById(id);
const api = (path, body) => fetch(path, { method: body ? "POST" : "GET", headers: { "X-Admin-Token": token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const when = (iso) => (iso ? new Date(iso).toLocaleString(lang) : "—");
let last = null;
function render() {
  const t = TEXT[lang]; document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t[el.dataset.t];
  if (!last) return;
  const s = last; const r = s.state || {};
  const rows = [[t.version, s.version], [t.running, when(s.startedAt)], [t.address, s.publicUrl], [t.factionList, String(s.factions)], [t.lastCheck, when(r.checkedAt)], [t.lastResult, r.result ? t[r.result] + " " + when(r.updatedAt || r.failedAt) : "—"]];
  $("status").replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; return [dt, dd]; }));
  $("auto").checked = s.autoUpdate;
  const p = r.pending || [];
  const list = document.createElement("ul"); for (const c of p) { const li = document.createElement("li"); li.textContent = c; list.append(li); }
  $("pending").replaceChildren(document.createTextNode(r.checkedAt ? (p.length ? t.pending(p.length) : t.none) : ""), ...(p.length ? [list] : []));
}
async function load() {
  last = await api("/api/status");
  for (const [k, v] of Object.entries(last.settings || {})) { const f = $("form").elements[k]; if (f && !f.value) f.value = v; }
  render();
}
for (const b of document.querySelectorAll("[data-lang]")) b.onclick = () => { lang = b.dataset.lang; try { localStorage.setItem("edch.admin.lang", lang); } catch {} render(); };
$("auto").onchange = () => api("/api/auto-update", { on: $("auto").checked });
$("check").onclick = async () => { $("updateMsg").textContent = TEXT[lang].working; await api("/api/check", {}); $("updateMsg").textContent = ""; load(); };
$("update").onclick = async () => {
  $("update").disabled = true; $("updateMsg").className = "msg"; $("updateMsg").textContent = TEXT[lang].working;
  const a = await api("/api/update", {}).catch(() => ({ message: "updated" }));
  $("updateMsg").className = "msg " + (a.ok ? "ok" : "bad"); $("updateMsg").textContent = TEXT[lang][a.message] || a.message; $("update").disabled = false;
  if (a.message !== "updated") load();
};
$("form").onsubmit = async (e) => {
  e.preventDefault();
  for (const el of $("form").querySelectorAll("input")) el.classList.remove("bad");
  const a = await api("/api/settings", Object.fromEntries(new FormData($("form"))));
  if (a.bad) { for (const k of a.bad) $("form").elements[k]?.classList.add("bad"); $("saveMsg").className = "msg bad"; $("saveMsg").textContent = TEXT[lang].badFields; return; }
  $("saveMsg").className = "msg ok"; $("saveMsg").textContent = a.restart ? TEXT[lang].restarting : TEXT[lang].saved;
  $("form").DISCORD_BOT_TOKEN.value = ""; $("form").DUCKDNS_TOKEN.value = "";
};
load();
</script></body></html>`;

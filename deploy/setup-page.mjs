// The install scripts' setup page: a form in the browser to give the bot's settings (where it
// runs, the Discord application's ids and secrets, the Linux machine and its DuckDNS address)
// instead of typing them in a terminal. It runs on this PC only (127.0.0.1, a one-time address),
// checks what is typed, writes it to a settings file readable by its owner only, and stops.
//   node deploy/setup-page.mjs <settings file to write> [previous answers file]
// The previous answers file (.edch-install) fills the form again; secrets are never kept in it.

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [outFile, previousFile] = process.argv.slice(2);
if (!outFile) {
  console.error("usage: node deploy/setup-page.mjs <settings file> [previous answers file]");
  process.exit(2);
}

/** KEY=value lines (the previous answers), blank or unreadable: none. */
function readKeyValues(path) {
  const values = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2];
    }
  } catch {
    // First install: nothing to fill in.
  }
  return values;
}
const previous = previousFile ? readKeyValues(previousFile) : {};

/** What each field accepts; a value that doesn't fit is refused with the field's message. */
const SNOWFLAKE = /^\d{17,20}$/;
const FIELDS = {
  MODE: (v) => v === "cloudflare" || v === "server",
  DISCORD_APPLICATION_ID: (v) => SNOWFLAKE.test(v),
  DISCORD_PUBLIC_KEY: (v) => /^[0-9a-f]{64}$/i.test(v),
  DISCORD_BOT_TOKEN: (v) => v.length >= 50 && !/\s/.test(v),
  DISCORD_GUILD_ID: (v) => v === "" || SNOWFLAKE.test(v),
  SSH_TARGET: (v, all) => all.MODE !== "server" || /^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$/.test(v),
  SSH_PORT: (v, all) => all.MODE !== "server" || (/^\d{1,5}$/.test(v) && +v > 0 && +v < 65536),
  DUCKDNS_DOMAIN: (v, all) => all.MODE !== "server" || /^[a-z0-9-]{1,63}$/.test(v),
  DUCKDNS_TOKEN: (v, all) => all.MODE !== "server" || /^[0-9a-f-]{36}$/i.test(v),
};

const token = randomBytes(16).toString("hex");

const page = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EDCH bot setup</title>
<style>
:root{--bg:#0d0f12;--card:#171a1f;--line:#2a2f37;--text:#e8e6e1;--sub:#9aa0a8;--accent:#f07b05;--bad:#e5484d;--ok:#3fb950}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f6f5f2;--card:#fff;--line:#ddd;--text:#1b1d21;--sub:#5d636b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h1 span{color:var(--accent)}
.sub{color:var(--sub);font-size:13px}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
h2{font-size:15px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
label{display:block;margin:12px 0 4px;font-weight:600}input{width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit}
input.bad{border-color:var(--bad)}.err{color:var(--bad);font-size:13px;min-height:1em}.choice{display:flex;gap:10px;flex-wrap:wrap}
.choice label{flex:1 1 260px;margin:0;border:1px solid var(--line);border-radius:8px;padding:12px;cursor:pointer;font-weight:400}
.choice input{width:auto;margin-right:8px}.choice label:has(input:checked){border-color:var(--accent)}
button{background:var(--accent);color:#111;border:0;border-radius:8px;padding:11px 18px;font:600 15px system-ui;cursor:pointer}
a{color:var(--accent)}.lang{float:right}.lang button{background:none;color:var(--sub);padding:4px 6px;font-weight:400}
.done{color:var(--ok);font-weight:600}[hidden]{display:none!important}
</style></head><body><main>
<div class="lang"><button type="button" data-lang="en">EN</button><button type="button" data-lang="fr">FR</button></div>
<h1><span>EDCH</span> bot setup</h1>
<p class="sub" data-t="intro"></p>
<form id="form" novalidate>
<section><h2 data-t="whereTitle"></h2><div class="choice">
<label><input type="radio" name="MODE" value="cloudflare"><b>Cloudflare</b><br><span class="sub" data-t="cloudflareHelp"></span></label>
<label><input type="radio" name="MODE" value="server"><b data-t="serverName"></b><br><span class="sub" data-t="serverHelp"></span></label>
</div><div class="err" data-for="MODE"></div></section>
<section><h2>Discord</h2><p class="sub" data-t="discordHelp"></p>
<label for="DISCORD_APPLICATION_ID">Application ID</label><input id="DISCORD_APPLICATION_ID" name="DISCORD_APPLICATION_ID" inputmode="numeric" autocomplete="off"><div class="err" data-for="DISCORD_APPLICATION_ID"></div>
<div><label for="DISCORD_PUBLIC_KEY">Public Key</label><input id="DISCORD_PUBLIC_KEY" name="DISCORD_PUBLIC_KEY" autocomplete="off" spellcheck="false"><div class="err" data-for="DISCORD_PUBLIC_KEY"></div>
<label for="DISCORD_BOT_TOKEN" data-t="tokenLabel"></label><input id="DISCORD_BOT_TOKEN" name="DISCORD_BOT_TOKEN" type="password" autocomplete="off"><div class="err" data-for="DISCORD_BOT_TOKEN"></div></div>
<label for="DISCORD_GUILD_ID" data-t="guildLabel"></label><input id="DISCORD_GUILD_ID" name="DISCORD_GUILD_ID" inputmode="numeric" autocomplete="off"><div class="sub" data-t="guildHelp"></div><div class="err" data-for="DISCORD_GUILD_ID"></div>
</section>
<section data-server><h2 data-t="machineTitle"></h2>
<label for="SSH_TARGET" data-t="sshLabel"></label><input id="SSH_TARGET" name="SSH_TARGET" placeholder="pi@192.168.1.20" autocomplete="off"><div class="sub" data-t="sshHelp"></div><div class="err" data-for="SSH_TARGET"></div>
<label for="SSH_PORT" data-t="sshPortLabel"></label><input id="SSH_PORT" name="SSH_PORT" inputmode="numeric" value="22"><div class="err" data-for="SSH_PORT"></div>
<label for="DUCKDNS_DOMAIN" data-t="duckLabel"></label><input id="DUCKDNS_DOMAIN" name="DUCKDNS_DOMAIN" placeholder="mysquadron" autocomplete="off"><div class="sub" data-t="duckHelp"></div><div class="err" data-for="DUCKDNS_DOMAIN"></div>
<label for="DUCKDNS_TOKEN" data-t="duckTokenLabel"></label><input id="DUCKDNS_TOKEN" name="DUCKDNS_TOKEN" type="password" autocomplete="off"><div class="err" data-for="DUCKDNS_TOKEN"></div>
<p class="sub" data-t="portsHelp"></p>
</section>
<button type="submit" data-t="continue"></button> <span class="err" id="formError"></span>
</form>
<section id="done" hidden><p class="done" data-t="done"></p></section>
</main>
<script>
const TEXT = {
  en: {
    intro: "This page runs on your PC only and closes once you continue. Secrets are given to the install script, never kept by this page.",
    whereTitle: "Where the bot runs", cloudflareHelp: "Free Cloudflare Worker: nothing to keep switched on. The install script signs you in to Cloudflare.",
    serverName: "Your Linux machine", serverHelp: "A Linux machine you reach with SSH (a Raspberry Pi, a server at home). Its address comes from DuckDNS, with HTTPS.",
    discordHelp: "Discord developer portal → your application: Application ID and Public Key are in General Information; the token in Bot → Reset Token.",
    tokenLabel: "Bot token",
    guildLabel: "Your Discord server's ID (optional)", guildHelp: "Right-click your server (developer mode on) → Copy Server ID. Set: the bot answers this server only.",
    machineTitle: "The Linux machine", sshLabel: "SSH address", sshHelp: "user@address, as you'd type it after ssh. That user needs sudo rights.", sshPortLabel: "SSH port",
    duckLabel: "DuckDNS name", duckHelp: "Create it on duckdns.org: \\"mysquadron\\" for mysquadron.duckdns.org. Your router must forward ports 80 and 443 to the machine.",
    duckTokenLabel: "DuckDNS token", portsHelp: "Some Internet providers share one IP between customers (CGNAT): ports can't be forwarded then. Ask them for a public IP.",
    continue: "Continue the installation", done: "Done: go back to the terminal, the installation goes on there. You can close this page.",
    bad: { MODE: "Choose where the bot runs.", DISCORD_APPLICATION_ID: "17 to 20 digits.", DISCORD_PUBLIC_KEY: "64 characters, 0-9 and a-f.", DISCORD_BOT_TOKEN: "Paste the whole token.", DISCORD_GUILD_ID: "17 to 20 digits, or empty.", SSH_TARGET: "user@address", SSH_PORT: "A port number.", DUCKDNS_DOMAIN: "The name only: lowercase letters, digits and dashes.", DUCKDNS_TOKEN: "The token shown on duckdns.org (36 characters)." },
    failed: "Some fields need a look.",
  },
  fr: {
    intro: "Cette page tourne uniquement sur ton PC et se ferme quand tu continues. Les secrets sont passés au script d'installation, jamais gardés par cette page.",
    whereTitle: "Où tourne le bot", cloudflareHelp: "Worker Cloudflare gratuit : rien à garder allumé. Le script d'installation te connecte à Cloudflare.",
    serverName: "Ta machine Linux", serverHelp: "Une machine Linux que tu joins en SSH (un Raspberry Pi, un serveur à la maison). Son adresse vient de DuckDNS, en HTTPS.",
    discordHelp: "Portail développeur Discord → ton application : Application ID et Public Key sont dans General Information ; le token dans Bot → Reset Token.",
    tokenLabel: "Token du bot",
    guildLabel: "ID de ton serveur Discord (facultatif)", guildHelp: "Clic droit sur ton serveur (mode développeur activé) → Copier l'identifiant du serveur. Renseigné : le bot ne répond qu'à ce serveur.",
    machineTitle: "La machine Linux", sshLabel: "Adresse SSH", sshHelp: "utilisateur@adresse, comme après ssh. Cet utilisateur doit avoir les droits sudo.", sshPortLabel: "Port SSH",
    duckLabel: "Nom DuckDNS", duckHelp: "À créer sur duckdns.org : « monescadrille » pour monescadrille.duckdns.org. Ta box doit rediriger les ports 80 et 443 vers la machine.",
    duckTokenLabel: "Token DuckDNS", portsHelp: "Certains fournisseurs partagent une IP entre clients (CGNAT) : impossible alors de rediriger des ports. Demande-leur une IP publique.",
    continue: "Continuer l'installation", done: "C'est noté : retourne dans le terminal, l'installation continue là-bas. Tu peux fermer cette page.",
    bad: { MODE: "Choisis où tourne le bot.", DISCORD_APPLICATION_ID: "17 à 20 chiffres.", DISCORD_PUBLIC_KEY: "64 caractères, 0-9 et a-f.", DISCORD_BOT_TOKEN: "Colle le token en entier.", DISCORD_GUILD_ID: "17 à 20 chiffres, ou vide.", SSH_TARGET: "utilisateur@adresse", SSH_PORT: "Un numéro de port.", DUCKDNS_DOMAIN: "Le nom seul : minuscules, chiffres et tirets.", DUCKDNS_TOKEN: "Le token affiché sur duckdns.org (36 caractères)." },
    failed: "Quelques champs sont à revoir.",
  },
};
const PREVIOUS = ${JSON.stringify(Object.fromEntries(Object.entries(previous).filter(([k]) => ["MODE", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID", "SSH_TARGET", "SSH_PORT", "DUCKDNS_DOMAIN"].includes(k))))};
let lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
try { lang = localStorage.getItem("edch.setup.lang") || lang; } catch {}
const form = document.getElementById("form");
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  try { localStorage.setItem("edch.setup.lang", l); } catch {}
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = TEXT[l][el.dataset.t];
}
function showMode() {
  const mode = form.MODE.value;
  for (const el of document.querySelectorAll("[data-server]")) el.hidden = mode !== "server";
}
for (const b of document.querySelectorAll("[data-lang]")) b.onclick = () => setLang(b.dataset.lang);
for (const [k, v] of Object.entries(PREVIOUS)) { const f = form.elements[k]; if (f && f.type !== "radio") f.value = v; }
if (PREVIOUS.MODE) for (const r of form.querySelectorAll('[name=MODE]')) r.checked = r.value === PREVIOUS.MODE;
form.addEventListener("change", showMode);
setLang(lang); showMode();
form.onsubmit = async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  for (const el of document.querySelectorAll(".err[data-for]")) el.textContent = "";
  for (const el of form.querySelectorAll("input")) el.classList.remove("bad");
  const answer = await fetch("/save?t=${token}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }).then((r) => r.json()).catch(() => ({ bad: ["MODE"] }));
  if (answer.ok) { form.hidden = true; document.getElementById("done").hidden = false; return; }
  for (const key of answer.bad || []) {
    const err = document.querySelector('.err[data-for="' + key + '"]'); if (err) err.textContent = TEXT[lang].bad[key];
    const input = form.elements[key]; if (input && input.classList) input.classList.add("bad");
  }
  document.getElementById("formError").textContent = TEXT[lang].failed;
};
</script></body></html>`;

/** Opens the page in the default browser (Windows, macOS or Linux). */
function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // No browser to open: the address is printed below.
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  // The one-time address only: another program on this PC can't read or post the form.
  if (url.searchParams.get("t") !== token) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(page());
    return;
  }
  if (req.method === "POST" && url.pathname === "/save") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) req.destroy();
    });
    req.on("end", () => {
      let values = {};
      try {
        values = JSON.parse(body);
      } catch {
        // Answered as every field wrong below.
      }
      const clean = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, String(values[k] ?? "").trim()]));
      const bad = Object.entries(FIELDS)
        .filter(([key, check]) => !check(clean[key], clean))
        .map(([key]) => key);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (bad.length) {
        res.end(JSON.stringify({ bad }));
        return;
      }
      const lines = Object.entries(clean).map(([k, v]) => `${k}=${v}`);
      writeFileSync(outFile, lines.join("\n") + "\n", { mode: 0o600 });
      res.end(JSON.stringify({ ok: true }));
      console.log("Settings received.");
      setTimeout(() => process.exit(0), 300);
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(0, "127.0.0.1", () => {
  const address = `http://127.0.0.1:${server.address().port}/?t=${token}`;
  console.log(`Setup page: ${address}\n(opened in your browser; fill it in, then come back here)`);
  openBrowser(address);
});

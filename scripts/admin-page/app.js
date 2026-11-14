// The bot's admin page in the browser: sign-in (or making the account), status, updates,
// settings and password. Every text is put in the page as text (never as HTML), and every call
// goes to this same address with the "X-EDCH" header, which pages of other sites can't send.

const TEXT = {
  en: {
    createTitle: "Make the admin account",
    createHelp:
      "First visit: choose a user name and a password for this page. Lost them later? Delete ~/edch-discord/admin-credentials.json on the machine (over SSH) and open the page again from the setup.",
    user: "User name",
    password: "Password",
    passwordAgain: "Password again",
    passwordRules: "At least 12 characters, not containing the user name. A sentence is easy to remember.",
    createButton: "Make the account",
    loginTitle: "Sign in",
    loginButton: "Sign in",
    lostHelp:
      "Lost the password? Delete ~/edch-discord/admin-credentials.json on the machine (over SSH), then open the page from the setup to make a new account.",
    logout: "Sign out",
    status: "Status",
    updates: "Updates from GitHub",
    auto: "Update automatically every night (back to the previous version if an update fails)",
    check: "Check now",
    update: "Update now",
    settings: "Settings",
    token: "Bot token",
    guild: "Discord server ID (empty: any server)",
    duck: "DuckDNS token",
    blankKeeps: "Left blank: unchanged.",
    save: "Save and restart",
    domainNote: "To change the DuckDNS name or the ports, run the setup again from your PC.",
    account: "Admin account",
    currentPassword: "Current password",
    nextPassword: "New password",
    changePassword: "Change the password",
    version: "Version",
    running: "Running since",
    address: "Address",
    factionList: "Game factions known",
    lastCheck: "Last check",
    lastResult: "Last update",
    upToDate: "Up to date.",
    updated: "Updated: the bot restarts, reload this page in a few seconds.",
    failed: "The update failed; the bot kept its previous version.",
    busy: "An update is already running.",
    pending: (n) => `${n} new change(s) on GitHub:`,
    none: "No new change on GitHub.",
    saved: "Saved.",
    restarting: "Saved: the bot restarts, reload this page in a few seconds.",
    badFields: "Some fields need a look.",
    working: "Working…",
    passwordChanged: "Password changed.",
    errors: {
      wrong: "Wrong user name or password.",
      locked: (s) => `Too many tries: wait ${Math.ceil(s / 60)} minute(s).`,
      tooShort: "The password needs at least 12 characters.",
      tooLong: "The password is too long.",
      containsUser: "The password must not contain the user name.",
      tooSimple: "The password is too simple.",
      badUser: "User name: 3 to 32 letters, digits, dots, dashes or underscores.",
      mismatch: "The two passwords differ.",
      noKey: "Open this page from the setup on your PC (it gives the key the first account needs).",
      exists: "An account exists already: sign in.",
      expired: "Signed out (session ended): sign in again.",
      network: "The bot doesn't answer.",
    },
  },
  fr: {
    createTitle: "Créer le compte d'administration",
    createHelp:
      "Première visite : choisis un nom d'utilisateur et un mot de passe pour cette page. Perdus plus tard ? Supprime ~/edch-discord/admin-credentials.json sur la machine (en SSH) et rouvre la page depuis l'installation.",
    user: "Nom d'utilisateur",
    password: "Mot de passe",
    passwordAgain: "Mot de passe, encore",
    passwordRules: "Au moins 12 caractères, sans le nom d'utilisateur. Une phrase se retient facilement.",
    createButton: "Créer le compte",
    loginTitle: "Connexion",
    loginButton: "Se connecter",
    lostHelp:
      "Mot de passe perdu ? Supprime ~/edch-discord/admin-credentials.json sur la machine (en SSH), puis rouvre la page depuis l'installation pour créer un nouveau compte.",
    logout: "Se déconnecter",
    status: "État",
    updates: "Mises à jour depuis GitHub",
    auto: "Mettre à jour automatiquement chaque nuit (retour à la version précédente si une mise à jour échoue)",
    check: "Vérifier",
    update: "Mettre à jour",
    settings: "Réglages",
    token: "Token du bot",
    guild: "ID du serveur Discord (vide : tous les serveurs)",
    duck: "Token DuckDNS",
    blankKeeps: "Laissé vide : inchangé.",
    save: "Enregistrer et redémarrer",
    domainNote: "Pour changer le nom DuckDNS ou les ports, relance l'installation depuis ton PC.",
    account: "Compte d'administration",
    currentPassword: "Mot de passe actuel",
    nextPassword: "Nouveau mot de passe",
    changePassword: "Changer le mot de passe",
    version: "Version",
    running: "En marche depuis",
    address: "Adresse",
    factionList: "Factions du jeu connues",
    lastCheck: "Dernière vérification",
    lastResult: "Dernière mise à jour",
    upToDate: "À jour.",
    updated: "Mis à jour : le bot redémarre, recharge la page dans quelques secondes.",
    failed: "La mise à jour a échoué ; le bot a gardé sa version précédente.",
    busy: "Une mise à jour est déjà en cours.",
    pending: (n) => `${n} nouveauté(s) sur GitHub :`,
    none: "Rien de nouveau sur GitHub.",
    saved: "Enregistré.",
    restarting: "Enregistré : le bot redémarre, recharge la page dans quelques secondes.",
    badFields: "Quelques champs sont à revoir.",
    working: "En cours…",
    passwordChanged: "Mot de passe changé.",
    errors: {
      wrong: "Nom d'utilisateur ou mot de passe incorrect.",
      locked: (s) => `Trop d'essais : attends ${Math.ceil(s / 60)} minute(s).`,
      tooShort: "Le mot de passe doit faire au moins 12 caractères.",
      tooLong: "Le mot de passe est trop long.",
      containsUser: "Le mot de passe ne doit pas contenir le nom d'utilisateur.",
      tooSimple: "Le mot de passe est trop simple.",
      badUser: "Nom d'utilisateur : 3 à 32 lettres, chiffres, points, tirets ou soulignés.",
      mismatch: "Les deux mots de passe sont différents.",
      noKey: "Ouvre cette page depuis l'installation sur ton PC (elle donne la clé dont le premier compte a besoin).",
      exists: "Un compte existe déjà : connecte-toi.",
      expired: "Déconnecté (session terminée) : reconnecte-toi.",
      network: "Le bot ne répond pas.",
    },
  },
};

// The key the setup gave (needed only to make the first account), then out of the address bar.
const params = new URLSearchParams(location.search);
const setupKey = params.get("k") || "";
history.replaceState(null, "", location.pathname);

let lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
try {
  lang = localStorage.getItem("edch.admin.lang") || lang;
} catch {
  // Stays the browser's language.
}
const $ = (id) => document.getElementById(id);
const t = () => TEXT[lang];
let last = null;

/** A call to the admin page's server; answers { status, ...json }. */
async function api(path, body) {
  try {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "X-EDCH": "1", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/login") show("login", "expired");
    return { status: response.status, ...json };
  } catch {
    return { status: 0, error: "network" };
  }
}

function errorText(answer) {
  const e = t().errors[answer.error];
  return typeof e === "function" ? e(answer.retryIn || 0) : e || answer.error || "";
}

function setLang(l) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem("edch.admin.lang", l);
  } catch {
    // Not kept.
  }
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t()[el.dataset.t];
  render();
}

/** Shows one of the three views: "create", "login" or "app". */
function show(view, error) {
  $("create").hidden = view !== "create";
  $("login").hidden = view !== "login";
  $("app").hidden = view !== "app";
  if (view === "login") $("loginMsg").textContent = error ? errorText({ error }) : "";
  if (view === "app") load();
}

const when = (iso) => (iso ? new Date(iso).toLocaleString(lang) : "—");

function render() {
  if (!last) return;
  const s = last;
  const r = s.state || {};
  const rows = [
    [t().version, s.version],
    [t().running, when(s.startedAt)],
    [t().address, s.publicUrl],
    [t().factionList, String(s.factions)],
    [t().lastCheck, when(r.checkedAt)],
    [t().lastResult, r.result ? `${t()[r.result] || r.result} ${when(r.updatedAt || r.failedAt)}` : "—"],
  ];
  $("status").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v ?? "";
      return [dt, dd];
    }),
  );
  $("auto").checked = Boolean(s.autoUpdate);
  const pending = Array.isArray(r.pending) ? r.pending : [];
  const list = document.createElement("ul");
  for (const change of pending) {
    const li = document.createElement("li");
    li.textContent = change;
    list.append(li);
  }
  const head = document.createTextNode(r.checkedAt ? (pending.length ? t().pending(pending.length) : t().none) : "");
  $("pending").replaceChildren(head, ...(pending.length ? [list] : []));
}

async function load() {
  const answer = await api("/api/status");
  if (answer.status !== 200) return;
  last = answer;
  const form = $("settingsForm");
  for (const [key, value] of Object.entries(answer.settings || {})) {
    const field = form.elements[key];
    if (field && !field.value) field.value = value;
  }
  render();
}

function message(id, text, ok) {
  $(id).className = `msg ${ok === undefined ? "" : ok ? "ok" : "bad"}`;
  $(id).textContent = text;
}

$("createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!setupKey) return message("createMsg", t().errors.noKey, false);
  if ($("newPassword").value !== $("newPassword2").value) return message("createMsg", t().errors.mismatch, false);
  const answer = await api("/api/create", {
    key: setupKey,
    user: $("newUser").value.trim(),
    password: $("newPassword").value,
  });
  if (answer.status !== 200) return message("createMsg", errorText(answer), false);
  $("newPassword").value = $("newPassword2").value = "";
  show("app");
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = await api("/api/login", { user: $("user").value.trim(), password: $("password").value });
  $("password").value = "";
  if (answer.status !== 200) return message("loginMsg", errorText(answer), false);
  show("app");
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", {});
  last = null;
  show("login");
});

$("auto").addEventListener("change", () => api("/api/auto-update", { on: $("auto").checked }));

$("check").addEventListener("click", async () => {
  message("updateMsg", t().working);
  await api("/api/check", {});
  message("updateMsg", "");
  load();
});

$("update").addEventListener("click", async () => {
  $("update").disabled = true;
  message("updateMsg", t().working);
  const answer = await api("/api/update", {});
  message("updateMsg", t()[answer.message] || errorText(answer), Boolean(answer.ok));
  $("update").disabled = false;
  if (answer.message !== "updated") load();
});

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = $("settingsForm");
  for (const input of form.querySelectorAll("input")) input.classList.remove("bad");
  const answer = await api("/api/settings", Object.fromEntries(new FormData(form)));
  if (answer.bad) {
    for (const key of answer.bad) form.elements[key]?.classList.add("bad");
    return message("saveMsg", t().badFields, false);
  }
  if (answer.status !== 200) return message("saveMsg", errorText(answer), false);
  message("saveMsg", answer.restart ? t().restarting : t().saved, true);
  form.elements.DISCORD_BOT_TOKEN.value = "";
  form.elements.DUCKDNS_TOKEN.value = "";
});

$("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = await api("/api/password", { current: $("currentPassword").value, next: $("nextPassword").value });
  $("currentPassword").value = $("nextPassword").value = "";
  message("passwordMsg", answer.status === 200 ? t().passwordChanged : errorText(answer), answer.status === 200);
});

for (const button of document.querySelectorAll("[data-lang]"))
  button.addEventListener("click", () => setLang(button.dataset.lang));

setLang(lang);
api("/api/session").then((answer) => {
  if (answer.signedIn) show("app");
  else show(answer.stage === "create" ? "create" : "login");
});

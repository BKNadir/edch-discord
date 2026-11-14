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
  de: {
    createTitle: "Admin-Konto anlegen",
    createHelp:
      "Erster Besuch: wähle einen Benutzernamen und ein Passwort für diese Seite. Später vergessen? Lösche ~/edch-discord/admin-credentials.json auf der Maschine (per SSH) und öffne die Seite erneut über die Einrichtung.",
    user: "Benutzername",
    password: "Passwort",
    passwordAgain: "Passwort wiederholen",
    passwordRules: "Mindestens 12 Zeichen, ohne den Benutzernamen. Einen Satz merkt man sich leicht.",
    createButton: "Konto anlegen",
    loginTitle: "Anmelden",
    loginButton: "Anmelden",
    lostHelp:
      "Passwort vergessen? Lösche ~/edch-discord/admin-credentials.json auf der Maschine (per SSH) und öffne die Seite dann über die Einrichtung, um ein neues Konto anzulegen.",
    logout: "Abmelden",
    status: "Status",
    updates: "Updates von GitHub",
    auto: "Jede Nacht automatisch aktualisieren (zurück zur vorherigen Version, wenn ein Update fehlschlägt)",
    check: "Jetzt prüfen",
    update: "Jetzt aktualisieren",
    settings: "Einstellungen",
    token: "Bot-Token",
    guild: "Discord-Server-ID (leer: jeder Server)",
    duck: "DuckDNS-Token",
    blankKeeps: "Leer gelassen: unverändert.",
    save: "Speichern und neu starten",
    domainNote: "Um den DuckDNS-Namen oder die Ports zu ändern, starte die Einrichtung erneut von deinem PC.",
    account: "Admin-Konto",
    currentPassword: "Aktuelles Passwort",
    nextPassword: "Neues Passwort",
    changePassword: "Passwort ändern",
    version: "Version",
    running: "Läuft seit",
    address: "Adresse",
    factionList: "Bekannte Fraktionen im Spiel",
    lastCheck: "Letzte Prüfung",
    lastResult: "Letztes Update",
    upToDate: "Aktuell.",
    updated: "Aktualisiert: der Bot startet neu, lade diese Seite in ein paar Sekunden neu.",
    failed: "Das Update ist fehlgeschlagen; der Bot hat seine vorherige Version behalten.",
    busy: "Ein Update läuft bereits.",
    pending: (n) => `${n} neue Änderung(en) auf GitHub:`,
    none: "Keine neue Änderung auf GitHub.",
    saved: "Gespeichert.",
    restarting: "Gespeichert: der Bot startet neu, lade diese Seite in ein paar Sekunden neu.",
    badFields: "Einige Felder müssen geprüft werden.",
    working: "Läuft…",
    passwordChanged: "Passwort geändert.",
    errors: {
      wrong: "Falscher Benutzername oder falsches Passwort.",
      locked: (s) => `Zu viele Versuche: warte ${Math.ceil(s / 60)} Minute(n).`,
      tooShort: "Das Passwort braucht mindestens 12 Zeichen.",
      tooLong: "Das Passwort ist zu lang.",
      containsUser: "Das Passwort darf den Benutzernamen nicht enthalten.",
      tooSimple: "Das Passwort ist zu einfach.",
      badUser: "Benutzername: 3 bis 32 Buchstaben, Ziffern, Punkte, Bindestriche oder Unterstriche.",
      mismatch: "Die beiden Passwörter sind verschieden.",
      noKey:
        "Öffne diese Seite über die Einrichtung auf deinem PC (sie liefert den Schlüssel, den das erste Konto braucht).",
      exists: "Es gibt schon ein Konto: melde dich an.",
      expired: "Abgemeldet (Sitzung beendet): melde dich erneut an.",
      network: "Der Bot antwortet nicht.",
    },
  },
  es: {
    createTitle: "Crear la cuenta de administración",
    createHelp:
      "Primera visita: elige un nombre de usuario y una contraseña para esta página. ¿Los pierdes más tarde? Borra ~/edch-discord/admin-credentials.json en la máquina (por SSH) y vuelve a abrir la página desde la instalación.",
    user: "Nombre de usuario",
    password: "Contraseña",
    passwordAgain: "Repite la contraseña",
    passwordRules: "Al menos 12 caracteres, sin el nombre de usuario. Una frase se recuerda fácilmente.",
    createButton: "Crear la cuenta",
    loginTitle: "Iniciar sesión",
    loginButton: "Iniciar sesión",
    lostHelp:
      "¿Contraseña perdida? Borra ~/edch-discord/admin-credentials.json en la máquina (por SSH) y abre la página desde la instalación para crear una cuenta nueva.",
    logout: "Cerrar sesión",
    status: "Estado",
    updates: "Actualizaciones desde GitHub",
    auto: "Actualizar automáticamente cada noche (vuelta a la versión anterior si una actualización falla)",
    check: "Comprobar ahora",
    update: "Actualizar ahora",
    settings: "Ajustes",
    token: "Token del bot",
    guild: "ID del servidor de Discord (vacío: cualquier servidor)",
    duck: "Token de DuckDNS",
    blankKeeps: "Vacío: sin cambios.",
    save: "Guardar y reiniciar",
    domainNote: "Para cambiar el nombre DuckDNS o los puertos, vuelve a lanzar la instalación desde tu PC.",
    account: "Cuenta de administración",
    currentPassword: "Contraseña actual",
    nextPassword: "Nueva contraseña",
    changePassword: "Cambiar la contraseña",
    version: "Versión",
    running: "En marcha desde",
    address: "Dirección",
    factionList: "Facciones del juego conocidas",
    lastCheck: "Última comprobación",
    lastResult: "Última actualización",
    upToDate: "Al día.",
    updated: "Actualizado: el bot se reinicia, recarga esta página en unos segundos.",
    failed: "La actualización ha fallado; el bot ha conservado su versión anterior.",
    busy: "Ya hay una actualización en marcha.",
    pending: (n) => `${n} cambio(s) nuevo(s) en GitHub:`,
    none: "Nada nuevo en GitHub.",
    saved: "Guardado.",
    restarting: "Guardado: el bot se reinicia, recarga esta página en unos segundos.",
    badFields: "Hay que revisar algunos campos.",
    working: "En curso…",
    passwordChanged: "Contraseña cambiada.",
    errors: {
      wrong: "Nombre de usuario o contraseña incorrectos.",
      locked: (s) => `Demasiados intentos: espera ${Math.ceil(s / 60)} minuto(s).`,
      tooShort: "La contraseña necesita al menos 12 caracteres.",
      tooLong: "La contraseña es demasiado larga.",
      containsUser: "La contraseña no debe contener el nombre de usuario.",
      tooSimple: "La contraseña es demasiado simple.",
      badUser: "Nombre de usuario: de 3 a 32 letras, cifras, puntos, guiones o guiones bajos.",
      mismatch: "Las dos contraseñas son distintas.",
      noKey: "Abre esta página desde la instalación en tu PC (da la clave que necesita la primera cuenta).",
      exists: "Ya existe una cuenta: inicia sesión.",
      expired: "Sesión cerrada (terminada): vuelve a iniciar sesión.",
      network: "El bot no responde.",
    },
  },
  pt: {
    createTitle: "Criar a conta de administração",
    createHelp:
      "Primeira visita: escolha um nome de usuário e uma senha para esta página. Perdeu depois? Apague ~/edch-discord/admin-credentials.json na máquina (por SSH) e abra a página de novo pela instalação.",
    user: "Nome de usuário",
    password: "Senha",
    passwordAgain: "Repita a senha",
    passwordRules: "Pelo menos 12 caracteres, sem o nome de usuário. Uma frase é fácil de lembrar.",
    createButton: "Criar a conta",
    loginTitle: "Entrar",
    loginButton: "Entrar",
    lostHelp:
      "Perdeu a senha? Apague ~/edch-discord/admin-credentials.json na máquina (por SSH) e abra a página pela instalação para criar uma conta nova.",
    logout: "Sair",
    status: "Status",
    updates: "Atualizações do GitHub",
    auto: "Atualizar automaticamente toda noite (volta à versão anterior se uma atualização falhar)",
    check: "Verificar agora",
    update: "Atualizar agora",
    settings: "Configurações",
    token: "Token do bot",
    guild: "ID do servidor do Discord (vazio: qualquer servidor)",
    duck: "Token do DuckDNS",
    blankKeeps: "Deixado vazio: sem mudança.",
    save: "Salvar e reiniciar",
    domainNote: "Para mudar o nome DuckDNS ou as portas, rode a instalação de novo pelo seu PC.",
    account: "Conta de administração",
    currentPassword: "Senha atual",
    nextPassword: "Nova senha",
    changePassword: "Mudar a senha",
    version: "Versão",
    running: "Rodando desde",
    address: "Endereço",
    factionList: "Facções do jogo conhecidas",
    lastCheck: "Última verificação",
    lastResult: "Última atualização",
    upToDate: "Atualizado.",
    updated: "Atualizado: o bot reinicia, recarregue esta página em alguns segundos.",
    failed: "A atualização falhou; o bot manteve a versão anterior.",
    busy: "Uma atualização já está em andamento.",
    pending: (n) => `${n} mudança(s) nova(s) no GitHub:`,
    none: "Nada novo no GitHub.",
    saved: "Salvo.",
    restarting: "Salvo: o bot reinicia, recarregue esta página em alguns segundos.",
    badFields: "Alguns campos precisam ser revistos.",
    working: "Em andamento…",
    passwordChanged: "Senha alterada.",
    errors: {
      wrong: "Nome de usuário ou senha incorretos.",
      locked: (s) => `Tentativas demais: espere ${Math.ceil(s / 60)} minuto(s).`,
      tooShort: "A senha precisa ter pelo menos 12 caracteres.",
      tooLong: "A senha é longa demais.",
      containsUser: "A senha não pode conter o nome de usuário.",
      tooSimple: "A senha é simples demais.",
      badUser: "Nome de usuário: de 3 a 32 letras, números, pontos, hífens ou sublinhados.",
      mismatch: "As duas senhas são diferentes.",
      noKey: "Abra esta página pela instalação no seu PC (ela dá a chave de que a primeira conta precisa).",
      exists: "Já existe uma conta: entre.",
      expired: "Você saiu (sessão encerrada): entre de novo.",
      network: "O bot não responde.",
    },
  },
  ru: {
    createTitle: "Создание учётной записи администратора",
    createHelp:
      "Первый визит: выберите имя пользователя и пароль для этой страницы. Потеряли их позже? Удалите ~/edch-discord/admin-credentials.json на машине (по SSH) и снова откройте страницу из установки.",
    user: "Имя пользователя",
    password: "Пароль",
    passwordAgain: "Пароль ещё раз",
    passwordRules: "Не меньше 12 символов, без имени пользователя. Фразу легко запомнить.",
    createButton: "Создать учётную запись",
    loginTitle: "Вход",
    loginButton: "Войти",
    lostHelp:
      "Забыли пароль? Удалите ~/edch-discord/admin-credentials.json на машине (по SSH), затем откройте страницу из установки, чтобы создать новую учётную запись.",
    logout: "Выйти",
    status: "Состояние",
    updates: "Обновления с GitHub",
    auto: "Обновлять автоматически каждую ночь (возврат к прежней версии, если обновление не удалось)",
    check: "Проверить сейчас",
    update: "Обновить сейчас",
    settings: "Настройки",
    token: "Токен бота",
    guild: "ID сервера Discord (пусто: любой сервер)",
    duck: "Токен DuckDNS",
    blankKeeps: "Пустое поле: без изменений.",
    save: "Сохранить и перезапустить",
    domainNote: "Чтобы сменить имя DuckDNS или порты, снова запустите установку с вашего ПК.",
    account: "Учётная запись администратора",
    currentPassword: "Текущий пароль",
    nextPassword: "Новый пароль",
    changePassword: "Сменить пароль",
    version: "Версия",
    running: "Работает с",
    address: "Адрес",
    factionList: "Известные фракции игры",
    lastCheck: "Последняя проверка",
    lastResult: "Последнее обновление",
    upToDate: "Актуально.",
    updated: "Обновлено: бот перезапускается, перезагрузите страницу через несколько секунд.",
    failed: "Обновление не удалось; бот сохранил прежнюю версию.",
    busy: "Обновление уже выполняется.",
    pending: (n) => `Новых изменений на GitHub: ${n}`,
    none: "На GitHub ничего нового.",
    saved: "Сохранено.",
    restarting: "Сохранено: бот перезапускается, перезагрузите страницу через несколько секунд.",
    badFields: "Некоторые поля нужно проверить.",
    working: "Выполняется…",
    passwordChanged: "Пароль изменён.",
    errors: {
      wrong: "Неверное имя пользователя или пароль.",
      locked: (s) => `Слишком много попыток: подождите ${Math.ceil(s / 60)} мин.`,
      tooShort: "Пароль должен содержать не меньше 12 символов.",
      tooLong: "Пароль слишком длинный.",
      containsUser: "Пароль не должен содержать имя пользователя.",
      tooSimple: "Пароль слишком простой.",
      badUser: "Имя пользователя: от 3 до 32 букв, цифр, точек, дефисов или подчёркиваний.",
      mismatch: "Пароли не совпадают.",
      noKey: "Откройте эту страницу из установки на вашем ПК (она даёт ключ, нужный для первой учётной записи).",
      exists: "Учётная запись уже есть: войдите.",
      expired: "Сеанс завершён: войдите снова.",
      network: "Бот не отвечает.",
    },
  },
};

// The key the setup gave (needed only to make the first account), then out of the address bar.
const params = new URLSearchParams(location.search);
const setupKey = params.get("k") || "";
history.replaceState(null, "", location.pathname);

// The browser's language when EDCH has it, else English; the last choice is remembered.
let lang = (navigator.language || "en").slice(0, 2);
try {
  lang = localStorage.getItem("edch.admin.lang") || lang;
} catch {
  // Stays the browser's language.
}
if (!TEXT[lang]) lang = "en";
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
  for (const b of document.querySelectorAll("[data-lang]")) b.classList.toggle("on", b.dataset.lang === l);
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

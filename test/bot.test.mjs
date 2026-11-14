// EDCH-Discord: keys, reports, storage in the channel, the /bgs commands and EDCH's calls, against
// an in-memory Discord. The isolation tests check that a server never reads or writes another's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { BOT_ID, fakeDiscord } from "./fakeDiscord.mjs";
import { makeKey, readKey } from "../dist-test/key.js";
import { checkReport } from "../dist-test/report.js";
import { messageActions, readActions, readConfig, reportMessages } from "../dist-test/storage.js";
import { handleInteraction } from "../dist-test/commands.js";
import { handleApi } from "../dist-test/api.js";
import { verifyDiscordSignature } from "../dist-test/crypto.js";
import { summaryText } from "../dist-test/summary.js";

const SECRET = "test secret, long enough to be a real one";
const GUILD_A = "1200000000000000001";
const GUILD_B = "1200000000000000002";
const ADMIN = "1300000000000000001";
const PILOT = "1300000000000000002";
const OUTSIDER = "1300000000000000003";
const ROLE_A = "1400000000000000001";
const ROLE_B = "1400000000000000002";
const BOT_URL = "https://edch-discord.example.workers.dev";
const env = (extra = {}) => ({ DISCORD_APPLICATION_ID: BOT_ID, LINK_SECRET: SECRET, DISCORD_GUILD_ID: "", ...extra });
const NOW = Date.parse("2026-11-13T20:00:00Z");

const report = (faction, actions) => ({
  schema: "edch.bgs.report",
  version: 1,
  faction,
  from: "",
  to: "",
  app: "test",
  actions,
});
const ACTION = {
  at: "2026-11-13T19:00:00Z",
  kind: "mission",
  system: "Synuefe XR-H d11-102",
  influence: 3,
  credits: 1_000_000,
  against: false,
};

/** Runs a /bgs subcommand as `userId` (admin rights with `admin`), finishing deferred work. */
async function bgs(
  discord,
  guildId,
  userId,
  roles,
  name,
  options = {},
  { admin = false, extraEnv = {}, command, channelId } = {},
) {
  const interaction = {
    type: 2,
    token: `token-${Math.random()}`,
    application_id: BOT_ID,
    guild_id: guildId,
    channel_id: channelId,
    member: { user: { id: userId }, roles, permissions: admin ? "32" : "0" },
    data: {
      name: command ?? "bgs",
      options: [commandOptions(name, options)],
    },
  };
  const answer = await handleInteraction(interaction, {
    env: env(extraEnv),
    api: discord.api,
    botUrl: BOT_URL,
    now: NOW,
    tick: async () => null,
  });
  if (answer.later) {
    await answer.later();
    const content = discord.replies.find((r) => r.token === interaction.token).content;
    // A text, or a card (embeds, menus) as Discord gets it.
    return content;
  }
  return answer.response.data?.content;
}

/** "faction add" → a subcommand group (type 2) holding the subcommand; "link" → a subcommand. */
function commandOptions(name, options) {
  const values = Object.entries(options).map(([n, value]) => ({ name: n, value }));
  const [group, sub] = name.split(" ");
  return sub
    ? { type: 2, name: group, options: [{ type: 1, name: sub, options: values }] }
    : { type: 1, name, options: values };
}

/** Two servers, each set up with its own faction and role, PILOT a member of A only. */
async function twoServers() {
  const discord = fakeDiscord();
  const channelA = discord.addGuild(GUILD_A);
  const channelB = discord.addGuild(GUILD_B);
  discord.setMember(GUILD_A, ADMIN, []);
  discord.setMember(GUILD_A, PILOT, [ROLE_A]);
  discord.setMember(GUILD_B, ADMIN, []);
  await bgs(discord, GUILD_A, ADMIN, [], "setup", { role: ROLE_A, faction: "Faction A" }, { admin: true });
  await bgs(discord, GUILD_B, ADMIN, [], "setup", { role: ROLE_B, faction: "Faction B" }, { admin: true });
  return { discord, channelA, channelB };
}

const keyFrom = (text) => /```\n(edch1\.[^\n]+)\n```/.exec(text)?.[1];

/** /bgs link, and the key it gave (by direct message, or in the answer when DMs are closed). */
async function linkKey(discord, guildId, userId, roles, opts = {}) {
  const before = discord.dms.length;
  const answer = await bgs(discord, guildId, userId, roles, "link", {}, opts);
  return discord.dms.length > before ? keyFrom(discord.dms.at(-1).content) : keyFrom(answer);
}

/** The reading channel (#edch-bgs) of a server. */
const bgsChannel = (discord, guildId) => discord.guild(guildId).channels.find((c) => c.name === "edch-bgs").id;

test("keys: signed claims read back; changed, foreign or broken keys refused", async () => {
  const claims = {
    bot: BOT_URL,
    guildId: GUILD_A,
    channelId: "1500000000000000001",
    userId: PILOT,
    issuedAt: 1_763_000_000,
  };
  const key = await makeKey(claims, SECRET);
  assert.deepEqual(await readKey(key, SECRET), claims);
  assert.equal(await readKey(key, "another secret"), null);
  // Changing the payload (another server) breaks the signature.
  const [prefix, , signature] = key.split(".");
  const forged = await makeKey({ ...claims, guildId: GUILD_B }, "attacker's secret");
  assert.equal(await readKey(`${prefix}.${forged.split(".")[1]}.${signature}`, SECRET), null);
  assert.equal(await readKey("edch1.abc", SECRET), null);
  assert.equal(await readKey("", SECRET), null);
  assert.equal(await readKey(await makeKey({ ...claims, bot: "http://plain" }, SECRET), SECRET), null);
});

test("discord signatures: only Discord's signed interactions are read", async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("hex");
  const body = '{"type":1}';
  const signature = Buffer.from(
    await webcrypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode("1700000000" + body)),
  ).toString("hex");
  assert.equal(await verifyDiscordSignature(publicKey, signature, "1700000000", body), true);
  assert.equal(await verifyDiscordSignature(publicKey, signature, "1700000001", body), false);
  assert.equal(await verifyDiscordSignature(publicKey, signature, "1700000000", '{"type":2}'), false);
  assert.equal(await verifyDiscordSignature(publicKey, null, "1700000000", body), false);
});

test("reports: checked against the server's faction, bounded, malformed refused", () => {
  assert.deepEqual(checkReport(report("faction a", [ACTION]), ["Faction A"]).actions[0].influence, 3);
  assert.equal(checkReport(report("Faction B", [ACTION]), ["Faction A"]).error, "otherFaction");
  assert.equal(checkReport({ ...report("Faction A", []), version: 2 }, ["Faction A"]).error, "unknownVersion");
  assert.equal(checkReport(report("Faction A", [{ ...ACTION, kind: "hack" }]), ["Faction A"]).error, "badFormat");
  assert.equal(checkReport(report("Faction A", [{ ...ACTION, at: "soon" }]), ["Faction A"]).error, "badFormat");
  assert.equal(checkReport(report("Faction A", Array(2001).fill(ACTION)), ["Faction A"]).error, "tooLarge");
  // Out-of-range numbers are dropped, not stored.
  assert.equal(
    checkReport(report("Faction A", [{ ...ACTION, influence: 99 }]), ["Faction A"]).actions[0].influence,
    undefined,
  );
});

test("storage: a big report split into messages under Discord's limit, read back whole", async () => {
  const actions = Array.from({ length: 400 }, (_, i) => ({
    ...ACTION,
    at: new Date(Date.parse(ACTION.at) + i * 1000).toISOString(),
    system: `System ${i % 37}`,
  }));
  const messages = await reportMessages(PILOT, "Faction A", actions);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((m) => m.length <= 2000));
  const back = (await Promise.all(messages.map(messageActions))).flat();
  assert.equal(back.length, 400);
  assert.deepEqual({ ...back[5], userId: undefined }, { ...actions[5], userId: undefined, faction: "Faction A" });
  assert.deepEqual(await messageActions("hello"), []);
});

test("commands: setup for admins, link needs the role, the key works for EDCH", async () => {
  const { discord, channelA } = await twoServers();
  assert.match(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "setup", { role: ROLE_A, faction: "X" }), /Only admins/);
  assert.equal((await readConfig(discord.api, channelA, BOT_ID)).config.factions[0], "Faction A");
  assert.match(await bgs(discord, GUILD_A, OUTSIDER, [], "link"), /You need the/);
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  assert.ok(key);
  const config = await handleApi("GET", "/v1/config", `Bearer ${key}`, null, env(), discord.api);
  assert.deepEqual(config, { status: 200, body: { faction: "Faction A", factions: ["Faction A"] } });
  const sent = await handleApi(
    "POST",
    "/v1/report",
    `Bearer ${key}`,
    JSON.stringify(report("Faction A", [ACTION])),
    env(),
    discord.api,
  );
  assert.deepEqual(sent.body, { accepted: 1, systems: 0 });
  const summary = JSON.stringify(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "summary", { period: "7d" }));
  assert.match(summary, /Synuefe XR-H d11-102/);
  assert.match(summary, /\+3 inf/);
});

test("isolation: a key of server A never reads or writes server B", async () => {
  const { discord, channelA, channelB } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  await handleApi(
    "POST",
    "/v1/report",
    `Bearer ${key}`,
    JSON.stringify(report("Faction A", [ACTION])),
    env(),
    discord.api,
  );
  // Written in A's channel only.
  assert.ok(discord.messages(channelA).some((m) => m.content.includes("edch:r1:")));
  assert.ok(!discord.messages(channelB).some((m) => m.content.includes("edch:r1:")));
  // B's faction can't be reported with A's key (and B's role is never given by it).
  const other = await handleApi(
    "POST",
    "/v1/report",
    `Bearer ${key}`,
    JSON.stringify(report("Faction B", [ACTION])),
    env(),
    discord.api,
  );
  assert.equal(other.body.error, "otherFaction");
  // A key naming A's server with B's channel (signed, as if the bot had made it) is refused.
  const mixed = await makeKey(
    { bot: BOT_URL, guildId: GUILD_A, channelId: channelB, userId: PILOT, issuedAt: NOW / 1000 },
    SECRET,
  );
  assert.equal(
    (await handleApi("GET", "/v1/config", `Bearer ${mixed}`, null, env(), discord.api)).body.error,
    "notSetUp",
  );
  // B's summary shows nothing of A.
  assert.match(
    JSON.stringify(await bgs(discord, GUILD_B, ADMIN, [], "summary", { period: "7d" }, { admin: true })),
    /Nothing reported/,
  );
  // Every channel the bot touched for B's summary is B's.
  const touched = discord.calls.filter(([, id]) => id === channelA || id === GUILD_A).length;
  discord.calls.length = 0;
  await bgs(discord, GUILD_B, ADMIN, [], "summary", { period: "7d" }, { admin: true });
  assert.ok(
    discord.calls.every(([, id]) => id === channelB || id === GUILD_B),
    JSON.stringify(discord.calls),
  );
  assert.ok(touched > 0);
});

test("isolation: messages written by someone else than the bot are never read as reports", async () => {
  const { discord, channelA } = await twoServers();
  const real = await reportMessages(PILOT, "Faction A", [ACTION]);
  discord.postAs(channelA, OUTSIDER, real[0]);
  assert.deepEqual(await readActions(discord.api, channelA, BOT_ID, "2026-11-01T00:00:00Z"), []);
});

test("access: revoked keys, a lost role or a server that left are refused", async () => {
  const { discord } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const call = () => handleApi("GET", "/v1/config", `Bearer ${key}`, null, env(), discord.api);
  discord.setMember(GUILD_A, PILOT, []);
  assert.equal((await call()).body.error, "roleMissing");
  discord.removeMember(GUILD_A, PILOT);
  assert.equal((await call()).body.error, "roleMissing");
  discord.setMember(GUILD_A, PILOT, [ROLE_A]);
  assert.equal((await call()).status, 200);
  assert.match(await bgs(discord, GUILD_A, ADMIN, [], "revoke", { member: PILOT }, { admin: true }), /cancelled/);
  assert.equal((await call()).body.error, "revoked");
  assert.equal((await handleApi("GET", "/v1/config", "Bearer nope", null, env(), discord.api)).status, 401);
  assert.equal((await handleApi("GET", "/v1/config", null, null, env(), discord.api)).status, 401);
});

test("own copy: a squadron's copy answers its server only", async () => {
  const { discord } = await twoServers();
  const own = { extraEnv: { DISCORD_GUILD_ID: GUILD_A } };
  assert.match(await bgs(discord, GUILD_B, ADMIN, [], "summary", {}, { admin: true, ...own }), /another squadron/);
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A], own);
  assert.equal(
    (await handleApi("GET", "/v1/config", `Bearer ${key}`, null, env({ DISCORD_GUILD_ID: GUILD_B }), discord.api)).body
      .error,
    "otherServer",
  );
});

test("summary: by system, busiest first, within Discord's limit", () => {
  const actions = Array.from({ length: 300 }, (_, i) => ({
    ...ACTION,
    userId: PILOT,
    system: `A long system name ${i}`,
    influence: (i % 5) + 1,
  }));
  const text = summaryText("Faction A", "last 7 days", actions);
  assert.ok(text.length <= 2000);
  assert.match(text, /more systems/);
  assert.match(summaryText("Faction A", "last 24 hours", []), /Nothing reported/);
});

test("setup: creates the BGS role, the data channel and the reading channel", async () => {
  const discord = fakeDiscord();
  discord.addGuild(GUILD_A, { withChannel: false });
  discord.setMember(GUILD_A, ADMIN, []);
  const answer = await bgs(discord, GUILD_A, ADMIN, [], "setup", { faction: "Faction A" }, { admin: true });
  assert.match(answer, /Created the role .*data, admins only.*for the role/);
  const guild = discord.guild(GUILD_A);
  const role = guild.roles.find((r) => r.name === "BGS");
  const sync = guild.channels.find((c) => c.name === "edch-sync");
  const reading = guild.channels.find((c) => c.name === "edch-bgs");
  assert.ok(role && sync && reading);
  // Data: hidden from everyone, the bot only (admins see every channel). Reading: the role.
  assert.equal(sync.overwrites.find((o) => o.id === GUILD_A).deny, String(1n << 10n));
  assert.ok(!sync.overwrites.some((o) => o.id === role.id));
  assert.ok(reading.overwrites.some((o) => o.id === role.id && o.type === 0));
  assert.ok(reading.overwrites.some((o) => o.id === BOT_ID && o.type === 1));
  const { config } = await readConfig(discord.api, sync.id, BOT_ID);
  assert.equal(config.roleId, role.id);
  assert.equal(config.bgsChannelId, reading.id);
  // Again: nothing new is created, the settings are updated.
  const again = await bgs(discord, GUILD_A, ADMIN, [], "setup", { faction: "Faction B" }, { admin: true });
  assert.doesNotMatch(again, /Created/);
  assert.equal(guild.roles.length, 1);
  assert.equal(guild.channels.length, 2);
  // A faction given again is added; the first one stays the default.
  assert.deepEqual((await readConfig(discord.api, sync.id, BOT_ID)).config.factions, ["Faction A", "Faction B"]);
});

test("admin commands: setup and revoke refused to members without the rights", async () => {
  const { discord } = await twoServers();
  assert.match(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "setup", { faction: "X" }), /Only admins/);
  assert.match(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "revoke", { member: ADMIN }), /Only admins/);
  assert.match(await bgs(discord, GUILD_A, ADMIN, [], "other", {}, { admin: true, command: "bgs-admin" }), /Unknown/);
});

test("link: by direct message, in the chosen channel only, in the answer when DMs are closed", async () => {
  const { discord } = await twoServers();
  const linkChannel = "1600000000000000001";
  await bgs(
    discord,
    GUILD_A,
    ADMIN,
    [],
    "setup",
    { role: ROLE_A, faction: "Faction A", link_channel: linkChannel },
    { admin: true },
  );
  assert.match(
    await bgs(discord, GUILD_A, PILOT, [ROLE_A], "link", {}, { channelId: "1600000000000000009" }),
    /works in/,
  );
  assert.match(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "link", {}, { channelId: linkChannel }), /direct messages/);
  assert.ok(keyFrom(discord.dms.at(-1).content));
  discord.closedDms.add(PILOT);
  const answer = await bgs(discord, GUILD_A, PILOT, [ROLE_A], "link", {}, { channelId: linkChannel });
  assert.ok(keyFrom(answer));
});

test("setup: without Manage Roles or Manage Channels, says what to do", async () => {
  const discord = fakeDiscord();
  discord.addGuild(GUILD_A, { withChannel: false, readOnly: true });
  const answer = await bgs(discord, GUILD_A, ADMIN, [], "setup", { faction: "Faction A" }, { admin: true });
  assert.match(answer, /Manage Roles/);
});

test("answers: written with the application id Discord sends", async () => {
  const { discord } = await twoServers();
  await bgs(discord, GUILD_A, PILOT, [ROLE_A], "link", {}, { extraEnv: { DISCORD_APPLICATION_ID: "" } });
  assert.equal(discord.replies.at(-1).appId, BOT_ID);
});

test("threads: one per system, a line per report, reopened after being archived", async () => {
  const { discord, channelA } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const send = (actions) =>
    handleApi("POST", "/v1/report", `Bearer ${key}`, JSON.stringify(report("Faction A", actions)), env(), discord.api);
  await send([
    ACTION,
    { ...ACTION, kind: "trade", influence: undefined, credits: 12_000_000 },
    { ...ACTION, system: "HIP 21991" },
  ]);
  let threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.deepEqual(Object.keys(threads).sort(), ["HIP 21991", "Synuefe XR-H d11-102"]);
  const line = threads["Synuefe XR-H d11-102"].messages[0].content;
  assert.match(line, new RegExp(`<@${PILOT}> · 1 mission \\(\\+3 inf\\.\\) · trade 12\\.0M`));
  assert.equal(threads["HIP 21991"].autoArchiveMinutes, 4320);
  // Archived (3 days quiet), then a new report: the same thread, open again.
  discord.archive(threads["HIP 21991"].id);
  await send([{ ...ACTION, system: "HIP 21991", at: "2026-11-13T19:30:00Z" }]);
  threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.equal(Object.keys(threads).length, 2);
  assert.equal(threads["HIP 21991"].messages.length, 2);
  assert.equal(threads["HIP 21991"].archived, false);
});

test("daily recap: once per tick, in the channel, for the past BGS day", async () => {
  const { discord, channelA } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const send = (actions, tick) =>
    handleApi(
      "POST",
      "/v1/report",
      `Bearer ${key}`,
      JSON.stringify(report("Faction A", actions)),
      env(),
      discord.api,
      async () => tick,
    );
  const recaps = () => discord.messages(bgsChannel(discord, GUILD_A)).filter((m) => m.content.startsWith("📊"));
  // First report: the tick is only noted.
  await send([{ ...ACTION, at: "2026-11-13T19:00:00Z" }], "2026-11-12T15:00:00.000Z");
  assert.equal(recaps().length, 0);
  // A new tick: the recap of the day before it, once.
  await send([{ ...ACTION, at: "2026-11-13T19:40:00Z", system: "Late" }], "2026-11-13T19:30:00.000Z");
  await send([{ ...ACTION, at: "2026-11-13T19:45:00Z", system: "Later" }], "2026-11-13T19:30:00.000Z");
  assert.equal(recaps().length, 1);
  const card = JSON.stringify(recaps()[0].embeds);
  assert.match(card, /Synuefe XR-H d11-102/);
  assert.match(card, /Faction A/);
  assert.doesNotMatch(card, /Late/);
});

test("factions: admins add, set the default and remove; members only list", async () => {
  const { discord, channelA } = await twoServers();
  const factions = async () => (await readConfig(discord.api, channelA, BOT_ID)).config.factions;
  // Members can't change them.
  assert.match(await bgs(discord, GUILD_A, PILOT, [ROLE_A], "faction add", { name: "Ally" }), /Only admins/);
  const added = await bgs(
    discord,
    GUILD_A,
    ADMIN,
    [],
    "faction add",
    { name: "Amicale des Compagnons de l'Espace" },
    { admin: true },
  );
  assert.match(JSON.stringify(added.embeds), /Amicale/);
  assert.deepEqual(await factions(), ["Faction A", "Amicale des Compagnons de l'Espace"]);
  assert.match(
    await bgs(discord, GUILD_A, ADMIN, [], "faction add", { name: "faction a" }, { admin: true }),
    /already/,
  );
  await bgs(
    discord,
    GUILD_A,
    ADMIN,
    [],
    "faction default",
    { name: "amicale des compagnons de l'espace" },
    { admin: true },
  );
  assert.deepEqual(await factions(), ["Amicale des Compagnons de l'Espace", "Faction A"]);
  // The list: a card for members, with menus for admins only.
  const seen = await bgs(discord, GUILD_A, PILOT, [ROLE_A], "faction list", {});
  assert.match(seen.embeds[0].description, /⭐ \*\*Amicale/);
  assert.equal(seen.components.length, 0);
  const adminList = await bgs(discord, GUILD_A, ADMIN, [], "faction list", {}, { admin: true });
  assert.equal(adminList.components.length, 2);
  assert.match(await bgs(discord, GUILD_A, OUTSIDER, [], "faction list", {}), /need the/);
  await bgs(discord, GUILD_A, ADMIN, [], "faction remove", { name: "Faction A" }, { admin: true });
  assert.deepEqual(await factions(), ["Amicale des Compagnons de l'Espace"]);
  assert.match(
    await bgs(discord, GUILD_A, ADMIN, [], "faction remove", { name: "Nope" }, { admin: true }),
    /isn't followed/,
  );
  // Server B is untouched.
  const channelB = discord.guild(GUILD_B).channels.find((c) => c.name === "edch-sync").id;
  assert.deepEqual((await readConfig(discord.api, channelB, BOT_ID)).config.factions, ["Faction B"]);
});

test("factions: reports for each followed faction, kept apart in the summary", async () => {
  const { discord } = await twoServers();
  await bgs(discord, GUILD_A, ADMIN, [], "faction add", { name: "Ally" }, { admin: true });
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const config = await handleApi("GET", "/v1/config", `Bearer ${key}`, null, env(), discord.api);
  assert.deepEqual(config.body.factions, ["Faction A", "Ally"]);
  const send = (faction, system) =>
    handleApi(
      "POST",
      "/v1/report",
      `Bearer ${key}`,
      JSON.stringify(report(faction, [{ ...ACTION, system }])),
      env(),
      discord.api,
    );
  assert.equal((await send("ally", "Ally Home")).status, 200);
  assert.equal((await send("Faction A", "Main Home")).status, 200);
  assert.equal((await send("Faction B", "Elsewhere")).body.error, "otherFaction");
  const all = await bgs(discord, GUILD_A, PILOT, [ROLE_A], "summary", { period: "7d" });
  assert.deepEqual(
    all.embeds.map((e) => e.title),
    ["Faction A", "Ally"],
  );
  assert.match(all.embeds[1].description, /Ally Home/);
  assert.doesNotMatch(all.embeds[1].description, /Main Home/);
  const one = await bgs(discord, GUILD_A, PILOT, [ROLE_A], "summary", { period: "7d", faction: "Ally" });
  assert.deepEqual(
    one.embeds.map((e) => e.title),
    ["Ally"],
  );
  // With several factions, the thread line names it.
  const threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.match(threads["Ally Home"].messages[0].content, /\*\*Ally\*\*/);
});

test("factions: the list's menus (admins), and names offered as you type", async () => {
  const { discord, channelA } = await twoServers();
  await bgs(discord, GUILD_A, ADMIN, [], "faction add", { name: "Ally" }, { admin: true });
  const ctx = { env: env(), api: discord.api, botUrl: BOT_URL, now: NOW, tick: async () => null };
  const base = (userId, admin) => ({
    token: `menu-${userId}-${admin}`,
    application_id: BOT_ID,
    guild_id: GUILD_A,
    member: { user: { id: userId }, roles: [ROLE_A], permissions: admin ? "8" : "0" },
  });
  const menu = (userId, admin, customId, value) =>
    handleInteraction({ ...base(userId, admin), type: 3, data: { custom_id: customId, values: [value] } }, ctx);
  const refused = await menu(PILOT, false, "bgs:faction:remove", "Ally");
  assert.match(refused.response.data.content, /Only admins/);
  const chosen = await menu(ADMIN, true, "bgs:faction:default", "Ally");
  assert.equal(chosen.response.type, 6);
  await chosen.later();
  assert.deepEqual((await readConfig(discord.api, channelA, BOT_ID)).config.factions, ["Ally", "Faction A"]);
  // Autocomplete: the server's own factions only.
  const typed = await handleInteraction(
    {
      ...base(PILOT, false),
      type: 4,
      data: {
        name: "bgs",
        options: [
          {
            type: 2,
            name: "faction",
            options: [{ type: 1, name: "remove", options: [{ name: "name", value: "al", focused: true }] }],
          },
        ],
      },
    },
    ctx,
  );
  assert.deepEqual(typed.response, { type: 8, data: { choices: [{ name: "Ally", value: "Ally" }] } });
  // Adding: what was typed first, then the game's factions (admins only: members get no search).
  const searched = [];
  const searchCtx = {
    ...ctx,
    searchFactions: async (t) => (searched.push(t), ["Amicale des Compagnons de l'Espace", "Amicale"]),
  };
  const adding = (admin) =>
    handleInteraction(
      {
        ...base(admin ? ADMIN : PILOT, admin),
        type: 4,
        data: {
          name: "bgs",
          options: [
            {
              type: 2,
              name: "faction",
              options: [{ type: 1, name: "add", options: [{ name: "name", value: "Amicale", focused: true }] }],
            },
          ],
        },
      },
      searchCtx,
    );
  assert.deepEqual(
    (await adding(true)).response.data.choices.map((c) => c.value),
    ["Amicale", "Amicale des Compagnons de l'Espace"],
  );
  assert.deepEqual(
    (await adding(false)).response.data.choices.map((c) => c.value),
    ["Amicale"],
  );
  assert.deepEqual(searched, ["Amicale"]);
});

test("setup without a faction: channels and role first, factions added after", async () => {
  const discord = fakeDiscord();
  discord.addGuild(GUILD_A, { withChannel: false });
  const answer = await bgs(discord, GUILD_A, ADMIN, [], "setup", {}, { admin: true });
  assert.match(answer, /faction add/);
  const sync = discord.guild(GUILD_A).channels.find((c) => c.name === "edch-sync");
  assert.deepEqual((await readConfig(discord.api, sync.id, BOT_ID)).config.factions, []);
});

const seen = (system, influence, at, extra = {}) => ({
  at,
  system,
  controlling: "Faction A",
  factions: [
    { name: "Faction A", influence, state: "Boom", active: ["Boom"], pending: [], recovering: [] },
    { name: "Rival", influence: 100 - influence, state: "None", active: [], pending: [], recovering: [] },
  ],
  conflicts: [],
  ...extra,
});

test("systems seen: shared with the server's members, a thread line only when it changed", async () => {
  const { discord, channelA } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const now = () => Date.parse("2026-11-13T20:00:00Z");
  const send = (systems, faction = "Faction A") =>
    handleApi(
      "POST",
      "/v1/report",
      `Bearer ${key}`,
      JSON.stringify({ ...report(faction, []), systems }),
      env(),
      discord.api,
      async () => null,
      now,
    );
  const elsewhere = {
    ...seen("Nowhere", 50, "2026-11-13T18:00:00Z"),
    factions: [{ name: "Strangers", influence: 100, state: "None", active: [], pending: [], recovering: [] }],
  };
  const first = await send([seen("Home", 40, "2026-11-13T18:00:00Z"), elsewhere]);
  // Systems without a followed faction are dropped.
  assert.deepEqual(first.body, { accepted: 0, systems: 1 });
  let threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.deepEqual(Object.keys(threads), ["Home"]);
  assert.match(threads.Home.messages[0].content, /Faction A\*\* 40\.0 % \(Boom\) · closest Rival 60\.0 %/);
  // The same again (a later visit, nothing changed): no line, the thread can archive.
  await send([seen("Home", 40, "2026-11-13T19:00:00Z")]);
  threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.equal(threads.Home.messages.length, 1);
  // Influence moved: a new line.
  await send([seen("Home", 42.5, "2026-11-13T19:30:00Z")]);
  threads = discord.threads(bgsChannel(discord, GUILD_A));
  assert.equal(threads.Home.messages.length, 2);
  // Every member's EDCH gets the newest of each system, without who sent it.
  const shared = await handleApi("GET", "/v1/systems", `Bearer ${key}`, null, env(), discord.api, undefined, now);
  assert.equal(shared.status, 200);
  assert.equal(shared.body.systems.length, 1);
  assert.equal(shared.body.systems[0].at, "2026-11-13T19:30:00.000Z");
  assert.equal(shared.body.systems[0].factions[0].influence, 42.5);
  assert.equal(shared.body.systems[0].userId, undefined);
  // Malformed systems refuse the report; nothing of it is stored.
  const before = discord.messages(channelA).length;
  assert.equal((await send([{ ...seen("Bad", 30, "2026-11-13T19:40:00Z"), factions: "x" }])).body.error, "badFormat");
  assert.equal((await send([seen("Bad", 300, "2026-11-13T19:40:00Z")])).body.error, "badFormat");
  assert.equal(discord.messages(channelA).length, before);
});

test("systems seen: server B never gets A's systems", async () => {
  const { discord } = await twoServers();
  const keyA = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  discord.setMember(GUILD_B, OUTSIDER, [ROLE_B]);
  const keyB = await linkKey(discord, GUILD_B, OUTSIDER, [ROLE_B]);
  const now = () => Date.parse("2026-11-13T20:00:00Z");
  const both = {
    ...seen("Shared", 40, "2026-11-13T18:00:00Z"),
    factions: [
      { name: "Faction A", influence: 40, state: "None", active: [], pending: [], recovering: [] },
      { name: "Faction B", influence: 60, state: "None", active: [], pending: [], recovering: [] },
    ],
  };
  await handleApi(
    "POST",
    "/v1/report",
    `Bearer ${keyA}`,
    JSON.stringify({ ...report("Faction A", []), systems: [both] }),
    env(),
    discord.api,
    undefined,
    now,
  );
  const forB = await handleApi("GET", "/v1/systems", `Bearer ${keyB}`, null, env(), discord.api, undefined, now);
  assert.deepEqual(forB.body.systems, []);
});

test("#edch-bgs is read-only for the role, also after setting up again; the key tells to mute it", async () => {
  const discord = fakeDiscord();
  discord.addGuild(GUILD_A, { withChannel: false });
  discord.setMember(GUILD_A, PILOT, []);
  await bgs(discord, GUILD_A, ADMIN, [], "setup", { faction: "Faction A" }, { admin: true });
  const guild = discord.guild(GUILD_A);
  const role = guild.roles[0];
  const reading = () => guild.channels.find((c) => c.name === "edch-bgs");
  const write = (1n << 11n) | (1n << 38n) | (1n << 35n);
  const roleRule = () => reading().overwrites.find((o) => o.id === role.id);
  assert.equal(BigInt(roleRule().deny) & write, write);
  assert.ok(BigInt(roleRule().allow) & (1n << 10n));
  // An older channel where the role could write: setting up again closes it, other rules stay.
  reading().overwrites = [
    ...reading().overwrites.filter((o) => o.id !== role.id),
    { id: role.id, type: 0, allow: String(1n << 10n), deny: "0" },
    { id: "1999999999999999999", type: 0, allow: "0", deny: "0" },
  ];
  await bgs(discord, GUILD_A, ADMIN, [], "setup", {}, { admin: true });
  assert.equal(BigInt(roleRule().deny) & write, write);
  assert.ok(reading().overwrites.some((o) => o.id === "1999999999999999999"));
  discord.setMember(GUILD_A, PILOT, [role.id]);
  await bgs(discord, GUILD_A, PILOT, [role.id], "link", {});
  assert.match(discord.dms.at(-1).content, new RegExp(`Mute <#${reading().id}>`));
});

test("adding a faction offers those the members saw in their systems, even without EliteBGS", async () => {
  const { discord } = await twoServers();
  const key = await linkKey(discord, GUILD_A, PILOT, [ROLE_A]);
  const now = () => NOW;
  const ally = {
    ...seen("Home", 40, "2026-11-13T18:00:00Z"),
    factions: [
      { name: "Faction A", influence: 40, state: "None", active: [], pending: [], recovering: [] },
      {
        name: "Amicale des Compagnons de l'Espace",
        influence: 35,
        state: "None",
        active: [],
        pending: [],
        recovering: [],
      },
      { name: "Bad Neighbours", influence: 25, state: "None", active: [], pending: [], recovering: [] },
    ],
  };
  await handleApi(
    "POST",
    "/v1/report",
    `Bearer ${key}`,
    JSON.stringify({ ...report("Faction A", []), systems: [ally] }),
    env(),
    discord.api,
    undefined,
    now,
  );
  const typing = (value) =>
    handleInteraction(
      {
        type: 4,
        token: "typing",
        application_id: BOT_ID,
        guild_id: GUILD_A,
        member: { user: { id: ADMIN }, roles: [], permissions: "8" },
        data: {
          name: "bgs",
          options: [
            {
              type: 2,
              name: "faction",
              options: [{ type: 1, name: "add", options: [{ name: "name", value, focused: true }] }],
            },
          ],
        },
      },
      // EliteBGS down: it answers nothing.
      {
        env: env(),
        api: discord.api,
        botUrl: BOT_URL,
        now: NOW,
        tick: async () => null,
        searchFactions: async () => [],
      },
    );
  const offered = (await typing("ami")).response.data.choices.map((c) => c.value);
  assert.deepEqual(offered, ["ami", "Amicale des Compagnons de l'Espace"]);
  // Already followed: not offered again.
  const all = (await typing("")).response.data.choices.map((c) => c.value);
  assert.deepEqual(all, ["Amicale des Compagnons de l'Espace", "Bad Neighbours"]);
});

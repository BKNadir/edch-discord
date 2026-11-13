// What EDCH calls, with the member's key (Authorization: Bearer <key>):
//   GET  /v1/config   the factions the server follows, the default first (EDCH sends a report
//                     for each)
//   GET  /v1/systems  the newest snapshot of each system the members saw over the last days
//                     (systems.ts), so each member's EDCH uses the freshest one
//   POST /v1/report   a report (docs/BGS_SYNC.md in EDCH): written to the server's #edch-bgs, with
//                     a line in each system's thread and, after a tick, the day's recap
// Before anything is read or written: the key's signature, this copy's server (when it has one),
// that the channel belongs to the key's server, that the key wasn't cancelled, and that the member
// still has the role. Errors are short codes EDCH translates.

import { readKey, type KeyClaims } from "./key.js";
import { checkReport, MAX_REPORT_BYTES } from "./report.js";
import { readConfig, readData, reportMessages } from "./storage.js";
import { checkSnapshots, latestBySystem, snapshotMessages, withoutSender } from "./systems.js";
import { postRecapIfNewTick, writeSnapshotLines, writeThreadLines } from "./threads.js";

/** Systems seen this long ago at most are shared (GET /v1/systems) and compared with. */
export const SNAPSHOT_DAYS = 7;
const DAY = 86_400_000;
import type { DiscordApi, Env, GuildConfig } from "./types.js";

export type ApiError =
  | "badKey"
  | "otherServer"
  | "notSetUp"
  | "revoked"
  | "roleMissing"
  | "badFormat"
  | "unknownVersion"
  | "otherFaction"
  | "tooLarge"
  | "notFound";

export interface ApiAnswer {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: ApiError): ApiAnswer => ({ status, body: { error } });

/** The key's member and server settings, once every check passed; or the refusal. */
async function authorise(
  authorization: string | null,
  env: Env,
  api: DiscordApi,
): Promise<{ claims: KeyClaims; config: GuildConfig; configMessageId: string } | ApiAnswer> {
  const key = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = key ? await readKey(key, env.LINK_SECRET) : null;
  if (!claims) return fail(401, "badKey");
  if (env.DISCORD_GUILD_ID && claims.guildId !== env.DISCORD_GUILD_ID) return fail(403, "otherServer");
  // The key is signed, so this can't differ; checked anyway, a server's channel is its own.
  if ((await api.channelGuild(claims.channelId)) !== claims.guildId) return fail(404, "notSetUp");
  const found = await readConfig(api, claims.channelId, env.DISCORD_APPLICATION_ID);
  if (!found) return fail(404, "notSetUp");
  const revokedAt = found.config.revoked[claims.userId];
  if (revokedAt !== undefined && claims.issuedAt <= revokedAt) return fail(403, "revoked");
  const roles = await api.memberRoles(claims.guildId, claims.userId);
  if (!roles?.includes(found.config.roleId)) return fail(403, "roleMissing");
  return { claims, config: found.config, configMessageId: found.messageId };
}

/** Answers one EDCH call. */
export async function handleApi(
  method: string,
  path: string,
  authorization: string | null,
  body: string | null,
  env: Env,
  api: DiscordApi,
  tick: () => Promise<string | null> = async () => null,
  now: () => number = Date.now,
): Promise<ApiAnswer> {
  const isConfig = method === "GET" && path === "/v1/config";
  const isReport = method === "POST" && path === "/v1/report";
  const isSystems = method === "GET" && path === "/v1/systems";
  if (!isConfig && !isReport && !isSystems) return fail(404, "notFound");
  if (isReport && (body ?? "").length > MAX_REPORT_BYTES) return fail(413, "tooLarge");

  const auth = await authorise(authorization, env, api);
  if ("status" in auth) return auth;
  if (isConfig)
    return { status: 200, body: { faction: auth.config.factions[0] ?? null, factions: auth.config.factions } };
  const since = new Date(now() - SNAPSHOT_DAYS * DAY).toISOString();
  if (isSystems) {
    const { snapshots } = await readData(api, auth.claims.channelId, env.DISCORD_APPLICATION_ID, since);
    return { status: 200, body: { systems: latestBySystem(snapshots).map(withoutSender) } };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body ?? "");
  } catch {
    return fail(400, "badFormat");
  }
  const checked = checkReport(raw, auth.config.factions);
  if ("error" in checked) return fail(checked.error === "otherFaction" ? 409 : 400, checked.error);
  const snapshots = checkSnapshots((raw as Record<string, unknown>).systems, auth.config.factions);
  if (!snapshots) return fail(400, "badFormat");
  const { claims } = auth;
  // What the server knew before this report, to tell which systems changed.
  const previous = snapshots.length
    ? latestBySystem((await readData(api, claims.channelId, env.DISCORD_APPLICATION_ID, since)).snapshots)
    : [];
  for (const content of await reportMessages(claims.userId, checked.faction, checked.actions))
    await api.sendMessage(claims.channelId, content);
  for (const content of await snapshotMessages(claims.userId, snapshots))
    await api.sendMessage(claims.channelId, content);
  // The readable side (threads, daily recap): the report is stored already, so a failure here
  // (a right missing, Discord busy) is logged and doesn't refuse it.
  const stored = checked.actions.map((a) => ({ ...a, userId: claims.userId, faction: checked.faction }));
  try {
    // Threads and recap go to the reading channel (the data channel for an older set-up).
    const readChannel = auth.config.bgsChannelId ?? claims.channelId;
    await postRecapIfNewTick(
      api,
      claims.channelId,
      readChannel,
      env.DISCORD_APPLICATION_ID,
      auth.config,
      auth.configMessageId,
      await tick(),
    );
    // The faction is named in the line when the server follows several.
    const label = auth.config.factions.length > 1 ? checked.faction : undefined;
    await writeThreadLines(api, claims.guildId, readChannel, claims.userId, stored, label);
    await writeSnapshotLines(
      api,
      claims.guildId,
      readChannel,
      claims.userId,
      snapshots,
      auth.config.factions,
      previous,
    );
  } catch (error) {
    console.error(`threads: ${(error as Error)?.message ?? error}`);
  }
  return { status: 200, body: { accepted: checked.actions.length, systems: snapshots.length } };
}

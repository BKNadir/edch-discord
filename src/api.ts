// What EDCH calls, with the member's key (Authorization: Bearer <key>):
//   GET  /v1/config   the faction the squadron follows (EDCH shows it next to the key)
//   POST /v1/report   a report (docs/BGS_SYNC.md in EDCH): written to the server's #edch-bgs
// Before anything is read or written: the key's signature, this copy's server (when it has one),
// that the channel belongs to the key's server, that the key wasn't cancelled, and that the member
// still has the role. Errors are short codes EDCH translates.

import { readKey, type KeyClaims } from "./key.js";
import { checkReport, MAX_REPORT_BYTES } from "./report.js";
import { readConfig, reportMessages } from "./storage.js";
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
): Promise<{ claims: KeyClaims; config: GuildConfig } | ApiAnswer> {
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
  return { claims, config: found.config };
}

/** Answers one EDCH call. */
export async function handleApi(
  method: string,
  path: string,
  authorization: string | null,
  body: string | null,
  env: Env,
  api: DiscordApi,
): Promise<ApiAnswer> {
  const isConfig = method === "GET" && path === "/v1/config";
  const isReport = method === "POST" && path === "/v1/report";
  if (!isConfig && !isReport) return fail(404, "notFound");
  if (isReport && (body ?? "").length > MAX_REPORT_BYTES) return fail(413, "tooLarge");

  const auth = await authorise(authorization, env, api);
  if ("status" in auth) return auth;
  if (isConfig) return { status: 200, body: { faction: auth.config.faction } };

  let raw: unknown;
  try {
    raw = JSON.parse(body ?? "");
  } catch {
    return fail(400, "badFormat");
  }
  const checked = checkReport(raw, auth.config.faction);
  if ("error" in checked) return fail(checked.error === "otherFaction" ? 409 : 400, checked.error);
  for (const content of await reportMessages(auth.claims.userId, checked.actions))
    await api.sendMessage(auth.claims.channelId, content);
  return { status: 200, body: { accepted: checked.actions.length } };
}

// The key /bgs link gives a member for their EDCH: who they are, on which server and channel,
// when it was made, and which bot to send to, signed by the bot (HMAC, LINK_SECRET). The bot
// keeps no list of keys: it checks the signature, then that the member still has the role and
// that the key wasn't cancelled by /bgs revoke. A key can't be changed to name another server:
// the signature would no longer match.
//
// The text EDCH gets: "edch1.<payload>.<signature>", the payload being URL-safe base64 of
// {"b": bot URL, "g": server id, "c": channel id, "u": member id, "t": Unix seconds}.

import { base64Url, fromBase64Url, sign, verifySignature } from "./crypto.js";

export const KEY_PREFIX = "edch1";

export interface KeyClaims {
  /** The bot's address (https://…): where EDCH sends the reports. */
  bot: string;
  guildId: string;
  channelId: string;
  userId: string;
  /** When the key was made (Unix seconds). */
  issuedAt: number;
}

const SNOWFLAKE = /^\d{17,20}$/;

export async function makeKey(claims: KeyClaims, secret: string): Promise<string> {
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ b: claims.bot, g: claims.guildId, c: claims.channelId, u: claims.userId, t: claims.issuedAt }),
    ),
  );
  return `${KEY_PREFIX}.${payload}.${await sign(secret, `${KEY_PREFIX}.${payload}`)}`;
}

/** The key's claims when it is well formed and signed by this bot; null otherwise. */
export async function readKey(key: string, secret: string): Promise<KeyClaims | null> {
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || parts[1].length > 1000) return null;
  if (!(await verifySignature(secret, `${parts[0]}.${parts[1]}`, parts[2]))) return null;
  const bytes = fromBase64Url(parts[1]);
  if (!bytes) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const claims: KeyClaims = { bot: raw.b, guildId: raw.g, channelId: raw.c, userId: raw.u, issuedAt: raw.t };
    const valid =
      typeof claims.bot === "string" &&
      claims.bot.startsWith("https://") &&
      [claims.guildId, claims.channelId, claims.userId].every((id) => typeof id === "string" && SNOWFLAKE.test(id)) &&
      Number.isInteger(claims.issuedAt);
    return valid ? claims : null;
  } catch {
    return null;
  }
}

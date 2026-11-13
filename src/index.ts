// EDCH-Discord, a Cloudflare Worker: Discord's interactions (POST /interactions, signed by
// Discord) and EDCH's calls (/v1/…, with a member's key). It keeps nothing itself: every server's
// data lives in that server's #edch-bgs channel (storage.ts).

import { handleApi } from "./api.js";
import { handleInteraction, TICK_URL } from "./commands.js";
import { verifyDiscordSignature } from "./crypto.js";
import { discordRest } from "./discordRest.js";
import type { Env } from "./types.js";

/** Discord's interactions are small; anything bigger isn't one. */
const MAX_INTERACTION_BYTES = 64 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The last BGS tick from EDCD's tick detector, or null. */
async function lastTick(): Promise<string | null> {
  try {
    const response = await fetch(TICK_URL);
    const value = await response.json();
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const api = discordRest(env.DISCORD_BOT_TOKEN);

    if (url.pathname === "/interactions" && request.method === "POST") {
      const body = await request.text();
      if (body.length > MAX_INTERACTION_BYTES) return new Response("Too large", { status: 413 });
      const signed = await verifyDiscordSignature(
        env.DISCORD_PUBLIC_KEY,
        request.headers.get("X-Signature-Ed25519"),
        request.headers.get("X-Signature-Timestamp"),
        body,
      );
      if (!signed) return new Response("Bad signature", { status: 401 });
      const answer = await handleInteraction(JSON.parse(body), {
        env,
        api,
        botUrl: url.origin,
        now: Date.now(),
        tick: lastTick,
      });
      if (answer.later) ctx.waitUntil(answer.later());
      return json(200, answer.response);
    }

    if (url.pathname.startsWith("/v1/")) {
      const body = request.method === "POST" ? await request.text() : null;
      try {
        const answer = await handleApi(
          request.method,
          url.pathname,
          request.headers.get("Authorization"),
          body,
          env,
          api,
        );
        return json(answer.status, answer.body);
      } catch {
        // Discord unreachable or refusing: EDCH keeps the report and tries again later.
        return json(503, { error: "discordUnavailable" });
      }
    }

    if (url.pathname === "/" && request.method === "GET")
      return new Response("EDCH-Discord: the BGS bot of EDCH. See https://github.com/BKNadir/edch.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    return new Response("Not found", { status: 404 });
  },
};

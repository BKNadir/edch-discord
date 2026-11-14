// The bot's requests, wherever it runs (a Cloudflare Worker, index.ts, or Node on a machine,
// scripts/server.mjs): Discord's interactions (POST /interactions, signed by Discord) and EDCH's
// calls (/v1/…, with a member's key). It keeps nothing itself: every server's data lives in that
// server's own channels (storage.ts).

import { handleApi } from "./api.js";
import { handleInteraction, TICK_URL } from "./commands.js";
import { factionList, type FactionList, searchFactionList } from "./factionList.js";
import { verifyDiscordSignature } from "./crypto.js";
import { discordRest } from "./discordRest.js";
import { syncCommands } from "./syncCommands.js";
import type { Env } from "./types.js";

/** Discord's interactions are small; anything bigger isn't one. */
const MAX_INTERACTION_BYTES = 64 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Work that may go on after the answer (the Worker's ExecutionContext, or Node's own). */
export interface Background {
  waitUntil(work: Promise<unknown>): void;
}

/** Answers one request. */
export type Handler = (request: Request, env: Env, background: Background) => Promise<Response>;

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

/**
 * The bot's request handler. `factionsText`: the game's faction list (one name per line), read
 * at the first search; `publicOrigin`: the bot's address as Discord and EDCH reach it, when the
 * request's own differs (behind a reverse proxy).
 */
export function createHandler(factionsText: () => string, publicOrigin?: string): Handler {
  /** The game's factions, read once (the first search). */
  let factions: FactionList | null = null;
  const searchGameFactions = async (typed: string) =>
    searchFactionList((factions ??= factionList(factionsText())), typed);
  /** Whether /bgs was checked with Discord (once; again after a failure). */
  let commandsChecked = false;

  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const origin = publicOrigin ?? url.origin;
    const api = discordRest(env.DISCORD_BOT_TOKEN);
    if (!commandsChecked && env.DISCORD_APPLICATION_ID) {
      commandsChecked = true;
      // In the background: the answer doesn't wait for it.
      ctx.waitUntil(
        syncCommands(api, env.DISCORD_APPLICATION_ID)
          .then((sent) => sent && console.log("/bgs declared again"))
          .catch((error) => {
            commandsChecked = false;
            console.error(`commands: ${(error as Error)?.message ?? error}`);
          }),
      );
    }

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
        botUrl: origin,
        now: Date.now(),
        tick: lastTick,
        searchFactions: searchGameFactions,
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
          lastTick,
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
  };
}

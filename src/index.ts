// EDCH-Discord as a Cloudflare Worker (wrangler deploy): the handler (handler.ts) with the game's
// faction list bundled as text. On a machine of its own, scripts/server.mjs runs the same handler.

import { createHandler } from "./handler.js";
// Built by scripts/build-factions.mjs (npm run update); bundled as text.
import FACTIONS_TEXT from "./generated/factions.txt";
import type { Env } from "./types.js";

const handle = createHandler(() => FACTIONS_TEXT);

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => handle(request, env, ctx),
};

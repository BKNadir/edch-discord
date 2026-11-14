// The bot keeps its /bgs command up to date by itself: when a Worker instance answers its first
// request, it compares what Discord has with COMMANDS and sends them again only when they differ.
// It uses the bot's own token (a Worker secret), so updating the bot needs no token typed.

import { COMMANDS } from "./commandDefinitions.js";
import type { DiscordApi } from "./types.js";

/**
 * Whether Discord's version holds everything ours says (Discord adds its own fields, ids and
 * versions, which don't matter).
 */
export function covers(ours: unknown, theirs: unknown): boolean {
  if (Array.isArray(ours))
    return Array.isArray(theirs) && ours.length === theirs.length && ours.every((o, i) => covers(o, theirs[i]));
  if (ours && typeof ours === "object") {
    if (!theirs || typeof theirs !== "object") return false;
    return Object.entries(ours).every(([key, value]) => covers(value, (theirs as Record<string, unknown>)[key]));
  }
  return ours === theirs;
}

/** Sends the commands when Discord's differ; true when they were sent. */
export async function syncCommands(api: DiscordApi, applicationId: string): Promise<boolean> {
  const current = await api.applicationCommands(applicationId);
  const byName = new Map(current.map((c) => [String(c.name), c]));
  const same = current.length === COMMANDS.length && COMMANDS.every((c) => covers(c, byName.get(String(c.name))));
  if (same) return false;
  await api.setApplicationCommands(applicationId, COMMANDS);
  return true;
}

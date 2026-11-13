// Reading a report sent by EDCH ("edch.bgs.report" version 1, docs/BGS_SYNC.md in EDCH):
// everything is checked and bounded before it is written to the channel; a report for another
// faction than those the server follows, or in an unknown format, is refused as a whole.

import { ACTION_KINDS, type ActionKind, type ReportAction } from "./types.js";

export const REPORT_SCHEMA = "edch.bgs.report";
export const REPORT_VERSION = 1;
/** A report covers at most a few days of one commander: far under these. */
export const MAX_REPORT_BYTES = 512 * 1024;
export const MAX_ACTIONS = 2000;

const KINDS: ReadonlySet<string> = new Set(ACTION_KINDS);

/** Why a report was refused (sent back to EDCH as `error`). */
export type ReportError = "badFormat" | "unknownVersion" | "otherFaction" | "tooLarge";

const isDate = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
const whole = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

/** Elite Dangerous faction names compare without case. */
export const sameFaction = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Checks a report against the server's factions: its faction and actions, or why it's refused. */
export function checkReport(
  raw: unknown,
  factions: string[],
): { faction: string; actions: ReportAction[] } | { error: ReportError } {
  if (!raw || typeof raw !== "object") return { error: "badFormat" };
  const report = raw as Record<string, unknown>;
  if (report.schema !== REPORT_SCHEMA) return { error: "badFormat" };
  if (report.version !== REPORT_VERSION) return { error: "unknownVersion" };
  const reportFaction = text(report.faction, 120);
  if (!reportFaction) return { error: "badFormat" };
  // The server's own spelling of the faction is kept.
  const faction = factions.find((f) => sameFaction(f, reportFaction));
  if (!faction) return { error: "otherFaction" };
  if (!Array.isArray(report.actions)) return { error: "badFormat" };
  if (report.actions.length > MAX_ACTIONS) return { error: "tooLarge" };
  const actions: ReportAction[] = [];
  for (const entry of report.actions as Record<string, unknown>[]) {
    const system = text(entry?.system, 120);
    if (
      !entry ||
      !isDate(entry.at) ||
      !KINDS.has(entry.kind as string) ||
      !system ||
      typeof entry.against !== "boolean"
    )
      return { error: "badFormat" };
    actions.push({
      at: new Date(Date.parse(entry.at)).toISOString(),
      kind: entry.kind as ActionKind,
      system,
      influence: whole(entry.influence, -5, 5),
      credits: whole(entry.credits, -10_000_000_000, 10_000_000_000),
      against: entry.against,
    });
  }
  return { faction, actions };
}

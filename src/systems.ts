// What the members saw in the game: a system's factions (influence, states) and conflicts, as
// EDCH reads them from the journal on arrival. Shared through the server so every member's EDCH
// can use the freshest one (GET /v1/systems), and shown in the system's thread when it changed.
// Public game data: no commander, ship or position beyond the system itself.
// Stored like the actions (storage.ts): messages of the bot in #edch-sync, compressed in a spoiler.

import { base64Url, fromBase64Url } from "./crypto.js";
import { sameFaction } from "./report.js";

/** A faction in a system, as the game showed it. */
export interface FactionSnapshot {
  name: string;
  /** Percent, 0–100. */
  influence: number;
  state: string;
  active: string[];
  pending: string[];
  recovering: string[];
}

/** A war or election: the two sides, what is at stake and the days won. */
export interface ConflictSnapshot {
  type: string;
  status: string;
  sides: { name: string; stake: string; wonDays: number }[];
}

/** A system as a member's game showed it at `at`. */
export interface SystemSnapshot {
  at: string;
  system: string;
  controlling?: string;
  factions: FactionSnapshot[];
  conflicts: ConflictSnapshot[];
}

/** A snapshot read back, with who sent it. */
export interface StoredSnapshot extends SystemSnapshot {
  userId: string;
}

/** A report carries at most this many systems; a system at most this many factions. */
export const MAX_SNAPSHOTS = 200;
const MAX_FACTIONS_IN_SYSTEM = 40;
const MAX_CONFLICTS = 10;
const MAX_STATES = 12;
const SNAPSHOT_MARK = "edch:s1:";
const MAX_DATA_CHARS = 1700;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value.trim() : null);
const states = (value: unknown): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STATES) return null;
  const list = value.map((s) => text(s, 60));
  return list.every((s): s is string => s !== null) ? list.filter(Boolean) : null;
};

/** One snapshot of a report, checked and bounded; null when malformed. */
function checkSnapshot(raw: unknown): SystemSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const system = text(s.system, 120);
  if (!system || !isDate(s.at) || !Array.isArray(s.factions) || s.factions.length > MAX_FACTIONS_IN_SYSTEM) return null;
  const factions: FactionSnapshot[] = [];
  for (const f of s.factions as Record<string, unknown>[]) {
    const name = text(f?.name, 120);
    const influence = f?.influence;
    const state = text(f?.state ?? "None", 60);
    const active = states(f?.active);
    const pending = states(f?.pending);
    const recovering = states(f?.recovering);
    if (!name || typeof influence !== "number" || !(influence >= 0 && influence <= 100) || state === null) return null;
    if (!active || !pending || !recovering) return null;
    factions.push({ name, influence: Math.round(influence * 100) / 100, state, active, pending, recovering });
  }
  const conflicts: ConflictSnapshot[] = [];
  const rawConflicts = s.conflicts ?? [];
  if (!Array.isArray(rawConflicts) || rawConflicts.length > MAX_CONFLICTS) return null;
  for (const c of rawConflicts as Record<string, unknown>[]) {
    const sides = Array.isArray(c?.sides) ? (c.sides as Record<string, unknown>[]).slice(0, 2) : null;
    if (!sides) return null;
    conflicts.push({
      type: text(c.type, 40) ?? "",
      status: text(c.status, 40) ?? "",
      sides: sides.map((side) => ({
        name: text(side?.name, 120) ?? "",
        stake: text(side?.stake, 120) ?? "",
        wonDays: Number.isInteger(side?.wonDays) ? Math.max(0, Math.min(10, side.wonDays as number)) : 0,
      })),
    });
  }
  const controlling = text(s.controlling, 120) || undefined;
  return { at: new Date(Date.parse(s.at)).toISOString(), system, controlling, factions, conflicts };
}

/**
 * The systems of a report: checked, and only those where a faction the server follows is present
 * (the others are none of the squadron's business). Undefined: none sent; null: malformed.
 */
export function checkSnapshots(raw: unknown, followed: string[]): SystemSnapshot[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SNAPSHOTS) return null;
  const snapshots: SystemSnapshot[] = [];
  for (const entry of raw) {
    const snapshot = checkSnapshot(entry);
    if (!snapshot) return null;
    if (snapshot.factions.some((f) => followed.some((name) => sameFaction(name, f.name)))) snapshots.push(snapshot);
  }
  return snapshots;
}

async function deflate(value: string): Promise<Uint8Array> {
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).text();
}

const encode = async (userId: string, list: SystemSnapshot[]) =>
  SNAPSHOT_MARK + base64Url(await deflate(JSON.stringify({ u: userId, s: list })));

/** The messages holding some snapshots (as many as needed to fit Discord's limit). */
export async function snapshotMessages(userId: string, snapshots: SystemSnapshot[]): Promise<string[]> {
  const messages: string[] = [];
  let pending: SystemSnapshot[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const count = pending.length;
    messages.push(
      `🛰️ <@${userId}> · ${count} system${count > 1 ? "s" : ""} seen\n||${await encode(userId, pending)}||`,
    );
    pending = [];
  };
  for (const snapshot of snapshots) {
    pending.push(snapshot);
    if ((await encode(userId, pending)).length > MAX_DATA_CHARS) {
      const last = pending.pop()!;
      await flush();
      pending = [last];
    }
  }
  await flush();
  return messages;
}

/** The snapshots of a message written by `snapshotMessages` (none when it isn't one). */
export async function messageSnapshots(content: string): Promise<StoredSnapshot[]> {
  const data = new RegExp(`${SNAPSHOT_MARK}([A-Za-z0-9_-]+)`).exec(content)?.[1];
  const bytes = data ? fromBase64Url(data) : null;
  if (!bytes) return [];
  try {
    const raw = JSON.parse(await inflate(bytes));
    if (typeof raw.u !== "string" || !Array.isArray(raw.s)) return [];
    return (raw.s as unknown[])
      .map(checkSnapshot)
      .filter((s): s is SystemSnapshot => s !== null)
      .map((s) => ({ ...s, userId: raw.u }));
  } catch {
    return [];
  }
}

/** The newest snapshot of each system (by name, without case), newest first. */
export function latestBySystem(snapshots: StoredSnapshot[]): StoredSnapshot[] {
  const latest = new Map<string, StoredSnapshot>();
  for (const s of snapshots) {
    const key = s.system.toLowerCase();
    const known = latest.get(key);
    if (!known || s.at > known.at) latest.set(key, s);
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** What a thread line says about a system: the followed factions there, with their states. */
function followedPart(snapshot: SystemSnapshot, followed: string[]): string {
  return snapshot.factions
    .filter((f) => followed.some((name) => sameFaction(name, f.name)))
    .map((f) => {
      const extra = [
        f.state && f.state !== "None" ? f.state : "",
        f.pending.length ? `pending ${f.pending.join(", ")}` : "",
      ].filter(Boolean);
      return `**${f.name}** ${f.influence.toFixed(1)} %${extra.length ? ` (${extra.join(" · ")})` : ""}`;
    })
    .join(" · ");
}

/** The closest other faction to the first followed one there, as "rival X 30.1 %". */
function rivalPart(snapshot: SystemSnapshot, followed: string[]): string {
  const ours = snapshot.factions.find((f) => followed.some((name) => sameFaction(name, f.name)));
  if (!ours) return "";
  const others = snapshot.factions.filter((f) => !followed.some((name) => sameFaction(name, f.name)));
  const rival = others.sort(
    (a, b) => Math.abs(a.influence - ours.influence) - Math.abs(b.influence - ours.influence),
  )[0];
  return rival ? `closest ${rival.name} ${rival.influence.toFixed(1)} %` : "";
}

/** The line written in the system's thread for a snapshot. */
export function snapshotLine(userId: string, snapshot: SystemSnapshot, followed: string[]): string {
  const war = snapshot.conflicts
    .filter((c) => c.sides.some((side) => followed.some((name) => sameFaction(name, side.name))))
    .map((c) => `⚔️ ${c.type || "conflict"} ${c.sides.map((side) => `${side.name} ${side.wonDays}`).join(" – ")}`);
  const parts = [followedPart(snapshot, followed), rivalPart(snapshot, followed), ...war].filter(Boolean);
  return `🛰️ <@${userId}> · ${parts.join(" · ")}`;
}

/** Whether a snapshot shows something new for the followed factions (influence or states). */
export function changedSince(previous: SystemSnapshot | undefined, next: SystemSnapshot, followed: string[]): boolean {
  if (!previous) return true;
  const view = (s: SystemSnapshot) => `${followedPart(s, followed)}|${rivalPart(s, followed)}|${s.conflicts.length}`;
  return view(previous) !== view(next);
}

/** For tests and the API: snapshots without who sent them (EDCH doesn't need it). */
export const withoutSender = ({ userId: _userId, ...snapshot }: StoredSnapshot): SystemSnapshot => snapshot;

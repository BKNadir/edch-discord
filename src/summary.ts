// /bgs summary: what the squadron did for its faction over a period, system by system, and who
// did it. Plain text for a Discord message (at most 2000 characters).

import type { StoredAction } from "./types.js";

export interface SystemTotals {
  system: string;
  /** Sum of the missions' influence ("+"), negative ones included. */
  influence: number;
  missions: number;
  bounties: number;
  combatBonds: number;
  trade: number;
  exploration: number;
  /** Actions that lowered the faction (crimes, failed or abandoned missions, missions against it). */
  against: number;
  /** Members who reported something in this system. */
  members: Set<string>;
}

/** Totals by system, the busiest first. */
export function totalsBySystem(actions: StoredAction[]): SystemTotals[] {
  const bySystem = new Map<string, SystemTotals>();
  for (const a of actions) {
    const t =
      bySystem.get(a.system) ??
      ({
        system: a.system,
        influence: 0,
        missions: 0,
        bounties: 0,
        combatBonds: 0,
        trade: 0,
        exploration: 0,
        against: 0,
        members: new Set(),
      } as SystemTotals);
    bySystem.set(a.system, t);
    t.members.add(a.userId);
    if (a.against) t.against += 1;
    const credits = a.credits ?? 0;
    switch (a.kind) {
      case "mission":
        t.missions += 1;
        t.influence += a.influence ?? 0;
        break;
      case "bounty":
        t.bounties += credits;
        break;
      case "combatBond":
        t.combatBonds += credits;
        break;
      case "trade":
      case "blackMarket":
        t.trade += credits;
        break;
      case "exploration":
        t.exploration += credits;
        break;
    }
  }
  const weight = (t: SystemTotals) =>
    Math.abs(t.influence) * 1_000_000 + t.bounties + t.combatBonds + t.trade + t.exploration;
  return [...bySystem.values()].sort((a, b) => weight(b) - weight(a) || a.system.localeCompare(b.system));
}

/** "12.3M", "850k", "420". */
export function shortCredits(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** The message text: a heading, then one line per system (cut to fit Discord's limit). */
export function summaryText(faction: string, periodLabel: string, actions: StoredAction[]): string {
  const totals = totalsBySystem(actions);
  const members = new Set(actions.map((a) => a.userId));
  const head = `**${faction}** · ${periodLabel} · ${actions.length} actions · ${members.size} member${members.size === 1 ? "" : "s"}`;
  if (!totals.length) return `${head}\nNothing reported for this period.`;
  const lines = totals.map((t) => {
    const parts = [
      t.missions ? `${t.missions} missions (${t.influence >= 0 ? "+" : ""}${t.influence} inf.)` : "",
      t.bounties ? `bounties ${shortCredits(t.bounties)}` : "",
      t.combatBonds ? `bonds ${shortCredits(t.combatBonds)}` : "",
      t.trade ? `trade ${shortCredits(t.trade)}` : "",
      t.exploration ? `cartography ${shortCredits(t.exploration)}` : "",
      t.against ? `⚠️ ${t.against} against` : "",
    ].filter(Boolean);
    return `• **${t.system}**: ${parts.join(" · ")} — ${[...t.members].map((id) => `<@${id}>`).join(" ")}`;
  });
  let text = head;
  for (const [index, line] of lines.entries()) {
    const more = `\n…and ${lines.length - index} more systems.`;
    if (text.length + line.length + 1 + more.length > 1990) return text + more;
    text += `\n${line}`;
  }
  return text;
}

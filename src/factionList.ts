// The game's minor factions, for /bgs faction add: a list built from EDSM's nightly dump of the
// populated systems (scripts/build-factions.mjs, run by `npm run update`) and shipped inside the
// Worker as text, one name per line. Searching it asks no website while an admin types.

/** A searchable list: the names, and the same in lower case for comparing. */
export interface FactionList {
  names: string[];
  lower: string[];
}

/** The list from its text (one name per line); blank lines are ignored. */
export function factionList(text: string): FactionList {
  const names = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { names, lower: names.map((name) => name.toLowerCase()) };
}

/**
 * The names matching what was typed: those starting with it first, then those containing it
 * (each part of the name counts, so "compagnons" finds "Amicale des Compagnons de l'Espace").
 */
export function searchFactionList(list: FactionList, typed: string, max = 24): string[] {
  const wanted = typed.trim().toLowerCase();
  if (wanted.length < 2) return [];
  const starting: string[] = [];
  const containing: string[] = [];
  for (let i = 0; i < list.lower.length && starting.length < max; i++) {
    const name = list.lower[i];
    if (name.startsWith(wanted)) starting.push(list.names[i]);
    else if (containing.length < max && name.includes(wanted)) containing.push(list.names[i]);
  }
  return [...starting, ...containing].slice(0, max);
}

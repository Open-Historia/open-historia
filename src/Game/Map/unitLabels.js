/*! Open Historia — the short name under a counter © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What fits under a counter on the map: a unit's (Units.jsx), and a named
// formation's among a battlefield's troops (FrontLayers.jsx). Loads in plain
// Node.

// Words that end a formation's name without identifying it. Every counter on the
// map is a group of something, so the word is pure width on a label that has to
// sit under a 30px disc.
const FORMATION_SUFFIXES = new Set([
  "group", "squadron", "flotilla", "fleet", "command", "battalion", "regiment",
  "brigade", "division", "corps", "army", "detachment", "force", "battlegroup",
  "wing", "strike", "task", "element", "unit", "formation", "flight", "team",
]);

// Words that cannot END a label, because they read as dangling. "Gulf of Guinea
// Strike Group" has to shorten to "Gulf of Guinea", never "Gulf of".
const CONNECTIVES = new Set(["of", "the", "de", "du", "da", "di", "la", "le", "van", "von", "al", "st", "st.", "and", "&"]);

// Two words of a unit's name, which is all that fits under a counter. The full
// name is one click away in the unit popup.
export const shortUnitLabel = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";

  // Shed trailing formation nouns, but never below two words — "USN Amphibious
  // Squadron" should reach "USN Amphibious", not bottom out at "USN".
  const trimmed = [...words];
  while (trimmed.length > 2 && FORMATION_SUFFIXES.has(trimmed[trimmed.length - 1].toLowerCase())) {
    trimmed.pop();
  }

  // Take two words, then keep going while the label would otherwise end on a
  // connective — so "Gulf of Guinea" survives whole and "HMS St Albans" does too.
  const taken = trimmed.slice(0, 2);
  while (taken.length < trimmed.length && CONNECTIVES.has(taken[taken.length - 1].toLowerCase())) {
    taken.push(trimmed[taken.length]);
  }
  return taken.join(" ");
};

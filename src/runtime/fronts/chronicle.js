/*! Open Historia — battlefields and fronts: what a battlefield's war came to © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "After-action report when a war ends: its turning points (breakthroughs,
// encirclements, walls breached) from the battle's log and replay" (the
// owner's list, 2026-10-16). A battlefield's log keeps only its last few
// entries (constants.js MAX_LOG_ENTRIES) and a war is fought over many turns,
// so what is worth telling afterwards is kept here, run by run, beside the
// record: each moment worth telling (CHRONICLE_KINDS), and how strong each side
// stood at the end of each run. The report reads it once the battlefield has
// closed (Game/GameUI/afterAction.jsx).
//
//   record.chronicle   { moments: [{ d, k, s, at, size?, capital? }], strength: [[date, a, b, pa, pb]] }
//                      the moments in the order they happened (a log entry's own
//                      words: engine.js, day.js, supply.js, walls.js); a and b,
//                      each side's formations at the end of a run, pa and pb
//                      their strength on average
//
// Only + - * / and comparisons, as everywhere in the engine.

import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { isLive } from "./troops.js";

// The moments worth telling afterwards, of what a battlefield's log says.
export const CHRONICLE_KINDS = Object.freeze(["offensive", "counter", "city", "pocket", "siege", "breached", "destroyed", "invaded", "attacked", "landed", "withdrew", "returned", "assault", "bombed"]);
// The most kept: the first few of the war are always kept, then the latest.
export const CHRONICLE_MOST = 120;
const OPENING_KEPT = 20;
// The most a single run adds (a long skip on a broken front can overrun dozens of places).
export const CHRONICLE_RUN_MOST = 16;
// The most points of strength kept: past that, the older half is thinned to every other one.
export const STRENGTH_MOST = 60;

const clean = (value, most) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most);
const count = (value) => (Number(value) > 0 ? Math.floor(Number(value)) : 0);
const percent = (value) => (Number(value) > 0 ? (Number(value) > 100 ? 100 : Math.round(Number(value))) : 0);

// A chronicle as a record keeps it, or null where there is none.
export const readChronicle = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const moments = [];
  for (const entry of Array.isArray(value.moments) ? value.moments : []) {
    const k = clean(entry?.k, 24).toLowerCase();
    if (!CHRONICLE_KINDS.includes(k)) continue;
    moments.push({
      d: clean(entry.d, 40),
      k,
      ...(entry.s === 0 || entry.s === 1 ? { s: entry.s } : {}),
      at: clean(entry.at, 160),
      ...(count(entry.size) > 0 ? { size: count(entry.size) } : {}),
      ...(entry.capital === true ? { capital: true } : {}),
    });
  }
  const strength = [];
  for (const row of Array.isArray(value.strength) ? value.strength : []) {
    if (!Array.isArray(row) || row.length < 3) continue;
    strength.push([clean(row[0], 40), count(row[1]), count(row[2]), percent(row[3]), percent(row[4])]);
  }
  if (moments.length === 0 && strength.length === 0) return null;
  return { moments: moments.slice(-CHRONICLE_MOST), strength: strength.slice(-STRENGTH_MOST) };
};

const strengthOf = (troops) => {
  let sum = 0;
  for (const troop of troops) sum += troop.strength;
  return troops.length > 0 ? Math.round(sum / troops.length) : 0;
};

// The chronicle as a run leaves it, on `date`: what it had (battle.chronicle, battle.js), with what this run's log
// added that is worth telling, and how strong each side stands now.
export const chronicleAfter = (battle, date) => {
  const before = battle.chronicle ?? { moments: [], strength: [] };
  const fresh = [];
  for (const entry of Array.isArray(battle.log) ? battle.log.slice(battle.logFrom ?? 0) : []) {
    if (!CHRONICLE_KINDS.includes(entry?.k) || fresh.length >= CHRONICLE_RUN_MOST) continue;
    const told = { d: clean(entry.d, 40), k: entry.k, ...(entry.s === 0 || entry.s === 1 ? { s: entry.s } : {}), at: clean(entry.at, 160) };
    // A town says how large it is, and whether it is a capital: the report tells the larger first.
    if (entry.k === "city") {
      const city = (battle.arena?.cities ?? []).find((candidate) => `city: ${candidate.name}` === entry.at);
      if (city && count(city.population) > 0) told.size = count(city.population);
      if (city?.capital) told.capital = true;
    }
    fresh.push(told);
  }
  let moments = [...before.moments, ...fresh];
  if (moments.length > CHRONICLE_MOST) moments = [...moments.slice(0, OPENING_KEPT), ...moments.slice(moments.length - (CHRONICLE_MOST - OPENING_KEPT))];
  const live = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => battle.troops[side].filter(isLive));
  const point = [clean(date, 40), live[0].length, live[1].length, strengthOf(live[0]), strengthOf(live[1])];
  const last = before.strength[before.strength.length - 1];
  let strength = last && last[0] === point[0] ? [...before.strength.slice(0, -1), point] : [...before.strength, point];
  if (strength.length > STRENGTH_MOST) {
    const half = STRENGTH_MOST / 2;
    strength = [...strength.slice(0, strength.length - half).filter((_, at) => at % 2 === 0), ...strength.slice(strength.length - half)];
  }
  return { moments, strength };
};

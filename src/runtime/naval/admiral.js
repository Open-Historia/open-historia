/*! Open Historia — war at sea: an admiral for the countries nobody plays (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Make it also be able to control and understand
// fortifications, fleets and blockades, plane attacks, and litterally
// everything" (the owner, 2026-10-14).
//
// A fleet keeps the posture the story or a player last gave it, and the war at
// sea (engine.js) only plays out what follows: a country nobody plays had
// nobody to choose for its fleets. This admiral chooses, as the land staff that
// looks ahead does (runtime/fronts/mind/planner.js): before a period's war at
// sea is fought, each country at war that nobody plays and that has fleets
// afloat tries each posture it might give them all (ADMIRAL_POSTURES), fights
// the period out with each (runNaval, the engine itself, on the same input),
// and weighs what each leaves it:
//
//   its fleets' strength at the end, less its enemies'
//   and BLOCKADE_WORTH for each whole period of blockade pressure it laid on
//   an enemy, less the same for what was laid on it
//
// It keeps the best (its fleets as they were where none is better). Countries
// choose in turn, by name, each against what those before it chose. A fleet
// the turn's story moved or ordered keeps what it was told (`kept`).
//
// Pure, like the engine: the same input chooses the same.

import { hostilities, runNaval } from "./engine.js";

const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

export const ADMIRAL_POSTURES = Object.freeze(["patrol", "assaulting", "blockade", "holding", "withdrawing"]);
// What a whole period of blockade pressure 1 is worth beside a fleet's strength (100 a full fleet).
export const BLOCKADE_WORTH = 60;

// The postures the countries nobody plays give their fleets this period.
//   input     what runNaval is given
//   players   the countries people play: theirs are theirs
//   kept      the ids of fleets the turn's story moved or ordered
// Returns { units, chosen }: the units with the postures chosen, and Map unitId -> the posture chosen for it
// (only where it changed).
export const chooseFleetPostures = (input, { players = [], kept = new Set(), run = runNaval } = {}) => {
  const units = list(input?.units).map((unit) => (unit && typeof unit === "object" ? { ...unit } : unit));
  const chosen = new Map();
  const { enemies } = hostilities(input?.wars);
  if (enemies.size === 0) return { units, chosen };
  const played = new Set(list(players).map(fold));
  const decides = (unit) => unit && fold(unit.type) === "naval" && !clean(unit.committedTo) && clean(unit.id) && Number(unit.strength) > 0
    && !kept.has(clean(unit.id)) && enemies.has(fold(unit.ownerCode)) && !played.has(fold(unit.ownerCode));
  const owners = [...new Set(units.filter(decides).map((unit) => clean(unit.ownerCode)))].sort();
  for (const owner of owners) {
    const key = fold(owner);
    const foes = enemies.get(key) ?? new Set();
    const mine = units.filter((unit) => decides(unit) && fold(unit.ownerCode) === key);
    const weigh = () => {
      const result = run({ ...input, units });
      let value = 0;
      for (const fleet of list(result?.fleets)) {
        const whose = fold(fleet.owner);
        if (whose === key) value += Number(fleet.strength) || 0;
        else if (foes.has(whose)) value -= Number(fleet.strength) || 0;
      }
      const days = Math.max(1, Number(input?.days) || 1);
      for (const blockade of list(result?.blockades)) {
        const weight = (BLOCKADE_WORTH * (Number(blockade.pressure) || 0) * (Number(blockade.days) || 0)) / days;
        if (fold(blockade.country) === key) value -= weight;
        else if (list(blockade.by).some((name) => fold(name) === key)) value += weight;
      }
      return value;
    };
    const was = mine.map((unit) => unit.posture);
    let best = weigh();
    let bestPosture = null;
    for (const posture of ADMIRAL_POSTURES) {
      if (mine.every((unit) => fold(unit.posture) === posture)) continue;
      for (const unit of mine) unit.posture = posture;
      const value = weigh();
      if (value > best + 1e-9) {
        best = value;
        bestPosture = posture;
      }
    }
    mine.forEach((unit, at) => {
      unit.posture = bestPosture ?? was[at];
      if (bestPosture && fold(was[at]) !== bestPosture) chosen.set(clean(unit.id), bestPosture);
    });
  }
  return { units, chosen };
};

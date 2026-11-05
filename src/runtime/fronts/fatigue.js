/*! Open Historia — battlefields and fronts: troops tire, and recover at rest © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "fatigue"). "Make advancing and movement
// tire troops."
//
// A troop's FATIGUE runs from 0, fresh, to 1, spent. Every evening (dawn.js
// dusk) what its day was adds to it or takes from it:
//
//   marching       a full day's march at its era's pace adds FATIGUE_MARCH,
//                  a shorter one its share of that (the scenario's pace is in
//                  the figure, so a slower setting does not tire troops less)
//   attacking      a day it attacked adds FATIGUE_ATTACK; a day it was
//                  attacked, FATIGUE_DEFEND
//   resting        a day it did neither, and moved less than FATIGUE_STILL_KM,
//                  takes FATIGUE_REST off: the more so dug in, the less so
//                  short of supply, and hardly at all cut off
//
// And every morning (dawn.js) what it has left is what it fights and marches
// with: its attack, defence and pace each fall with its fatigue
// (FATIGUE_PUNCH, FATIGUE_GUARD, FATIGUE_LEGS of them when spent).
//
// So a side that attacks everywhere every day wears itself out within a
// fortnight, and one that pauses, or holds a stretch while another attacks,
// comes back to it fresh. Reserves that make good a troop's losses are men,
// not rest: they do not freshen it.
//
// Kept with the battlefield (battle.js, brief.carry.tired), a letter a troop.
// Only + - * / and comparisons.

import {
  FATIGUE_ATTACK,
  FATIGUE_DEFEND,
  FATIGUE_GUARD,
  FATIGUE_LEGS,
  FATIGUE_MARCH,
  FATIGUE_PUNCH,
  FATIGUE_REST,
  FATIGUE_REST_DUG,
  FATIGUE_REST_POCKET,
  FATIGUE_STILL_KM,
} from "./constants.js";
import { isLive } from "./troops.js";

// The evening: what each live troop's day did to it. `wear` and `rest` are
// what the day's weather does to both (weather.js), 0 and 1 without it.
export const tireDay = (run, battle, { wear = 0, rest = 1 } = {}) => {
  for (const side of [0, 1]) {
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      const full = run.advanceKm[troop.kind] * run.pace;
      const marched = full > 0 ? troop.movedKm / full : 0;
      const busy = troop.fought || troop.engaged || troop.movedKm >= FATIGUE_STILL_KM;
      if (busy) {
        // (And what its own ground's climate wears it, where a scenario's zones say: climate.js.)
        const rise = FATIGUE_MARCH * (marched > 1 ? 1 : marched) + (troop.fought ? FATIGUE_ATTACK : troop.engaged ? FATIGUE_DEFEND : 0) + wear + (troop.climate ? troop.climate.wear : 0);
        troop.fatigue = troop.fatigue + rise > 1 ? 1 : troop.fatigue + rise;
      } else {
        const fall = FATIGUE_REST * (troop.dug ? FATIGUE_REST_DUG : 1) * (troop.pocket ? FATIGUE_REST_POCKET : troop.supply) * rest;
        troop.fatigue = troop.fatigue - fall < 0 ? 0 : troop.fatigue - fall;
      }
    }
  }
};

// The morning: what a troop's fatigue leaves it of its attack, defence and pace.
export const punchLeft = (fatigue) => 1 - FATIGUE_PUNCH * fatigue;
export const guardLeft = (fatigue) => 1 - FATIGUE_GUARD * fatigue;
export const legsLeft = (fatigue) => 1 - FATIGUE_LEGS * fatigue;

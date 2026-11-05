/*! Open Historia — battlefields and fronts: a day's morning and evening © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. The MORNING of a battle's day, before its staff looks
// and before anyone moves (engine.js stepDay): what the day's conditions make
// of each troop, as three numbers that the fight and the march only multiply
// by (combat.js):
//
//   punch   its attack
//   guard   its defence
//   legs    its pace
//
// Each is 1 unless a mechanic of the run's says otherwise (mechanics.js), so a
// run with none on is the run it always was, to the last digit.
//
// The EVENING, before the day's books are closed (day.js simulateDay): what
// the day did to each troop.
//
// Only + - * / and comparisons.

import { STILL_EDGE, STRONG_WORKS } from "./constants.js";
import { guardLeft, legsLeft, punchLeft, tireDay } from "./fatigue.js";
import { mendBudget } from "./manpower.js";
import { anyMechanic } from "./mechanics.js";
import { isLive } from "./troops.js";
import { airStrikes, skyOfWings, wearWings } from "./air.js";
import { keptWith, raiseWalls } from "./walls.js";
import { harshnessOf, skyOver } from "./weather.js";
import { ATTRITION_HARSH_FROM } from "./constants.js";
import { climateAt } from "./climate.js";
import { cellAt } from "./ground.js";

// (A test may set a side's readiness outright: input.steering.readiness = { punch: [a, b], guard, legs }.)
const steered = (run, key, side) => {
  const list = run.steer?.readiness?.[key];
  const value = Array.isArray(list) ? Number(list[side]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : 1;
};

// Whether the mornings of a run have anything to do.
export const dawnsOn = (run) => anyMechanic(run.mech) || Boolean(run.steer?.readiness);

export const dawn = (run, battle, day) => {
  if (!dawnsOn(run)) return;
  // The walls standing today, and who fights from one (walls.js): the ground each side leaves alone with them.
  if (run.mech.walls) {
    raiseWalls(run, battle, run.dateOf(day));
    battle.kept = keptWith(battle);
  }
  // The day's weather (weather.js): what it does to every troop's march and blows.
  const sky = run.mech.weather ? skyOver(run, battle, day) : null;
  if (!sky) battle.sky = null;
  const pace = sky ? sky.effects.pace : 1;
  const blows = sky ? sky.effects.attack : 1;
  // Who holds the sky over it, and what that does to each side (air.js).
  const air = run.mech.air ? skyOfWings(run, battle, day) : null;
  // With the fatigue mechanic, troops dig in deeper and faster and their works hold better (constants.js STRONG_WORKS).
  battle.works = run.mech.fatigue ? STRONG_WORKS : null;
  // With the supply mechanic, supply carried down a corridor the other side's ground lies close along is carried
  // the worse (supply.js refreshSupply, constants.js CORRIDOR_COST).
  battle.corridors = run.mech.supply === true;
  // Attrition (mechanics.js "attrition"): what the weather takes from every troop out in it (combat.js closeDay),
  // and each country's count of it this run: its formation-days out, those in harsh weather, and what it lost.
  const counting = run.mech.attrition === true;
  if (counting && !battle.outBy) {
    battle.outBy = [new Map(), new Map()];
    battle.harshBy = [new Map(), new Map()];
    battle.lostBy = [new Map(), new Map()];
  }
  battle.exposure = counting ? [{ short: battle.short?.[0] ?? 0 }, { short: battle.short?.[1] ?? 0 }] : null;
  for (const side of [0, 1]) {
    const punch = steered(run, "punch", side);
    const guard = steered(run, "guard", side);
    const legs = steered(run, "legs", side);
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      // What its country's soldiers fight with (military.js: setHandicap).
      const worth = battle.worth ? battle.worth[side][troop.owner] ?? 1 : 1;
      // What its fatigue leaves it (fatigue.js).
      const tired = run.mech.fatigue && troop.fatigue > 0;
      // What a scenario's climate zones make of its own ground today (climate.js).
      troop.climate = sky && battle.climateToday ? climateAt(battle.climateToday, cellAt(battle.field, troop.x, troop.y)) : null;
      const local = troop.climate;
      if (counting) {
        battle.outBy[side].set(troop.owner, (battle.outBy[side].get(troop.owner) ?? 0) + 1);
        if (sky && harshnessOf(sky, troop) >= ATTRITION_HARSH_FROM) battle.harshBy[side].set(troop.owner, (battle.harshBy[side].get(troop.owner) ?? 0) + 1);
      }
      // A troop that did not advance yesterday is a little stronger today (constants.js STILL_EDGE).
      const still = run.mech.fatigue && troop.still === true ? 1 + STILL_EDGE : 1;
      troop.punch = (tired ? punch * punchLeft(troop.fatigue) : punch) * worth * blows * (air ? air.punch[side] : 1) * (local ? local.attack : 1) * still;
      troop.guard = (tired ? guard * guardLeft(troop.fatigue) : guard) * worth * (air ? air.guard[side] : 1) * still;
      troop.legs = (tired ? legs * legsLeft(troop.fatigue) : legs) * pace * (air ? air.legs[side] : 1) * (local ? local.pace : 1);
    }
  }
};

// The evening's count of who advanced: each troop's `still`, and each country's
// formation-days at war, of them advancing, and its days at war (run.effort).
const markAdvance = (run, battle, day) => {
  for (const side of [0, 1]) {
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      const advanced = troop.walkedToday === true || troop.fought === true;
      troop.still = !advanced;
      if (!run.mech.supply) continue;
      const name = battle.sides[side][troop.owner];
      if (!name) continue;
      const key = String(name).toLowerCase();
      let entry = run.effort.get(key);
      if (!entry) {
        entry = { name: String(name), advanced: 0, troopDays: 0, warDays: 0, lastDay: -1 };
        run.effort.set(key, entry);
      }
      entry.troopDays += 1;
      if (advanced) entry.advanced += 1;
      if (entry.lastDay !== day) {
        entry.lastDay = day;
        entry.warDays += 1;
      }
    }
  }
};

export const dusk = (run, battle, day) => {
  if (!anyMechanic(run.mech)) return;
  // What wings sent to strike did to the other side's troops, and the wings that flew over it are worn (air.js).
  if (run.mech.air) {
    airStrikes(battle);
    wearWings(run, battle);
  }
  // The day's march and fighting tire every troop that marched or fought, and rest the others (fatigue.js).
  // (And the weather tires them too, and rests them less: weather.js.)
  if (run.mech.fatigue) tireDay(run, battle, battle.sky ? { wear: battle.sky.effects.wear, rest: battle.sky.effects.rest } : undefined);
  // Which troops advanced today, taking ground or attacking (combat.js walkedToday, fought): one that did not
  // fights a little harder tomorrow; and each country's days of advance, which its war resources pay for
  // (runtime/warResources.js).
  if (run.mech.fatigue || run.mech.supply) markAdvance(run, battle, day);
  // Weighing countries' own military figures, reserves make good a country's losses only with men it still has (manpower.js).
  if (run.mech.military) {
    const budget = mendBudget(run, day);
    battle.mendOf = (side, owner) => budget(battle.sides[side][owner]);
  } else battle.mendOf = null;
};

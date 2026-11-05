/*! Open Historia — battlefields and fronts: what attrition took from each country © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "attrition"). What the weather and being
// cut off took from each country's formations in a run, besides the fighting,
// for the turn (runtime/warWeariness.js, runtime/warResources.js,
// runtime/attrition.js): counted each morning and evening (dawn.js,
// combat.js closeDay) on each battle, summed here.
//
// Only + - * / and comparisons.

import { menOf } from "./manpower.js";

// [{ name, lost, men, troopDays, harshDays, days }]:
//   lost        strength points (a hundred a formation) lost to attrition
//   men         the men that is
//   troopDays   its formation-days out on a battlefield
//   harshDays   those in harsh weather (constants.js ATTRITION_HARSH_FROM)
//   days        the days of the run
export const attritionReport = (run, days) => {
  const totals = new Map();
  for (const battle of run.battles) {
    if (!battle.outBy) continue;
    for (const side of [0, 1]) {
      const add = (counts, field) => counts.forEach((value, owner) => {
        const name = battle.sides[side][owner];
        if (!name) return;
        const key = String(name).toLowerCase();
        if (!totals.has(key)) totals.set(key, { name: String(name), lost: 0, troopDays: 0, harshDays: 0 });
        totals.get(key)[field] += value;
      });
      add(battle.lostBy[side], "lost");
      add(battle.outBy[side], "troopDays");
      add(battle.harshBy[side], "harshDays");
    }
  }
  return [...totals.values()].map((entry) => ({
    name: entry.name,
    lost: Math.round(entry.lost * 10) / 10,
    men: Math.round((entry.lost / 100) * menOf(run, entry.name)),
    troopDays: entry.troopDays,
    harshDays: entry.harshDays,
    days,
  }));
};

// What a battle's attrition came to this run, a side: formations' worth, to a tenth; null with nothing counted.
export const battleAttrition = (battle) => {
  if (!battle.lostBy) return null;
  const lost = [0, 1].map((side) => {
    let sum = 0;
    battle.lostBy[side].forEach((value) => {
      sum += value;
    });
    return Math.round(sum / 10) / 10;
  });
  return lost[0] > 0 || lost[1] > 0 ? lost : null;
};

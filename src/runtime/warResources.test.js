/*! Open Historia — a country's war resources: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warResources.test.js
//
// "Make it so advancing uses up resources (so does building fortifications)
// which lowers the amount of resources availible weakening your army", and
// "make it so troops that are not advancing also get a small strength boost".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { turnWarAndPeace } from "../Game/AI/warAndPeace.js";
import { withBlockadeEconomy } from "../Game/AI/frontApply.js";
import { BLOCKADE_BUDGET_A_YEAR, budgetUnderBlockade } from "./naval/blockade.js";
import { STILL_EDGE } from "./fronts/constants.js";
import { dawn, dusk } from "./fronts/dawn.js";
import { runFronts } from "./fronts/engine.js";
import { readMechanics } from "./fronts/mechanics.js";
import { frontInput, syntheticMap } from "./fronts/syntheticMap.js";
import {
  RESOURCES_ADVANCE_A_MONTH,
  RESOURCES_BLOCKADE_CUT,
  RESOURCES_RATE_LEAST,
  RESOURCES_RATE_MOST,
  economyRate,
  refillAMonth,
  RESOURCES_FORTIFY_A_DAY,
  RESOURCES_REFILL_A_MONTH,
  RESOURCES_SHORT_FROM,
  RESOURCES_SHORTAGE_MOST,
  buildingDaysIn,
  fortifyResourceCost,
  normalizeWarResources,
  resourceShortage,
  resourcesAfter,
  resourcesOf,
  withTurnResources,
} from "./warResources.js";

test("building spends them (advancing no longer does), funding refills them, and running low leaves an army short", () => {
  // A month in which every formation advanced every day it was at war: the full advance cost (none since 2026-10-15), less a month's refill.
  assert.equal(RESOURCES_ADVANCE_A_MONTH, 0, "advancing spends nothing");
  assert.equal(resourcesAfter({ before: 50, days: 30, advanced: 1, warDays: 30 }), 50 - RESOURCES_ADVANCE_A_MONTH + RESOURCES_REFILL_A_MONTH);
  // Half of them: half of it. Holding: none, and the refill to the full.
  assert.equal(resourcesAfter({ before: 50, days: 30, advanced: 0.5, warDays: 30 }), 50 - RESOURCES_ADVANCE_A_MONTH / 2 + RESOURCES_REFILL_A_MONTH);
  assert.equal(resourcesAfter({ before: 90, days: 30, advanced: 0, warDays: 30 }), 100);
  // A rich country refills faster, a poor one slower; never under nothing.
  assert.ok(resourcesAfter({ before: 20, days: 30, rate: 1.5 }) > resourcesAfter({ before: 20, days: 30, rate: 0.6 }));
  assert.equal(resourcesAfter({ before: 10, days: 60, advanced: 1, warDays: 60, rate: 0 }), 10 - 2 * RESOURCES_ADVANCE_A_MONTH);
  assert.equal(resourcesAfter({ before: 10, days: 60, fortifying: 60, rate: 0 }), 0, "never under nothing");
  // A line being built: RESOURCES_FORTIFY_A_DAY a day.
  assert.equal(resourcesAfter({ before: 50, days: 30, fortifying: 30, rate: 0 }), 50 - 30 * RESOURCES_FORTIFY_A_DAY);
  assert.deepEqual(fortifyResourceCost(450), { aMonth: 6, total: 90 });
  // Short only under RESOURCES_SHORT_FROM, and RESOURCES_SHORTAGE_MOST with nothing left.
  assert.equal(resourceShortage(RESOURCES_SHORT_FROM), 0);
  assert.equal(resourceShortage(100), 0);
  assert.equal(resourceShortage(0), RESOURCES_SHORTAGE_MOST);
  assert.ok(resourceShortage(RESOURCES_SHORT_FROM / 2) > 0);
  // Kept only below the full, a country once.
  assert.deepEqual(normalizeWarResources([{ country: "Aland", value: 42.36 }, { country: "aland", value: 5 }, { country: "Borea", value: 100 }, { country: "", value: 3 }]), [{ country: "Aland", value: 42.4 }]);
  assert.equal(resourcesOf([{ country: "Aland", value: 42 }], "ALAND"), 42);
  assert.equal(resourcesOf([], "Aland"), 100);
});

test("they refill over time by the economy: richer, growing and solvent faster; a blockade cuts it", () => {
  // Nothing known of its economy: the ordinary rate.
  assert.equal(economyRate({}), 1);
  assert.equal(refillAMonth(1), 15);
  // Its treasury, where there is nothing to compare it with: a deficit and a debt slow it.
  const deficit = economyRate({ sheet: { economy: { budgetBalance: -10, publicDebt: 120 } } });
  assert.ok(deficit < 1 && deficit >= RESOURCES_RATE_LEAST, String(deficit));
  // Growth: a growing economy faster, a shrinking one slower; a figure written as text is read.
  assert.ok(economyRate({ sheet: { economy: { gdpGrowth: 6 } } }) > economyRate({ sheet: { economy: { gdpGrowth: -6 } } }));
  assert.equal(economyRate({ sheet: { economy: { gdpGrowth: "4%" } } }), 1.2);
  // Wealth against the middle of the known countries: four times as well funded a head, twice the rate.
  const rich = { population: { total: 1e6 }, economy: { gdp: 4e10 } };
  const middle = (4e10 * 0.03) / 1e6 / 4;
  assert.ok(Math.abs(economyRate({ sheet: rich, middle }) - 2) < 1e-9);
  assert.equal(economyRate({ sheet: rich, middle: middle * 1000 }), RESOURCES_RATE_LEAST);
  assert.ok(economyRate({ sheet: rich, middle: middle / 100 }) <= RESOURCES_RATE_MOST);
  // A blockade at full pressure cuts it by RESOURCES_BLOCKADE_CUT.
  assert.ok(Math.abs(economyRate({ pressure: 1 }) - (1 - RESOURCES_BLOCKADE_CUT)) < 1e-9);
  assert.ok(economyRate({ pressure: 0.5 }) > economyRate({ pressure: 1 }));
});

test("a blockade takes points off the budget's balance as well as GDP off the economy", () => {
  assert.equal(budgetUnderBlockade(-2, 1, 365), -2 - BLOCKADE_BUDGET_A_YEAR);
  assert.equal(budgetUnderBlockade(1, 0.5, 73), 1 - (BLOCKADE_BUDGET_A_YEAR * 0.5 * 73) / 365);
  assert.equal(budgetUnderBlockade(-99, 1, 3650), -100);
  const world = { countryStats: { Teutonia: { economy: { budgetBalance: -2 } }, Albion: { economy: { gdp: 1e9, budgetBalance: 1 } } } };
  const write = (next, name, change) => {
    next.countryStats[name] = { ...next.countryStats[name], economy: { ...next.countryStats[name].economy, ...change.economy } };
  };
  const after = withBlockadeEconomy(world, { sea: { days: 30, blockades: [{ country: "Teutonia", pressure: 1 }] } }, write);
  // A country with a budget and no GDP on its sheet still pays in its budget.
  assert.equal(after.countryStats.Teutonia.economy.budgetBalance, Math.round(budgetUnderBlockade(-2, 1, 30) * 100) / 100);
  assert.equal(after.countryStats.Albion, world.countryStats.Albion);
});

test("a line is paid for only on the days it is being built in the period", () => {
  const line = { building: { since: "1940-01-10", days: 30 } };
  assert.equal(buildingDaysIn(line, "1940-01-01", "1940-01-31"), 21);
  assert.equal(buildingDaysIn(line, "1940-02-01", "1940-03-01"), 8);
  assert.equal(buildingDaysIn(line, "1940-03-01", "1940-04-01"), 0);
  assert.equal(buildingDaysIn({ level: 5 }, "1940-01-01", "1940-01-31"), 0, "a line already standing costs nothing");
  const after = withTurnResources([], {
    days: 30,
    toDate: "1940-01-31",
    effort: [{ name: "Aland", advanced: 300, troopDays: 300, warDays: 30 }, { name: "Borea", advanced: 0, troopDays: 300, warDays: 30 }],
    fortifications: [{ owner: "Borea", building: { since: "1940-01-01", days: 400 } }],
    rateOf: (name) => (name === "Aland" ? 1 : 0.5),
  });
  assert.deepEqual(after, [
    { country: "Aland", value: 100 - RESOURCES_ADVANCE_A_MONTH + RESOURCES_REFILL_A_MONTH },
    { country: "Borea", value: Math.round((100 - 30 * RESOURCES_FORTIFY_A_DAY + RESOURCES_REFILL_A_MONTH * 0.5) * 10) / 10 },
  ].filter((entry) => entry.value < 100));
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "supply" });
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" }), ...extra });

test("the run counts each country's days of advance; one that holds advances on none of them", () => {
  const result = runFronts(war({ mechanics: { supply: true } }));
  const of = (name) => result.effort.find((entry) => entry.name === name);
  assert.ok(of("Aland").advanced > 0, "the side told to advance did");
  assert.ok(of("Aland").troopDays >= of("Aland").advanced && of("Aland").warDays > 0 && of("Aland").warDays <= 20);
  assert.ok(of("Aland").advanced / of("Aland").troopDays > of("Borduria").advanced / of("Borduria").troopDays);
  // Off, the run has no such count, and it is the run it always was.
  assert.equal(runFronts(war()).effort, undefined);
  assert.deepEqual(runFronts(war({ mechanics: { supply: true } })).battlefields, runFronts(war()).battlefields);
});

test("a troop that did not advance the day before is a little stronger: holding pays", () => {
  const troop = (still) => ({ strength: 100, fatigue: 0, owner: 0, x: 0, y: 0, ...(still === undefined ? {} : { still }) });
  const battle = { troops: [[troop(true), troop(false)], [troop()]], worth: null, climateToday: null };
  dawn({ mech: readMechanics({ fatigue: true }), steer: {} }, battle, 0);
  const [holder, mover] = battle.troops[0];
  assert.equal(holder.punch, 1 + STILL_EDGE);
  assert.equal(holder.guard, 1 + STILL_EDGE);
  assert.equal(holder.legs, 1, "no faster for it");
  assert.deepEqual([mover.punch, mover.guard, battle.troops[1][0].punch], [1, 1, 1], "one that advanced, or one not yet seen a day, as it was");
  assert.ok(STILL_EDGE > 0 && STILL_EDGE <= 0.1, "a small edge");
  // Without the fatigue mechanic, none.
  const plain = { troops: [[troop(true)], [troop()]], worth: null, climateToday: null };
  dawn({ mech: readMechanics({ supply: true }), steer: {} }, plain, 0);
  assert.equal(plain.troops[0][0].punch, 1);
  // The evening marks it: one that took ground or attacked is not still.
  const evening = { sides: [["Aland"], ["Borduria"]], troops: [[{ ...troop(), walkedToday: true }, { ...troop(), fought: true }, troop()], [troop()]] };
  const run = { mech: readMechanics({ fatigue: true, supply: true }), effort: new Map(), advanceKm: [20, 30, 15], pace: 1 };
  dusk(run, evening, 3);
  assert.deepEqual(evening.troops[0].map((entry) => entry.still), [false, false, true]);
  assert.deepEqual(run.effort.get("aland"), { name: "Aland", advanced: 2, troopDays: 3, warDays: 1, lastDay: 3 });
});

test("a turn refills each country's war resources (advancing spends none), and the next turn's fronts read the shortage", () => {
  const world = {
    wars: [{ id: "w", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
    warResources: [{ country: "Aland", value: 30 }],
    countryStats: {},
  };
  const next = turnWarAndPeace({ world, baseWorld: world, days: 30, date: "1940-01-31", fronts: { effort: [{ name: "Aland", advanced: 300, troopDays: 300, warDays: 30 }] } });
  assert.equal(resourcesOf(next.warResources, "Aland"), 30 - RESOURCES_ADVANCE_A_MONTH + 15, "a month of advancing everywhere costs nothing");
  const front = fs.readFileSync(new URL("../Game/AI/frontTurn.js", import.meta.url), "utf8");
  assert.match(front, /const lacks = resourceShortage\(entry\.value\);/);
  // A blockade this period: what its economy refills is cut (the same world, refilling from 30).
  const quiet = turnWarAndPeace({ world, baseWorld: world, days: 30, date: "1940-01-31", fronts: { effort: [] } });
  const blockaded = turnWarAndPeace({ world, baseWorld: world, days: 30, date: "1940-01-31", fronts: { effort: [], sea: { blockades: [{ country: "Aland", pressure: 1 }] } } });
  assert.equal(resourcesOf(quiet.warResources, "Aland"), 45);
  assert.equal(resourcesOf(blockaded.warResources, "Aland"), 30 + 15 * (1 - RESOURCES_BLOCKADE_CUT));
  // Off, nothing is spent.
  const off = turnWarAndPeace({ world: { ...world, warSettings: { mechanics: { supply: false } } }, baseWorld: world, days: 30, date: "1940-01-31", fronts: { effort: [{ name: "Aland", advanced: 300, troopDays: 300, warDays: 30 }] } });
  assert.deepEqual(off.warResources, world.warResources);
});

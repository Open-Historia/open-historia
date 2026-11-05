/*! Open Historia — how long a fortified line takes to build: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fortifyCost.test.js
//
// "It says how long it will take to build depending on the size, on your
// country resources, manpower, and ... the strength of the fortifications."

import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILD_DAYS_LEAST,
  BUILD_DAYS_MOST,
  DAYS_PER_KM,
  FORTIFY_LEVEL_MOST,
  FORTIFY_LEVEL_USUAL,
  REFERENCE_MEN,
  buildDays,
  buildTimeParts,
  fortifyCostFor,
  fortifyLevelOf,
  fundingOf,
  lineKm,
  manpowerShareOf,
  peopleOf,
} from "./fortifyCost.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";

test("the days go as the length, the square of the level, and against the treasury and the root of the men", () => {
  // A country of middling size with its treasury in order.
  assert.equal(buildDays({ km: 10, level: 3 }), 7, "a 10 km palisade: about a week");
  assert.equal(buildDays({ km: 50, level: 5 }), 100, "a 50 km line of level 5: a little over three months");
  assert.equal(buildDays({ km: 1000, level: 9 }), 6480, "a 1,000 km great wall: some eighteen years");
  assert.equal(buildDays({ km: 50, level: 5 }), Math.round(50 * 25 * DAYS_PER_KM));
  // Twice as long, twice the days; twice as high, four times.
  assert.equal(buildDays({ km: 100, level: 5 }), 2 * buildDays({ km: 50, level: 5 }));
  assert.equal(buildDays({ km: 50, level: 6 }), 4 * buildDays({ km: 50, level: 3 }));
  // A richer treasury and more men build faster; four times the men, twice as fast.
  assert.equal(buildDays({ km: 50, level: 5, funding: 1.25 }), 80);
  assert.equal(buildDays({ km: 50, level: 5, funding: 0.6 }), 167);
  assert.equal(buildDays({ km: 50, level: 5, men: 4 * REFERENCE_MEN }), 50);
  assert.equal(buildDays({ km: 50, level: 5, men: REFERENCE_MEN / 4 }), 200);
  // A great power and a small state.
  assert.equal(buildDays({ km: 50, level: 5, funding: 1.2, men: 140e6 * 0.12 }), 20);
  assert.equal(buildDays({ km: 50, level: 5, funding: 0.9, men: 2e6 * 0.12 }), 227);
});

test("a build time is held between a day and a hundred years, and nothing known counts as the middling country", () => {
  assert.equal(buildDays({ km: 0.1, level: 3 }), BUILD_DAYS_LEAST);
  assert.equal(buildDays({ km: 0, level: 3 }), BUILD_DAYS_LEAST);
  assert.equal(buildDays({ km: 6000, level: 9, funding: 0.6, men: 1000 }), BUILD_DAYS_MOST);
  assert.equal(buildDays({ km: 50, level: 5, funding: 0, men: 0 }), buildDays({ km: 50, level: 5 }));
  assert.equal(buildDays({ km: 50, level: 5, funding: "x", men: -3 }), 100);
  assert.equal(buildDays({ km: "50", level: "5" }), 100);
  // A level is a whole number from 3 to 9: a line nobody passes (10) is a
  // scenario designer's alone, and no country builds one.
  assert.equal(FORTIFY_LEVEL_MOST, 9);
  assert.equal(buildDays({ km: 50, level: 1 }), buildDays({ km: 50, level: 3 }));
  assert.equal(buildDays({ km: 50, level: 10 }), buildDays({ km: 50, level: 9 }));
  assert.equal(buildDays({ km: 50, level: 14 }), buildDays({ km: 50, level: 9 }));
  assert.deepEqual([fortifyLevelOf(2), fortifyLevelOf(6.4), fortifyLevelOf(10), fortifyLevelOf(11), fortifyLevelOf("nonsense")], [3, 6, 9, 9, FORTIFY_LEVEL_USUAL]);
});

test("a line is measured as the engine measures it, along the globe", () => {
  // A degree of latitude is some 111 km.
  assert.ok(Math.abs(lineKm([[10, 50], [10, 51]]) - 111.2) < 0.5);
  assert.ok(Math.abs(lineKm([[10, 50], [10, 50.5], [10, 51]]) - 111.2) < 0.5, "however many points it is drawn with");
  assert.equal(lineKm([[10, 50]]), 0);
  assert.equal(lineKm(null), 0);
  assert.equal(lineKm([[10, 50], ["x", 2], [10, 51]]), 0, "a stretch to a point that is no point is not counted");
});

test("a country's treasury, its people and its share of them fit to serve are read as the land war reads them", () => {
  const sheets = {
    Aland: { population: { total: 20000000 }, economy: { gdp: 4e11 } },
    Borduria: { population: { total: 5000000 }, economy: { gdp: 2e10 } },
    Syldavia: { population: { total: 8000000 }, economy: { gdp: 1e11 } },
  };
  const world = {
    countryStats: sheets,
    polityOverrides: { Ruritania: { name: "Kingdom of Ruritania", population: "3.5 million" } },
    groups: { "Free Company": { population: 12000 } },
    warSettings: { manpowerShare: 20 },
  };
  assert.equal(peopleOf(world, " aland "), 20000000);
  assert.equal(peopleOf(world, "Kingdom of Ruritania"), 3500000, "the figure the scenario's author gave it, by any name it goes by");
  assert.equal(peopleOf(world, "free company"), 12000, "or its group");
  assert.equal(peopleOf(world, "Neutralia"), 0);
  assert.equal(manpowerShareOf(world, "Aland"), 0.2, "the scenario's share");
  assert.equal(manpowerShareOf({}, "Aland"), MANPOWER_SHARE, "else the game's own");
  const drafted = { ...world, countryStats: { ...sheets, Aland: { ...sheets.Aland, military: { manpowerShare: 5 } } } };
  assert.equal(manpowerShareOf(drafted, "Aland"), 0.05, "a country's own figure, where the scenario weighs them");
  assert.equal(manpowerShareOf({ ...drafted, warSettings: { mechanics: { military: false }, manpowerShare: 20 } }, "Aland"), 0.2, "and not where it does not");
  // The best funded a head builds fastest; one with no economy known is as it is.
  assert.ok(fundingOf(world, "Aland") > 1 && fundingOf(world, "Borduria") < 1);
  assert.equal(fundingOf(world, "Neutralia"), 1);
});

test("what a line would take a country: its length, level, treasury and men, and the days they come to", () => {
  const world = { countryStats: { Aland: { population: { total: 8000000 } } } };
  const line = [[10, 50], [10, 50.45]];
  const cost = fortifyCostFor(world, "Aland", line, 5);
  assert.deepEqual([cost.km, cost.level, cost.funding, cost.people, cost.men], [50, 5, 1, 8000000, 960000]);
  assert.equal(cost.days, buildDays({ km: lineKm(line), level: 5, funding: 1, men: 960000 }));
  assert.ok(cost.days > 95 && cost.days < 110);
  // Nothing known of a country: the middling one.
  const unknown = fortifyCostFor({}, "Nowhere", line, 12);
  assert.deepEqual([unknown.level, unknown.people, unknown.men], [9, 0, 0]);
  assert.equal(unknown.days, buildDays({ km: lineKm(line), level: 9 }));
});

test("a build time is said in days, weeks, months or years", () => {
  assert.deepEqual(buildTimeParts(1), { count: 1, unit: "day" });
  assert.deepEqual(buildTimeParts(7), { count: 7, unit: "day" });
  assert.deepEqual(buildTimeParts(13), { count: 13, unit: "day" });
  assert.deepEqual(buildTimeParts(14), { count: 2, unit: "week" });
  assert.deepEqual(buildTimeParts(60), { count: 9, unit: "week" });
  assert.deepEqual(buildTimeParts(100), { count: 3, unit: "month" });
  assert.deepEqual(buildTimeParts(729), { count: 24, unit: "month" });
  assert.deepEqual(buildTimeParts(8000), { count: 22, unit: "year" });
  assert.deepEqual(buildTimeParts(0), { count: 1, unit: "day" });
});

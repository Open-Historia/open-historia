/*! Open Historia — fortified lines a country orders built in the war room: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/fortifyOps.test.js
//
// A line drawn in the war room is built for the asking country only, on its
// own territory and nowhere past it, at a level of 3 to 9 (a line nobody
// passes is the scenario designer's alone), and stands only once the days its
// length, level, treasury and manpower take have passed.

import test from "node:test";
import assert from "node:assert/strict";

import { addGameDays } from "../gameDates.js";
import { fortifyCostFor } from "../fortifyCost.js";
import { FORTIFICATIONS_MOST } from "../warGeography.js";
import { regionLocatorOf } from "../regionLocator.js";
import { chartOf } from "../warRoomChart.js";
import { FORTIFY_BUILDING_MOST, FORTIFY_KM_MOST, FORTIFY_OPS, FORTIFY_POINTS_MOST, applyFortifyOp, cleanFortifyOp, fortifyLineOf } from "./fortifyOps.js";
import { syntheticMap } from "./syntheticMap.js";
import { standsOn } from "./walls.js";
import { buildWorldGrid } from "./worldGrid.js";

// Aland in the west with a lake inside it, Borduria in the east, the sea between.
const map = syntheticMap({
  layout: ["AAAA~~~BBBBB", "A~AA~~~BBBBB", "AAAA~~~BBBBB", "AAAABBBBBBBB"],
  legend: { A: "Aland", B: "Borduria", "~": null },
  west: 0,
  north: 54,
  step: 1,
  key: "the fortified coast",
});
// (Whose a place is, read from the regions' own shapes, as the game reads it.)
const chart = chartOf({ grid: buildWorldGrid(map.regions, { step: 0.5 }), controllerOf: map.controllerOf, locate: regionLocatorOf(map.regions) });
const world = (extra = {}) => ({
  countryStats: { Aland: { population: { total: 8000000 } }, Borduria: { population: { total: 30000000 } } },
  fortifications: [{ id: "old-wall", name: "The Old Wall", owner: "Borduria", level: 7, points: [[9, 53], [9, 51]] }],
  ...extra,
});
const DATE = "1914-08-01";
const as = (player, extra = {}) => ({ player, date: DATE, chart, ...extra });
// Along Aland's northern land, some 130 km.
const NORTH = [[0.5, 53.5], [1.5, 53.6], [2.5, 53.5]];

test("a line is built for the country that asks, on its own ground, as long as its length, level and country take", () => {
  const done = applyFortifyOp(world(), { op: "fortify", points: NORTH, level: 5, name: "  The  Northern Line " }, as("Aland"));
  assert.equal(done.error, undefined);
  const lines = done.world.fortifications;
  assert.equal(lines.length, 2, "beside the lines there were");
  assert.equal(lines[0].id, "old-wall");
  const built = lines[1];
  assert.deepEqual(
    [built.id, built.name, built.owner, built.level, built.points, built.breaches, built.wear],
    ["built-1", "The Northern Line", "Aland", 5, NORTH, [], []],
  );
  // Being built from the game's date, for the days the war room said it would take.
  const cost = fortifyCostFor(world(), "Aland", NORTH, 5);
  assert.deepEqual(built.building, { since: DATE, days: cost.days });
  assert.equal(done.days, cost.days);
  assert.ok(cost.days > 200 && cost.days < 320, `about a hundred and thirty km of level 5: ${cost.days} days`);
  // It is no wall until it is finished (the engine's own rule), and one after.
  assert.equal(standsOn(built, DATE), false);
  assert.equal(standsOn(built, addGameDays(DATE, cost.days - 1)), false);
  assert.equal(standsOn(built, addGameDays(DATE, cost.days)), true);
  // A second is the next of its own.
  const again = applyFortifyOp(done.world, { op: "fortify", points: [[0.5, 50.5], [3.5, 50.5]], level: 3 }, as("Aland"));
  assert.equal(again.line.id, "built-2");
  assert.equal(again.line.name, "");
  // The stronger the line, the longer; the bigger the country, the shorter.
  const strong = applyFortifyOp(world(), { op: "fortify", points: NORTH, level: 9 }, as("Aland"));
  assert.equal(strong.days, fortifyCostFor(world(), "Aland", NORTH, 9).days);
  assert.ok(Math.abs(strong.days / cost.days - 81 / 25) < 0.02, "the days go as the square of the level");
  const bigger = applyFortifyOp(world(), { op: "fortify", points: [[8.5, 53.5], [10.5, 53.5]], level: 5 }, as("Borduria"));
  assert.ok(bigger.days < fortifyCostFor(world(), "Aland", [[8.5, 53.5], [10.5, 53.5]], 5).days);
});

test("a line is the asker's own, on the asker's own ground: another country's, or another's land, is refused", () => {
  const refused = (op, who = "Aland", extra = {}) => applyFortifyOp(world(), { op: "fortify", points: NORTH, level: 5, ...op }, as(who, extra)).error;
  assert.match(refused({ owner: "Borduria" }), /your own country/, "a line for another country");
  assert.equal(refused({ owner: " aland " }), undefined, "its own name, however written, is its own");
  assert.match(refused({ points: [[8.5, 53.5], [10.5, 53.5]] }), /ground you hold/, "a line through Borduria");
  assert.match(refused({ points: [[2.5, 53.5], [9.5, 53.5]] }), /ground you hold/, "or partly through it");
  assert.match(refused({}, ""), /no country/);
  // Water is crossed (a lake, a strait); a line only over water is no line.
  assert.equal(refused({ points: [[0.5, 52.5], [3.5, 52.5]] }), undefined, "across the lake");
  assert.match(refused({ points: [[4.5, 53.5], [6.5, 53.5]] }), /only over water/);
  // Only on its own territory: a line drawn up to the border is built, and one
  // that strays over it, however little, is not.
  assert.equal(refused({ points: [[3.5, 50.5], [3.97, 50.5]] }), undefined);
  assert.match(refused({ points: [[3.5, 50.5], [4.03, 50.5]] }), /ground you hold/);
  // The map could not be read: nothing is built on ground nobody could see.
  assert.match(refused({}, "Aland", { chart: null }), /could not be read/);
});

test("a level is held to 3 to 9, and a line must be one", () => {
  const level = (asked) => applyFortifyOp(world(), { op: "fortify", points: NORTH, level: asked }, as("Aland"));
  // A line nobody passes is the scenario designer's alone: asked for, it is built at 9.
  assert.equal(level(10).line.level, 9);
  assert.equal(level(14).line.level, 9);
  assert.equal(level(1).line.level, 3);
  assert.equal(level(0).line.level, 3);
  assert.equal(level(6.6).line.level, 7);
  assert.equal(level("8").line.level, 8);
  assert.match(level("strong").error, /how strong/);
  assert.match(level(undefined).error, /how strong/);
  assert.match(level(null).error, /how strong/);
  const refused = (points) => applyFortifyOp(world(), { op: "fortify", points, level: 5 }, as("Aland")).error;
  assert.match(refused([[0.5, 53.5]]), /Draw the line/);
  assert.match(refused([[0.5, 53.5], [0.5, 53.5]]), /Draw the line/, "the same point twice is a point");
  assert.match(refused([["a", 1], [2, "b"]]), /Draw the line/);
  assert.match(refused([[0.5, 53.5], [0.505, 53.5]]), /too short/);
  assert.ok(FORTIFY_KM_MOST >= 5000, "a great wall can be drawn");
  assert.match(refused([[0.5, 53.5], [120, 53.5]]), /too long/);
});

test("a line is built to the game's calendar, under the scenario's rules, and only so many at once", () => {
  const refused = (op, extra = {}, base = world()) => applyFortifyOp(base, { op: "fortify", points: NORTH, level: 5, ...op }, as("Aland", extra)).error;
  assert.match(refused({}, { date: "Year 12 of the Long Night" }), /cannot be counted in days/);
  assert.match(refused({}, {}, world({ warSettings: { mechanics: { walls: false } } })), /no part of this scenario/);
  assert.equal(refused({}, {}, world({ warSettings: { mechanics: { walls: true } } })), undefined);
  // As many being built as a country may have: the next waits.
  let full = world();
  for (let index = 0; index < FORTIFY_BUILDING_MOST; index += 1) full = applyFortifyOp(full, { op: "fortify", points: [[0.5, 53.4 - index * 0.2], [3.4, 53.4 - index * 0.2]], level: 3 }, as("Aland")).world;
  assert.match(refused({}, {}, full), /as many lines being built/);
  assert.equal(applyFortifyOp(full, { op: "fortify", points: [[8.5, 53.5], [10.5, 53.5]], level: 3 }, as("Borduria")).error, undefined, "another country's are its own");
  // Once one is finished, another can be begun.
  const later = applyFortifyOp(full, { op: "fortify", points: NORTH, level: 5 }, as("Aland", { date: "1960-01-01" }));
  assert.equal(later.error, undefined);
  // The map holds so many lines and no more.
  const crowded = world({ fortifications: Array.from({ length: FORTIFICATIONS_MOST }, (_, index) => ({ id: `w${index}`, owner: "Borduria", level: 5, points: [[9, 50 + index * 0.01], [10, 50 + index * 0.01]] })) });
  assert.match(refused({}, {}, crowded), /no room on the map/);
});

test("a line still being built can be given up by its own country, and only then", () => {
  const begun = applyFortifyOp(world(), { op: "fortify", points: NORTH, level: 5 }, as("Aland"));
  const id = begun.line.id;
  assert.match(applyFortifyOp(begun.world, { op: "unfortify", id }, as("Borduria")).error, /not one of yours/);
  assert.match(applyFortifyOp(begun.world, { op: "unfortify", id: "old-wall" }, as("Borduria")).error, /not one of yours/, "a line that stands is no longer being built");
  assert.match(applyFortifyOp(begun.world, { op: "unfortify", id }, as("Aland", { date: addGameDays(DATE, begun.days) })).error, /not one of yours/, "nor is one that is finished");
  const given = applyFortifyOp(begun.world, { op: "unfortify", id }, as("Aland"));
  assert.equal(given.error, undefined);
  assert.deepEqual(given.world.fortifications.map((line) => line.id), ["old-wall"]);
  assert.equal(given.line.id, id);
});

test("an op is cut to its own fields and sizes before it crosses the wire", () => {
  assert.deepEqual(FORTIFY_OPS, ["fortify", "unfortify"]);
  assert.equal(cleanFortifyOp(null), null);
  assert.equal(cleanFortifyOp({ op: "wall" }), null);
  assert.deepEqual(cleanFortifyOp({ op: "fortify", points: [[1.123456789, 2], [3, "4"], ["x", 1]], level: "6", name: "  A   line ", owner: "Aland", extra: true }), {
    op: "fortify", points: [[1.12346, 2], [3, 4]], level: 6, name: "A line", owner: "Aland",
  });
  assert.deepEqual(cleanFortifyOp({ op: "fortify", points: NORTH, level: "x" }), { op: "fortify", points: NORTH }, "no level that is not a number");
  assert.deepEqual(cleanFortifyOp({ op: "unfortify", id: "built-3", points: NORTH }), { op: "unfortify", id: "built-3" });
  assert.equal(JSON.stringify(cleanFortifyOp({ op: "fortify", points: [[NaN, 1], [1, Infinity]], level: NaN })).includes("null"), false, "nothing that is no number");
  // A drawing of very many points is thinned from end to end, never cut short.
  const long = Array.from({ length: 1000 }, (_, index) => [index / 1000, 53.5]);
  const thinned = fortifyLineOf(long);
  assert.equal(thinned.length, FORTIFY_POINTS_MOST);
  assert.deepEqual([thinned[0], thinned.at(-1)], [[0, 53.5], [0.999, 53.5]]);
  assert.equal(cleanFortifyOp({ op: "fortify", points: long, level: 5 }).points.length, FORTIFY_POINTS_MOST);
});

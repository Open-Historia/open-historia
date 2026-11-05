/*! Open Historia — battlefields and fronts: a war's levies come in over weeks: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/muster.test.js

import test from "node:test";
import { MUSTER_STANDING_SHARE } from "./constants.js";
import assert from "node:assert/strict";

import { DEFAULT_MUSTER, fitMuster, musterCurvePoints, musterDays, musterTable } from "../mustering.js";
import { describeBattlefield } from "./brief.js";
import { runFronts } from "./engine.js";
import { spreadPick } from "./muster.js";
import { normalizeBattlefield } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

test("a mustering curve goes through (0, 0) and the designer's two points, and its table never falls", () => {
  for (const points of [DEFAULT_MUSTER, [[0.25, 10], [0.75, 120]], [[0.5, 30], [1, 40]], [[0.5, 10], [1, 20]]]) {
    const curve = fitMuster(points);
    assert.ok(Math.abs(musterDays(curve, points[0][0]) - points[0][1]) < 1e-6, JSON.stringify(points));
    assert.ok(Math.abs(musterDays(curve, points[1][0]) - points[1][1]) < 1e-6, JSON.stringify(points));
    assert.equal(musterDays(curve, 0), 0);
    const table = musterTable(points);
    assert.equal(table[0], 0);
    assert.equal(table.at(-1), 1);
    for (let day = 1; day < table.length; day += 1) assert.ok(table[day] >= table[day - 1]);
  }
  // The game's own: half in three weeks, all in three months; the first levies come quickly, the last slowly.
  const table = musterTable(DEFAULT_MUSTER);
  assert.equal(table[21], 0.5);
  assert.equal(table.length, 91);
  assert.ok(table[7] - table[0] > table[90] - table[83], "the first week brings more than the last");
  assert.equal(fitMuster([[0.5, 10], [1, 20]]).B, 0, "two points on a straight line are a straight line");
  // What the chart draws.
  const drawn = musterCurvePoints(DEFAULT_MUSTER, 4);
  assert.deepEqual(drawn[0], [0, 0]);
  assert.deepEqual(drawn[2], [21, 0.5]);
  assert.deepEqual(drawn[4], [90, 1]);
  // Spread along the line, not bunched at one end.
  assert.deepEqual(spreadPick(10, 3), [3, 6, 9]);
  assert.deepEqual(spreadPick(4, 0), []);
  assert.deepEqual(spreadPick(4, 4), [0, 1, 2, 3]);
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "muster" });
const curve = { table: musterTable(DEFAULT_MUSTER), head: DEFAULT_MUSTER[0][1] };
// A war Aland began on the day the run begins, two months into the game.
const war = (extra = {}) => frontInput(sheet(), {
  arenas: new Map(), troops: 1, days: 30, strengthOf: () => 4,
  wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-03-01" }],
  gameBegan: "2024-01-01",
  mechanics: { muster: true },
  musterOf: () => curve,
  ...extra,
});
// The live troops of each side on each day of a run, by name.
// (Nobody is ordered to attack, so nobody is lost: what is on the line is what has come in.)
const countsByDay = (input) => {
  const days = [];
  const result = runFronts({ ...input, staff: false, watch: (seen) => { days[seen.day] = seen.troops.map((list) => list.filter((troop) => troop.strength > 0).length); } });
  const names = result.battlefields[0].sides.map((members) => members[0]);
  const at = (name) => names.indexOf(name);
  return { days, aland: (day) => days[day][at("Aland")], borduria: (day) => days[day][at("Borduria")], result };
};

test("a war's levies come in over weeks: the side that began it first, part-mustered; the other from its peacetime army", () => {
  const full = countsByDay(war({ mechanics: {} }));
  const mustered = countsByDay(war());
  // Without mustering, both sides are all there from the first day (the first the run hands on is its first evening).
  const fullAland = full.aland(1);
  const fullBorduria = full.borduria(1);
  // With it, Borduria (attacked) has little more than its peacetime army (a quarter: constants.js
  // MUSTER_STANDING_SHARE), and Aland (which began it) that and half the rest, the first point of its curve.
  assert.ok(mustered.borduria(1) < fullBorduria / 3, `${mustered.borduria(1)} of ${fullBorduria}`);
  assert.ok(mustered.borduria(1) >= Math.floor(fullBorduria * MUSTER_STANDING_SHARE), `${mustered.borduria(1)} of ${fullBorduria}: never from nothing`);
  assert.ok(Math.abs(mustered.aland(1) - Math.floor(fullAland * (MUSTER_STANDING_SHARE + (1 - MUSTER_STANDING_SHARE) / 2))) <= 1, `${mustered.aland(1)} of ${fullAland}`);
  // A month later both have come in further: Borduria more than half, as its curve says.
  assert.ok(mustered.borduria(30) > fullBorduria / 2, `${mustered.borduria(30)} of ${fullBorduria}`);
  assert.ok(mustered.borduria(30) > mustered.borduria(7) && mustered.borduria(7) > mustered.borduria(1));
  // Charged to their people as they came: less drawn by mustered armies than by armies all there at once.
  const drawn = (result, name) => result.manpower.find((entry) => entry.name === name)?.drawn ?? 0;
  const people = (input) => ({ ...input, peopleOf: () => 4e7 });
  const fullMen = runFronts(people(war({ mechanics: {}, days: 1 })));
  const musteredMen = runFronts(people(war({ days: 1 })));
  assert.ok(drawn(musteredMen, "Borduria") < drawn(fullMen, "Borduria") / 3, `${drawn(musteredMen, "Borduria")} against ${drawn(fullMen, "Borduria")}`);
  // The story is told that more are still coming.
  assert.match(describeBattlefield(musteredMen.battlefields[0]), /more still mustering/);
});

test("what is still owed is kept with the battlefield and keeps coming in the next run; the other side does not see it", () => {
  const first = runFronts(war({ days: 10, staff: true }));
  const [record] = first.battlefields;
  const levy = record.brief.carry.levy;
  assert.ok(Array.isArray(levy) && levy.some((list) => list.length > 0), JSON.stringify(levy));
  const kept = normalizeBattlefield(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(kept.brief.carry.levy, levy, "a save keeps it");
  const next = countsByDay(war({ battlefields: [kept], fromDate: record.asOf, days: 20 }));
  const sideB = record.sides.findIndex((members) => members[0] === "Borduria");
  const before = record.troops[sideB].length / 7;
  assert.ok(next.borduria(20) > before, `${next.borduria(20)} after ${before}`);
});

test("a war under way when the game began has its armies, as does one with mustering off", () => {
  const plain = runFronts(war({ mechanics: {}, days: 5 }));
  const underWay = runFronts(war({ days: 5, wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2023-11-01" }] }));
  assert.deepEqual(underWay.battlefields[0].troops, plain.battlefields[0].troops);
  const scenario = runFronts(war({ days: 5, gameBegan: "" }));
  assert.deepEqual(scenario.battlefields[0].troops, plain.battlefields[0].troops, "no game start: nothing to muster against");
});

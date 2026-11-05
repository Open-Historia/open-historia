/*! Open Historia — battlefields and fronts: an engineer for the countries nobody plays: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/engineer.test.js
//
// "Make it also be able to control and understand fortifications" (the owner, 2026-10-14).

import test from "node:test";
import assert from "node:assert/strict";

import { ENGINEER_DAYS_MOST, ENGINEER_LEVEL_MOST, engineerLines, frontLineFor } from "./engineer.js";
import { runFronts } from "./engine.js";
import { holderAt } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: Array.from({ length: 8 }, () => "AAAAAAAABBBBBBBB"), legend, west: 20, north: 54, step: 0.5, stepLat: 0.4, key: "engineer" });
// Aland, three times the stronger, at war with Borduria for a fortnight.
const fought = () => runFronts(frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 14, strengthOf: (name) => (name === "Aland" ? 6 : 2) }));
// Whose the ground is, as a war room's chart says it: here, the battlefield's own.
const chartOf = (record) => ({
  holds: (owner, lng, lat) => {
    const side = record.sides.findIndex((members) => members.includes(owner));
    const holder = holderAt(record, lng, lat);
    return holder === 0 || holder === 1 ? holder === side : null;
  },
});

test("the side outmatched on a battlefield has a line built behind its front, on its own ground, once", () => {
  const { battlefields } = fought();
  const [record] = battlefields;
  const borduria = record.sides.findIndex((members) => members[0] === "Borduria");
  const world = { battlefields, fortifications: [], countryStats: { Aland: { population: { total: 6e7 } }, Borduria: { population: { total: 2e7 } } } };
  const chart = chartOf(record);
  const { world: built, built: told } = engineerLines(world, { date: "2024-03-15", chart });
  assert.equal(told.length, 1, JSON.stringify(told));
  const [entry] = told;
  assert.equal(entry.owner, "Borduria");
  assert.ok(entry.level >= 3 && entry.level <= ENGINEER_LEVEL_MOST, String(entry.level));
  assert.ok(entry.days <= ENGINEER_DAYS_MOST && entry.km > 20, JSON.stringify(entry));
  const [line] = built.fortifications;
  assert.equal(line.owner, "Borduria");
  assert.deepEqual(line.building.since, "2024-03-15");
  assert.match(line.name, /Borduria line before/);
  // Behind its own front, every point of it on its own ground.
  for (const [lng, lat] of line.points) assert.equal(holderAt(record, lng, lat), borduria, `${lng},${lat}`);
  const along = frontLineFor(record, borduria);
  assert.ok(line.points.every(([lng, lat]) => along.some(([x, y]) => x === lng && y === lat)), "on the line behind its front");
  // Once: while it is being built, no other.
  assert.deepEqual(engineerLines(built, { date: "2024-03-20", chart }).built, []);
  // The stronger side builds none, and a side a person plays is that person's.
  assert.deepEqual(engineerLines(world, { date: "2024-03-15", chart, players: ["Borduria"] }).built, []);
  // Nor without a chart to tell whose the ground is.
  assert.deepEqual(engineerLines(world, { date: "2024-03-15", chart: null }).built, []);
});

// Run: node --test src/Game/AI/warParts.test.js
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// "in features rename the fronts section to wars and make it so you can toggle
// fronts, air troops, and navies for a scenario" (the owner, 2026-11-01). The
// Wars feature (key "fronts") has a switch for each part; what is off is not
// raised, not flown or sailed, not carried, and the skip is told so.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applyUnitOpBatch, normalizeEvents } from "../../runtime/gameState.js";
import { setActiveFeatures } from "../../runtime/gameFeatures.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { airOn, frontsOn, naviesOn, warPartsOffBlock } from "./frontsGate.js";
import { runTurnFronts } from "./frontTurn.js";
import { decodeFrontOrders } from "./nativeFrontLedger.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const spawn = (id, type) => ({ op: "spawn", unit: { id, name: id, type, ownerCode: "Aland", strength: 80, lng: 21, lat: 52 } });
const spawned = (ops) => applyUnitOpBatch([], [], ops, { gameDate: "2024-03-01" }).units.map((unit) => unit.type).sort();

test("with every part on nothing changes: all three on, no [Wars] block", () => {
  setActiveFeatures(null, null);
  assert.deepEqual([frontsOn(), airOn(), naviesOn()], [true, true, true]);
  assert.equal(warPartsOffBlock(), "", "the prompt is what it always was");
  assert.deepEqual(spawned([spawn("a", "air"), spawn("n", "naval"), spawn("i", "infantry")]), ["air", "infantry", "naval"]);
});

test("air units and navies off: no air unit or fleet is raised, and the skip is told so", () => {
  try {
    setActiveFeatures({ fronts: { air: false, navies: false } }, null);
    assert.deepEqual(spawned([spawn("a", "air"), spawn("n", "naval"), spawn("i", "infantry")]), ["infantry"]);
    const block = warPartsOffBlock();
    assert.match(block, /^\[Wars\]\nThis scenario's wars are fought without air units and navies\. Raise, move or fight no aircraft or fleets/);
    assert.doesNotMatch(block, /at sea/);
    setActiveFeatures({ fronts: { navies: false } }, null);
    assert.deepEqual(spawned([spawn("a", "air"), spawn("n", "naval")]), ["air"]);
    assert.match(warPartsOffBlock(), /without navies\. Raise, move or fight no fleets/);
  } finally {
    setActiveFeatures(null, null);
  }
});

test("the skip's prompt carries the block after [Fronts], and the turn's run is given the switches", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /if \(fronts\) blocks\.push\(fronts\);\n\s*\/\/ What its wars are fought without[^\n]*\n\s*const warParts = warPartsOffBlock\(\);\n\s*if \(warParts\) blocks\.push\(warParts\);/);
  const apply = read("./frontApply.js");
  assert.match(apply, /mechanics: airOn\(\) \? warSettingsOf\(world\)\.mechanics : \{ \.\.\.warSettingsOf\(world\)\.mechanics, air: false \},/);
  assert.match(apply, /naval: naviesOn\(\),\n\s*air: airOn\(\),/);
});

// Aland and Borduria across the water, at war.
const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [{ name: "Alba", lng: 23.5, lat: 51.5, capital: true }, { name: "Port", lng: 28.4, lat: 51.5 }, { name: "Brod", lng: 30.5, lat: 51.5, capital: true }];
const map = syntheticMap({ layout: ["~~~~~~~~~~~~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~~~~~~~~~~~~"], legend, west: 20, north: 54, step: 1, cities, key: "war parts" });
const WAR = { id: "war-1", title: "The War Across the Water", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const world = {
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria") },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [WAR], battlefields: [], transports: [], units: [],
};
const run = (extra) => runTurnFronts({
  createFrontRun,
  world,
  events: normalizeEvents([{ id: "e1", date: "2024-03-04", title: "War", description: "The war goes on across the water.", warId: "war-1", source: "ai", impacts: {} }]),
  frontOrders: decodeFrontOrders("Operation Tide~Aland~ship~~1~city: Port\nOperation Sky~Borduria~airlift~~1~city: Alba\nThe Reserve~Aland~rail~~1~city: Alba"),
  warStages: [world.wars],
  map: { key: "war parts", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  fromDate: "2024-03-01",
  toDate: "2024-03-11",
  seed: "campaign|2|2024-03-01",
  ...extra,
});

test("nothing is shipped with navies off, and nothing airlifted with air units off; by rail still", async () => {
  const all = await run({});
  assert.deepEqual(all.transports.map((entry) => entry.medium).sort(), ["air", "land", "sea"]);
  const without = await run({ naval: false, air: false });
  assert.deepEqual(without.transports.map((entry) => entry.medium), ["land"]);
});

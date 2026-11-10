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
import { airOn, frontsOn, naviesOn, transportMediaOn, warPartsOffBlock } from "./frontsGate.js";
import { FRONT_ORDER_LINES_BLOCK, frontOrderLinesBlock } from "./frontPrompt.js";
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

// "make different transport types disableable in features" (the owner, 2026-11-09): rail, sea and air each have a
// switch under Wars. Off, nothing is sent that way, and the skip is not told it exists.
test("each transport has its switch: what may carry troops, what the turn sends, and what the skip is told", async () => {
  try {
    setActiveFeatures(null, null);
    assert.deepEqual(transportMediaOn(), ["sea", "land", "air"]);
    assert.equal(frontOrderLinesBlock(transportMediaOn()), FRONT_ORDER_LINES_BLOCK, "with all of them on the prompt is what it always was");
    setActiveFeatures({ fronts: { airTransport: false } }, null);
    assert.deepEqual(transportMediaOn(), ["sea", "land"]);
    setActiveFeatures({ fronts: { railTransport: false } }, { fronts: { seaTransport: false } });
    assert.deepEqual(transportMediaOn(), ["air"], "a game's own over its scenario's");
    setActiveFeatures({ fronts: { navies: false, air: false } }, null);
    assert.deepEqual(transportMediaOn(), ["land"], "nothing by sea without navies, nor by air without air units");
  } finally {
    setActiveFeatures(null, null);
  }
  // The order lines tell only what is on.
  assert.match(FRONT_ORDER_LINES_BLOCK, /- ship \| rail \| airlift send a TRANSPORTER: /);
  assert.match(FRONT_ORDER_LINES_BLOCK, /an airlift far fewer/);
  const railOnly = frontOrderLinesBlock(["land"]);
  assert.match(railOnly, /- rail send a TRANSPORTER: /);
  assert.doesNotMatch(railOnly, /airlift|ship|aircraft/);
  assert.match(railOnly, /\nNAME~A~rail~~3~city: X~~~troop trains~10~800\n/);
  const none = frontOrderLinesBlock([]);
  assert.doesNotMatch(none, /TRANSPORTER|airlift|~ship~|~rail~/);
  // And where the skip's prompt and the turn's run read it.
  assert.match(read("./gameplay.js"), /frontsOn\(\) \? frontOrderLinesBlock\(transportMediaOn\(\)\) : "",/);
  const apply = read("./frontApply.js");
  assert.match(apply, /transportMedia: transportMediaOn\(\),/);
  assert.match(apply, /orderLines, transportMedia: transportMediaOn\(\) \}\)/);

  // A line of orders for a transport that is off is not sent, and what the war room ordered that way is refused.
  const only = await run({ transportMedia: ["sea"] });
  assert.deepEqual(only.transports.map((entry) => entry.medium), ["sea"]);
  const flown = { id: "t7", medium: "air", owner: "Aland", kind: "transport aircraft", to: { lng: 30.5, lat: 51.5, name: "city: Brod" }, speed: 15000, capacity: 2, raise: 2, status: "ordered", by: "Aland" };
  const refused = await run({ world: { ...world, transports: [flown] }, transportMedia: ["sea", "land"] });
  assert.ok(refused.voyages.some((voyage) => voyage.id === "t7" && voyage.k === "refused" && voyage.why === "switched-off"), JSON.stringify(refused.voyages));
});

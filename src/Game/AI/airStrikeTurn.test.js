// Run: node --test src/Game/AI/airStrikeTurn.test.js
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// The war room's air strikes in a turn (runtime/fronts/airStrike.js): flown as
// the period begins, in the run made before the story and the one that applies
// it alike; their bombs on the battlefields' troops; and what they did written
// into the world (frontApply.js withAirStrikes). Told to the story by name.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvents } from "../../runtime/gameState.js";
import { setActiveFeatures } from "../../runtime/gameFeatures.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { airStrikesLiveBlock, withAirStrikes } from "./frontApply.js";
import { runTurnFronts } from "./frontTurn.js";

const legend = { A: "Aland", B: "Borduria" };
const cities = [{ name: "Alba", lng: 21, lat: 51.2, capital: true }, { name: "Brod", lng: 27, lat: 51.2, capital: true }];
const map = syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities, key: "air turn" });
const WAR = { id: "war-1", title: "The War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const bombers = (id, extra = {}) => ({ id, name: `Bomber Wing ${id}`, type: "air", ownerCode: "Aland", strength: 100, lng: 21, lat: 51, status: "idle", ...extra });
const base = {
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria") },
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 1e6 }, economy: { gdp: 1e9, gdpPerCapita: 1000 } } },
  wars: [WAR], battlefields: [], transports: [], units: [],
  markers: [{ id: "m1", name: "Fort Brod", kind: "fort", ownerCode: "Borduria", lng: 26.5, lat: 51, status: "active" }],
};
const run = (world, extra = {}) => runTurnFronts({
  createFrontRun,
  world,
  events: normalizeEvents([{ id: "e1", date: "2024-03-04", title: "War", description: "The war goes on.", warId: "war-1", source: "ai", impacts: {} }]),
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "air turn", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  fromDate: "2024-03-01",
  toDate: "2024-03-11",
  seed: "campaign|2|2024-03-01",
  ...extra,
});

// A battlefield open between them, and where one of Borduria's troops stands on it.
const opened = async () => {
  const first = await run(base);
  const record = first.battlefields.find((entry) => entry.status === "active");
  const at = projectorOf(record.frame);
  const side = record.sides.findIndex((members) => members.includes("Borduria"));
  const troop = decodeTroops(record.troops[side]).find((entry) => entry.strength > 0);
  return { record, battlefields: first.battlefields, place: at.toLngLat(troop.x, troop.y) };
};

test("a turn flies the strikes waiting: its bombs hit the troops under them, the structure struck is damaged, the air units are worn", async () => {
  const { record, battlefields, place } = await opened();
  const world = {
    ...base,
    battlefields,
    units: [bombers("b1"), bombers("b2")],
    airStrikeOrders: [
      { id: "s1", unit: "b1", owner: "Aland", kind: "troops", lng: place[0], lat: place[1], target: "the line", country: "Borduria", battlefield: record.name },
      { id: "s2", unit: "b2", owner: "Aland", kind: "structure", lng: 26.5, lat: 51, target: "Fort Brod", country: "Borduria", marker: "m1" },
    ],
  };
  const turn = await run(world);
  assert.deepEqual(turn.airStrikes.map((strike) => [strike.kind, strike.outcome]), [["troops", "unopposed"], ["structure", "unopposed"]]);
  const [onTroops, onFort] = turn.airStrikes;
  assert.ok(onTroops.hits.some((hit) => hit.country === "Borduria" && hit.n > 0 && hit.lost > 0), JSON.stringify(onTroops.hits));
  assert.equal(onFort.status, "destroyed", "a full wing of bombers unopposed");
  // The air units come back worn by the flak, and the land war begins with them so.
  for (const id of ["b1", "b2"]) {
    const change = turn.unitChanges.find((entry) => entry.unitId === id);
    assert.ok(change && change.strength < 100, `${id}: ${JSON.stringify(change)}`);
  }
  // The same turn is the same war, strike for strike.
  assert.deepEqual((await run(world)).airStrikes, turn.airStrikes);
  // The story is told it, by name.
  const block = airStrikesLiveBlock({ airStrikes: turn.airStrikes });
  assert.match(block, /Aland's Bomber Wing b1 struck Borduria's troops on .* near the line/);
  assert.match(block, /Aland's Bomber Wing b2 struck Borduria's Fort Brod; nobody rose against it and it bombed unopposed; .*it was destroyed/);

  // What it did is written into the world: kept, the orders cleared, the structure destroyed.
  const after = withAirStrikes(world, turn, { round: 3, date: "2024-03-01" });
  assert.deepEqual(after.airStrikeOrders, []);
  assert.deepEqual(after.airStrikes.map((strike) => [strike.id, strike.round]), [["air:s1", 3], ["air:s2", 3]]);
  assert.equal(after.markers.find((marker) => marker.id === "m1").status, "destroyed");
});

test("a city struck: its people killed and its economy hurt; nothing flies in a scenario without air units", async () => {
  const world = { ...base, units: [bombers("b1")], airStrikeOrders: [{ id: "s1", unit: "b1", owner: "Aland", kind: "city", lng: 27, lat: 51.2, target: "Brod", country: "Borduria", people: 400000 }] };
  const turn = await run(world);
  const [strike] = turn.airStrikes;
  assert.equal(strike.outcome, "unopposed");
  assert.ok(strike.dead > 0 && strike.weariness > 0);
  const patched = [];
  const patch = (into, key, values) => {
    patched.push([key, values]);
    const sheet = into.countryStats[key];
    into.countryStats[key] = { ...sheet, ...(values.population ? { population: { ...sheet.population, ...values.population } } : {}), ...(values.economy ? { economy: { ...sheet.economy, ...values.economy } } : {}) };
  };
  const after = withAirStrikes(world, turn, { round: 3, date: "2024-03-01", patch });
  assert.equal(after.countryStats.Borduria.population.total, 1e6 - strike.dead);
  assert.ok(after.countryStats.Borduria.economy.gdp < 1e9);
  assert.equal(after.countryStats.Aland, world.countryStats.Aland, "the striker's own sheet is not touched");

  // Without air units (the Wars feature), nothing waits to be flown and nothing is.
  const grounded = await run(world, { air: false });
  assert.deepEqual(grounded.airStrikes, []);
  assert.equal(grounded.unitChanges.some((change) => change.unitId === "b1"), false);
  assert.deepEqual(withAirStrikes(world, grounded, { round: 3 }).airStrikeOrders, [], "and what waited is let go");
  try {
    setActiveFeatures({ fronts: { air: false } }, null);
    assert.equal(airStrikesLiveBlock({ airStrikes: turn.airStrikes }), "", "nor is the story told any");
  } finally {
    setActiveFeatures(null, null);
  }
  // A turn whose land war was not run leaves the orders waiting.
  assert.equal(withAirStrikes(world, { airStrikes: null }, { round: 3 }), world);
});

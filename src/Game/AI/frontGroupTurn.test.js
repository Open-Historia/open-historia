/*! Open Historia — a turn's land war with a group in it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontGroupTurn.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// "it looks like there are alot of issues involving wars with groups including issues with the dynamic borders and
// duel occupied territory" (the owner, 2026-11-05). A group owns no land: what it takes is a groupOps take, and
// the region stays its country's. What the story's own groupOps do to a battlefield's ground is told to the
// engine on its day, as a change of control is.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, normalizeEvents } from "../../runtime/gameState.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { FRONT_MARK, planFrontMoments, runTurnFronts } from "./frontTurn.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [{ name: "Alba", lng: 20.6, lat: 51.4, capital: true }, { name: "Brod", lng: 23.3, lat: 51.2, capital: true }];
const sheet = () => syntheticMap({ layout: enlarge(["AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });
const FROM = "2024-03-01";
const TO = "2024-03-31";
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: {
    Aland: { code: "Aland", name: "Aland", aliases: [], color: "", note: "" },
    Borduria: { code: "Borduria", name: "Borduria", aliases: [], color: "", note: "" },
  },
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [],
  battlefields: [],
  units: [],
  ...extra,
});
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  staff: false,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  fromDate: FROM,
  toDate: TO,
  map: { key: "the sheet", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  seed: "campaign|2|2024-03-01",
  ...overrides,
});
// Borduria's eastern half, where the rising begins.
const east = (map) => map.regions.filter((region) => Number(region.id.slice(1).split("-")[0]) >= 13).map((region) => region.id);

test("the story's groupOps are told to the engine on their day, and a release names the group that lets go", () => {
  const events = normalizeEvents([
    { id: "e1", date: "2024-03-04", title: "The rising", description: "The Free East rise.", source: "ai", impacts: { groupOps: [{ op: "create", name: "Free East", regionIds: ["r1-0", "r2-0"] }] } },
    { id: "e2", date: "2024-03-09", title: "Retaken", description: "Borduria retakes a town.", source: "ai", impacts: { groupOps: [{ op: "release", name: "Free East", regionIds: ["r2-0"] }, { op: "take", name: "Free East", regionIds: ["r3-0"], by: FRONT_MARK }] } },
  ]);
  const dayOf = (event) => ({ e1: 3, e2: 8 })[event.id];
  const moments = planFrontMoments({ events, warsBefore: [], warsAfter: [], fromDate: FROM, days: 30, dayOf });
  assert.deepEqual(moments, [
    { day: 3, type: "group", regionId: "r1-0", group: "Free East", ref: "e1" },
    { day: 3, type: "group", regionId: "r2-0", group: "Free East", ref: "e1" },
    { day: 8, type: "group", regionId: "r2-0", group: "", from: "Free East", ref: "e2" },
  ], "the engine's own take is not told back to it");
});

test("a group the turn founds, fighting in it, takes ground as a group the same turn: no country of its name owns it", async () => {
  const map = sheet();
  const world = worldOn(map);
  const rising = { id: "war-2", title: "The Rising", status: "active", sideA: ["Free East"], sideB: ["Borduria"], startedDate: "2024-03-02", lastUpdatedDate: "2024-03-02" };
  const events = normalizeEvents([
    { id: "e1", date: "2024-03-02", title: "The rising", description: "The Free East rise in Borduria's east.", source: "ai", impacts: { groupOps: [{ op: "create", name: "Free East", description: "Rebels.", regionIds: east(map) }] } },
    { id: "e2", date: "2024-03-20", title: "The rising spreads", description: "The fighting goes on.", source: "ai", impacts: {} },
  ]);
  const run = await runTurnFronts(turn(map, world, { events, warStages: [[], [rising]], staff: true }));
  const fought = run.battlefields.filter((record) => record.status === "active");
  assert.equal(fought.length, 1, "the rising is fought this turn");
  assert.deepEqual(fought[0].sides, [["Free East"], ["Borduria"]]);
  assert.ok(run.flips.length > 0, "and the Free East take ground");
  for (const flip of run.flips.filter((entry) => entry.to === "Free East")) assert.equal(flip.kind, "groupTake");
  const controls = run.events.flatMap((event) => event.impacts.regionControlOps ?? []);
  assert.deepEqual(controls.filter((op) => op.toCode === "Free East"), [], "no control operation to a group's name");
  // Applied, the world has a group holding an area over Borduria's land, and no country called the Free East.
  const after = applyEventImpactsToWorld({ colors: {}, events: run.events, world: { ...world, battlefields: run.battlefields } }).world;
  assert.equal(Object.values(after.regionOwnershipOverrides).includes("Free East"), false);
  assert.equal(after.polityOverrides["Free East"], undefined);
  assert.ok(Object.values(after.groupAreas).filter((name) => name === "Free East").length > east(map).length);
});

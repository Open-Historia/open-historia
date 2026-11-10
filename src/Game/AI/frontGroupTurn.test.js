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
import { FRONT_MARK, attachFrontFlips, frontWorldReaders, planFrontMoments, runTurnFronts } from "./frontTurn.js";

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

test("a stray groupOps take or update naming a country does not make it a group to the engine: its captures stay control", async () => {
  const map = sheet();
  const war = { id: "war-1", title: "The War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
  const world = worldOn(map, { wars: [war] });
  const events = normalizeEvents([
    { id: "e1", date: "2024-03-02", title: "Aland advances", description: "Aland pushes east.", source: "ai", impacts: { groupOps: [{ op: "take", name: "Aland", regionIds: ["r0-0"] }, { op: "update", name: "aland", description: "A country." }] } },
    { id: "e2", date: "2024-03-20", title: "The war goes on", description: "The fighting goes on.", source: "ai", impacts: {} },
  ]);
  const run = await runTurnFronts(turn(map, world, { events, warStages: [[war]], staff: true, frontOrders: [{ battlefield: "", side: "Aland", order: "advance", sector: "all", effort: "major", date: FROM }] }));
  const won = run.flips.filter((flip) => flip.to === "Aland");
  assert.ok(won.length > 0, "Aland takes ground");
  for (const flip of won) assert.equal(flip.kind, "control", JSON.stringify(flip));
  const groupOps = run.events.flatMap((event) => event.impacts.groupOps ?? []).filter((op) => op.by === FRONT_MARK);
  assert.deepEqual(groupOps, [], "nothing of Aland's is a group's area");
});

test("a country at war with a group on a third country's land: its force is founded as its own, and the land stays that country's", () => {
  const flips = [
    { day: 2, date: "2024-03-03", battlefield: "Aland - Free Hills front", regionId: "n1", from: "Free Hills", to: "Aland Forces in Neutralia", kind: "groupTake", owner: "Aland", land: "Neutralia" },
    { day: 4, date: "2024-03-05", battlefield: "Aland - Free Hills front", regionId: "n2", from: "Free Hills", to: "Aland Forces in Neutralia", kind: "groupTake", owner: "Aland", land: "Neutralia" },
  ];
  const events = normalizeEvents([{ id: "e1", date: "2024-03-10", title: "The hills", description: "Aland fights the Free Hills.", source: "ai", impacts: {} }]);
  const { events: carried } = attachFrontFlips(events, flips, { dayOf: () => 9 });
  const ops = carried[0].impacts.groupOps;
  assert.deepEqual(ops.map((op) => [op.op, op.name, op.owner, op.regionIds]), [["take", "Aland Forces in Neutralia", "Aland", ["n1"]], ["take", "Aland Forces in Neutralia", "Aland", ["n2"]]]);
  assert.deepEqual(carried[0].impacts.regionControlOps ?? [], [], "nothing is annexed");
  const world = {
    regionOwnershipOverrides: { n1: "Neutralia", n2: "Neutralia" },
    polityOverrides: { Aland: { code: "Aland", name: "Aland", aliases: [], color: "", note: "" }, Neutralia: { code: "Neutralia", name: "Neutralia", aliases: [], color: "", note: "" } },
    groups: { "Free Hills": { name: "Free Hills", description: "Hill clans.", color: "#e11d48" } },
    groupAreas: { n1: "Free Hills", n2: "Free Hills" },
  };
  const after = applyEventImpactsToWorld({ colors: {}, events: carried, world }).world;
  assert.equal(after.groups["Aland Forces in Neutralia"].owner, "Aland");
  assert.match(after.groups["Aland Forces in Neutralia"].description, /taken from Free Hills/);
  assert.deepEqual(after.groupAreas, { n1: "Aland Forces in Neutralia", n2: "Aland Forces in Neutralia" });
  assert.deepEqual(after.regionOwnershipOverrides, world.regionOwnershipOverrides, "Neutralia keeps its land");
  // And the engine is told whose force it is next turn.
  assert.equal(frontWorldReaders(after).groupOwnerOf("aland forces in neutralia"), "Aland");
  assert.equal(frontWorldReaders(after, { groups: false }).groupOwnerOf("Aland Forces in Neutralia"), "");
});

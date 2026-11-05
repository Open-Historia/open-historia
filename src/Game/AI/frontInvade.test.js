/*! Open Historia — a turn in which troops are sent into a country outside the war: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontInvade.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// The engine brings a country into a war when troops are sent into it
// (runtime/fronts/invade.js). This is the turn round that: the story is told
// of it before it is written, the war ledger is told of it afterwards, the
// run that applies the turn is the run that was told, and the war room says
// what a route means before any day has passed.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyEventImpactsToWorld, normalizeEvents } from "../../runtime/gameState.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { chosenOrdersOf } from "../../runtime/fronts/command.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { applyWarRoomOp } from "../../runtime/fronts/warRoomOps.js";
import { setActiveFeatures } from "../../runtime/gameFeatures.js";
import { frontWarJoins, routesIntoOthers } from "./frontApply.js";
import { buildFrontsBlock, describePeriod } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west, Borduria in the east, and Neutralia, which is in nobody's
// war, along the north between them. The sea to the south.
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.2, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Nord", lng: 21.2, lat: 51.75, capital: true },
];
const sheet = () => syntheticMap({ layout: enlarge(["ANNNBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01", note: "Aland wants the eastern bank." };
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria"), Neutralia: polity("Neutralia") },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } }, Neutralia: { population: { total: 2e5 } } },
  wars: [WAR],
  battlefields: [],
  units: [],
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id} of the war`, description: "The fighting goes on along the border.", source: "ai", impacts: {}, ...extra });
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "the sheet", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  ...overrides,
});
const applied = (world, events, battlefields) => applyEventImpactsToWorld({ colors: {}, events, world: { ...world, battlefields } }).world;
const stand = (record) => record.troops.map((side) => decodeTroops(side).map((troop) => [Math.round(troop.x * 16), Math.round(troop.y * 16), Math.round(troop.strength)]));

// East through Neutralia, then down into Borduria behind its line.
const THROUGH = [[21.0, 51.75], [21.9, 51.75], [22.5, 51.3]];
// A war two days old, both lines holding; and then a route drawn in the war
// room for the troops of Aland's that stand nearest Neutralia.
const routed = async (way = THROUGH) => {
  const map = sheet();
  const began = worldOn(map);
  const first = await runTurnFronts(turn(map, began, {
    events: normalizeEvents([event("e1", "2024-03-02")]),
    frontOrders: [{ id: "front-0", battlefield: "The Border", side: "Aland", order: "hold", sector: "all", eventIds: ["e1"] }],
    fromDate: "2024-03-01",
    toDate: "2024-03-03",
    seed: "campaign|2|2024-03-01",
  }));
  const world = applied(began, first.events, first.battlefields);
  const [record] = world.battlefields;
  const { toCell } = projectorOf(record.frame);
  const [x, y] = toCell(21.4, 51.45);
  const nearest = decodeTroops(record.troops[0])
    .map((troop, index) => ({ index, far: Math.hypot(troop.x - x, troop.y - y), live: troop.strength > 0 }))
    .filter((troop) => troop.live)
    .sort((a, b) => a.far - b.far)
    .slice(0, 8)
    .map((troop) => troop.index);
  const done = applyWarRoomOp(world.battlefields, { op: "route", battlefield: record.name, troops: nearest, way }, { player: "Aland", date: "2024-03-03" });
  assert.equal(done.error, undefined);
  return { map, world: { ...world, battlefields: done.battlefields }, name: record.name };
};
const SECOND = { fromDate: "2024-03-03", toDate: "2024-03-17", seed: "campaign|3|2024-03-03" };

test("a turn in which troops are sent into a country outside the war says who joined, and the war ledger takes it from the engine", async () => {
  const { map, world, name } = await routed();
  assert.deepEqual(world.battlefields[0].sides, [["Aland"], ["Borduria"]]);

  const run = await runTurnFronts(turn(map, world, SECOND));
  assert.deepEqual(run.joins.map((join) => [join.name, join.warId, join.side, join.by, join.battlefield]), [["Neutralia", "war-1", 1, "Aland", name]]);
  const [join] = run.joins;
  assert.match(join.date, /^2024-03-(0[3-9]|1[0-7])$/, "on a day of the period");
  assert.deepEqual(run.battlefields[0].sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.deepEqual(run.news.filter((entry) => entry.k === "invaded").map((entry) => [entry.s, entry.at, entry.d, entry.battlefield]), [[0, "country: Neutralia", join.date, name]]);

  // The ledger's own records: Neutralia joins the side Aland is not on, on that day.
  const updates = frontWarJoins(run);
  assert.deepEqual(updates, [{ id: "war-1", op: "join-b", actors: ["Neutralia"], opponents: [], eventIds: [], baselineDate: join.date }]);
  const merged = applyWarUpdates({ world, updates, events: [], stopDate: SECOND.toDate, round: 3, limit: Infinity });
  assert.deepEqual(merged.appliedIds, ["war-1"]);
  const [war] = merged.wars;
  assert.deepEqual([war.sideA, war.sideB, war.status], [["Aland"], ["Borduria", "Neutralia"], "active"]);
  assert.equal(war.note, WAR.note, "what the war is about is as it was written");
  // A turn with nothing of the kind gives the ledger nothing.
  assert.deepEqual(frontWarJoins(null), []);
  assert.deepEqual(frontWarJoins({ joins: [] }), []);
  assert.deepEqual(frontWarJoins({ joins: [{ name: "Neutralia" }, { warId: "war-1" }] }), [], "a join that does not say which war, or who, is not a record");

  // And the next turn finds it in the war: it is fought with, not dropped as a country that left.
  const after = { ...applied(world, run.events, run.battlefields), wars: merged.wars };
  const next = await runTurnFronts(turn(map, after, { fromDate: "2024-03-17", toDate: "2024-03-22", seed: "campaign|4|2024-03-17" }));
  assert.deepEqual(next.battlefields[0].sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.deepEqual(next.joins, [], "it joined once");
  assert.deepEqual(next.notes, []);
});

test("the story is told of the invasion before it is written, and the turn that is applied is the one that was told", async () => {
  const { map, world, name } = await routed();
  // The days ahead, fought before anything is asked for.
  const told = await runTurnFronts(turn(map, world, SECOND));
  const [join] = told.joins;
  const period = { fromDate: SECOND.fromDate, toDate: SECOND.toDate, days: 14, battlefields: told.battlefields, news: told.news, flips: told.flips };
  const block = buildFrontsBlock({ battlefields: world.battlefields, players: ["Aland"], period });
  assert.ok(block.includes(`${join.date} Aland sent its troops into country: Neutralia, which was not in the war and is at war with it from that day`), block);
  assert.match(block, /Where an account says a side sent its troops into a country that was not in the war, that country is in the war against it from that date, and the game has entered it in that war already/);
  // It is among the first things told of the period, whatever else happened in it.
  const crowded = [
    ...Array.from({ length: 12 }, (_, index) => ({ d: "2024-03-05", k: "city", s: 0, at: `city: Town ${index}`, size: 150000 + index, battlefield: name })),
    { d: "2024-03-06", k: "invaded", s: 0, at: "country: Neutralia", battlefield: name },
  ];
  assert.match(describePeriod({ record: told.battlefields[0], before: world.battlefields[0], news: crowded }), /2024-03-06 Aland sent its troops into country: Neutralia/);

  // The answer says so too, in its own war record, on the first of its events:
  // days before the troops could have reached the border. The engine's day stands.
  const events = normalizeEvents([event("f1", "2024-03-04", { warId: "war-1" }), event("f2", "2024-03-12", { warId: "war-1" })]);
  const storied = { id: "war-1", op: "join-b", actors: ["Neutralia"], opponents: [], eventIds: ["f1"] };
  const stage = applyWarUpdates({ world: { wars: world.wars }, updates: [storied], events, stopDate: SECOND.toDate, round: 3, limit: Infinity }).wars;
  assert.deepEqual(stage[0].sideB, ["Borduria", "Neutralia"], "the answer's record is one the ledger takes");
  const final = await runTurnFronts(turn(map, world, { ...SECOND, events, warStages: [world.wars, stage], foretold: true }));
  assert.deepEqual(final.joins, told.joins);
  assert.deepEqual(final.news, told.news);
  assert.deepEqual(final.flips, told.flips);
  assert.deepEqual(stand(final.battlefields[0]), stand(told.battlefields[0]), "the same fortnight, to the last troop");
  // Both records of the same joining are one joining in the ledger.
  const merged = applyWarUpdates({ world, updates: [storied, ...frontWarJoins(final)], events, stopDate: SECOND.toDate, round: 3, limit: Infinity });
  assert.deepEqual(merged.wars[0].sideB, ["Borduria", "Neutralia"]);
});

test("the war room is told what a route goes into as soon as it is drawn, from the same ground, and reads nothing when it need not", async () => {
  const { map, world } = await routed();
  const geojson = { features: map.regions.map((region) => ({ properties: { id: region.id, name: region.name }, geometry: region.geometry })) };
  const game = { country: "Aland", gameDate: "2024-03-03", round: 2 };
  const [record] = world.battlefields;
  const index = record.orders.findIndex((order) => order.chosen);
  assert.equal(chosenOrdersOf(record, 0)[0].attacks, undefined, "no day has passed: the engine has not read the route");
  const quiet = async (work) => {
    const { warn } = console;
    console.warn = () => {};
    try {
      return await work();
    } finally {
      console.warn = warn;
    }
  };
  let reads = 0;
  const loadRegions = async () => { reads += 1; return geojson; };
  const found = await quiet(() => routesIntoOthers({ world, game, campaignId: "invade-test", record, loadRegions }));
  assert.deepEqual([...found], [[index, ["Neutralia"]]]);
  assert.equal(reads, 1);
  // The ground is kept: asked again, nothing is read.
  assert.deepEqual([...await quiet(() => routesIntoOthers({ world, game, campaignId: "invade-test", record, loadRegions }))], [[index, ["Neutralia"]]]);
  assert.equal(reads, 1);

  // A route inside the war's own ground attacks nobody.
  const inside = await routed([[21.8, 51.2], [22.6, 51.0]]);
  assert.deepEqual([...await quiet(() => routesIntoOthers({ world: inside.world, game, campaignId: "invade-test", record: inside.world.battlefields[0], loadRegions }))], []);
  // A route under way that the engine never read (one drawn before it read routes) is read like any other.
  const begun = { ...record, brief: { ...record.brief, carry: { ...record.brief.carry, ages: record.orders.map(() => 3) } } };
  assert.deepEqual([...await quiet(() => routesIntoOthers({ world, game, campaignId: "invade-test", record: begun, loadRegions }))], [[index, ["Neutralia"]]]);
  // With no route drawn, with what the route attacks on its order already, or with fronts off, the map is not read at all.
  const refuse = async () => { throw new Error("nothing is read for this"); };
  const bare = { ...record, orders: record.orders.filter((order) => !order.chosen) };
  assert.equal((await routesIntoOthers({ world, game, campaignId: "another", record: bare, loadRegions: refuse })).size, 0);
  const marked = { ...record, orders: record.orders.map((order) => (order.chosen ? { ...order, attacks: ["Neutralia"] } : order)) };
  assert.equal((await routesIntoOthers({ world, game, campaignId: "another", record: marked, loadRegions: refuse })).size, 0);
  try {
    setActiveFeatures({ fronts: { enabled: false } }, null);
    assert.equal((await routesIntoOthers({ world, game, campaignId: "another", record, loadRegions: refuse })).size, 0);
  } finally {
    setActiveFeatures(null, null);
  }
  // Ground that cannot be read says nothing, and breaks nothing.
  assert.equal((await quiet(() => routesIntoOthers({ world, game, campaignId: "a third", record, loadRegions: async () => null }))).size, 0);
});

test("the turn hands the engine's joinings to the war ledger, and the war room has the order and the warning", () => {
  const gameplay = read("gameplay.js");
  assert.match(gameplay, /updates: \[\.\.\.warUpdates, \.\.\.frontWarStarts\(turnFronts\), \.\.\.frontWarJoins\(turnFronts\)\],/);
  // (And a country such a route goes into is asked for its sheet: runtime/statsBackend.test.js.)
  assert.match(gameplay, /export const warRoomRouteAttacks = \(\{ world, game, record \} = \{\}\) =>\n {2}routesIntoOthers\(\{ world, game, record, campaignId: activeCampaignId\(\), loadRegions: createRenderedRegionsReader\(\) \}\)\.then\(\(found\) => \{/);
  assert.match(read("gameplayLazy.js"), /export const warRoomRouteAttacks = async \(\.\.\.args\) => \(await gameplay\(\)\)\.warRoomRouteAttacks\(\.\.\.args\);/);
  const panel = read("../GameUI/warRoom.jsx");
  // Troops picked out can be told to advance with no route drawn for them: a key on the tool rail, carried out by the panel.
  assert.match(read("../GameUI/warRoomRail.jsx"), /<RailKey label="Advance" [^>]*onClick=\{\(\) => onOrder\("advance"\)\}>/);
  assert.match(panel, /onOrder=\{orderPicked\}/);
  assert.match(panel, /warRoomRouteAttacks\(\{ world, game, record \}\)/);
  assert.match(panel, /This route goes into <span data-no-translate>\{attacked\.join\(", "\)\}<\/span>, which is not in this war\./);
});

/*! Open Historia — a war that begins with an attack, in a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontAttackFirst.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// "Make it so enemies can deploy troops to attack you first without you
// instigating if the time skip AI says they do." The engine opens the war
// (runtime/fronts/attackFirst.test.js). This is the turn round it: the story
// is told how to have a country strike first, its line survives the rule that
// a person's troops are that person's to order (it orders the ATTACKER), the
// war is entered in the ledger under the id its battlefield carries, and the
// next period is told who struck.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeEvents } from "../../runtime/gameState.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { frontWarStarts } from "./frontApply.js";
import { buildFrontsBlock, describePeriod, describeTransports } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";
import { bindFrontOrdersToEvents, screenFrontOrders } from "./nativeFrontLedger.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west and Borduria, which a person plays, in the east: at peace.
// Cisland lies over the sea to the south, at peace with both.
const legend = { A: "Aland", B: "Borduria", C: "Cisland", "~": null };
const cities = [
  { name: "Alba", lng: 21.5, lat: 51.5, capital: true },
  { name: "Brod", lng: 24.5, lat: 51.5, capital: true },
  { name: "Cis", lng: 22.5, lat: 48.5, capital: true },
];
const sheet = () => syntheticMap({ layout: ["AAABBB", "AAABBB", "~~~~~~", "~~~~~~", "~CCCC~"], legend, west: 20, north: 52.5, step: 1, cities, key: "attack first" });
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria"), Cisland: polity("Cisland") },
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 1e6 } }, Cisland: { population: { total: 1e6 } } },
  wars: [],
  battlefields: [],
  transports: [],
  units: [],
  ...extra,
});
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "attack first", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  players: ["Borduria"],
  fromDate: "2024-03-01",
  toDate: "2024-03-21",
  seed: "campaign|2|2024-03-01",
  ...overrides,
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id}`, description: "Aland's columns cross the frontier at dawn.", source: "ai", impacts: {}, ...extra });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).length;

test("the story has a country attack the player's across their border, and the war is fought from that day", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = normalizeEvents([event("e1", "2024-03-05"), event("e2", "2024-03-12")]);
  // The line orders ALAND, which nobody plays: the rule that a person's troops are that person's leaves it alone.
  const bound = bindFrontOrdersToEvents(["border: Aland / Borduria~Aland~blitz~all~1~city: Brod~~major"], events);
  const { kept, dropped } = screenFrontOrders(bound, { events, humanSides: ["Borduria"] });
  assert.deepEqual([kept.length, dropped.length], [1, 0]);

  const run = await runTurnFronts(turn(map, world, { events, frontOrders: kept }));
  assert.deepEqual(run.notes, []);
  // A war between the two from the day of the event the line rests on.
  assert.deepEqual(run.starts, [{ day: 4, date: "2024-03-05", warId: "war-aland-borduria-2024-03-05", attacker: "Aland", defender: "Borduria" }]);
  const [field] = run.battlefields;
  assert.deepEqual([run.battlefields.length, field.status, field.warId, field.openedDate], [1, "active", "war-aland-borduria-2024-03-05", "2024-03-05"]);
  assert.deepEqual(field.sides, [["Aland"], ["Borduria"]]);
  // The player's country was given troops to meet it, and no order: those are the player's to give.
  assert.ok(live(field, 0) > 0 && live(field, 1) > 0, `${live(field, 0)} against ${live(field, 1)}`);
  assert.deepEqual(field.orders.map((entry) => [field.sides[entry.s][0], entry.order]), [["Aland", "blitz"]]);
  // Sixteen days of it: the attacker has taken ground, on events of the turn.
  assert.ok(run.flips.length > 0, `${run.flips.length} regions changed hands`);
  assert.ok(run.flips.every((flip) => flip.from === "Borduria" && flip.to === "Aland"));
  assert.ok(run.events.some((entry) => (entry.impacts?.regionControlOps ?? []).some((op) => op.by === "front" && op.toCode === "Aland")));
  assert.ok(run.news.some((entry) => entry.k === "attacked" && entry.at === "country: Borduria" && entry.d === "2024-03-05"));

  // The ledger: a war by the id the battlefield carries, begun that day, attacker first.
  const updates = frontWarStarts(run);
  assert.deepEqual(updates, [{ id: "war-aland-borduria-2024-03-05", op: "start", actors: ["Aland"], opponents: ["Borduria"], eventIds: [], baselineDate: "2024-03-05", note: "Aland attacked Borduria, with which it had been at peace" }]);
  const merged = applyWarUpdates({ world, updates, events, stopDate: "2024-03-21", round: 2, limit: Infinity });
  assert.deepEqual(merged.appliedIds, ["war-aland-borduria-2024-03-05"]);
  const [war] = merged.wars;
  assert.deepEqual([war.id, war.status, war.sideA, war.sideB, war.startedDate], ["war-aland-borduria-2024-03-05", "active", ["Aland"], ["Borduria"], "2024-03-05"]);
  assert.deepEqual(frontWarStarts(null), []);
  assert.deepEqual(frontWarStarts({ starts: [{ warId: "w", attacker: "Aland" }] }), [], "one that does not say who was attacked is no record");

  // The turn after finds the war in the ledger and its battlefield open: the same war goes on, and nothing begins twice.
  const next = { ...world, wars: merged.wars, battlefields: run.battlefields };
  const later = await runTurnFronts(turn(map, next, { fromDate: "2024-03-21", toDate: "2024-04-05", seed: "campaign|3|2024-03-21" }));
  assert.deepEqual(later.starts, []);
  assert.deepEqual([later.battlefields.length, later.battlefields[0].warId, later.battlefields[0].status], [1, "war-aland-borduria-2024-03-05", "active"]);

  // The story wrote the war itself as well: it is one war, the story's.
  const told = applyWarUpdates({ world, updates: [{ id: "war-told", op: "start", actors: ["Aland"], opponents: ["Borduria"], eventIds: ["e2"], note: "Title: The Dawn War; an old claim" }], events, stopDate: "2024-03-21", round: 2, limit: Infinity });
  const both = await runTurnFronts(turn(map, world, { events, frontOrders: kept, warStages: [world.wars, told.wars] }));
  assert.deepEqual(both.starts, []);
  assert.deepEqual([both.battlefields.length, both.battlefields[0].warId, both.battlefields[0].openedDate], [1, "war-told", "2024-03-05"]);
});

test("an order aimed at a city the map spells another way is still an attack on who holds it, and a convoy in peace is one too", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = normalizeEvents([event("e1", "2024-03-05")]);
  const asks = [];
  // The game's own reader of places: the map's Brod is Brodgrad to the model, and its Alba is Albany.
  const strikePlaces = {
    find: async (text) => {
      asks.push(text);
      return /brodgrad/i.test(text) ? { lng: 24.5, lat: 51.5 } : /albany/i.test(text) ? { lng: 21.5, lat: 51.5 } : null;
    },
  };
  const orders = bindFrontOrdersToEvents(["Operation Dawn~Aland~spearhead~all~1~city: Brodgrad~~major"], events);
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders, strikePlaces }));
  assert.deepEqual(asks, ["city: Brodgrad"]);
  assert.deepEqual(run.starts.map((start) => [start.attacker, start.defender]), [["Aland", "Borduria"]]);
  assert.deepEqual([run.battlefields[0].name, run.battlefields[0].status], ["Operation Dawn", "active"]);
  // A place the map has by that name is not asked for, and one nobody can find is the unknown battlefield it always was.
  asks.length = 0;
  const plain = await runTurnFronts(turn(map, world, { events, frontOrders: bindFrontOrdersToEvents(["Operation Dawn~Aland~advance~all~1~city: Brod~~major", "Operation Dusk~Aland~advance~all~1~city: Atlantis~~major"], events), strikePlaces }));
  assert.deepEqual(asks, ["city: Atlantis"]);
  assert.deepEqual(plain.starts.length, 1);
  assert.ok(plain.notes.some((note) => /Operation Dusk/.test(note.text) && /name their border/.test(note.text)), JSON.stringify(plain.notes));

  // Cisland has no border with anybody: it sends a convoy at Aland's capital, by the name the model knows it by.
  const sent = await runTurnFronts(turn(map, world, { events, frontOrders: bindFrontOrdersToEvents(["Operation Tide~Cisland~ship~~1~city: Albany~~~troop convoy~20~600"], events), strikePlaces }));
  assert.deepEqual(sent.starts, [], "nothing begins the day it is ordered");
  assert.deepEqual(sent.transports.map((entry) => [entry.owner, entry.status, entry.to]), [["Cisland", "ordered", { lng: 21.5, lat: 51.5, name: "city: Albany" }]]);
  // The period after is fought before its story: the convoy crosses, the troops come ashore, and the war begins there.
  const next = { ...world, transports: sent.transports };
  const fought = await runTurnFronts(turn(map, next, { fromDate: "2024-03-21", toDate: "2024-04-05", seed: "campaign|3|2024-03-21" }));
  assert.deepEqual(fought.voyages.map((voyage) => voyage.k), ["sailed", "invaded", "landed"]);
  assert.deepEqual(fought.starts.map((start) => [start.attacker, start.defender]), [["Cisland", "Aland"]]);
  const [beach] = fought.battlefields;
  assert.deepEqual([beach.name, beach.status, beach.sides], ["Operation Tide", "active", [["Cisland"], ["Aland"]]]);
  assert.deepEqual(frontWarStarts(fought).map((update) => [update.op, update.actors, update.opponents]), [["start", ["Cisland"], ["Aland"]]]);
  // And the story of that period is told it, as the war it is.
  const told = describeTransports({ transports: fought.transports, voyages: fought.voyages, fought: true });
  assert.match(told, /Cisland put troops into country: Aland, with which it had been at peace, and the two are at war from that day/);
  // The same run again is the same war: what was told is what is applied.
  const again = await runTurnFronts(turn(map, next, { fromDate: "2024-03-21", toDate: "2024-04-05", seed: "campaign|3|2024-03-21", foretold: true }));
  assert.deepEqual(again.starts, fought.starts);
  assert.deepEqual(again.voyages, fought.voyages);
});

test("the story is told how a country strikes first, and the next period is told who did", () => {
  const block = buildFrontsBlock({ players: ["Borduria"] });
  assert.match(block, /with an order to attack from one of the two at effort major or total, that country invades the other and the war between them begins that day \(the game enters it in the war ledger; its own warUpdates record, if you write one, is the same war\)/);
  assert.match(block, /Any country may strike first so, at one a person plays as at any other, when the story has it do so\./);
  // The player's own troops are still the player's: the rule stands beside it.
  assert.match(block, /Borduria is played by a person: write no order for it of your own\./);
  // What a battlefield's log says of it, in the period's account.
  const record = { name: "Aland - Borduria front", status: "active", sides: [["Aland"], ["Borduria"]] };
  const told = describePeriod({ record, news: [{ d: "2024-03-05", k: "attacked", s: 0, at: "country: Borduria" }, { d: "2024-03-09", k: "city", s: 0, at: "city: Brod", capital: true }] });
  assert.match(told, /2024-03-05 Aland attacked country: Borduria, with which it had been at peace, and the two are at war from that day/);
  assert.ok(told.indexOf("attacked") < told.indexOf("took city: Brod"), "it is told first");
  // The turn gives the ledger the engine's wars before whoever was brought into one.
  assert.match(read("./gameplay.js"), /updates: \[\.\.\.warUpdates, \.\.\.frontWarStarts\(turnFronts\), \.\.\.frontWarJoins\(turnFronts\)\],/);
});

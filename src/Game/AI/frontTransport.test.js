/*! Open Historia — transporters in a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontTransport.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// The engine sails a transporter and puts its troops down
// (runtime/fronts/transports.test.js). This is the turn round that: the story
// orders one in a line of its orders, it is the world's from then and sets out
// when the next period begins, that period is fought before its story is
// written and tells the voyage, and the world keeps and renames it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renameInTransports } from "../../../server/battlefieldNames.js";
import { renamePolityInWorld } from "../../../server/polityRename.js";
import { applyEventImpactsToWorld, normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { TRANSPORT_LOAD_USUAL, TRANSPORT_ORDERS, orderTransport } from "../../runtime/fronts/transports.js";
import { FRONTS_BLOCK_MAX, TRANSPORTS_TEXT_MAX, buildFrontsBlock, describePeriod, describeTransports } from "./frontPrompt.js";
import { runTurnFronts, transportRefusal } from "./frontTurn.js";
import { decodeFrontOrders, isTransportOrder, screenFrontOrders } from "./nativeFrontLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west and Borduria in the east, the sea between them: at war,
// and with no border to fight over.
const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 23.5, lat: 51.5, capital: true },
  { name: "Port", lng: 28.4, lat: 51.5, population: 300000 },
  { name: "Brod", lng: 30.5, lat: 51.5, capital: true },
];
const sheet = () => syntheticMap({ layout: ["~~~~~~~~~~~~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~~~~~~~~~~~~"], legend, west: 20, north: 54, step: 1, cities, key: "transport turn" });
const WAR = { id: "war-1", title: "The War Across the Water", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria") },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [WAR],
  battlefields: [],
  transports: [],
  units: [],
  ...extra,
});
const ARENAS = new Map();
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "transport turn", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: ARENAS,
  loadRegions: async () => map.regions,
  ...overrides,
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id} of the war`, description: "The war goes on across the water.", source: "ai", impacts: {}, ...extra });
const applied = (world, run) => ({ ...applyEventImpactsToWorld({ colors: {}, events: run.events, world: { ...world, battlefields: run.battlefields ?? world.battlefields } }).world, transports: run.transports ?? world.transports });
const FIRST = { fromDate: "2024-03-01", toDate: "2024-03-11", seed: "campaign|2|2024-03-01" };
const SECOND = { fromDate: "2024-03-11", toDate: "2024-03-31", seed: "campaign|3|2024-03-11" };

test("a line of orders sends a transporter: ship, rail or airlift, with what carries the troops, how many, and how fast", () => {
  assert.deepEqual(TRANSPORT_ORDERS, { ship: "sea", rail: "land", airlift: "air" });
  const [ship, train, drop, plain, bare, lost] = decodeFrontOrders([
    "Operation Tide~Aland~ship~~2~city: Port~~major~troop convoy~12~600",
    "The Eastern Front~Aland~by rail~~1~region: Eastmark~~~armoured trains~6",
    "Operation Sky~Aland~Airdrop~~~country: Borduria",
    "The Border~Aland~advance~all~1",
    "Operation Tide~Aland~convoy~~1~city: Port~~~~many~fast",
    "Operation Nowhere~Aland~ship",
  ].join("\n"));
  assert.deepEqual([ship.order, ship.battlefield, ship.side, ship.objective, ship.effort, ship.carrier, ship.strength, ship.speed, ship.eventIndexes], ["ship", "Operation Tide", "Aland", "city: Port", "major", "troop convoy", 12, 600, [1]]);
  assert.deepEqual([train.order, train.carrier, train.strength, train.speed], ["rail", "armoured trains", 6, undefined], "a speed that is not given is the year's usual");
  assert.deepEqual([drop.order, drop.objective, drop.carrier, drop.strength], ["airlift", "country: Borduria", undefined, undefined]);
  assert.deepEqual([plain.order, plain.carrier, plain.strength, plain.speed], ["advance", undefined, undefined, undefined], "an order for a battlefield carries none of it");
  assert.deepEqual([bare.order, bare.strength, bare.speed, bare.problem], ["ship", undefined, undefined, undefined], "a number that is not one is left out");
  assert.equal(lost.problem, "a transporter has to be sent somewhere");
  assert.deepEqual(["ship", "rail", "airlift", "advance", "land", ""].map(isTransportOrder), [true, true, true, false, false, false]);
  // Read again as records (a turn kept and applied later), it is what it was.
  const [again] = decodeFrontOrders([{ ...ship, eventIds: ["e2"] }]);
  assert.deepEqual([again.order, again.carrier, again.strength, again.speed, again.eventIds], ["ship", "troop convoy", 12, 600, ["e2"]]);
  // A person's own country is sent a transporter by that person only.
  const events = [{ id: "e1", actionIds: [] }, { id: "e2", actionIds: ["mine"] }];
  const screened = screenFrontOrders([{ ...ship, eventIds: ["e1"] }, { ...ship, id: "front-9", eventIds: ["e2"] }], { events, humanSides: ["Aland"], citesOrderOf: (side, entry) => entry.actionIds.includes("mine") });
  assert.deepEqual([screened.kept.map((order) => order.id), screened.dropped.map((entry) => entry.player)], [["front-9"], [true]]);
});

test("a transporter the story orders is the world's from that turn and sets out when the next period begins", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = normalizeEvents([event("e1", "2024-03-04", { warId: "war-1" }), event("e2", "2024-03-08", { warId: "war-1" })]);
  const frontOrders = decodeFrontOrders("Operation Tide~Aland~ship~~2~city: Port~~major~troop convoy~30~600\nOperation Sky~Borduria~airlift~~1~city: Atlantis\nThe Reserve~Neutralia~rail~~1~city: Port~~~~4");
  const first = await runTurnFronts(turn(map, world, { ...FIRST, events, frontOrders }));
  // It is no order for a battlefield: none opens and nobody is told a battlefield is unknown.
  assert.deepEqual(first.battlefields, []);
  assert.deepEqual(first.notes, []);
  assert.deepEqual(first.voyages, []);
  assert.deepEqual(first.transports.map((entry) => [entry.id, entry.status, entry.medium, entry.owner, entry.kind, entry.speed, entry.raise, entry.to.name, entry.battlefield, entry.ordered, entry.by]), [
    ["t1", "ordered", "sea", "Aland", "troop convoy", 600, 30, "city: Port", "Operation Tide", "2024-03-11", ""],
    ["t2", "ordered", "air", "Borduria", "transport aircraft", 15000, TRANSPORT_LOAD_USUAL, "city: Atlantis", "Operation Sky", "2024-03-11", ""],
    ["t3", "ordered", "land", "Neutralia", "troop trains", 800, 4, "city: Port", "The Reserve", "2024-03-11", ""],
  ]);
  assert.equal(first.underWay, 3);

  // The period after: fought before its story is asked for, with nothing ordered in it.
  const next = applied(world, first);
  assert.equal(next.transports.length, 3);
  const told = await runTurnFronts(turn(map, next, SECOND));
  assert.deepEqual(told.voyages.map((voyage) => [voyage.d, voyage.k, voyage.owner]), [
    ["2024-03-11", "sailed", "Aland"],
    ["2024-03-11", "refused", "Borduria"],
    ["2024-03-11", "refused", "Neutralia"],
    ["2024-03-12", "landed", "Aland"],
  ]);
  assert.deepEqual(told.transports.map((entry) => [entry.id, entry.status, entry.note]), [["t1", "landed", ""], ["t2", "refused", "no-place"], ["t3", "refused", "no-origin"]]);
  const [record] = told.battlefields;
  assert.deepEqual([record.name, record.openedDate, record.sides], ["Operation Tide", "2024-03-12", [["Aland"], ["Borduria"]]]);
  assert.ok(told.flips.length >= 1, `${told.flips.length} regions taken from the sea in the period`);
  // What could not set out is said to whoever ordered it, once, in words.
  assert.deepEqual(told.notes, [{ kind: "dropped", text: "Transporters were not sent (Borduria to city: Atlantis: the place it was sent to is not on the map; Neutralia to city: Port: its sender has no city to send it from). One is sent to a place on the map that its kind can reach (a ship to a coast, rail through land its side holds): by a side at war, or in peace to another country's land, which is an attack on it." }]);
  assert.equal(transportRefusal("no-sea-way"), "no sea leads there");
  assert.equal(transportRefusal("something new"), "it could not set out");

  // The story is given that account, and the turn that is applied is the one that was told.
  const period = { fromDate: SECOND.fromDate, toDate: SECOND.toDate, days: 20, battlefields: told.battlefields, news: told.news, flips: told.flips, transports: told.transports, voyages: told.voyages };
  const block = buildFrontsBlock({ battlefields: next.battlefields, players: [], period, transports: next.transports });
  assert.ok(block.length <= FRONTS_BLOCK_MAX);
  assert.ok(block.includes("Transporters this period, by date: 2024-03-11 the troop convoy of Aland with 30 formations set out from city: Alba for city: Port, due 2024-03-12; 2024-03-12 the troop convoy of Aland put 30 formations ashore at city: Port, on Operation Tide."), block.slice(-900));
  assert.match(block, /2024-03-12 troops of Aland came ashore at city: Port/, "and the battlefield's own account says who landed where");
  assert.doesNotMatch(block, /Atlantis|Neutralia/, "what never set out is not part of the period's story");
  const after = normalizeEvents([event("f1", "2024-03-13", { warId: "war-1" }), event("f2", "2024-03-25", { warId: "war-1" })]);
  const final = await runTurnFronts(turn(map, next, { ...SECOND, events: after, foretold: true }));
  assert.deepEqual(final.voyages, told.voyages);
  assert.deepEqual(final.flips, told.flips);
  assert.deepEqual(final.battlefields[0].troops, told.battlefields[0].troops);
  // The turn after that begins with the voyages over: they are let go.
  const later = applied(next, final);
  const third = await runTurnFronts(turn(map, later, { fromDate: "2024-03-31", toDate: "2024-04-05", seed: "campaign|4|2024-03-31" }));
  assert.deepEqual(third.transports, []);
});

test("what is told of transporters: the period's voyages by date, those on the way, and those still to set out", () => {
  const voyages = [
    { d: "2024-03-02", k: "sailed", owner: "Aland", kind: "troop convoy", to: "city: Port", n: 30, from: "city: Alba", due: "2024-03-08" },
    { d: "2024-03-04", k: "intercepted", owner: "Aland", kind: "troop convoy", to: "city: Port", n: 30, by: "Borduria", with: "Home Fleet", at: "city: Port", lost: 9 },
    { d: "2024-03-05", k: "refused", owner: "Aland", kind: "troop trains", to: "city: Brod", n: 4, why: "no-ground" },
    { d: "2024-03-08", k: "invaded", owner: "Aland", kind: "troop convoy", to: "city: Nord", n: 21, at: "country: Neutralia" },
    { d: "2024-03-08", k: "landed", owner: "Aland", kind: "troop convoy", to: "city: Port", n: 21, at: "city: Port", landed: 21, battlefield: "Operation Tide" },
    { d: "2024-03-09", k: "lost", owner: "Borduria", kind: "transport aircraft", to: "city: Alba", n: 2, by: "Aland", with: "", at: "", lost: 2 },
    { d: "2024-03-10", k: "reinforced", owner: "Borduria", kind: "troop trains", to: "city: Brod", n: 4, at: "city: Brod", landed: 4, battlefield: "Operation Tide" },
    { d: "2024-03-11", k: "returned", owner: "Aland", kind: "barges", to: "city: Brod", n: 3 },
  ];
  const moving = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 28.4, lat: 51.5, name: "city: Port" }, raise: 6 }, { year: 2024 }).transports.map((entry) => ({ ...entry, status: "moving", due: "2024-03-14", load: [[100, 0], [100, 0]] }));
  const waiting = orderTransport(moving, { medium: "air", owner: "Borduria", to: { name: "country: Aland" }, raise: 4 }, { year: 2024 }).transports;
  const text = describeTransports({ transports: waiting, voyages, fought: true, max: 4000 });
  assert.equal(text, [
    "Transporters this period, by date: 2024-03-02 the troop convoy of Aland with 30 formations set out from city: Alba for city: Port, due 2024-03-08",
    "; 2024-03-04 the troop convoy of Aland bound for city: Port was caught by Borduria (Home Fleet) near city: Port and lost 9 of its formations",
    "; 2024-03-08 Aland put troops into country: Neutralia, which was not in the war and is at war with it from that day",
    "; 2024-03-08 the troop convoy of Aland put 21 formations ashore at city: Port, on Operation Tide",
    "; 2024-03-09 the transport aircraft of Borduria bound for city: Alba was caught by Aland and lost with all aboard",
    "; 2024-03-10 the troop trains of Borduria brought 4 formations to city: Brod, on Operation Tide",
    "; 2024-03-11 the barges of Aland bound for city: Brod turned back.",
    " Still on the way: the troop convoy of Aland with 2 formations bound for city: Port, due 2024-03-14.",
    " Ordered, setting out as the next period begins: the transport aircraft of Borduria with 4 formations for country: Aland.",
  ].join(""));
  // Before a period is fought only what is out and what is ordered is said; with none of either, nothing.
  assert.equal(describeTransports({ transports: waiting, voyages, fought: false }), "Still on the way: the troop convoy of Aland with 2 formations bound for city: Port, due 2024-03-14. Ordered, setting out as the next period begins: the transport aircraft of Borduria with 4 formations for country: Aland.");
  assert.equal(describeTransports({ transports: [], voyages: [], fought: true }), "");
  assert.equal(describeTransports(), "");
  // It is held to its length.
  const held = describeTransports({ transports: waiting, voyages, fought: true });
  assert.ok(held.length <= TRANSPORTS_TEXT_MAX && held.endsWith("…"), `${held.length} characters`);
  // No battlefield open, and a transporter on its way: the block says so and still tells it.
  const none = buildFrontsBlock({ battlefields: [], players: [], transports: waiting });
  assert.ok(none.includes("No battlefield is open now.\nStill on the way: the troop convoy of Aland"), none.slice(-400));
  // The rules say how one is sent, with a line that is plainly a pattern.
  assert.match(none, /- ship \| rail \| airlift send a TRANSPORTER: /);
  assert.ok(none.includes("\nNAME~A~ship~~3~city: X~~~troop convoy~12~600\n"));
  // In a battlefield's own account a landing is among the first things told.
  const crowded = [
    ...Array.from({ length: 12 }, (_, index) => ({ d: "2024-03-05", k: "city", s: 0, at: `city: Town ${index}`, size: 150000 + index })),
    { d: "2024-03-06", k: "landed", s: 1, at: "city: Alba" },
    { d: "2024-03-07", k: "reinforced", s: 0, at: "city: Port" },
  ];
  const account = describePeriod({ record: { name: "Operation Tide", status: "active", sides: [["Aland"], ["Borduria"]] }, news: crowded });
  assert.match(account, /2024-03-06 troops of Borduria came ashore at city: Alba/);
});

test("the world keeps its transporters, shows them to everyone in a shared game, and renames their owners with everything else", () => {
  const sent = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 28.4, lat: 51.5, name: "city: Port" }, raise: 6, by: "Aland" }, { date: "2024-03-01", year: 2024 }).transports;
  const hunted = sent.map((entry) => ({ ...entry, status: "moving", hunters: ["Borduria"], attacks: ["Neutralia"] }));
  const world = normalizeWorldState({ transports: [...hunted, { id: "junk" }, null, hunted[0]] });
  assert.deepEqual(world.transports.map((entry) => [entry.id, entry.status, entry.owner]), [["t1", "moving", "Aland"]], "what is not a transporter is not kept, and each is kept once");
  assert.deepEqual(normalizeWorldState({}).transports, []);
  const renamed = renameInTransports(hunted, "aland", "The Aland Republic");
  assert.deepEqual([renamed[0].owner, renamed[0].by, renamed[0].hunters, renamed[0].attacks], ["The Aland Republic", "The Aland Republic", ["Borduria"], ["Neutralia"]]);
  assert.deepEqual(renameInTransports(hunted, "Borduria", "Bordureich")[0].hunters, ["Bordureich"]);
  assert.deepEqual(renameInTransports(hunted, "Neutralia", "Neutria")[0].attacks, ["Neutria"]);
  assert.equal(renameInTransports(hunted, "Cisland", "Transland"), hunted, "nothing renamed, nothing copied");
  const through = renamePolityInWorld({ polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria") }, transports: hunted }, "Aland", "Alandia");
  assert.equal(through.world.transports[0].owner, "Alandia");

  // Where the turn writes them, and where the map's time passing asks for them.
  const gameplay = read("gameplay.js");
  assert.match(gameplay, /\.\.\.\(turnFronts\?\.transports \? \{ transports: turnFronts\.transports \} : null\),/);
  const apply = read("frontApply.js");
  // (And an air strike waiting to be flown: runtime/fronts/airStrike.js.)
  assert.match(apply, /const fighting = \(world\) => onBattlefields\(world\) \|\| asArray\(world\?\.transports\)\.some\(isUnderWay\) \|\| /, "a transporter under way is reason enough to fight the period before its story");
  assert.match(apply, /hashOf\(JSON\.stringify\(asArray\(world\?\.transports\)\)\),/, "and a period worked out is kept only while they are as they were");
  assert.match(apply, /transports: asArray\(run\.transports\), voyages: asArray\(run\.voyages\), /);
});

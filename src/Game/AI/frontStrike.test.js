/*! Open Historia — strikes in a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontStrike.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// A missile launch or a bombing run an event tells of is written as a line of
// its own among the orders (nativeFrontLedger.js), becomes a strike of the
// world with its two places found (frontTurn.js), and is kept there for the
// map to play (runtime/strikes.js). It orders nobody and changes nothing.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_WORLD_KEYS } from "../../multiplayer/host/projection.js";
import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { STRIKES_PER_TURN_MOST, STRIKE_COUNT_MOST } from "../../runtime/strikes.js";
import { FRONTS_BLOCK_MAX, buildFrontsBlock } from "./frontPrompt.js";
import { placeStrikes, runTurnFronts } from "./frontTurn.js";
import { bindFrontOrdersToEvents, decodeEventStrikes, decodeFrontOrders, describeDroppedFrontOrders, isStrikeOrder, screenFrontOrders } from "./nativeFrontLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west and Borduria in the east, a wide sea between them.
const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 3, lat: 45, capital: true },
  { name: "Brod", lng: 51, lat: 45, capital: true },
];
const sheet = () => syntheticMap({
  layout: [
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BBBBB~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BBBBB~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BBBBB~",
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  ],
  legend,
  west: 0,
  north: 50,
  step: 2,
  cities,
  key: "strike turn",
});
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: { Aland: polity("Aland"), Borduria: polity("Borduria") },
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [],
  battlefields: [],
  transports: [],
  units: [],
  markers: [],
  ...extra,
});
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "strike turn", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  fromDate: "2024-03-01",
  toDate: "2024-03-11",
  seed: "campaign|2|2024-03-01",
  ...overrides,
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id}`, description: "It happened.", source: "ai", impacts: {}, ...extra });

test("a strike is a line of its own: who, with what, from where, at what, how many shot down, how many", () => {
  const [bombers, silo, submarine, bomb, barrage, vague, unarmed, aimless] = decodeFrontOrders([
    "strike~Aland~bombing run~structure: Alba Air Base~4~city: Brod~3~24",
    "Strike~Aland~Silo Missile~~2~city: Brod~~6",
    "strike~Aland~submarine missile~unit: 3rd Submarine Flotilla~2~city: Brod",
    "strike~Aland~nuclear bomber~~~city: Brod~0~1",
    "strike~Aland~missile strike~~1,2~structure: Brod Refinery~40~120",
    "strike~Aland~death ray~~1~city: Brod",
    "strike~Aland~~~1~city: Brod",
    "strike~Aland~bombing run~~1~",
  ]);
  assert.deepEqual(bombers, { id: "front-0", battlefield: "", side: "Aland", order: "strike", sector: "all", eventIndexes: [3], eventIds: [], objective: "city: Brod", result: "", effort: "", weapon: "bombing run", from: "structure: Alba Air Base", count: 24, down: 3 });
  assert.equal(isStrikeOrder(bombers.order), true);
  // The weapons are the rules' own words, case aside.
  assert.deepEqual([silo.weapon, silo.count, silo.down, silo.from], ["silo missile", 6, 0, ""]);
  assert.deepEqual([submarine.weapon, submarine.count, submarine.from], ["submarine missile", 1, "unit: 3rd Submarine Flotilla"]);
  assert.deepEqual([bomb.weapon, bomb.count, bomb.eventIndexes], ["nuclear bomber", 1, []]);
  assert.deepEqual([barrage.weapon, barrage.count, barrage.down, barrage.eventIndexes], ["missile strike", 120, 40, [0, 1]]);
  // What cannot be drawn says why.
  assert.match(vague.problem, /"death ray" is not a weapon/);
  assert.match(unarmed.problem, /has to say what it is made with/);
  assert.match(aimless.problem, /has to say what it hits/);
  // A word for a weapon that is not the rules' own is no weapon, in English as in any language: the
  // line is left out and said, so the next answer writes it right.
  for (const word of ["ICBM", "cruise missiles", "atomic bomb", "submarine-launched missile", "missile de croisière", "Marschflugkörper", "крылатая ракета"]) {
    assert.match(decodeFrontOrders([`strike~Aland~${word}~~1~city: Brod`])[0].problem, /is not a weapon/, word);
  }
  // How many were shot down may be said in one of the rules' words, by a model that will not count.
  const said = (word, count = 12) => decodeFrontOrders([`strike~Aland~missile strike~~1~city: Brod~${word}~${count}`])[0].down;
  assert.deepEqual(["all", "All.", "most", "half", "some", "none", "", "7", "7 of them"].map((word) => said(word)), [12, 12, 9, 6, 4, 0, 0, 7, 7]);
  // Any other word is no number and no share, whatever its language: none were shot down.
  assert.deepEqual(["intercepted", "All of them", "a few", "tous", "la plupart", "все"].map((word) => said(word)), [0, 0, 0, 0, 0, 0]);
  // A share of a strike that was shot down at all is never none of it: one missile, "some" of it, is that one.
  assert.deepEqual([said("some", 1), said("most", 2), said("none", 1)], [1, 2, 0]);
  // No more shot down than there were, and no more than a strike is ever said to be of.
  const [over, huge] = decodeFrontOrders(["strike~Aland~bombing run~~1~city: Brod~50~12", "strike~Aland~missile strike~~1~city: Brod~~99999"]);
  assert.deepEqual([over.count, over.down], [12, 12]);
  assert.equal(huge.count, STRIKE_COUNT_MOST);
  // A record that already crossed a pass is read again as what it was.
  assert.deepEqual(decodeFrontOrders([bombers]), [bombers]);
});

test("a strike rests on its event, orders nobody, and is drawn whoever's it is", () => {
  const events = [event("e1", "2024-03-02"), event("e2", "2024-03-05")];
  const bound = bindFrontOrdersToEvents(["strike~Aland~silo missile~~2~city: Brod~1~4", "The Border~Aland~advance~all~1", "strike~Aland~trebuchet~~1~city: Brod"], events);
  assert.deepEqual(bound[0].eventIds, ["e2"]);
  // Aland is played by a person. An order of the story's for its troops is left
  // out; its strike is not an order and stays: its event already says it happened.
  const { kept, dropped } = screenFrontOrders(bound, { events, humanSides: ["Aland"] });
  assert.deepEqual(kept.map((order) => order.order), ["strike"]);
  assert.equal(dropped.length, 2);
  assert.match(describeDroppedFrontOrders(dropped), /a strike by Aland: "trebuchet" is not a weapon/);
});

test("a turn's strikes come back with their places found, in peace as in war, and a submarine's is fired from the sea", async () => {
  const map = sheet();
  const markers = [
    { id: "m1", name: "Silo North", kind: "missile silo", ownerCode: "Aland", lng: 5, lat: 47 },
    { id: "m2", name: "Alba Air Base", kind: "airbase", ownerCode: "Aland", lng: 7, lat: 45 },
    { id: "m3", name: "Brod Refinery", kind: "refinery", ownerCode: "Borduria", lng: 53, lat: 43 },
  ];
  const world = worldOn(map, { markers });
  const events = [
    event("e1", "2024-03-03", { places: [{ kind: "city", name: "Brod", lng: 51, lat: 45 }] }),
    event("e2", "2024-03-06"),
  ];
  const orders = bindFrontOrdersToEvents([
    "strike~Aland~silo missile~~1~city: Brod~1~3",
    "strike~Aland~bombing run~structure: Alba Air Base~2~structure: Brod Refinery~4~30",
    "strike~Aland~submarine missile~~2~city: Brod~~2",
    "strike~Aland~nuclear bomber~~2~city: Atlantis~~1",
  ], events);
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders }));
  assert.equal(run.strikes.length, 4);
  const [silo, bombers, submarine, lost] = run.strikes;
  // From the silo its owner has, at the place its event placed.
  assert.deepEqual(silo, { id: "strike:2024-03-11:0", eventId: "e1", date: "2024-03-03", owner: "Aland", weapon: "silo missile", count: 3, down: 1, from: { name: "Silo North", lng: 5, lat: 47 }, to: { name: "city: Brod", lng: 51, lat: 45 } });
  // From where the line says, at a structure of the world's.
  assert.deepEqual([bombers.eventId, bombers.date, bombers.count, bombers.down], ["e2", "2024-03-06", 30, 4]);
  assert.deepEqual(bombers.from, { name: "structure: Alba Air Base", lng: 7, lat: 45 });
  assert.deepEqual(bombers.to, { name: "structure: Brod Refinery", lng: 53, lat: 43 });
  // No fleet of Aland's is on the map: its submarine fires from open water, well off both shores.
  assert.ok(Number.isFinite(submarine.from?.lng) && Number.isFinite(submarine.from?.lat), JSON.stringify(submarine.from));
  assert.ok(submarine.from.lng > 9.5 && submarine.from.lng < 47.5, `at sea, at ${submarine.from.lng}`);
  // A place nobody can find is kept by its name: the map looks for it when it plays the strike.
  assert.deepEqual(lost.to, { name: "city: Atlantis" });
  assert.equal(lost.from.name, "Alba Air Base");
  // Nothing was fought, ordered or moved by any of it.
  assert.deepEqual(run.unitChanges, []);
  assert.deepEqual(run.flips, []);
  assert.deepEqual(run.joins, []);
  assert.equal(run.events.length, 2);
  // The same turn is the same strikes.
  const again = await runTurnFronts(turn(map, world, { events, frontOrders: orders }));
  assert.deepEqual(again.strikes, run.strikes);
  // With a fleet of its own on the map, the submarine's missile leaves from there.
  const fleet = worldOn(map, { markers, units: [{ id: "u1", name: "3rd Submarine Flotilla", type: "naval", ownerCode: "Aland", lng: 20, lat: 47 }] });
  const sailed = await runTurnFronts(turn(map, fleet, { events, frontOrders: orders }));
  assert.deepEqual(sailed.strikes[2].from, { name: "3rd Submarine Flotilla", lng: 20, lat: 47 });
  // A turn with no strike has none, and no more than a turn may add are kept.
  assert.deepEqual((await runTurnFronts(turn(map, world, { events }))).strikes, []);
  const flood = bindFrontOrdersToEvents(Array.from({ length: STRIKES_PER_TURN_MOST + 4 }, () => "strike~Aland~missile strike~~1~city: Brod~~2"), events);
  assert.equal((await runTurnFronts(turn(map, world, { events, frontOrders: flood }))).strikes.length, STRIKES_PER_TURN_MOST);
});

test("what the turn's own lists do not have is asked of the game's reader of places: a city by another name, a launching city", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = [event("e1", "2024-03-03")];
  const orders = bindFrontOrdersToEvents([
    "strike~Aland~missile strike~~1~city: Brodgrad~~8",
    "strike~Aland~bombing run~city: Alba~1~country: Borduria~1~6",
    "strike~Aland~submarine missile~~1~city: Brod~~2",
    "strike~Aland~silo missile~~1~city: Nowhere~~1",
  ], events);
  const asks = [];
  const strikePlaces = {
    // The map knows Brod as Brodgrad too, and a country by its capital.
    find: async (text) => {
      asks.push(["find", text]);
      return /brodgrad|borduria/i.test(text) ? { lng: 51, lat: 45 } : null;
    },
    origin: async ({ owner, weapon, to }) => {
      asks.push(["origin", owner, weapon, to ? `${to.lng},${to.lat}` : "nowhere"]);
      return { name: "city: Alba", lng: 3, lat: 45 };
    },
    seat: async (owner) => {
      asks.push(["seat", owner]);
      return { name: "city: Alba", lng: 3, lat: 45 };
    },
  };
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders, strikePlaces }));
  const [missiles, bombers, submarine, nowhere] = run.strikes;
  // The city by its other name is found, and with nothing of Aland's on the map the missiles leave one of its cities.
  assert.deepEqual(missiles.to, { name: "city: Brodgrad", lng: 51, lat: 45 });
  assert.deepEqual(missiles.from, { name: "city: Alba", lng: 3, lat: 45 });
  // A launching place the turn's own cities have is not asked for; the country struck is.
  assert.deepEqual(bombers.from, { name: "city: Alba", lng: 3, lat: 45 });
  assert.deepEqual(bombers.to, { name: "country: Borduria", lng: 51, lat: 45 });
  // A submarine is not given a city: it is put to sea, on the side of its owner's capital.
  assert.ok(submarine.from.lng > 9.5 && submarine.from.lng < 47.5 && submarine.from.name === "", JSON.stringify(submarine.from));
  // What nobody can find stays a name, and its strike still has somewhere to leave from.
  assert.deepEqual(nowhere.to, { name: "city: Nowhere" });
  assert.deepEqual(nowhere.from, { name: "city: Alba", lng: 3, lat: 45 });
  assert.deepEqual(asks, [
    ["find", "city: Brodgrad"],
    ["origin", "Aland", "missile strike", "51,45"],
    ["find", "country: Borduria"],
    ["find", "city: Nowhere"],
    ["origin", "Aland", "silo missile", "nowhere"],
    ["seat", "Aland"],
  ]);
  // A reader that fails costs the turn nothing: the strike is kept by its names.
  const broken = { find: async () => { throw new Error("no map"); }, origin: async () => { throw new Error("no map"); }, seat: async () => { throw new Error("no map"); } };
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const failed = await runTurnFronts(turn(map, world, { events, frontOrders: orders, strikePlaces: broken }));
    assert.equal(failed.strikes.length, 4);
    assert.deepEqual(failed.strikes[0], { id: "strike:2024-03-11:0", eventId: "e1", date: "2024-03-03", owner: "Aland", weapon: "missile strike", count: 8, down: 0, from: null, to: { name: "city: Brodgrad" } });
  } finally {
    console.warn = quiet;
  }
  // The turn hands the game's own reader over.
  assert.match(read("./gameplay.js"), /strikePlaces: createStrikePlaceReader\(baseWorld\),/);
  assert.match(read("./frontApply.js"), /foretold: foretold === true,\n\s+strikePlaces,/);
});

// "it doesnt look like missile strikes actually ever happen" / "make story events be able to do strikes" (the owner,
// 2026-11-05): a strike was a frontOrders line, read by the battlefield turn alone, and with Fronts off or no war
// there was none. It is written on the event that tells of it (impacts.strikes), in every skip.
test("the story is told how a strike is written, on its event, in every skip", () => {
  const levers = read("./gameplay.js");
  assert.match(levers, /• strikes: a missile launch or a bombing run the event tells of, one line each: side~weapon~from~target~count~shot down\./);
  assert.match(levers, /silo missile \| submarine missile \| nuclear bomber \(these three are nuclear\) \| missile strike \| bombing run/);
  assert.match(levers, /It is drawn on the map and changes nothing itself/);
  for (const block of [buildFrontsBlock({}), buildFrontsBlock({ period: { fromDate: "2024-03-01", toDate: "2024-03-11", battlefields: [], news: [], voyages: [{ k: "sailed", d: "2024-03-02", owner: "Aland", kind: "convoy", n: 4, to: "Brod" }], transports: [] } })]) {
    assert.match(block, /A missile launch or a bombing run is not a front order: it goes in the impacts\.strikes of the event that tells of it/);
    assert.ok(block.length <= FRONTS_BLOCK_MAX);
  }
  // The levers' example reads as the strike it shows, bound to its event, and names no real country or city, which
  // a model copies (as front orders' did, 2254902f).
  const shown = levers.match(/Example: ([^"\n]*~[^"\n]*)",\r?\n/)?.[1];
  assert.equal(shown, "A~missile strike~~city: X~12~some");
  const [example] = decodeEventStrikes([shown], "e7");
  assert.deepEqual([example.problem, example.side, example.weapon, example.from, example.objective, example.count, example.down, example.eventIds], [undefined, "A", "missile strike", "", "city: X", 12, 4, ["e7"]]);
  // A line written the battlefield way is read as that, and an old answer's strike line still is.
  const [old] = decodeEventStrikes("strike~A~bombing run~city: X~4~city: Y~3~24", "e1");
  assert.deepEqual([old.problem, old.weapon, old.from, old.objective, old.down, old.count, old.eventIds], [undefined, "bombing run", "city: X", "city: Y", 3, 24, ["e1"]]);
  const [front] = decodeFrontOrders(["strike~A~bombing run~city: X~4~city: Y~3~24"]);
  assert.equal(front.problem, undefined);
  // What cannot be one says why, and prose is no line.
  assert.deepEqual(decodeEventStrikes(["A~catapult~~city: Y"], "e1").map((strike) => strike.problem), ['"catapult" is not a weapon a strike is made with']);
  assert.deepEqual(decodeEventStrikes("No strikes this time.", "e1"), []);
});

test("an event's strike is placed and kept with the battlefields off, and the world keeps its lines", async () => {
  const events = [{ id: "e1", date: "2024-03-04", places: [{ name: "Brod", lng: 51, lat: 45 }] }];
  const struck = decodeEventStrikes(["Aland~silo missile~structure: North Silo~city: Brod~2~1"], "e1");
  const world = { markers: [{ name: "North Silo", kind: "missile silo", ownerCode: "Aland", lng: 40, lat: 50 }], units: [] };
  const [placed] = await placeStrikes(struck, { events, cities: [{ name: "Brod", lng: 51, lat: 45 }], world, fromDate: "2024-03-01", toDate: "2024-03-31", idPrefix: "event-strike" });
  assert.equal(placed.id, "event-strike:2024-03-31:0");
  assert.deepEqual([placed.eventId, placed.date, placed.owner, placed.weapon, placed.count, placed.down], ["e1", "2024-03-04", "Aland", "silo missile", 2, 1]);
  assert.deepEqual([placed.to.lng, placed.to.lat, placed.from.lng, placed.from.lat], [51, 45, 40, 50]);
  // The world reads an event's lines as written, a string of lines included, and drops what is no line.
  const [event] = normalizeEvents([{ id: "e1", title: "t", date: "2024-03-04", impacts: { strikes: "Aland~bombing run~~city: Brod~6~none\nnothing here" } }]);
  assert.deepEqual(event.impacts.strikes, ["Aland~bombing run~~city: Brod~6~none"]);
  // And the turn places them whether the battlefields ran or not.
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /flatMap\(\(event\) => decodeEventStrikes\(event\?\.impacts\?\.strikes, event\?\.id\)\)/);
  assert.match(gameplay, /\.\.\.\(turnFronts \|\| eventStrikes\.length\s*\n\s*\? \{ strikes: withTurnStrikes\(baseWorld\?\.strikes, \[\.\.\.\(turnFronts\?\.strikes \?\? \[\]\), \.\.\.eventStrikes,/);
});

test("the world keeps its strikes, every player's map is given them, and the turn writes them", () => {
  assert.deepEqual(normalizeWorldState({}).strikes, []);
  const kept = normalizeWorldState({ strikes: [{ id: "s1", owner: "Aland", weapon: "bombing run", count: 12, down: 2, round: 4, to: { name: "city: Brod", lng: 51, lat: 45 } }, { id: "s2", weapon: "catapult" }] }).strikes;
  assert.deepEqual(kept, [{ id: "s1", eventId: "", date: "", round: 4, owner: "Aland", weapon: "bombing run", count: 12, down: 2, from: null, to: { name: "city: Brod", lng: 51, lat: 45 } }]);
  assert.ok(PUBLIC_WORLD_KEYS.includes("strikes"));
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /\.\.\.\(turnFronts \? airStrikeVisuals\(turnFronts\.airStrikes\) : \[\]\)\], nextGame\.round\)/);
  assert.match(gameplay, /import \{ STRIKES_PER_TURN_MOST, fliesAsAircraft, withTurnStrikes \} from "\.\.\/\.\.\/runtime\/strikes\.js";/);
  // A run that could not be made tells of no strike rather than of none it knows.
  // (Nor of the war room's air strikes: they wait to be flown.)
  assert.match(read("./frontApply.js"), /voyages: \[\], strikes: \[\], airStrikes: null \}/);
});

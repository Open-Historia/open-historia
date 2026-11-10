/*! Open Historia — war at sea: a turn's battles, the world after them and what the story is told: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/navalTurn.test.js
//
// "Now let's do a version of this for navy battles."
//
// runtime/naval/engine.test.js checks the engine by itself. This is the turn
// around it: the period's battles come out of the same run the land war does,
// the fleets are the world's formations afterwards, and the skip is told what
// was fought before it writes.
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setActiveFeatures } from "../../runtime/gameFeatures.js";
import { MAX_UNITS_GLOBAL, MAX_UNITS_PER_POLITY, normalizeWorldState } from "../../runtime/gameState.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { BLOCKADE_BITES_DAYS, BLOCKADE_GDP_A_YEAR, gdpUnderBlockade } from "../../runtime/naval/blockade.js";
import { NAVAL_REACH_KM } from "../../runtime/naval/engine.js";
import { frontsLiveBlock, seasLiveBlock, turnBlockades, withBlockadeEconomy, withFrontUnits } from "./frontApply.js";
import { applyFrontUnitChanges, runTurnFronts } from "./frontTurn.js";
import { SEAS_BLOCK_HEADING, SEAS_BLOCK_MAX, buildSeasBlock, describeBlockade, describeSeaBattle } from "./navalPrompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");

// Albion in the west, Teutonia in the east and four degrees of sea between
// them: no border, so the land war has nothing to fight over.
const legend = { A: "Albion", B: "Teutonia", "~": null };
const sheet = () => syntheticMap({ layout: enlarge(["AAA~~~~BBB", "AAA~~~~BBB", "AAA~~~~BBB", "AAA~~~~BBB"], 2), legend, west: 0, north: 54, step: 0.5, cities: [{ name: "Heligoland", lng: 5, lat: 52.6 }] });
const WAR = { id: "war-1", title: "The Great War", status: "active", sideA: ["Albion"], sideB: ["Teutonia"], startedDate: "1914-08-01" };
const fleet = (id, name, ownerCode, lng, lat, extra = {}) => ({ id, name, type: "naval", ownerCode, strength: 100, lng, lat, status: "idle", posture: "patrol", ...extra });
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  countryStats: { Albion: { population: { total: 4e7 } }, Teutonia: { population: { total: 4e7 } } },
  wars: [WAR],
  battlefields: [],
  units: [],
  ...extra,
});
const turn = (map, world, extra = {}) => runTurnFronts({
  createFrontRun,
  staff: false,
  manpower: false,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  fromDate: "1914-08-01",
  toDate: "1914-08-31",
  map: { key: "the narrow sea", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  seed: "campaign|2",
  players: [],
  ...extra,
});
const fleets = () => [
  fleet("u1", "Grand Fleet", "Albion", 4, 52, { posture: "blockade" }),
  fleet("u2", "High Seas Fleet", "Teutonia", 6, 52, { strength: 50 }),
  { id: "u3", name: "1st Army", type: "army", ownerCode: "Albion", strength: 90, lng: 1, lat: 52, status: "idle", posture: "holding" },
];

test("a turn fights the period's sea battles in the run that fights its land war, and the fleets come out of it changed", async () => {
  const map = sheet();
  const world = worldOn(map, { units: fleets() });
  const run = await turn(map, world);
  assert.ok(run.sea, "the sea was fought");
  const [battle] = run.sea.battles;
  assert.ok(battle, "the two fleets met");
  assert.deepEqual([battle.place, battle.warId, battle.winner], ["off Heligoland", "war-1", 0]);
  assert.ok(battle.date > "1914-08-01" && battle.date <= "1914-08-31", battle.date);
  // What it did to them is in the same list of changes the land war's formations are in.
  const grand = run.unitChanges.find((change) => change.unitId === "u1");
  const high = run.unitChanges.find((change) => change.unitId === "u2");
  assert.ok(grand.strength < 100 && high.strength < 50 && 100 - grand.strength < 50 - high.strength, "the lesser fleet lost more");
  assert.equal(high.posture, "withdrawing");
  assert.equal(run.unitChanges.some((change) => change.unitId === "u3"), false, "an army is no part of it");
  // And the world's formations after it: the fleets worn, the beaten one withdrawing, the army as it was.
  const after = withFrontUnits(world, run).units;
  assert.deepEqual(after.map((unit) => [unit.name, unit.strength, unit.posture]), [["Grand Fleet", grand.strength, "blockade"], ["High Seas Fleet", high.strength, "withdrawing"], ["1st Army", 90, "holding"]]);
  // The same turn again is the same battle: forecasting it and then applying it tell one story.
  const again = await turn(map, world);
  assert.deepEqual(again.sea, run.sea);
  assert.deepEqual(again.unitChanges, run.unitChanges);
  // Switched off, the fleets are left alone; and with no war nothing is fought at all.
  const off = await turn(map, world, { naval: false });
  assert.equal(off.sea, null);
  assert.deepEqual(off.unitChanges, []);
  const peace = worldOn(map, { units: fleets(), wars: [{ ...WAR, status: "ended" }] });
  const quiet = await turn(map, peace);
  assert.equal(quiet.sea ?? null, null);
  assert.deepEqual(quiet.unitChanges, []);
});

test("where the lab's own staff leads the land war, an admiral chooses the postures of the fleets nobody plays", async () => {
  // (runtime/naval/admiral.js: "make it also be able to control and understand ... fleets and blockades", the owner.)
  const map = sheet();
  const world = worldOn(map, { units: fleets() });
  const plain = await turn(map, world);
  const led = await turn(map, world, { staffPolicy: () => undefined });
  const chose = led.unitChanges.filter((change) => ["u1", "u2"].includes(change.unitId)).map((change) => [change.unitId, change.posture ?? ""]);
  assert.notDeepEqual(led.unitChanges, plain.unitChanges, JSON.stringify(chose));
  // The outmatched fleet does not go looking for the battle it would lose.
  assert.notEqual(led.unitChanges.find((change) => change.unitId === "u2")?.posture, "assaulting");
  // Fleets people play, and fleets the turn's story ordered, are as they were.
  assert.deepEqual((await turn(map, world, { staffPolicy: () => undefined, players: ["Albion", "Teutonia"] })).unitChanges, plain.unitChanges);
  const ordered = [{ id: "e1", date: "1914-08-02", title: "The fleets put to sea", impacts: { unitOps: [{ op: "update", unitId: "u1" }, { op: "update", unitId: "u2" }] } }];
  assert.deepEqual((await turn(map, world, { staffPolicy: () => undefined, events: ordered })).sea.battles, (await turn(map, world, { events: ordered })).sea.battles);
  // The same turn again is the same choice.
  assert.deepEqual((await turn(map, world, { staffPolicy: () => undefined })).unitChanges, led.unitChanges);
});

test("a country at war with a coast and no fleet has one from the turn on, within the caps on formations", async () => {
  const map = sheet();
  const world = worldOn(map, { units: [fleet("u1", "Grand Fleet", "Albion", 3.5, 52)] });
  const run = await turn(map, world, { toDate: "1914-08-06", unitCaps: { perCountry: MAX_UNITS_PER_POLITY, world: MAX_UNITS_GLOBAL } });
  assert.deepEqual(run.sea.commissioned.map((unit) => [unit.name, unit.type, unit.ownerCode, unit.posture]), [["Teutonia Home Fleet", "naval", "Teutonia", "patrol"]]);
  assert.deepEqual(run.sea.raised, [{ country: "Teutonia", date: "1914-08-01" }]);
  const after = withFrontUnits(world, run);
  assert.deepEqual(after.units.map((unit) => unit.name), ["Grand Fleet", "Teutonia Home Fleet"]);
  // Applied twice it is there once, and the world's own rules for a formation keep it.
  assert.equal(withFrontUnits(after, run).units.length, 2);
  const kept = normalizeWorldState({ ...after, naviesRaised: run.sea.raised }).units.find((unit) => unit.name === "Teutonia Home Fleet");
  assert.ok(kept, "the world keeps it");
  assert.deepEqual([kept.type, kept.ownerCode, kept.posture], ["naval", "Teutonia", "patrol"]);
  // Full up, nobody is commissioned.
  const full = await turn(map, world, { toDate: "1914-08-06", unitCaps: { perCountry: MAX_UNITS_PER_POLITY, world: 1 } });
  assert.deepEqual(full.sea.commissioned, []);
});

test("a change to a formation carries a posture, and a formation the land war took up is left to the land war", () => {
  const units = [fleet("u1", "Grand Fleet", "Albion", 4, 52), fleet("u2", "High Seas Fleet", "Teutonia", 6, 52)];
  const next = applyFrontUnitChanges(units, [{ unitId: "u1", strength: 81.6 }, { unitId: "u2", strength: 40, posture: "withdrawing", lng: 6.5, lat: 52 }]);
  assert.deepEqual(next.map((unit) => [unit.strength, unit.posture, unit.lng]), [[82, "patrol", 4], [40, "withdrawing", 6.5]]);
  const source = read("frontTurn.js");
  // (Nor one an air strike wore: runtime/fronts/airStrike.js.)
  assert.ok(source.includes("...asArray(sea?.unitChanges).filter((change) => ![...asArray(result.unitChanges), ...sorties.unitChanges].some((entry) => clean(entry?.unitId) === clean(change?.unitId)))"));
  assert.ok(source.includes("if (naval !== false && atWar && days > 0) {"));
  assert.ok(source.includes("console.warn(\"[naval] the war at sea could not be fought this turn; the fleets stand as they were.\", error);"), "a sea that cannot be fought never stops the turn");
});

const battle = (extra = {}) => ({
  id: "sea:1914-08-12:0",
  date: "1914-08-12",
  place: "off Heligoland",
  lng: 5,
  lat: 52,
  warId: "war-1",
  sides: [["Albion"], ["Teutonia"]],
  fleets: [[{ id: "u1", name: "Grand Fleet", owner: "Albion", before: 100, after: 88 }], [{ id: "u2", name: "High Seas Fleet", owner: "Teutonia", before: 70, after: 41, broke: true }]],
  winner: 0,
  ...extra,
});

test("a battle is told in a line: who had the better of whom, and what became of each fleet", () => {
  assert.equal(describeSeaBattle(battle()), "1914-08-12 off Heligoland: Albion had the better of Teutonia (Grand Fleet 100% to 88%; High Seas Fleet 70% to 41%, broke off).");
  assert.ok(describeSeaBattle(battle({ winner: 1 })).startsWith("1914-08-12 off Heligoland: Teutonia had the better of Albion (Grand Fleet "));
  assert.ok(describeSeaBattle(battle({ winner: -1, place: "" })).startsWith("1914-08-12 at sea: Albion and Teutonia fought with neither the better of it ("));
  const sunk = battle({ fleets: [[{ name: "Grand Fleet", owner: "Albion", before: 100, after: 90 }, { name: "Escadre du Nord", owner: "Gallia", before: 60, after: 52 }], [{ name: "Coastal Squadron", owner: "Teutonia", before: 22, after: 0, sunk: true }]] });
  assert.ok(describeSeaBattle(sunk).includes("Albion and Gallia had the better of Teutonia"));
  assert.ok(describeSeaBattle(sunk).endsWith("Coastal Squadron 22% to 0%, destroyed)."));
});

test("the skip is told the rules of the sea, the battles already fought and the fleets, by name and in a short block", () => {
  const sea = {
    battles: [battle()],
    commissioned: [{ id: "fleet-gallia-1914-08-01", name: "Gallia Home Fleet", ownerCode: "Gallia" }],
    fleets: [
      { id: "u1", name: "Grand Fleet", owner: "Albion", strength: 88, posture: "blockade", lng: 4, lat: 52, place: "off Heligoland" },
      { id: "u2", name: "High Seas Fleet", owner: "Teutonia", strength: 41, posture: "withdrawing", lng: 6, lat: 52, place: "off Heligoland" },
    ],
  };
  const block = buildSeasBlock({ sea, players: ["Albion"], date: "1914-08-01" });
  const lines = block.split("\n");
  assert.equal(lines[0], SEAS_BLOCK_HEADING);
  assert.ok(lines[1].startsWith("War at sea is decided by the game, as war on land is."));
  assert.ok(lines[1].includes(`within about ${NAVAL_REACH_KM[2]} km of each other fight`), "the reach of the game's own year");
  assert.ok(lines[2].startsWith("A fleet in the blockade posture within about "), "what a blockade is, and what the game does with one");
  assert.ok(lines[3].startsWith("It has ALREADY fought this period's battles, below: tell each as it happened, on its date, and write no unitOps that change those fleets' strength"));
  assert.equal(lines[4], "Albion is played by a person: move its fleets only as an action of this turn orders.");
  assert.deepEqual(lines.slice(5), [
    "Sea battles of this period:",
    "- 1914-08-12 off Heligoland: Albion had the better of Teutonia (Grand Fleet 100% to 88%; High Seas Fleet 70% to 41%, broke off).",
    "- Gallia had no fleet and the game commissioned Gallia Home Fleet in its home waters.",
    "The fleets of the countries at war, as the period leaves them:",
    "- Grand Fleet (Albion): 88% strength, blockade, off Heligoland",
    "- High Seas Fleet (Teutonia): 41% strength, withdrawing, off Heligoland",
  ]);
  // Names, never ids.
  for (const id of ["u1", "u2", "war-1", "sea:1914", "fleet-gallia"]) assert.equal(block.includes(id), false, id);
  // An age of sail reaches less far; two people are each told so.
  assert.ok(buildSeasBlock({ sea, players: ["Albion", "Teutonia"], date: "1750-01-01" }).includes(`within about ${NAVAL_REACH_KM[1]} km`));
  assert.ok(buildSeasBlock({ sea, players: ["Albion", "Teutonia"], date: "1750-01-01" }).includes("Albion, Teutonia are each played by a person: move their fleets only as an action of this turn orders."));
  // However much was fought, the block keeps to its length and says how much it left out.
  const many = { ...sea, battles: Array.from({ length: 16 }, (_, index) => battle({ id: `sea:${index}`, date: `1914-08-${String(index + 10).padStart(2, "0")}` })) };
  const long = buildSeasBlock({ sea: many, players: ["Albion"], date: "1914-08-01" });
  assert.ok(long.length <= SEAS_BLOCK_MAX + 40, String(long.length));
  assert.ok(long.includes("more were fought.)"));
});

test("a turn whose period was not fought beforehand is told the fleets as they stand, and a world with no fleet at war nothing", () => {
  const units = [
    fleet("u1", "Grand Fleet", "Albion", 4, 52, { posture: "blockade" }),
    fleet("u2", "High Seas Fleet", "Teutonia", 6, 52, { strength: 70 }),
    fleet("u4", "Neutral Squadron", "Neutralia", 5, 50),
    fleet("u5", "Landing Fleet", "Albion", 4, 51, { committedTo: "The Landing" }),
    { id: "u3", name: "1st Army", type: "army", ownerCode: "Albion", strength: 90, lng: 1, lat: 52 },
  ];
  const block = buildSeasBlock({ units, wars: [WAR], players: [], date: "1914-08-01" });
  assert.ok(block.includes("It fights them when this period has been written: say only that fleets were sent, and their battles are told to you next period."));
  assert.deepEqual(block.split("\n").slice(4), ["The fleets of the countries at war:", "- Grand Fleet (Albion): 100% strength, blockade", "- High Seas Fleet (Teutonia): 70% strength, patrol"]);
  assert.equal(block.includes("played by a person"), false);
  assert.equal(buildSeasBlock({ units, wars: [{ ...WAR, status: "ended" }], date: "1914-08-01" }), "");
  assert.equal(buildSeasBlock({ units: units.slice(2), wars: [WAR], date: "1914-08-01" }), "");
  assert.equal(buildSeasBlock({ sea: { battles: [], fleets: [], commissioned: [] }, units, wars: [WAR] }), "", "a period fought with no fleet in it says nothing");
});

test("the sea's block stands after the land's in the skip's live records, and is gone with fronts off", () => {
  const map = sheet();
  const world = worldOn(map, { units: fleets() });
  const game = { country: "Albion", gameDate: "1914-08-01", round: 1 };
  const live = frontsLiveBlock(world, game);
  assert.ok(live.includes(`\n\n${SEAS_BLOCK_HEADING}\n`) || live.startsWith(`${SEAS_BLOCK_HEADING}\n`), live.slice(0, 80));
  assert.ok(live.endsWith("- High Seas Fleet (Teutonia): 50% strength, patrol"));
  assert.equal(seasLiveBlock(world, game), live.slice(live.indexOf(SEAS_BLOCK_HEADING)));
  const foreseen = { sea: { battles: [battle()], commissioned: [], fleets: [{ name: "Grand Fleet", owner: "Albion", strength: 88, posture: "blockade", place: "off Heligoland" }] } };
  assert.ok(seasLiveBlock(world, game, foreseen).includes("Sea battles of this period:\n- 1914-08-12 off Heligoland: Albion had the better of Teutonia"));
  try {
    setActiveFeatures({ fronts: { enabled: false } }, null);
    assert.equal(seasLiveBlock(world, game, foreseen), "");
    assert.equal(frontsLiveBlock(world, game, foreseen), "");
  } finally {
    setActiveFeatures(null, null);
  }
});

test("the world keeps the turn's battles and when each navy was made or lost, and a guest sees the battles", () => {
  const world = normalizeWorldState({
    seaBattles: [{ ...battle(), round: 3 }, { id: "", lng: 1, lat: 1 }, "x"],
    naviesRaised: [{ country: "Teutonia", date: "1914-08-12" }, { country: "" }],
  });
  assert.deepEqual(world.seaBattles.map((entry) => [entry.id, entry.round, entry.place, entry.winner, entry.fleets[1][0].broke]), [["sea:1914-08-12:0", 3, "off Heligoland", 0, true]]);
  assert.deepEqual(world.naviesRaised, [{ country: "Teutonia", date: "1914-08-12" }]);
  assert.deepEqual([normalizeWorldState({}).seaBattles, normalizeWorldState({}).naviesRaised], [[], []], "a save from before has neither");
  const gameplay = read("gameplay.js");
  assert.ok(gameplay.includes("...(turnFronts ? { seaBattles: withTurnSeaBattles(baseWorld?.seaBattles, turnFronts.sea?.battles, nextGame.round) } : null),"));
  assert.ok(gameplay.includes("...(turnFronts?.sea ? { naviesRaised: turnFronts.sea.raised } : null),"));
  const apply = read("frontApply.js");
  assert.ok(apply.includes("sea: run.sea ?? null,"), "the forecast carries the sea to the prompt");
  assert.ok(apply.includes("unitCaps: { perCountry: MAX_UNITS_PER_POLITY, world: MAX_UNITS_GLOBAL },"));
});

// ---- blockades ---------------------------------------------------------------------------
// "Make blockades affect the economy and land war."

const sheets = () => ({
  Albion: { population: { total: 4e7 }, economy: { gdp: 2.4e11, gdpPerCapita: 6000 } },
  Teutonia: { population: { total: 4e7 }, economy: { gdp: 2e11, gdpPerCapita: 5000 } },
});
const blockading = () => [fleet("u1", "Grand Fleet", "Albion", 6, 52, { posture: "blockade" })];
// (Teutonia had a navy and lost it: nobody is commissioned one to contest the blockade.)
const NO_NAVY = [{ country: "Teutonia", date: "1914-07-15" }];

test("a turn works out the period's blockades, and the world keeps them with the days they have stood", async () => {
  const map = sheet();
  const world = worldOn(map, { units: blockading(), naviesRaised: NO_NAVY, countryStats: sheets() });
  const run = await turn(map, world);
  const [blockade] = run.sea.blockades;
  assert.deepEqual([run.sea.blockades.length, blockade.country, blockade.by, blockade.days, blockade.covered], [1, "Teutonia", ["Albion"], 30, 1]);
  assert.ok(blockade.pressure > 0.5, String(blockade.pressure));
  assert.deepEqual([run.sea.fromDate, run.sea.days], ["1914-08-01", 30]);
  // The world after the turn, and after the next: the days add up, and it is as old as the day it was laid.
  const first = turnBlockades(world, run);
  assert.deepEqual(first, [{ country: "Teutonia", by: ["Albion"], pressure: blockade.pressure, covered: 1, days: 30, since: "1914-08-01" }]);
  const later = await turn(map, { ...world, blockades: first }, { fromDate: "1914-08-31", toDate: "1914-09-30" });
  const second = turnBlockades({ ...world, blockades: first }, later);
  assert.deepEqual([second[0].days, second[0].since], [60, "1914-08-01"]);
  // The blockader sails home: the turn after, there is none.
  const lifted = await turn(map, { ...world, blockades: second, units: [fleet("u1", "Grand Fleet", "Albion", 3.5, 52, { posture: "holding" })] }, { fromDate: "1914-09-30", toDate: "1914-10-30" });
  assert.deepEqual(turnBlockades({ ...world, blockades: second }, lifted), []);
  // Peace lifts it too, and a turn with fronts off (no run at all) is asked nothing.
  assert.deepEqual(turnBlockades({ blockades: second }, { sea: null }), []);
  assert.deepEqual(normalizeWorldState({ blockades: [...second, { country: "", pressure: 1 }, "x"] }).blockades, second);
  assert.deepEqual(normalizeWorldState({}).blockades, []);
});

test("a blockade is taken off the economy of the country it is laid on, by how hard it pressed and how long", async () => {
  const map = sheet();
  const world = worldOn(map, { units: blockading(), naviesRaised: NO_NAVY, countryStats: sheets() });
  const run = await turn(map, world);
  const [blockade] = run.sea.blockades;
  const patched = [];
  const patch = (next, name, change) => {
    patched.push([name, change]);
    next.countryStats[name] = { ...next.countryStats[name], economy: { ...next.countryStats[name].economy, ...change.economy } };
  };
  const after = withBlockadeEconomy(world, run, patch);
  const expected = Math.round(gdpUnderBlockade(2e11, blockade.pressure, 30));
  assert.deepEqual(patched, [["Teutonia", { economy: { gdp: expected, gdpPerCapita: Math.round(((5000 * expected) / 2e11) * 100) / 100 } }]]);
  assert.ok(expected < 2e11 && expected > 2e11 * (1 - (BLOCKADE_GDP_A_YEAR * 30) / 365) - 1, `${expected}`);
  assert.equal(after.countryStats.Albion, world.countryStats.Albion, "the blockader's own economy is not touched");
  assert.equal(world.countryStats.Teutonia.economy.gdp, 2e11, "and the world handed in is not written to");
  // The same turn applied again from the same world takes it off once.
  assert.equal(withBlockadeEconomy(world, run, patch).countryStats.Teutonia.economy.gdp, expected);
  // Nobody blockaded, no run, a country with no economy on its sheet: the world as it was.
  assert.equal(withBlockadeEconomy(world, { sea: { blockades: [], days: 30 } }, patch), world);
  assert.equal(withBlockadeEconomy(world, null, patch), world);
  const bare = worldOn(map, { countryStats: { Teutonia: { population: { total: 4e7 } } } });
  assert.equal(withBlockadeEconomy(bare, run, patch), bare);
  // A year under the same blockade costs twelve times a month, as near as rounding goes.
  const year = withBlockadeEconomy(world, { sea: { blockades: run.sea.blockades, days: 365 } }, patch).countryStats.Teutonia.economy.gdp;
  assert.ok(Math.abs((2e11 - year) / (2e11 - expected) - 365 / 30) < 0.01, `${2e11 - year} / ${2e11 - expected}`);
  // The turn writes both: what the blockade cost, and the record of it.
  const gameplay = read("gameplay.js");
  assert.ok(gameplay.includes("impactedWorld = withBlockadeEconomy(impactedWorld, turnFronts, applyCountryStatPatchToWorld, { date: nextGame.gameDate, round: nextGame.round });"));
  assert.ok(gameplay.includes("...(turnFronts ? { blockades: turnBlockades(baseWorld, turnFronts) } : null),"));
});

test("the land war of a period is told who is short, by the blockades standing as it begins", async () => {
  const source = read("frontTurn.js");
  assert.ok(source.includes("const short = new Map(naval === false ? [] : normalizeBlockades(world?.blockades).map((record) => [fold(record.country), shortageOfBlockade(record)]).filter(([, lacks]) => lacks > 0));"));
  assert.ok(source.includes("...(short.size > 0 ? { shortageOf: (name) => short.get(fold(name)) ?? 0 } : {}),"));
  // The engine is handed it: a stand-in for the engine reads what the turn gave it.
  const map = sheet();
  // (Every run the turn makes of the engine is handed the same.)
  const handed = async (world, extra = {}) => {
    const seen = new Set();
    const standIn = (input) => {
      seen.add(JSON.stringify(typeof input.shortageOf === "function" ? ["Albion", "Teutonia", "teutonia"].map((name) => input.shortageOf(name)) : null));
      return createFrontRun(input);
    };
    await turn(map, world, { createFrontRun: standIn, ...extra });
    return [...seen];
  };
  const standing = [{ country: "Teutonia", by: ["Albion"], pressure: 0.8, covered: 1, days: BLOCKADE_BITES_DAYS / 2, since: "1914-06-01" }];
  assert.deepEqual(await handed(worldOn(map, { units: fleets(), blockades: standing })), ["[0,0.4,0.4]"], "half its pressure after half the days it takes to bite");
  assert.deepEqual(await handed(worldOn(map, { units: fleets() })), ["null"], "nothing with no blockade");
  assert.deepEqual(await handed(worldOn(map, { units: fleets(), blockades: standing }), { naval: false }), ["null"], "nor with the sea switched off");
});

test("the skip is told of the blockades: who is cut off by whom, how much, for how long, and to leave the GDP to the game", () => {
  assert.equal(describeBlockade({ country: "Teutonia", by: ["Albion", "Gallia"], pressure: 0.613 }, 12), "Teutonia is blockaded by Albion and Gallia: about 61% of its trade is cut, day 12 of the blockade; its armies are beginning to go short.");
  assert.equal(describeBlockade({ country: "Teutonia", by: [], pressure: 1 }, BLOCKADE_BITES_DAYS), `Teutonia is blockaded: about 100% of its trade is cut, day ${BLOCKADE_BITES_DAYS} of the blockade; its armies are short of everything that came by sea.`);
  const standing = [{ country: "Teutonia", by: ["Albion"], pressure: 0.6, covered: 1, days: 75, since: "1914-05-18" }];
  // A period fought beforehand: its own blockade, counted from the day it was first laid.
  const sea = { battles: [], commissioned: [], fleets: [{ name: "Grand Fleet", owner: "Albion", strength: 100, posture: "blockade", place: "off Heligoland" }], blockades: [{ country: "Teutonia", by: ["Albion"], pressure: 0.64, covered: 1, days: 30 }] };
  const fought = buildSeasBlock({ sea, players: [], date: "1914-08-01", blockades: standing });
  assert.ok(fought.includes("\nBlockades of this period:\n- Teutonia is blockaded by Albion: about 64% of its trade is cut, day 105 of the blockade; its armies are short of everything that came by sea.\n"));
  assert.ok(fought.includes(`A fleet in the blockade posture within about ${NAVAL_REACH_KM[2]} km of a coast of a country it is at war with blockades it.`));
  assert.ok(fought.includes("do not change that country's GDP for it yourself."));
  assert.ok(fought.length <= SEAS_BLOCK_MAX);
  // A turn whose period was not fought: those standing.
  const live = buildSeasBlock({ units: fleets(), wars: [WAR], date: "1914-08-01", blockades: standing });
  assert.ok(live.includes("\nBlockades standing:\n- Teutonia is blockaded by Albion: about 60% of its trade is cut, day 75 of the blockade; its armies are beginning to go short.\n"));
  // And a blockade is told even where no fleet is left to list.
  assert.ok(buildSeasBlock({ sea: { battles: [], fleets: [], commissioned: [], blockades: sea.blockades }, date: "1914-08-01" }).includes("Blockades of this period:"));
  // The live block of a world carries its standing blockades.
  const map = sheet();
  assert.ok(seasLiveBlock(worldOn(map, { units: fleets(), blockades: standing }), { country: "Albion", gameDate: "1914-08-01", round: 1 }).includes("Blockades standing:\n- Teutonia is blockaded by Albion"));
});

test("the sea engine uses no arithmetic that differs between machines, and nothing but its seed for chance", () => {
  for (const name of ["engine.js", "blockade.js"]) {
    const engine = fs.readFileSync(path.join(here, "../../runtime/naval", name), "utf8");
    for (const word of ["Math.random", "Date.now", "new Date", "Math.sin", "Math.cos", "Math.tan", "Math.atan", "Math.pow", "Math.exp", "Math.log", "Math.hypot", "**"]) {
      assert.equal(engine.includes(word), false, `${word} in runtime/naval/${name}`);
    }
  }
});

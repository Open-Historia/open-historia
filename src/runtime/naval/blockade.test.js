/*! Open Historia — war at sea: blockades: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/naval/blockade.test.js
//
// "Make blockades affect the economy and land war."

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "../fronts/codec.js";
import { DIFFICULTY_EDGES, POOL_PER_TROOP, SHORTAGE_EDGE } from "../fronts/constants.js";
import { runFronts } from "../fronts/engine.js";
import { FAIR_EDGE, shortEdge, sideShortage } from "../fronts/handicap.js";
import { applyFlips, frontInput, syntheticMap } from "../fronts/syntheticMap.js";
import { readBattlefield } from "../fronts/testKit.js";
import { buildWorldGrid } from "../fronts/worldGrid.js";
import {
  BLOCKADE_BITES_DAYS,
  BLOCKADE_CLOSES,
  BLOCKADE_GDP_A_YEAR,
  BLOCKADE_GDP_PERIOD_MOST,
  BLOCKADE_LEAST,
  BLOCKADE_STATIONS_MOST,
  LAND_TRADE_WEIGHT,
  SEA_TRADE_LEAST,
  dayPressure,
  gdpUnderBlockade,
  normalizeBlockades,
  seaShareOf,
  shortageOfBlockade,
  stationsOf,
  withTurnBlockades,
} from "./blockade.js";
import { NAVAL_REACH_KM, runNaval } from "./engine.js";

const war = (extra = {}) => ({ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"], ...extra });
const fleet = (id, name, ownerCode, lng, lat, extra = {}) => ({ id, name, type: "naval", ownerCode, strength: 100, lng, lat, posture: "patrol", ...extra });
// Albion in the west, Teutonia in the east with Neutralia behind it, and the sea between: some 440 km of coast each.
const narrowSea = (layout = ["AAA~~~~BBBNN", "AAA~~~~BBBNN", "AAA~~~~BBBNN", "AAA~~~~BBBNN"]) => {
  const world = syntheticMap({ layout, legend: { A: "Albion", B: "Teutonia", N: "Neutralia", "~": null }, west: 0, north: 54, step: 1, key: "the narrow sea" });
  return { world, grid: buildWorldGrid(world.regions, { step: 0.5 }) };
};
const sea = (units, { world, grid }, extra = {}) => runNaval({ fromDate: "1914-08-01", days: 30, seed: "a seed", wars: [war()], units, strengthOf: () => 13, controllerOf: world.controllerOf, grid, raised: [{ country: "Albion", date: "1914-07-01" }, { country: "Teutonia", date: "1914-07-01" }], ...extra });
const laid = (result, country = "Teutonia") => result.blockades.find((entry) => entry.country === country) ?? null;

test("how much a country lives by sea: an island by nothing else, and nobody with a coast by less than a floor", () => {
  assert.equal(seaShareOf(40, 0), 1, "an island");
  assert.equal(seaShareOf(0, 40), 0, "no coast: nothing to blockade");
  assert.equal(seaShareOf(30, 30), 30 / (30 + 30 * LAND_TRADE_WEIGHT));
  assert.ok(seaShareOf(30, 30) > 0.5, "a land border carries less than the same stretch of coast");
  assert.equal(seaShareOf(2, 400), SEA_TRADE_LEAST);
  // A long coast is read at a few places along it, evenly.
  const coast = Array.from({ length: 500 }, (_, index) => [index, 0]);
  const stations = stationsOf(coast);
  assert.equal(stations.length, BLOCKADE_STATIONS_MOST);
  assert.deepEqual([stations[0], stations.at(-1)[0] > 480], [[0, 0], true]);
  assert.deepEqual(stationsOf([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);
});

test("a day's pressure: the share of the coast in reach, how well it is closed, and how much of the trade that is", () => {
  const km = (lngA, latA, lngB, latB) => Math.abs(lngA - lngB) * 100 + Math.abs(latA - latB) * 100;
  const stations = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const strong = { lng: 0.5, lat: 0, weight: BLOCKADE_CLOSES * 2 };
  assert.deepEqual(dayPressure({ stations, blockaders: [strong], reach: 100, km, seaShare: 1 }), { pressure: 0.5, covered: 0.5 }, "half the coast, closed");
  assert.deepEqual(dayPressure({ stations, blockaders: [strong], reach: 400, km, seaShare: 1 }), { pressure: 1, covered: 1 });
  assert.deepEqual(dayPressure({ stations, blockaders: [strong], reach: 400, km, seaShare: 0.4 }), { pressure: 0.4, covered: 1 }, "and the rest comes over land");
  // A weak squadron reaches the whole coast and closes a part of it; two together close more.
  const weak = { lng: 1.5, lat: 0, weight: BLOCKADE_CLOSES / 4 };
  assert.deepEqual(dayPressure({ stations, blockaders: [weak], reach: 400, km, seaShare: 1 }), { pressure: 0.25, covered: 1 });
  assert.deepEqual(dayPressure({ stations, blockaders: [weak, weak], reach: 400, km, seaShare: 1 }), { pressure: 0.5, covered: 1 });
  assert.deepEqual(dayPressure({ stations, blockaders: [], reach: 400, km }), { pressure: 0, covered: 0 });
  assert.deepEqual(dayPressure({ stations: [], blockaders: [strong], reach: 400, km }), { pressure: 0, covered: 0 });
});

test("a fleet told to blockade, lying off an enemy's coast, presses on that country; any other fleet there does not", () => {
  const map = narrowSea();
  // Teutonia's coast is 440 km and behind it lies a neutral neighbour: some of its trade still comes over land.
  const off = (posture, extra = {}) => sea([fleet("u1", "Grand Fleet", "Albion", 6.25, 52.25, { posture, ...extra })], map);
  const blockade = laid(off("blockade"));
  assert.deepEqual([blockade.by, blockade.days, blockade.covered], [["Albion"], 30, 1]);
  assert.ok(blockade.pressure > 0.5 && blockade.pressure < 1, String(blockade.pressure));
  assert.equal(laid(off("blockade"), "Albion"), null, "nobody blockades Albion");
  // The posture is the order: a fleet patrolling the same water blockades nobody, nor one that is withdrawing.
  for (const posture of ["patrol", "assaulting", "holding", "withdrawing"]) assert.deepEqual(off(posture).blockades, [], posture);
  // Out of reach of the coast it presses on nobody; nor does a fleet of a country at peace with it.
  assert.deepEqual(sea([fleet("u1", "Grand Fleet", "Albion", 0.25, 60, { posture: "blockade" })], map, { fromDate: "1200-05-01" }).blockades, []);
  assert.deepEqual(sea([fleet("u1", "Neutral Fleet", "Neutralia", 6.25, 52.25, { posture: "blockade" })], map).blockades, []);
  // A weak squadron closes less of it.
  const weak = laid(off("blockade", { strength: 20 }));
  assert.ok(weak.pressure < blockade.pressure * 0.5 && weak.pressure > BLOCKADE_LEAST, `${weak.pressure} / ${blockade.pressure}`);
  // The same blockade again is the same figure.
  assert.deepEqual(off("blockade").blockades, off("blockade").blockades);
});

test("an island lives by the sea alone; a neighbour it is at war with is no way round a blockade", () => {
  const island = narrowSea(["AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~"]);
  const mainland = narrowSea();
  const grand = [fleet("u1", "Grand Fleet", "Albion", 6.25, 52.25, { posture: "blockade" })];
  const alone = laid(sea(grand, island));
  const neighboured = laid(sea(grand, mainland));
  assert.ok(alone.pressure > neighboured.pressure + 0.1, `${alone.pressure} / ${neighboured.pressure}`);
  // Neutralia comes into the war against Teutonia: nothing crosses that border now.
  const encircled = laid(sea(grand, mainland, { wars: [war({ sideA: ["Albion", "Neutralia"] })] }));
  assert.ok(encircled.pressure > neighboured.pressure + 0.1, `${encircled.pressure} / ${neighboured.pressure}`);
  // And as Teutonia's ally its border is as open as ever. (It is given no fleet here: one of its own would tie the blockader down.)
  const noNavies = ["Albion", "Teutonia", "Neutralia"].map((country) => ({ country, date: "1914-07-01" }));
  const allied = laid(sea(grand, mainland, { wars: [war({ sideB: ["Teutonia", "Neutralia"] })], raised: noNavies }));
  assert.equal(allied.pressure, neighboured.pressure);
});

test("in an age of short reach one squadron closes a part of a coast, and the country's own fleet ties a blockader down", () => {
  // A long coast: 1,100 km of it, and galleys that command 150.
  const long = narrowSea(Array.from({ length: 10 }, () => "AAA~~~~BBB~~"));
  const galleys = (units) => laid(sea(units, long, { fromDate: "1200-05-01", days: 1 }));
  const one = galleys([fleet("u1", "Western Fleet", "Albion", 6.25, 53.25, { posture: "blockade" })]);
  assert.ok(one.covered > 0.1 && one.covered < 0.5, String(one.covered));
  const two = galleys([fleet("u1", "Western Fleet", "Albion", 6.25, 53.25, { posture: "blockade" }), fleet("u3", "Southern Fleet", "Albion", 6.25, 46.25, { posture: "blockade" })]);
  assert.ok(two.covered > one.covered * 1.6 && two.pressure > one.pressure * 1.6, `${two.covered} / ${one.covered}`);

  // A weak blockader with the country's fleet lying in reach of it: most of what it has is tied down.
  const map = narrowSea(["AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~"]);
  const weak = fleet("u1", "Light Squadron", "Albion", 6.25, 52.25, { posture: "blockade", strength: 40 });
  const run = (units) => sea(units, map, { days: 1, seed: "quiet" });
  const free = run([weak]);
  const contested = run([weak, fleet("u2", "High Seas Fleet", "Teutonia", 6.75, 52.25, { posture: "holding" })]);
  assert.deepEqual(contested.battles, [], "(nobody fought that day)");
  assert.ok(laid(contested).pressure < laid(free).pressure * 0.5, `${laid(contested).pressure} / ${laid(free).pressure}`);
  // A fleet that has withdrawn ties nobody down.
  const hiding = run([weak, fleet("u2", "High Seas Fleet", "Teutonia", 6.75, 52.25, { posture: "withdrawing" })]);
  assert.equal(laid(hiding).pressure, laid(free).pressure);
});

test("a blockader beaten off is a blockade lifted: the period's pressure is the mean of its days", () => {
  const map = narrowSea(["AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~", "AAA~~~~BBB~~"]);
  // A light squadron blockades, and Teutonia's whole fleet comes out to lift it.
  const units = [fleet("u1", "Light Squadron", "Albion", 6.25, 52.25, { posture: "blockade", strength: 45 }), fleet("u2", "High Seas Fleet", "Teutonia", 6.75, 53.25, { posture: "assaulting" })];
  const result = sea(units, map, { days: 60 });
  const [battle] = result.battles;
  assert.ok(battle && battle.winner === 1, "the blockader was beaten");
  const blockade = laid(result);
  assert.ok(blockade === null || blockade.days < 60, "it stood only until then");
  if (blockade) assert.equal(blockade.days, battle.day - 1 >= 0 ? blockade.days : 0);
  const unopposed = laid(sea([units[0]], map, { days: 60 }));
  assert.equal(unopposed.days, 60);
  assert.ok((blockade?.pressure ?? 0) < unopposed.pressure * 0.6, `${blockade?.pressure} / ${unopposed.pressure}`);
  // Without the sheet of the map nobody's coast is known: no blockade is worked out.
  assert.deepEqual(sea([units[0]], { world: map.world, grid: null }).blockades, []);
});

test("the world keeps a blockade with the days it has stood, and lifts one a period no longer pressed", () => {
  const period = [{ country: "Teutonia", by: ["Albion", "Albion", ""], pressure: 0.6123456, covered: 0.9, days: 30 }, { country: "Gallia", by: ["Teutonia"], pressure: 0.001, days: 30 }];
  const first = withTurnBlockades([], period, "1914-08-01");
  assert.deepEqual(first, [{ country: "Teutonia", by: ["Albion"], pressure: 0.612, covered: 0.9, days: 30, since: "1914-08-01" }], "a pressure too small to speak of is no blockade");
  const second = withTurnBlockades(first, [{ country: "teutonia", by: ["Albion"], pressure: 0.7, covered: 1, days: 31 }], "1914-08-31");
  assert.deepEqual([second[0].days, second[0].since, second[0].pressure], [61, "1914-08-01", 0.7]);
  // The same turn applied again from the same world is the same record.
  assert.deepEqual(withTurnBlockades(first, [{ country: "teutonia", by: ["Albion"], pressure: 0.7, covered: 1, days: 31 }], "1914-08-31"), second);
  assert.deepEqual(withTurnBlockades(second, [], "1914-10-01"), [], "lifted");
  assert.deepEqual(withTurnBlockades(second, undefined, ""), []);
  assert.deepEqual(normalizeBlockades([{ country: "X" }, null, "y", { country: "", pressure: 1 }, { country: "Z", pressure: 3, days: -4 }]), [{ country: "Z", by: [], pressure: 1, covered: 0, days: 0, since: "" }]);
});

test("what it costs: a fifth of the economy in a year at full pressure, and on land the more the longer it stands", () => {
  assert.equal(gdpUnderBlockade(1000, 1, 365), 1000 * (1 - BLOCKADE_GDP_A_YEAR));
  assert.ok(Math.abs(gdpUnderBlockade(1000, 0.5, 30) - 1000 * (1 - (BLOCKADE_GDP_A_YEAR * 0.5 * 30) / 365)) < 1e-9);
  assert.equal(gdpUnderBlockade(1000, 0, 365), 1000);
  assert.equal(gdpUnderBlockade(1000, 1, 0), 1000);
  assert.equal(gdpUnderBlockade(1000, 1, 365 * 20), 1000 * (1 - BLOCKADE_GDP_PERIOD_MOST), "one period never takes more than half");
  assert.equal(gdpUnderBlockade(1000, 7, 365), 1000 * (1 - BLOCKADE_GDP_A_YEAR), "a pressure is at most 1");
  assert.ok(Number.isNaN(gdpUnderBlockade(undefined, 1, 30)) && gdpUnderBlockade(0, 1, 30) === 0, "no economy on the sheet: nothing to take it from");
  // Stockpiles last a while: a blockade just laid has hardly begun to bite on land.
  assert.equal(shortageOfBlockade({ pressure: 0.8, days: 0 }), 0);
  assert.equal(shortageOfBlockade({ pressure: 0.8, days: BLOCKADE_BITES_DAYS / 2 }), 0.4);
  assert.equal(shortageOfBlockade({ pressure: 0.8, days: BLOCKADE_BITES_DAYS }), 0.8);
  assert.equal(shortageOfBlockade({ pressure: 0.8, days: BLOCKADE_BITES_DAYS * 9 }), 0.8);
  assert.equal(shortageOfBlockade({ pressure: 0.001, days: 400 }), 0);
  assert.equal(shortageOfBlockade(null), 0);
});

test("a side that is short is weighed for it: slower to mend, fewer reserves, a little weaker and slower", () => {
  assert.equal(shortEdge(FAIR_EDGE, 0), FAIR_EDGE, "short of nothing: the edge itself");
  assert.equal(shortEdge(DIFFICULTY_EDGES.hard, undefined), DIFFICULTY_EDGES.hard);
  assert.deepEqual(shortEdge(FAIR_EDGE, 1), { power: 1 - SHORTAGE_EDGE.power, pace: 1 - SHORTAGE_EDGE.pace, reserves: 1 - SHORTAGE_EDGE.reserves, mend: 1 - SHORTAGE_EDGE.mend });
  assert.deepEqual(shortEdge(FAIR_EDGE, 5), shortEdge(FAIR_EDGE, 1));
  const half = shortEdge(DIFFICULTY_EDGES.hard, 0.5);
  assert.equal(half.reserves, DIFFICULTY_EDGES.hard.reserves * (1 - SHORTAGE_EDGE.reserves / 2), "on top of what the difficulty gives");
  assert.ok(SHORTAGE_EDGE.mend >= SHORTAGE_EDGE.power * 2, "it is supply that a blockade cuts, more than courage");
  // A side is short by its members, each by what it brings.
  const lacks = (name) => ({ Teutonia: 0.8, Austria: 0 })[name] ?? 0;
  assert.equal(sideShortage(["Teutonia"], lacks, () => 10), 0.8);
  assert.equal(sideShortage(["Teutonia", "Austria"], lacks, () => 10), 0.4);
  assert.equal(sideShortage(["Teutonia", "Austria"], lacks, (name) => (name === "Teutonia" ? 30 : 10)), 0.6);
  assert.equal(sideShortage(["Austria"], lacks, () => 10), 0);
  assert.equal(sideShortage(["Teutonia"], null, () => 10), 0);
  assert.equal(sideShortage([], lacks, () => 10), 0);
});

// An even fight on an even sheet (fronts/handicap.test.js): Borduria advances for `days`.
const legend = { A: "Aland", B: "Borduria", "~": null };
const field = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "shortage" });
const fight = ({ short = null, attacker = "Borduria", days = 20, battlefields = undefined, fromDate = undefined } = {}) => {
  const world = field();
  const input = frontInput(world, {
    arenas: new Map(),
    days,
    moments: [{ day: 0, type: "order", battlefield: "The Front", side: attacker, order: "advance", sector: "all" }],
    ...(battlefields ? { battlefields, fromDate } : {}),
    ...(short ? { shortageOf: (name) => short[name] ?? 0 } : {}),
  });
  const result = runFronts(input);
  applyFlips(world, result.flips);
  const [record] = result.battlefields;
  const { held } = readBattlefield(record, world);
  return { record, share: held[0] / (held[0] + held[1]) };
};
const strength = (record, side) => decodeTroops(record.troops[side]).reduce((sum, troop) => sum + Math.max(0, troop.strength), 0);

test("on land a country cut off from the sea loses ground it would have held, and gains less than it would have", () => {
  const plain = fight();
  // Nobody short, and a shortage of nothing, are the engine as it was.
  assert.deepEqual(fight({ short: {} }).record, plain.record);
  assert.deepEqual(fight({ short: { Aland: 0, Borduria: 0 } }).record, plain.record);
  // Aland, attacked, keeps less of the sheet when it is the one blockaded; and more when its attacker is.
  const starved = fight({ short: { Aland: 1 } });
  const relieved = fight({ short: { Borduria: 1 } });
  assert.ok(starved.share < plain.share - 0.02, `blockaded: ${starved.share} against ${plain.share}`);
  assert.ok(relieved.share > plain.share + 0.02, `its attacker blockaded: ${relieved.share} against ${plain.share}`);
  // Half a shortage is between the two.
  const partly = fight({ short: { Aland: 0.5 } });
  assert.ok(partly.share <= plain.share && partly.share >= starved.share, `${starved.share} / ${partly.share} / ${plain.share}`);
  // It is in the reserves a side is raised with: the same army in numbers, with half behind it.
  const raised = fight({ short: { Borduria: 1 }, days: 0 }).record;
  const usual = fight({ days: 0 }).record;
  const troops = decodeTroops(usual.troops[1]).length;
  assert.equal(decodeTroops(raised.troops[1]).length, troops);
  assert.equal(usual.pool[1], troops * POOL_PER_TROOP);
  assert.equal(raised.pool[1], troops * POOL_PER_TROOP * (1 - SHORTAGE_EDGE.reserves));
  assert.equal(raised.pool[0], usual.pool[0], "the other side is raised as ever");
  // And nothing of it is kept with the record: a blockade lifted counts from the next run.
  assert.equal(Object.hasOwn(raised, "edge"), false);
  const next = (short) => fight({ short, battlefields: [usual], fromDate: "2024-03-01", days: 15 });
  assert.ok(strength(next({ Aland: 1 }).record, 0) < strength(next(null).record, 0), "its troops are worn down faster than they are made good");
  assert.ok(NAVAL_REACH_KM.length === 4);
});

test("under a blockade, a place on a frozen coast is shut by the ice; ice alone blockades nobody", () => {
  const km = (lngA, latA, lngB, latB) => Math.abs(lngA - lngB) * 100 + Math.abs(latA - latB) * 100;
  const stations = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const strong = { lng: 0.5, lat: 0, weight: BLOCKADE_CLOSES * 2 };
  const iced = (lng) => lng >= 2;
  assert.deepEqual(dayPressure({ stations, blockaders: [strong], reach: 100, km, seaShare: 1 }), { pressure: 0.5, covered: 0.5 });
  assert.deepEqual(dayPressure({ stations, blockaders: [strong], reach: 100, km, seaShare: 1, iced }), { pressure: 1, covered: 0.5 }, "the fleet closes half, the ice the rest");
  assert.deepEqual(dayPressure({ stations, blockaders: [], reach: 100, km, seaShare: 1, iced }), { pressure: 0, covered: 0 });
});

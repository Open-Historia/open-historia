/*! Open Historia — more troops for a front, and half as many to begin with: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontDraft.test.js
//
// "Make it so actions can deploy more troops to fronts. This allows the user
// to do a draft for more troops or send reinforcements. By default have half
// as many troops as right now."
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "../../runtime/fronts/codec.js";
import {
  REINFORCED_LINE_MOST,
  REINFORCED_SIZE_MOST,
  REINFORCE_MOST,
  REINFORCE_ORDER,
  TROOPS_LINE_KM_EACH,
  TROOPS_MIN,
  TROOPS_PER_STRENGTH,
  TROOP_STATES,
} from "../../runtime/fronts/constants.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { FRONT_ORDER_TOOL, readGivenOrders } from "./frontOrderFunction.js";
import { buildFrontsBlock, describePeriod } from "./frontPrompt.js";
import { planFrontMoments, runTurnFronts } from "./frontTurn.js";
import { decodeFrontOrders } from "./nativeFrontLedger.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: enlarge(["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], 2), legend, west: 20, north: 53, step: 0.5, stepLat: 0.4, cities: [] });
const theWar = { id: "war-1", title: "The War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01" };
const event = (id, date) => ({ id, date, title: id, description: "x", impacts: {} });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0);

// A war between the two, a period at a time: nobody attacks unless a test says so.
const begin = (extra = {}) => {
  const map = sheet();
  const world = {
    customRegions: true,
    regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
    countryStats: { Aland: { population: { total: 4e6 } }, Borduria: { population: { total: 4e6 } } },
    wars: [theWar],
    battlefields: [],
    units: [],
  };
  return { map, world, ...extra };
};
const turn = async (state, { from = "2024-03-01", to = "2024-03-11", frontOrders = [], events = [], players = ["Aland"], seed = "campaign|2", ...extra } = {}) => {
  const run = await runTurnFronts({
    createFrontRun,
    world: state.world,
    events,
    frontOrders,
    warStages: [state.world.wars],
    fromDate: from,
    toDate: to,
    map: { key: "the draft sheet", cities: [], flat: false },
    baseOwners: new Map(state.map.regions.map((region) => [region.id, state.map.controllerOf(region.id)])),
    regionIds: state.map.regions.map((region) => region.id),
    arenas: new Map(),
    loadRegions: async () => state.map.regions,
    seed,
    players,
    // (Every side is left to the orders this file gives it, and to no limit of men but the draft's own:
    // what a country has the men for is runtime/fronts/manpower.test.js.)
    staff: false,
    manpower: false,
    ...extra,
  });
  state.world = { ...state.world, battlefields: run.battlefields ?? state.world.battlefields };
  return run;
};

test("by default a side raises half the troops it did: half for each point of strength, on a line with room for half", async () => {
  assert.deepEqual([TROOPS_PER_STRENGTH, TROOPS_LINE_KM_EACH, TROOPS_MIN], [6, 3, 3]);
  const now = await turn(begin());
  // (A run told to raise twice the usual raises what the game used to.)
  const before = await turn(begin(), { troops: 2 });
  const [mine, theirs] = [live(now.battlefields[0], 0).length, live(now.battlefields[0], 1).length];
  assert.ok(mine >= 6 && mine === theirs, `${mine} and ${theirs}`);
  const [was, wasTheirs] = [live(before.battlefields[0], 0).length, live(before.battlefields[0], 1).length];
  assert.ok(Math.abs(was - mine * 2) <= 1 && Math.abs(wasTheirs - theirs * 2) <= 1, `${mine} now, ${was} before`);
});

test("an order for more troops is read from a line: reinforce, a draft, a mobilisation, with how many", () => {
  const read = (line) => decodeFrontOrders([line]).map(({ side, order, sector, count, objective, problem }) => [side, order, sector, count, objective, problem])[0];
  assert.equal(REINFORCE_ORDER, "reinforce");
  assert.deepEqual(read("The War~Aland~reinforce~south~1~30"), ["Aland", "reinforce", "south", 30, "", undefined]);
  for (const word of ["draft", "Mobilise", "mobilization", "send reinforcements", "conscription", "reinforcements"]) {
    assert.deepEqual(read(`The War~Aland~${word}~all~1~12 divisions`), ["Aland", "reinforce", "all", 12, "", undefined], word);
  }
  // No number leaves it to the game; more than an order may bring is the most it may.
  assert.deepEqual(read("The War~Aland~reinforce~all~1"), ["Aland", "reinforce", "all", undefined, "", undefined]);
  assert.deepEqual(read("The War~Aland~reinforce~all~1~5000"), ["Aland", "reinforce", "all", REINFORCE_MOST, "", undefined]);
  // The turn hands the number to the engine with the order.
  const [moment] = planFrontMoments({ events: [event("e1", "2024-03-04")], frontOrders: decodeFrontOrders(["The War~Aland~reinforce~south~1~30"]).map((order) => ({ ...order, eventIds: ["e1"] })), fromDate: "2024-03-01", days: 10, dayOf: () => 3 });
  assert.deepEqual([moment.order, moment.count, moment.sector, moment.day], ["reinforce", 30, "south", 3]);
});

test("a player's action that drafts troops reaches the front through the function the skip calls", () => {
  assert.match(FRONT_ORDER_TOOL.schema.properties.orders.description, /A draft or reinforcements sent to a front is the order reinforce, with how many formations \(1 to 60\) as its objective\./);
  const { given, refused } = readGivenOrders("The War~Aland~reinforce~north~2024-03-04~25\nThe War~Borduria~reinforce~all~~10", { players: ["Aland"], fromDate: "2024-03-01", days: 10 });
  assert.deepEqual(given.map(({ side, order, sector, count, now, date, day }) => [side, order, sector, count, now, date, day]), [["Aland", "reinforce", "north", 25, true, "2024-03-04", 3]]);
  assert.equal(refused.length, 1, "nobody drafts a country they do not play");
});

test("the draft brings fresh formations to the stretch of line it names, with their reserves, on the day it is given", async () => {
  const state = begin();
  const opened = await turn(state);
  const [before] = opened.battlefields;
  const had = live(before, 0).length;
  const reserves = before.brief.strength[0].reserves;
  // The player drafts twelve formations for the north on the 14th.
  const run = await turn(state, {
    from: "2024-03-11", to: "2024-03-21", seed: "campaign|3",
    frontOrders: [{ id: "given-0", battlefield: before.name, side: "Aland", order: "reinforce", sector: "north", count: 12, eventIds: [], now: true, date: "2024-03-14" }],
  });
  const [after] = run.battlefields;
  assert.deepEqual(run.notes, []);
  assert.equal(live(after, 0).length, had + 12);
  assert.equal(live(after, 1).length, live(before, 1).length, "nobody was raised for the other side");
  assert.equal(after.brief.strength[0].n, had + 12);
  assert.notEqual(after.brief.strength[0].reserves, undefined);
  // (They arrive in the north; the line then evens itself out along its length, as it does with any troops.)
  // And the war is told of it, on its date.
  assert.deepEqual(run.news.filter((entry) => entry.k === "drafted").map((entry) => [entry.d, entry.s, entry.at, entry.n]), [["2024-03-14", 0, "12 fresh formations in the north", 12]]);
  assert.match(describePeriod({ record: after, before, news: run.news }), /This period, by date: 2024-03-14 Aland brought up 12 fresh formations in the north\./);
  assert.equal(typeof reserves, typeof after.brief.strength[0].reserves);
});

test("fresh troops come under what their stretch of the line is told, and no number is a quarter of the side's usual", async () => {
  const state = begin();
  const [opened] = (await turn(state, { events: [event("e1", "2024-03-02")], frontOrders: [{ id: "front-0", battlefield: "The War", side: "Aland", order: "dig in", sector: "all", eventIds: ["e1"] }] })).battlefields;
  const had = live(opened, 0).length;
  assert.ok(live(opened, 0).every((troop) => TROOP_STATES[troop.state] === "dug in"), "the line is dug in");
  const run = await turn(state, { from: "2024-03-11", to: "2024-03-21", seed: "campaign|3", frontOrders: [{ id: "given-0", battlefield: opened.name, side: "Aland", order: "reinforce", sector: "all", eventIds: [], now: true, date: "2024-03-12" }] });
  const [after] = run.battlefields;
  const came = live(after, 0).length - had;
  assert.equal(came, Math.max(2, Math.round(had * 0.25)), `${came} came to ${had}`);
  assert.ok(live(after, 0).every((troop) => TROOP_STATES[troop.state] === "dug in"), "and those who came dug in with it");
  assert.deepEqual(run.news.filter((entry) => entry.k === "drafted").map((entry) => entry.at), [`${came} fresh formations along its whole line`]);
});

test("a draft does not stack a front: a side is brought to so many times its usual number and no further", async () => {
  const state = begin();
  const [opened] = (await turn(state)).battlefields;
  const usual = live(opened, 0).length;
  let record = opened;
  let notes = [];
  for (let round = 0; round < 6; round += 1) {
    const run = await turn(state, {
      from: `2024-0${4 + round}-01`, to: `2024-0${4 + round}-11`, seed: `campaign|${3 + round}`,
      frontOrders: [{ id: "given-0", battlefield: opened.name, side: "Aland", order: "reinforce", sector: "all", count: REINFORCE_MOST, eventIds: [], now: true, date: `2024-0${4 + round}-02` }],
    });
    [record] = run.battlefields;
    notes = run.notes;
  }
  const most = live(record, 0).length;
  assert.ok(most > usual && most <= Math.max(REINFORCED_SIZE_MOST * usual, usual), `${usual} became ${most}`);
  assert.ok(most <= REINFORCED_LINE_MOST * Math.floor(record.brief.km / TROOPS_LINE_KM_EACH) || most <= REINFORCED_SIZE_MOST * usual);
  // The last of them brought nobody, and said why.
  assert.ok(notes.some((note) => /More troops were not brought to a front \(Aland on .+\): that side has all the troops its strength and its line can carry there\./.test(note.text)), JSON.stringify(notes));
});

test("a country nobody plays mobilises in an event of the story, and not by a line with nothing behind it", async () => {
  const state = begin();
  const [opened] = (await turn(state)).battlefields;
  const had = live(opened, 1).length;
  const loose = await turn(state, { from: "2024-03-11", to: "2024-03-21", seed: "campaign|3", frontOrders: [{ id: "front-0", battlefield: opened.name, side: "Borduria", order: "reinforce", sector: "all", count: 10, eventIds: [] }] });
  assert.equal(live(loose.battlefields[0], 1).length, had);
  assert.ok(loose.notes.some((note) => /More troops were not brought to a front \(Borduria on .+\): a country nobody plays mobilises or sends reinforcements in an event of the answer/.test(note.text)), JSON.stringify(loose.notes));
  const told = await turn(state, { from: "2024-03-21", to: "2024-03-31", seed: "campaign|4", events: [event("e1", "2024-03-24")], frontOrders: [{ id: "front-0", battlefield: opened.name, side: "Borduria", order: "reinforce", sector: "all", count: 10, eventIds: ["e1"] }] });
  assert.equal(live(told.battlefields[0], 1).length, had + 10);
  assert.deepEqual(told.news.filter((entry) => entry.k === "drafted").map((entry) => [entry.d, entry.s, entry.n]), [["2024-03-24", 1, 10]]);
});

test("the story is told how more troops are brought to a front", async () => {
  const block = buildFrontsBlock({ battlefields: [], players: ["Aland"] });
  assert.match(block, /- order: advance \| blitz \| spearhead \| flank \| encircle \| assault \| hold \| dig in \| fall back \| withdraw \| land \| reinforce\./);
  assert.match(block, /- reinforce brings FRESH formations to a side's line: a draft, a mobilisation, divisions sent from elsewhere\. Its objective field is how many formations \(1 to 60\), judged against how many that side has there now \(Strength\)/);
  assert.match(block, /A person's action that drafts troops or sends reinforcements to a front is such a line for their country; a country nobody plays gets one only with the number of the event in which it mobilises\./);
  assert.ok(block.split("\n").includes("NAME~A~reinforce~south~4~30"));
  assert.match(block, /a draft of thirty formations for the south is `NAME~X~reinforce~south~4~30`/);
  // With the function that fights the period again, the draft is given there.
  const run = await turn(begin());
  const period = { fromDate: "2024-03-01", toDate: "2024-03-11", days: 10, battlefields: run.battlefields, news: run.news, voyages: [], transports: [] };
  const fought = buildFrontsBlock({ battlefields: run.battlefields, players: ["Aland"], period, orderFunction: true });
  assert.match(fought, /to draft more troops or send reinforcements to a front, or anything of the kind\), call order_troops FIRST/);
  assert.match(fought, /a draft of thirty formations for the south is `NAME~X~reinforce~south~~30`/);
});

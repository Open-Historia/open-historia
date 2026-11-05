/*! Open Historia — who commands what, in a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontCommand.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// Three things a turn has to get right about command:
//   - what a person TYPES as an action is their order ("I withdraw my troops",
//     "north-west dig trenches, the south pushes for the city"): the skip's
//     model gives it to their troops through a function, the period is fought
//     again with it, and it is carried out in that very skip;
//   - on a side of several countries each commands its own, and an ally of a
//     player's does what the two agreed in their talks;
//   - a war between countries nobody plays is fought like any other.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeEvents } from "../../runtime/gameState.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { playerFronts } from "../GameUI/warRoomData.js";
import { FRONT_ORDER_FUNCTION, GIVEN_ORDERS_MOST, readGivenOrders, withFrontOrderFunction } from "./frontOrderFunction.js";
import { alliesRule, buildFrontsBlock } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";
import { bindFrontOrdersToEvents, screenFrontOrders } from "./nativeFrontLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west (with Cisland, its ally, south of it) and Borduria all along their east.
const legend = { A: "Aland", C: "Cisland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 21.5, lat: 51.5, capital: true },
  { name: "Brod", lng: 26.5, lat: 50.6, capital: true },
  { name: "Cis", lng: 21.5, lat: 50.4, capital: true },
];
const sheet = (layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"]) => syntheticMap({ layout, legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities, key: `command ${layout.join("")}` });
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map, wars, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: Object.fromEntries(["Aland", "Borduria", "Cisland", "Neutralia"].map((name) => [name, polity(name)])),
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 2e6 } }, Cisland: { population: { total: 1e6 } } },
  wars,
  battlefields: [],
  transports: [],
  units: [],
  ...extra,
});
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  // (Every side is left to the orders this test gives it: a side's own staff is tested in frontStaff.test.js.)
  staff: false,
  // (And nobody is held to the men his country has: these fights were worked out before recruitment drew on them, runtime/fronts/manpower.test.js.)
  manpower: false,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: map.map.key, cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  fromDate: "2024-03-01",
  toDate: "2024-03-11",
  seed: "campaign|2|2024-03-01",
  ...overrides,
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id}`, description: "Orders go down the line.", source: "ai", impacts: {}, ...extra });
// A side's living troops with where they stand: [{ lng, lat, state }].
const troopsOf = (record, side) => {
  const { toLngLat } = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).map((troop) => {
    const [lng, lat] = toLngLat(troop.x, troop.y);
    return { lng, lat, state: troop.state, owner: troop.owner };
  });
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const STATE_DUG_IN = 4;

// "No, the action should not keyword, just make the ai function call to
// regenerate the events with that action. Make it so the battle that happens
// that's given to the ai's context before it generates the events is basically
// what would happen if the user does not give any actions that change that."
test("a player's typed order reaches their troops through the function the skip's model calls, and the period is fought again with it", async () => {
  // Nothing reads an action's words for troop commands any more: the period is always fought first.
  const skip = read("./gameplay.js");
  assert.equal(skip.includes("actionsCommandTroops"), false);
  assert.equal(read("./frontApply.js").includes("COMMAND_WORDS"), false);
  assert.match(skip, /const foughtBefore = await forecastTurnFronts\(\{\s*world: bundle\.world,/);
  assert.match(skip, /if \(frontsForecast\) frontsForecast\.orderFunction = segmentCount === 1 && plannedActionCount > 0;/);
  assert.match(skip, /lookups: withFrontOrderFunction\(buildTaskLookups\(segmentBundle\), frontOrderCall\(context\)\),/);
  assert.match(skip, /frontsGiven: normalizeArray\(context\.variables\?\.frontsForecast\?\.given\),/);
  assert.match(skip, /givenOrders: normalizeArray\(result\.frontsGiven\),/);
  // (It is no lookup: the lookup directive is not said for it alone.)
  assert.match(skip, /lookups\.tools\.some\(\(tool\) => tool\?\.name !== FRONT_ORDER_FUNCTION\)\) blocks\.push\(LOOKUP_DIRECTIVE\);/);

  // The lines of a call: the player's own, each with the day it is given.
  const read2 = (text) => readGivenOrders(text, { players: ["Aland"], fromDate: "2024-03-01", days: 10 });
  const { given, refused } = read2([
    "The Front~Aland~dig in~north~~",
    "The Front~Aland~push~south~2024-03-04~city: Brod",
    "The Front~Aland~withdraw~all~2025-01-01",
    "The Front~Borduria~advance~all~~",
    "strike~Aland~missile strike~~~city: Brod",
    "The Front~Aland~dance~all~~",
  ].join("\n"));
  assert.deepEqual(given.map((order) => [order.side, order.order, order.sector, order.objective, order.date, order.day, order.now]), [
    ["Aland", "dig in", "north", "", "2024-03-01", 0, true],
    ["Aland", "advance", "south", "city: Brod", "2024-03-04", 3, true],
    // (A day outside the period is its first.)
    ["Aland", "withdraw", "all", "", "2024-03-01", 0, true],
  ]);
  assert.equal(refused.length, 3);
  assert.match(refused.join("\n"), /Borduria is not a country a person plays/);
  assert.match(refused.join("\n"), /a strike or a transporter goes in frontOrders/);
  assert.equal(read2(Array.from({ length: 20 }, () => "The Front~Aland~hold~all~~").join("\n")).given.length, GIVEN_ORDERS_MOST);

  // The function beside a task's others: it is answered once, and the rest still answer.
  const fought = [];
  const offered = withFrontOrderFunction({ tools: [{ name: "list_powers", schema: {} }], execute: async (name) => `looked up ${name}`, maxRounds: 2 }, {
    players: ["Aland"], fromDate: "2024-03-01", days: 10,
    refight: async (orders) => { fought.push(orders); return "- The Front: as it now went."; },
  });
  assert.deepEqual(offered.tools.map((tool) => tool.name), [FRONT_ORDER_FUNCTION, "list_powers"]);
  assert.equal(offered.maxRounds, 2);
  assert.equal(await offered.execute("list_powers", {}), "looked up list_powers");
  assert.match(await offered.execute(FRONT_ORDER_FUNCTION, { orders: "The Front~Borduria~advance~all~~" }), /^No order was taken, so the period stands as you were shown it\./);
  const answer = await offered.execute(FRONT_ORDER_FUNCTION, { orders: "The Front~Aland~withdraw~all~~" });
  assert.match(answer, /^The period fought again with that order, each from the day it was given\. This replaces the battlefields you were shown: write the events from it, and do not write these orders again in frontOrders\.\n- The Front: as it now went\.$/);
  assert.equal(fought.length, 1);
  assert.match(await offered.execute(FRONT_ORDER_FUNCTION, { orders: "The Front~Aland~advance~all~~" }), /fought again once already/);
  assert.equal(fought.length, 1);
  // Not offered: a task's own functions are what they were, and nothing is added to none.
  assert.equal(withFrontOrderFunction(null, {}), null);
  // With no lookups of the task's own it is the one function there is.
  assert.deepEqual(withFrontOrderFunction(null, { refight: async () => "" }).tools.map((tool) => tool.name), [FRONT_ORDER_FUNCTION]);

  // The story is told to call it, where the period was fought beforehand and the function is there.
  const map = sheet();
  const world = worldOn(map, [WAR], { countryStats: { Aland: { population: { total: 6e6 } }, Borduria: { population: { total: 5e5 } } } });
  const opened = await runTurnFronts(turn(map, world, { fromDate: "2024-02-20", toDate: "2024-03-01", seed: "campaign|1|2024-02-20" }));
  const fighting = { ...world, battlefields: opened.battlefields };
  const [front] = opened.battlefields;
  // The period as it goes with no new order from the player: this is what the model is shown first.
  const quiet = await runTurnFronts(turn(map, fighting, { players: ["Aland"], foretold: true }));
  const period = { fromDate: "2024-03-01", toDate: "2024-03-11", days: 10, battlefields: quiet.battlefields, news: quiet.news, voyages: [], transports: [] };
  const block = buildFrontsBlock({ battlefields: fighting.battlefields, players: ["Aland"], period, orderFunction: true });
  assert.match(block, /The battlefields below are the period as it goes if that person gives its troops NO new order\. If an action of this turn does give its troops one \(to attack, push for a place, dig in, hold, fall back, withdraw, to draft more troops or send reinforcements to a front, or anything of the kind\), call order_troops FIRST, before you write any event/);
  assert.match(block, /`NAME~X~dig in~northwest~~` and `NAME~X~advance~south~~city: Y`; to pull out is `NAME~X~withdraw~all~~`/);
  assert.match(block, /Do not write such an order again in frontOrders\. With no such action, call nothing\./);
  // Without the function the rule is the one it was: the order waits for the next period.
  assert.match(buildFrontsBlock({ battlefields: fighting.battlefields, players: ["Aland"], period }), /Such an order is carried out next period/);
  // What the function answers with is the battlefields alone, with none of the rules above them.
  const list = buildFrontsBlock({ battlefields: fighting.battlefields, players: ["Aland"], period, listOnly: true });
  assert.ok(list.startsWith("Battlefields, as the period from 2024-03-01 to 2024-03-11 leaves them:"), list.slice(0, 80));
  assert.equal(list.includes("played by a person"), false);

  // Fought again with the order, the period is another period: given on the 3rd, the withdrawal is done within it.
  const orders = readGivenOrders(`${front.name}~Aland~withdraw~all~2024-03-03`, { players: ["Aland"], fromDate: "2024-03-01", days: 10 }).given;
  const again = await runTurnFronts(turn(map, fighting, { players: ["Aland"], frontOrders: orders }));
  assert.ok(troopsOf(quiet.battlefields[0], 0).length > 0, "with no order they are still there");
  assert.equal(troopsOf(again.battlefields[0], 0).length, 0, "with it they have gone");
  assert.deepEqual(again.battlefields[0].orders.filter((entry) => entry.s === 0).map((entry) => [entry.order, entry.since]), [["withdraw", "2024-03-03"]]);
  // And the turn is applied as that same run: on a battlefield whose period was told, an order of the
  // answer's own waits for the period's end, and one the function was given does not.
  const applied = await runTurnFronts(turn(map, fighting, { players: ["Aland"], foretold: true, frontOrders: orders }));
  assert.deepEqual(applied.battlefields[0].troops, again.battlefields[0].troops);
  const waiting = await runTurnFronts(turn(map, fighting, { players: ["Aland"], foretold: true, frontOrders: orders.map(({ now, date, day, ...order }) => order) }));
  assert.ok(troopsOf(waiting.battlefields[0], 0).length > 0, "an order of the answer's own is for the period after");
  const apply = read("./frontApply.js");
  assert.match(apply, /frontOrders: \[\.\.\.asArray\(givenOrders\)\.filter\(\(order\) => order\?\.now === true\), \.\.\.asArray\(frontOrders\)\],/);
  assert.match(apply, /frontOrders: asArray\(given\),/);
});

test("what a person types is written as their own order lines, which stand because the event carries their action out", async () => {
  // The story is told so, with the two examples a person is most likely to give.
  const block = buildFrontsBlock({ players: ["Aland"] });
  assert.match(block, /Aland is played by a person: write no order for it of your own\. But what that person tells its troops to do in an action of this turn IS its order, and you write it for them: a line for each stretch of line the action speaks of, with the sector and the objective it names, resting on the event that carries the action out/);
  assert.match(block, /`NAME~X~dig in~northwest~4` and `NAME~X~advance~south~4~city: Y`; to pull out is `NAME~X~withdraw~all~4`/);
  assert.match(block, /It is carried out from that event's date\./);
  assert.match(block, /\| fall back \| withdraw \| land \| reinforce\./);
  assert.match(block, /Troops told to withdraw leave the battlefield and go home: the ground stays whose it is/);

  const map = sheet();
  // (Aland is much the stronger: what it is told to do can be seen to happen within a turn.)
  const world = worldOn(map, [WAR], { countryStats: { Aland: { population: { total: 6e6 } }, Borduria: { population: { total: 5e5 } } } });
  // A war already being fought, both lines holding.
  const opened = await runTurnFronts(turn(map, world, { fromDate: "2024-02-20", toDate: "2024-03-01", seed: "campaign|1|2024-02-20" }));
  const [front] = opened.battlefields;
  const fighting = { ...world, battlefields: opened.battlefields };
  const before = troopsOf(front, 0);
  const northLine = mean(before.filter((troop) => troop.lat > 51.4).map((troop) => troop.lng));
  const southLine = mean(before.filter((troop) => troop.lat < 50.6).map((troop) => troop.lng));

  // The player typed: "north dig trenches; the south pushes for Brod." The story carries it out in event 1.
  const events = normalizeEvents([event("e1", "2024-03-03", { warId: "war-1", impacts: { actionIds: ["act-1"] } }), event("e2", "2024-03-07", { warId: "war-1" })]);
  const lines = [`${front.name}~Aland~dig in~north~1`, `${front.name}~Aland~advance~south~1~city: Brod`, `${front.name}~Aland~blitz~centre~2`];
  const citesOrderOf = (side, entry) => (entry?.impacts?.actionIds ?? []).includes("act-1") && side === "Aland";
  const { kept, dropped } = screenFrontOrders(bindFrontOrdersToEvents(lines, events), { events, humanSides: ["Aland"], citesOrderOf });
  // The two that rest on the event of the player's action are the player's; the one the story made up is not.
  assert.deepEqual(kept.map((entry) => [entry.order, entry.sector]), [["dig in", "north"], ["advance", "south"]]);
  assert.match(dropped[0].reason, /Aland is played by a person, and no order of theirs asks for this/);

  // Carried out in this very period, from the day of that event.
  const run = await runTurnFronts(turn(map, fighting, { events, frontOrders: kept, players: ["Aland"] }));
  const [after] = run.battlefields;
  assert.deepEqual(after.orders.map((entry) => [after.sides[entry.s][0], entry.sector, entry.order, entry.objective ?? "", entry.since]), [
    ["Aland", "north", "dig in", "", "2024-03-03"],
    ["Aland", "south", "advance", "city: Brod", "2024-03-03"],
  ]);
  const mine = troopsOf(after, 0);
  const north = mine.filter((troop) => troop.lat > 51.4);
  const south = mine.filter((troop) => troop.lat < 50.6);
  assert.ok(north.length > 0 && north.every((troop) => troop.state === STATE_DUG_IN), "the north has dug in where it stood");
  assert.ok(Math.abs(mean(north.map((troop) => troop.lng)) - northLine) < 0.1);
  assert.ok(mean(south.map((troop) => troop.lng)) > southLine + 0.15, "and the south has gone forward, toward Brod");

  // The turn after, the player types "I withdraw my troops": one line, and they are gone from it, the ground as it was.
  const next = { ...world, battlefields: run.battlefields };
  const leave = normalizeEvents([event("e3", "2024-03-12", { warId: "war-1", impacts: { actionIds: ["act-2"] } })]);
  const out = screenFrontOrders(bindFrontOrdersToEvents([`${front.name}~Aland~withdraw~all~1`], leave), { events: leave, humanSides: ["Aland"], citesOrderOf: () => true });
  assert.deepEqual(out.kept.map((entry) => entry.order), ["withdraw"]);
  const gone = await runTurnFronts(turn(map, next, { events: leave, frontOrders: out.kept, players: ["Aland"], fromDate: "2024-03-11", toDate: "2024-03-26", seed: "campaign|3|2024-03-11" }));
  assert.equal(troopsOf(gone.battlefields[0], 0).length, 0);
  assert.ok(troopsOf(gone.battlefields[0], 1).length > 0);
  assert.equal(gone.flips.some((flip) => flip.to === "Borduria"), false, "nothing is handed back");
  assert.ok(gone.news.some((entry) => entry.k === "withdrew" && entry.s === 0));
  // And the story of the period after is told that they went.
  const told = buildFrontsBlock({ battlefields: gone.battlefields, players: ["Aland"] });
  assert.match(told, /Aland has withdrawn its troops from here: the ground it holds is unguarded until it orders them back\./);
  assert.match(told, /Standing orders: Aland: all withdraw/);
});

test("an ally of a player's commands its own troops, and what the two agreed in their talks is what it does", async () => {
  const map = sheet(["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"]);
  const coalition = [{ ...WAR, sideA: ["Aland", "Cisland"] }];
  const world = worldOn(map, coalition);
  const opened = await runTurnFronts(turn(map, world, { fromDate: "2024-02-20", toDate: "2024-03-01", seed: "campaign|1|2024-02-20", players: ["Aland"] }));
  const [front] = opened.battlefields;
  assert.deepEqual(front.sides, [["Aland", "Cisland"], ["Borduria"]]);
  // The story is told who the player's allies are, that their orders are its to write, and where a plan agreed in talks comes from.
  const block = buildFrontsBlock({ battlefields: opened.battlefields, players: ["Aland"] });
  assert.match(block, /On a side of several countries each commands its own troops: a line orders the troops of the country it names, and a line for a side's first country also orders any ally there that nobody plays and that has no line of its own\./);
  assert.match(block, new RegExp(`Allies of a player command their own troops, and their orders are yours to write: Cisland beside Aland on ${front.name}\\. Where such an ally and the player have agreed a plan in their talks \\(\\[Diplomatic Memory\\]\\), its orders carry that plan out, in the sector and at the time agreed\\.`));
  assert.match(block, /Strength: Aland \d+ formations \(\d+%\) \(Aland \d+, Cisland \d+\)/);
  // Nobody played, or no ally beside them: nothing is said of it.
  assert.equal(alliesRule(opened.battlefields, []), "");
  assert.equal(alliesRule(opened.battlefields, ["Borduria"]), "");
  assert.equal(alliesRule([{ ...front, status: "closed" }], ["Aland"]), "");
  // In a shared game where both are played, neither is the other's to write.
  assert.equal(alliesRule(opened.battlefields, ["Aland", "Cisland"]), "");

  // The story orders the ally (the player has asked it to push in the south): its troops go, the player's stay the player's.
  const fighting = { ...world, battlefields: opened.battlefields };
  const events = normalizeEvents([event("e1", "2024-03-02", { warId: "war-1" })]);
  const orders = screenFrontOrders(bindFrontOrdersToEvents([`${front.name}~Cisland~advance~all~1`, `${front.name}~Aland~advance~all~1`], events), { events, humanSides: ["Aland"] });
  assert.deepEqual(orders.kept.map((entry) => entry.side), ["Cisland"], "the ally's line stands; one made up for the player does not");
  const before = troopsOf(front, 0);
  const run = await runTurnFronts(turn(map, fighting, { events, frontOrders: orders.kept, players: ["Aland"] }));
  const after = troopsOf(run.battlefields[0], 0);
  const lng = (troops, owner) => mean(troops.filter((troop) => troop.owner === owner).map((troop) => troop.lng));
  assert.ok(lng(after, 1) > lng(before, 1) + 0.15, "Cisland's troops have advanced");
  assert.ok(Math.abs(lng(after, 0) - lng(before, 0)) < 0.08, "Aland's are where the player left them");
});

test("a war between countries nobody plays is fought in full: opened by the story, ordered on both sides, told to it, and on the map", async () => {
  // The player is Cisland, at peace in the south-west; Aland and Borduria go to war by the story's own choice.
  const map = sheet(["AAAABBBB", "AAAABBBB", "CCCC~~~~", "CCCC~~~~"]);
  const world = worldOn(map, [], { countryStats: { Aland: { population: { total: 3e6 } }, Borduria: { population: { total: 1e6 } }, Cisland: { population: { total: 1e6 } } } });
  const events = normalizeEvents([event("e1", "2024-03-02"), event("e2", "2024-03-06")]);
  // One line is enough to begin it: Aland attacks across their border. Borduria is told to dig in.
  const orders = screenFrontOrders(bindFrontOrdersToEvents(["border: Aland / Borduria~Aland~advance~all~1~~~major", "border: Aland / Borduria~Borduria~dig in~all~2"], events), { events, humanSides: ["Cisland"] });
  assert.equal(orders.dropped.length, 0, "neither is the player's: both lines stand");
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders.kept, players: ["Cisland"], toDate: "2024-03-21" }));
  assert.deepEqual(run.starts.map((start) => [start.attacker, start.defender, start.date]), [["Aland", "Borduria", "2024-03-02"]]);
  const [field] = run.battlefields;
  assert.deepEqual([field.status, field.sides], ["active", [["Aland"], ["Borduria"]]]);
  assert.deepEqual(field.orders.map((entry) => [field.sides[entry.s][0], entry.order]), [["Aland", "advance"], ["Borduria", "dig in"]]);
  assert.ok(troopsOf(field, 0).length > 0 && troopsOf(field, 1).length > 0);
  // Ground changes hands on the turn's events, as on any battlefield.
  assert.ok(run.flips.length > 0, `${run.flips.length} regions changed hands`);
  assert.ok(run.events.some((entry) => (entry.impacts?.regionControlOps ?? []).some((op) => op.by === "front")));
  // The story is told to fight and tell such wars like any other.
  const block = buildFrontsBlock({ battlefields: run.battlefields, players: ["Cisland"] });
  assert.match(block, /Every war on the map is fought this way, between countries nobody plays as much as any other: when the story has two of them go to war, open it \(its warUpdates record, or an order to attack across their border at effort major or total\) and give each side its orders when it opens and whenever the story changes what that side does there\./);
  assert.ok(block.includes(`- ${field.name}: Aland against Borduria`));
  // It is not the player's to command: the war room does not list it. The map draws every battlefield of the world.
  assert.equal(playerFronts(run.battlefields, "Cisland").length, 0);
  assert.equal(playerFronts(run.battlefields, "Aland").length, 1);
});

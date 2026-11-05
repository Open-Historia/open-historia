/*! Open Historia — what a scenario made a front stands, a minor attack is no war, and a war begun on a fortified border is fought: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontPosture.test.js
//
// "Determining the type of the war front in the scenario editor has no outcome
// regarding how the war front acts, it just plays out as if it is active. The
// dig-in and hold types in the scenario editor do not work at all, basically
// all war fronts are on the constant offensive."
// "Events changing how the war front behaves is extremely finicky (from
// changing types of the war front and also between changing 'at war from the
// first day' and 'a fortified border, at peace') mostly does not work."
// "Border clashes, minor incidents and so forth also just cause war fronts to
// happen; have it so border fronts are for all war / serious conflicts, for
// minor attacks it should just use individual units and just use the old
// system."
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeMask } from "../../runtime/fronts/codec.js";
import { SCENARIO_MARK, STAFF_MARK, WAR_EFFORTS } from "../../runtime/fronts/constants.js";
import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { blankScenarioFront, normalizeScenarioFronts, scenarioFrontOrders } from "../../runtime/fronts/scenarioFronts.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { buildFrontsBlock } from "./frontPrompt.js";
import { buildScenarioFronts } from "./frontScenario.js";
import { planFrontMoments, runTurnFronts } from "./frontTurn.js";

const legend = { A: "Aland", B: "Borduria", S: "Syldavia", "~": null };
const sheet = () => syntheticMap({ layout: enlarge(["AAABBBBSSS", "AAABBBBSSS", "AAABBBBSSS", "AAABBBBSSS", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities: [] });
const mapOf = (map, seed) => ({
  map: { key: "the sheet", cities: [], flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  seed,
});
const share = (record) => {
  const held = [0, 0];
  for (const holder of decodeMask(record.field.mask, record.frame.cols * record.frame.rows)) if (holder < 2) held[holder] += 1;
  return held[0] / (held[0] + held[1]);
};
const orders = (record) => record.orders.map((order) => [record.sides[order.s][0], order.order, order.sector, order.mark ?? ""]);
const event = (id, date) => ({ id, date, title: id, description: "x", impacts: {} });

// A game made from a scenario with one front between Aland and Borduria.
const start = async ({ war = true, stance = ["hold", "hold"], players = [], fortified = true } = {}) => {
  const map = sheet();
  const world = {
    customRegions: true,
    regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
    countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 2e6 } }, Syldavia: { population: { total: 2e6 } } },
    wars: [],
    battlefields: [],
    units: [],
    scenarioFronts: fortified ? [{ ...blankScenarioFront(), name: "The Front", sides: [["Aland"], ["Borduria"]], war, stance }] : [],
  };
  const built = fortified ? await buildScenarioFronts({ world, game: { country: players[0] ?? "", gameDate: "1916-07-01", round: 1 }, createFrontRun, ...mapOf(map, "campaign|1"), players }) : { wars: [], battlefields: [] };
  return { map, world: { ...world, wars: built.wars, battlefields: built.battlefields, scenarioFronts: [] } };
};
const turn = async (state, { from = "1916-07-01", to = "1916-07-31", wars, frontOrders = [], events = [], players = [], seed = "campaign|2" } = {}) => {
  const run = await runTurnFronts({
    createFrontRun,
    world: state.world,
    events,
    frontOrders,
    warStages: [state.world.wars, wars ?? state.world.wars],
    fromDate: from,
    toDate: to,
    ...mapOf(state.map, seed),
    players,
  });
  state.world = { ...state.world, wars: wars ?? state.world.wars, battlefields: run.battlefields ?? state.world.battlefields };
  return run;
};
const theWar = (extra = {}) => ({ id: "war-1", title: "The War", status: "active", sideA: ["Borduria"], sideB: ["Aland"], startedDate: "1916-07-10", ...extra });

test("every side of a scenario's front is told what its author made it, one that holds as much as one that digs in", () => {
  const fronts = normalizeScenarioFronts([{ ...blankScenarioFront(), name: "The Front", sides: [["Aland"], ["Borduria"]], war: true, stance: ["hold", "dig in"] }]);
  assert.deepEqual(scenarioFrontOrders(fronts).map((order) => [order.side, order.order, order.mark]), [["Aland", "hold", SCENARIO_MARK], ["Borduria", "dig in", SCENARIO_MARK]]);
  // The turn hands the mark to the engine with the order.
  const moments = planFrontMoments({ events: [event("scenario-fronts", "1916-07-01")], frontOrders: scenarioFrontOrders(fronts), fromDate: "1916-07-01", days: 0, dayOf: () => 0 });
  assert.deepEqual(moments.map((moment) => [moment.side, moment.order, moment.mark, moment.unbound]), [["Aland", "hold", SCENARIO_MARK, undefined], ["Borduria", "dig in", SCENARIO_MARK, undefined]]);
});

test("a front set to hold or to dig in stays so: nobody attacks along it because a month has passed", async () => {
  for (const stance of [["hold", "hold"], ["dig in", "dig in"], ["hold", "dig in"]]) {
    // Nobody plays either side: each has a staff, which used to send a side with no order forward at once.
    const state = await start({ stance });
    const [built] = state.world.battlefields;
    assert.deepEqual(orders(built), [["Aland", stance[0], "all", SCENARIO_MARK], ["Borduria", stance[1], "all", SCENARIO_MARK]]);
    const before = share(built);
    const run = await turn(state);
    const [after] = run.battlefields;
    assert.deepEqual(orders(after), orders(built), stance.join(" / "));
    assert.equal(share(after), before, "no ground changed hands");
    assert.deepEqual(run.news.filter((entry) => entry.k === "offensive"), []);
    // Three months on it is the same front.
    const later = await turn(state, { from: "1916-07-31", to: "1916-10-29", seed: "campaign|3" });
    assert.deepEqual(orders(later.battlefields[0]), orders(built));
    assert.equal(share(later.battlefields[0]), before);
  }
});

test("the story is told so, and its order to attack there is carried out only when an event is behind it", async () => {
  const state = await start({ stance: ["dig in", "dig in"] });
  const [built] = state.world.battlefields;
  // What the brief says of the orders, and the rule that explains it.
  assert.match(describeBattlefield(built), /Standing orders: Aland: all dig in \(the scenario's\) \([a-z]+\)\. Borduria: all dig in \(the scenario's\) \([a-z]+\)\./);
  const block = buildFrontsBlock({ battlefields: [built], players: [] });
  assert.match(block, /A standing order shown as \(the scenario's\) is what the scenario's author made that front: a line dug in, a line held, a line attacked along\. It stands until an event of the story changes what that side does there\./);
  assert.match(block, /An order to attack against it is carried out only when it carries the number of the event in which the side goes over to the attack; with no event it is ignored, and a quiet period is no reason to end it\./);

  // An order to attack with no event of the answer behind it: not carried out, and the story is told why.
  const loose = await turn(state, { frontOrders: [{ id: "front-0", battlefield: "The Front", side: "Borduria", order: "advance", sector: "all", eventIds: [] }] });
  assert.deepEqual(orders(loose.battlefields[0]), orders(built));
  assert.ok(loose.notes.some((note) => /An order to attack was not carried out \(Borduria on The Front\): that side's posture there \(dig in\) is what the scenario's author made the front/.test(note.text)), JSON.stringify(loose.notes));

  // The same order resting on an event: the story has Borduria go over to the attack, and it does.
  const told = await turn(state, {
    from: "1916-07-31", to: "1916-08-30", seed: "campaign|3",
    events: [event("e1", "1916-08-04")],
    frontOrders: [{ id: "front-0", battlefield: "The Front", side: "Borduria", order: "advance", sector: "all", eventIds: ["e1"] }],
  });
  assert.deepEqual(orders(told.battlefields[0]), [["Aland", "dig in", "all", SCENARIO_MARK], ["Borduria", "advance", "all", ""]]);
  // To dig in or to hold is no attack: such an order needs no event.
  const quiet = await turn(state, { from: "1916-08-30", to: "1916-09-29", seed: "campaign|4", frontOrders: [{ id: "front-0", battlefield: "The Front", side: "Borduria", order: "hold", sector: "all", eventIds: [] }] });
  assert.deepEqual(orders(quiet.battlefields[0])[1], ["Borduria", "hold", "all", ""]);
});

test("a war begun on a border that was fortified in peace is fought: the side that began it attacks from its first day", async () => {
  const state = await start({ war: false, stance: ["dig in", "dig in"] });
  assert.deepEqual([state.world.battlefields[0].status, orders(state.world.battlefields[0])], ["standing", [["Aland", "dig in", "all", SCENARIO_MARK], ["Borduria", "dig in", "all", SCENARIO_MARK]]]);
  // The story opens a war between the two on the 10th (its ledger), and orders nobody.
  const run = await turn(state, { wars: [theWar()] });
  const [front] = run.battlefields;
  assert.deepEqual([front.status, front.warId], ["active", "war-1"]);
  // Borduria began it: its staff sends it forward the day after, and the war is told of it.
  assert.deepEqual(run.news.filter((entry) => entry.k === "offensive").map((entry) => [entry.d, front.sides[entry.s][0], entry.at]).slice(0, 1), [["1916-07-11", "Borduria", "the whole line"]]);
  // What stood there was the posture of a border at peace, and the war ended it: neither order is the scenario's any more.
  assert.deepEqual(front.orders.map((order) => order.mark ?? "").filter((mark) => mark === SCENARIO_MARK), []);
  assert.equal(front.orders.find((order) => front.sides[order.s][0] === "Borduria").mark, STAFF_MARK);
  // The defender stays dug in until somebody decides otherwise.
  assert.deepEqual(orders(front).find(([side]) => side === "Aland"), ["Aland", "dig in", "all", ""]);

  // A side a person plays is that person's: the war begins and its troops wait for their orders.
  const mine = await start({ war: false, stance: ["dig in", "dig in"], players: ["Borduria"] });
  const played = await turn(mine, { wars: [theWar()], players: ["Borduria"] });
  assert.deepEqual(played.news.filter((entry) => entry.k === "offensive"), []);
  assert.deepEqual(orders(played.battlefields[0]).find(([side]) => side === "Borduria"), ["Borduria", "dig in", "all", ""]);
});

test("an attack across a border at peace is a war only as a real offensive, or when the story opens the war itself", async () => {
  assert.deepEqual([...WAR_EFFORTS], ["major", "total"]);
  const attack = (effort) => [{ id: "front-0", battlefield: "border: Aland / Borduria", side: "Borduria", order: "advance", sector: "all", eventIds: ["e1"], ...(effort ? { effort } : {}) }];
  const events = [event("e1", "1916-07-04")];
  for (const fortified of [false, true]) {
    // A border clash: an order to attack with no effort, or a small one. No war, no battlefield, and the story is told why.
    for (const effort of ["", "token", "limited"]) {
      const state = await start({ war: false, stance: ["dig in", "dig in"], fortified });
      const run = await turn(state, { events, frontOrders: attack(effort) });
      assert.deepEqual(run.starts, [], `${fortified} ${effort}`);
      assert.deepEqual(run.battlefields.map((record) => record.status), fortified ? ["standing"] : []);
      assert.ok(run.notes.some((note) => /An attack across a border at peace opened no war and no battlefield \(Borduria\)/.test(note.text) && /A border clash, a raid or an incident is told with the formations that fought it \(unitOps\), as before\./.test(note.text)), JSON.stringify(run.notes));
    }
    // An invasion: the same order at effort major, or total.
    for (const effort of WAR_EFFORTS) {
      const state = await start({ war: false, stance: ["dig in", "dig in"], fortified });
      const run = await turn(state, { events, frontOrders: attack(effort) });
      assert.deepEqual(run.starts.map((entry) => [entry.attacker, entry.defender, entry.date]), [["Borduria", "Aland", "1916-07-04"]]);
      assert.deepEqual(run.battlefields.map((record) => record.status), ["active"]);
    }
    // The story opening the war in its own ledger is the war, whatever the order's effort.
    const ledger = await start({ war: false, stance: ["dig in", "dig in"], fortified });
    const opened = await turn(ledger, { events, frontOrders: attack(""), wars: [theWar({ startedDate: "1916-07-04" })] });
    assert.deepEqual([opened.starts, opened.battlefields.map((record) => [record.status, record.warId])], [[], [["active", "war-1"]]]);
    // And a person's own country attacks when that person says so: the line is theirs, not the story's.
    const mine = await start({ war: false, stance: ["dig in", "dig in"], fortified, players: ["Borduria"] });
    const own = await turn(mine, { events, frontOrders: attack(""), players: ["Borduria"] });
    assert.deepEqual(own.starts.map((entry) => [entry.attacker, entry.defender]), [["Borduria", "Aland"]]);
  }
});

test("the story is told what a battlefield is for", () => {
  const block = buildFrontsBlock({ battlefields: [], players: [] });
  assert.match(block, /Battlefields are for wars: an invasion, a general offensive, a civil war fought along a line\. A border clash, a skirmish, a raid, an incident, an exchange of fire or a single strike is not a war: write no frontOrders line and no warUpdates start for it, and tell it as before, with the formations that fought it \(unitOps\)\./);
  assert.match(block, /An attack across a border at peace that is given no effort, or token or limited, opens no war and no battlefield\./);
  // A side keeps the posture it has; a line is written when the story changes it.
  const fought = buildFrontsBlock({ battlefields: [], players: [], period: { battlefields: [], news: [] } });
  for (const text of [block, fought]) assert.match(text, /give each side its orders when it opens and whenever the story changes what that side does there\./);
});

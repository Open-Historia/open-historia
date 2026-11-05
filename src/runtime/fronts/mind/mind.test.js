/*! Open Historia — battlefields and fronts: a network as a side's staff (experiment): tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mind/mind.test.js
//
// "Let's experiment with training an RNN or other type of NN to learn military
// strategy so it powers the game engine for AI countries. It should factor in
// needing to defend its own territory."

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFronts } from "../engine.js";
import { normalizeBattlefield } from "../record.js";
import { frontInput, syntheticMap } from "../syntheticMap.js";
import { FEATURE_COUNT, FEATURE_NAMES, MIND_ACTIONS, SEEN_COUNT, countGround, groundOf, homeTableOf, staffFeatures } from "./features.js";
import { blankState, headStep, packWeights, paramCount, readWeights, step } from "./net.js";
import { MIND_ORDERS_MOST, MIND_OUTPUTS, MIND_SHAPE, TROOP_SHAPE, createStaffPolicy, createTroopPolicy } from "./policy.js";
import { DIG_IN, GUARD, HOLD, PUSH, REST, TAKE_CAPITAL, TAKE_CITY, TROOP_ACTIONS, TROOP_FEATURE_COUNT, TROOP_FEATURE_NAMES, troopView } from "./troops.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Weights from a seed, for tests: nothing trained.
const weightsOf = (seed, spread = 0.5, shape = MIND_SHAPE) => {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  return Float64Array.from({ length: paramCount(shape) }, () => next() * 2 * spread);
};

test("the network: its weights are counted, a step is the same step twice, and its memory changes what it says", () => {
  const shape = { inputs: 3, hidden: 2, outputs: 2 };
  assert.equal(paramCount(shape), 2 * 2 * (3 + 2 + 1) + 2 * (2 + 3 + 1));
  assert.equal(paramCount(MIND_SHAPE), 2 * MIND_SHAPE.hidden * (FEATURE_COUNT + MIND_SHAPE.hidden + 1) + MIND_OUTPUTS * (MIND_SHAPE.hidden + FEATURE_COUNT + 1));
  const params = weightsOf(3, 0.8, shape);
  const x = Float64Array.from([1, 0.5, -0.25]);
  const first = step(shape, params, blankState(shape), x);
  assert.deepEqual(step(shape, params, blankState(shape), x), first);
  assert.equal(first.state.length, 2);
  assert.equal(first.out.length, 2);
  for (const value of first.state) assert.ok(value >= -1 && value <= 1, "a memory stays within bounds");
  // The same thing seen a second time, with a memory of the first, is not answered the same.
  const second = step(shape, params, first.state, x);
  assert.notDeepEqual(Array.from(second.out), Array.from(first.out));
  // All zeros: nothing remembered, nothing said.
  const nothing = step(shape, new Float64Array(paramCount(shape)), blankState(shape), x);
  assert.deepEqual([Array.from(nothing.state), Array.from(nothing.out)], [[0, 0], [0, 0]]);
});

test("weights are kept rounded, and a file this build cannot read is no weights", () => {
  const params = weightsOf(9);
  const packed = packWeights(MIND_SHAPE, params, { prior: 1.5, gen: 12 });
  assert.deepEqual([packed.shape, packed.prior, packed.gen, packed.params.length], [{ ...MIND_SHAPE }, 1.5, 12, paramCount(MIND_SHAPE)]);
  const read = readWeights(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual([read.shape, read.prior, read.drafts], [{ ...MIND_SHAPE }, 1.5, false]);
  for (let at = 0; at < params.length; at += 1) assert.ok(Math.abs(read.params[at] - params[at]) <= 5e-6);
  assert.equal(readWeights({ ...packed, drafts: true }).drafts, true);
  assert.equal(readWeights({ ...packed, params: packed.params.slice(1) }), null, "the wrong number of weights");
  assert.equal(readWeights({ ...packed, params: packed.params.map((value, at) => (at === 3 ? "x" : value)) }), null);
  assert.equal(readWeights({ shape: { inputs: 0, hidden: 2, outputs: 2 }, params: [] }), null);
  assert.equal(readWeights(null), null);
});

// An even sheet: Aland in the west and Borduria in the east, at war.
const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "mind" });
const war = (world, extra = {}) => frontInput(world, { arenas: new Map(), staff: true, troops: 1, days: 30, strengthOf: () => 4, ...extra });

test("what a staff is shown: numbers in range, its own home ground by whose it lawfully is, and what the scripted staff would do", () => {
  const world = sheet();
  const seen = [];
  runFronts(war(world, {
    staffPolicy: (battle, side, context, run) => {
      const look = staffFeatures(battle, side, context, run, null);
      seen.push({ side, look, ground: groundOf(battle, side, run), homes: homeTableOf(battle, run), holders: battle.field.holders });
      return undefined;
    },
  }));
  assert.ok(seen.length >= 2, "both sides were asked");
  assert.equal(FEATURE_NAMES.length, FEATURE_COUNT);
  for (const { look, side } of seen) {
    assert.equal(look.x.length, FEATURE_COUNT);
    look.x.forEach((value, at) => assert.ok(Number.isFinite(value) && value >= -1 && value <= 1, `${FEATURE_NAMES[at]} = ${value}`));
    assert.equal(look.x[0], 1);
    assert.ok(look.staff >= 0 && look.staff < MIND_ACTIONS.length);
    assert.equal(look.x.slice(24).reduce((sum, value) => sum + value, 0), 1, "one word of the scripted staff's is marked");
    assert.equal(look.seen.length, SEEN_COUNT);
    assert.ok(side === 0 || side === 1);
  }
  // On the first day nobody has lost anything, and each side's home is half the sheet's land.
  const [first] = seen;
  assert.deepEqual(first.ground, { lost: 0, taken: 0 });
  const homeCells = [0, 1].map((side) => first.homes.filter((home) => home === side).length);
  assert.ok(homeCells[0] > 0 && Math.abs(homeCells[0] - homeCells[1]) <= homeCells[0] * 0.05, String(homeCells));
  // Counted by hand: a strip of the first side's home held by the other is ground lost to it, and taken by the other.
  const holders = Uint8Array.from(first.holders);
  let moved = 0;
  for (let cell = 0; cell < holders.length && moved < 50; cell += 1) {
    if (first.homes[cell] === 0 && holders[cell] === 0) {
      holders[cell] = 1;
      moved += 1;
    }
  }
  assert.equal(countGround(holders, first.homes, 0).lost, 50 / homeCells[0]);
  assert.equal(countGround(holders, first.homes, 1).taken, 50 / homeCells[0]);
  assert.deepEqual(countGround(null, first.homes, 0), { lost: 0, taken: 0 });
});

test("a run handed a staff of its own asks it for every side nobody plays, and one that says nothing leaves the engine's staff in place", () => {
  const plain = runFronts(war(sheet()));
  // Asked, and answering nothing: the run is the run it was.
  let asked = 0;
  const silent = runFronts(war(sheet(), { staffPolicy: () => { asked += 1; return undefined; } }));
  assert.ok(asked >= 2);
  assert.deepEqual(silent.battlefields, plain.battlefields);
  assert.deepEqual(silent.flips, plain.flips);
  // A side a person plays is that person's: nobody is asked for it.
  const sides = new Set();
  runFronts(war(sheet(), { players: ["Aland"], staffPolicy: (battle, side) => { sides.add(battle.sides[side][0]); return undefined; } }));
  assert.deepEqual([...sides], ["Borduria"]);
  // What it says is what the side stands under, as the staff's own order.
  const told = runFronts(war(sheet(), { staffPolicy: (battle, side) => (battle.sides[side][0] === "Borduria" ? { order: "dig in", sector: "all" } : { order: "advance", sector: "all" }) }));
  const [record] = told.battlefields;
  const standing = record.orders.filter((order) => !order.chosen).map((order) => [record.sides[order.s][0], order.order, order.sector, order.mark]);
  assert.deepEqual(standing.sort(), [["Aland", "advance", "all", "staff"], ["Borduria", "dig in", "all", "staff"]]);
  // With every side left to its orders (the engine's own tests of other things), nobody is asked.
  let quiet = 0;
  runFronts(war(sheet(), { staff: false, staffPolicy: () => { quiet += 1; return undefined; } }));
  assert.equal(quiet, 0);
});

test("a network is a staff: it decides the same twice, says one of four things, and remembers from one month to the next", () => {
  const policy = () => createStaffPolicy({ shape: MIND_SHAPE, params: weightsOf(21, 0.6) });
  const said = [];
  const spy = (inner) => (battle, side, context, run) => {
    const decided = inner(battle, side, context, run);
    said.push(decided);
    return decided;
  };
  const world = sheet();
  const first = runFronts(war(world, { staffPolicy: spy(policy()) }));
  assert.ok(said.length >= 2);
  for (const decided of said) {
    assert.ok(["advance", "hold", "dig in"].includes(decided.order), decided.order);
    assert.ok(decided.action >= 0 && decided.action < MIND_ACTIONS.length);
    assert.equal(decided.draft, false, "it calls nobody up unless its weights were trained to");
    if (decided.order !== "advance") assert.equal(decided.sector, "all");
  }
  // The same war with the same weights is the same war.
  assert.deepEqual(runFronts(war(sheet(), { staffPolicy: policy() })).battlefields, first.battlefields);
  // Its memory is kept with the battlefield: a list a side, the network's own and what it saw last.
  const [record] = first.battlefields;
  assert.deepEqual(record.mind.map((list) => list.length), [MIND_SHAPE.hidden + SEEN_COUNT, MIND_SHAPE.hidden + SEEN_COUNT]);
  const kept = normalizeBattlefield(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(kept.mind, record.mind, "and survives a save");
  // The next month begins from it: a network that had forgotten would not decide the same.
  const month = (battlefields) => {
    const later = sheet();
    for (const flip of first.flips) if (flip.kind === "control") later.controller.set(flip.regionId, flip.to);
    return runFronts(war(later, { battlefields, fromDate: record.asOf, staffPolicy: policy() })).battlefields[0];
  };
  const remembered = month([record]);
  const forgotten = month([{ ...record, mind: undefined }]);
  assert.notDeepEqual(remembered.mind, forgotten.mind);
  // A battlefield no network was ever asked about keeps nothing of the kind.
  assert.equal(Object.hasOwn(runFronts(war(sheet())).battlefields[0], "mind"), false);
  assert.equal(Object.hasOwn(normalizeBattlefield(JSON.parse(JSON.stringify(runFronts(war(sheet())).battlefields[0]))), "mind"), false);
});

test("with the scripted staff's own word weighed in, a network that knows nothing decides as the scripted staff does", () => {
  const plain = runFronts(war(sheet()));
  const nothing = createStaffPolicy({ shape: MIND_SHAPE, params: new Float64Array(paramCount(MIND_SHAPE)), prior: 1.5 });
  const led = runFronts(war(sheet(), { staffPolicy: nothing }));
  const orders = (result) => result.battlefields[0].orders.map(({ s, order, sector, mark }) => [s, order, sector, mark]);
  assert.deepEqual(orders(led), orders(plain));
  assert.deepEqual(led.flips, plain.flips);
  // Weights of the wrong shape are no staff at all: the engine's own decides.
  const wrong = createStaffPolicy({ shape: { inputs: 3, hidden: 2, outputs: 2 }, params: new Float64Array(30) });
  assert.deepEqual(runFronts(war(sheet(), { staffPolicy: wrong })).battlefields, plain.battlefields);
});

test("a network whose weights were trained to may call up fresh formations, and one refused says nothing of it", () => {
  // Weights that always say "draft": the second of the two last outputs has the larger bias.
  const params = new Float64Array(paramCount(MIND_SHAPE));
  params[params.length - 1] = 1;
  const people = { peopleOf: () => 4e6 };
  const count = (result, side) => result.battlefields[0].troops[side].length;
  const plain = runFronts(war(sheet(), people));
  const drafting = runFronts(war(sheet(), { ...people, staffPolicy: createStaffPolicy({ shape: MIND_SHAPE, params, prior: 1.5, drafts: true }) }));
  const quiet = runFronts(war(sheet(), { ...people, staffPolicy: createStaffPolicy({ shape: MIND_SHAPE, params, prior: 1.5 }) }));
  assert.ok(count(drafting, 0) > count(plain, 0) && count(drafting, 1) > count(plain, 1), "both sides were brought more troops");
  assert.equal(count(quiet, 0), count(plain, 0), "not without leave");
  const charged = (result) => result.manpower.reduce((sum, entry) => sum + entry.drawn, 0);
  assert.ok(charged(drafting) > charged(plain), "and their countries were charged the men");
  assert.deepEqual(drafting.notes.filter((note) => String(note.kind).startsWith("reinforce")), [], "a draft it could not have is not a note on the turn");
});

// ---- a staff that orders every troop by itself ----------------------------------------

test("the head: its weights are counted after the side's, kept with the file, and add what the side leans to", () => {
  const shape = { inputs: 3, hidden: 2, outputs: 2, head: 4, headHidden: 3 };
  const side = 2 * 2 * (3 + 2 + 1) + 2 * (2 + 3 + 1);
  assert.equal(paramCount(shape), side + 3 * (4 + 2 + 1) + 2 * (3 + 1));
  assert.equal(paramCount({ inputs: 3, hidden: 2, outputs: 2 }), side, "a network without a head is counted as it always was");
  // Nothing in the head: a troop's scores are what the side leans to.
  const params = new Float64Array(paramCount(shape));
  assert.deepEqual(Array.from(headStep(shape, params, Float64Array.from([0.5, -0.5]), Float64Array.from([0.25, -1]), Float64Array.from([1, 0, 0, 0]))), [0.25, -1]);
  // A bias on the second thing it may say, after everything else.
  params[params.length - 1] = 2;
  assert.deepEqual(Array.from(headStep(shape, params, Float64Array.from([0, 0]), null, Float64Array.from([1, 0, 0, 0]))), [0, 2]);
  const packed = packWeights(TROOP_SHAPE, weightsOf(5, 0.5, TROOP_SHAPE), { round: 3 });
  assert.deepEqual(packed.shape, { ...TROOP_SHAPE });
  const read = readWeights(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(read.shape, { ...TROOP_SHAPE });
  assert.equal(read.params.length, paramCount(TROOP_SHAPE));
  assert.equal(readWeights({ ...packed, shape: { ...packed.shape, headHidden: 15 } }), null, "weights for another head are no weights");
});

// The even sheet with cities: a capital each, within a troop's reach of the border, and a town of Borduria's by it.
const CITIES = [
  { name: "Aland Capital", lng: 22.5, lat: 50.75, population: 900000, capital: true },
  { name: "Borduria Capital", lng: 25.5, lat: 50.75, population: 900000, capital: true },
  { name: "Border Town", lng: 24.5, lat: 51.25, population: 40000 },
];
const citySheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "mind-cities" });
const liveOf = (battle, side) => battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);

test("what each troop is shown: every live troop once, numbers in range, and somewhere real to go for each order it may be given", () => {
  const views = [];
  runFronts(war(citySheet(), {
    staffPolicy: (battle, side) => {
      views.push({ side, view: troopView(battle, side), live: liveOf(battle, side).length, battle });
      return undefined;
    },
  }));
  assert.equal(TROOP_FEATURE_NAMES.length, TROOP_FEATURE_COUNT);
  assert.ok(views.length >= 2);
  for (const { view, live } of views) {
    assert.equal(view.rows.length, live, "every live troop, and none that is not");
    assert.equal(new Set(view.rows.map((row) => row.index)).size, view.rows.length);
    for (const row of view.rows) {
      assert.equal(row.t.length, TROOP_FEATURE_COUNT);
      row.t.forEach((value, at) => assert.ok(Number.isFinite(value) && value >= -1 && value <= 1.5, TROOP_FEATURE_NAMES[at] + " = " + value));
      assert.equal(row.t[0], 1);
      assert.equal(row.valid[HOLD], true, "a troop may always hold");
      assert.equal(row.valid[DIG_IN], true);
      row.valid.forEach((may, action) => {
        // (A rest is a pull back from where each troop stands: somewhere of its own, not a place shared.)
        if (!may || action === HOLD || action === DIG_IN || action === PUSH || action === REST) return;
        const goal = view.places.get(row.goal[action]);
        assert.ok(goal && goal.way.length > 0, TROOP_ACTIONS[action] + " goes somewhere");
      });
    }
  }
  // The other side's capital is somewhere to go for, from either side; the town is Borduria's, for Aland to take.
  const aland = views.find((entry) => entry.battle.sides[entry.side][0] === "Aland");
  const borduria = views.find((entry) => entry.battle.sides[entry.side][0] === "Borduria");
  assert.ok(aland.view.rows.some((row) => row.valid[TAKE_CAPITAL]) && borduria.view.rows.some((row) => row.valid[TAKE_CAPITAL]));
  assert.ok(aland.view.rows.some((row) => row.valid[TAKE_CITY]));
  const goals = new Set(aland.view.rows.flatMap((row) => [row.goal[TAKE_CITY], row.goal[TAKE_CAPITAL]]).filter(Boolean));
  const named = [...goals].map((key) => aland.battle.arena.cities[Number(key.split(" ")[1])].name);
  assert.ok(named.length > 0 && named.every((city) => city === "Borduria Capital" || city === "Border Town"), named.join(", "));
  // Aland's own capital is somewhere to guard, for a troop not already at it.
  const guards = new Set(aland.view.rows.map((row) => row.goal[GUARD]).filter(Boolean));
  assert.ok([...guards].every((key) => aland.battle.arena.cities[Number(key.split(" ")[1])].name === "Aland Capital"), [...guards].join(", "));
});

test("a staff that orders troops one by one: each body goes where it was sent, under the mind's own orders, and the line stands under none", () => {
  const toward = [[25.5, 50.75]];
  // What stood on each side when its staff next looked: the orders, and what its troops were doing.
  const later = [];
  const result = runFronts(war(citySheet(), {
    days: 30,
    staffPolicy: (battle, side) => {
      const picked = liveOf(battle, side);
      const name = battle.sides[side][0];
      if (battle.daysRun > 0) {
        later.push({
          name,
          orders: battle.orders.filter((order) => order.s === side).map((order) => ({ ...order })),
          onTheRoute: picked.filter((index) => JSON.stringify(battle.troops[side][index].order?.standing?.way) === JSON.stringify(toward)).length,
          dug: picked.filter((index) => battle.troops[side][index].dug === true).length,
          live: picked.length,
        });
      }
      if (name === "Borduria") return { troops: [{ order: "dig in", picked }], said: [] };
      const half = Math.ceil(picked.length / 2);
      return { troops: [{ order: "advance", picked: picked.slice(0, half), way: toward }, { order: "advance", picked: picked.slice(half) }], said: [] };
    },
  }));
  const aland = later.filter((entry) => entry.name === "Aland");
  const borduria = later.filter((entry) => entry.name === "Borduria");
  assert.ok(aland.length > 0 && borduria.length > 0);
  for (const entry of aland) {
    // Nothing stands for a stretch of its line: two bodies of its troops, under the mind's own orders.
    assert.equal(entry.orders.length, 2, JSON.stringify(entry.orders));
    assert.ok(entry.orders.every((order) => order.chosen === true && order.mark === "mind" && order.order === "advance"));
    assert.equal(entry.orders.filter((order) => JSON.stringify(order.way) === JSON.stringify(toward)).length, 1, "the route it was given");
    assert.ok(entry.onTheRoute > 0, "and troops on it");
    assert.ok(entry.orders.every((order) => !order.attacks && !order.crosses));
  }
  // Borduria's troops stand dug in where they were, under no order at all.
  for (const entry of borduria) {
    assert.deepEqual(entry.orders, []);
    assert.equal(entry.dug, entry.live);
  }
  // And what is saved stands under nothing for a stretch of line either.
  assert.deepEqual(result.battlefields[0].orders.filter((order) => !order.chosen), []);
});

test("a route the mind draws never takes a war into a country outside it", () => {
  const sheetWithNeutral = () => syntheticMap({ layout: ["AAAANNNN", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend: { A: "Aland", B: "Borduria", N: "Neutralia" }, west: 20, north: 52, step: 1, stepLat: 0.5, key: "mind-neutral" });
  // Straight into Neutralia's ground, every Aland troop.
  const into = [[26.5, 51.75]];
  let sent = 0;
  const result = runFronts(war(sheetWithNeutral(), {
    days: 30,
    staffPolicy: (battle, side) => {
      if (battle.sides[side][0] !== "Aland") return { troops: [], said: [] };
      sent += 1;
      return { troops: [{ order: "advance", picked: liveOf(battle, side), way: into }], said: [] };
    },
  }));
  assert.ok(sent > 0);
  for (const record of result.battlefields) {
    assert.deepEqual(record.log.filter((entry) => entry.k === "attacked" || entry.k === "invaded"), []);
    assert.ok(record.sides.flat().every((name) => name !== "Neutralia"), "Neutralia is in no battle");
    for (const order of record.orders) assert.ok(!order.attacks && !order.crosses);
  }
});

test("a network that orders troops one by one: the same war twice, every troop given one order, and a body for each place it sends troops", () => {
  const params = weightsOf(33, 0.6, TROOP_SHAPE);
  const answers = [];
  const spy = (inner) => (battle, side, context, run) => {
    const live = liveOf(battle, side).length;
    const decided = inner(battle, side, context, run);
    answers.push({ decided, live });
    return decided;
  };
  const first = runFronts(war(citySheet(), { staffPolicy: spy(createTroopPolicy({ shape: TROOP_SHAPE, params })) }));
  assert.ok(answers.length >= 2);
  for (const { decided, live } of answers) {
    assert.ok(Array.isArray(decided.troops));
    const picked = decided.troops.flatMap((body) => body.picked);
    assert.equal(picked.length, live, "every live troop once");
    assert.equal(new Set(picked).size, picked.length);
    assert.equal(decided.said.length, TROOP_ACTIONS.length);
    assert.equal(decided.said.reduce((sum, value) => sum + value, 0), live);
    assert.ok(decided.troops.filter((body) => body.order === "advance").length <= MIND_ORDERS_MOST);
    for (const body of decided.troops) {
      assert.ok(["hold", "dig in", "advance"].includes(body.order), body.order);
      for (const [lng, lat] of body.way ?? []) assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
    }
  }
  assert.deepEqual(runFronts(war(citySheet(), { staffPolicy: createTroopPolicy({ shape: TROOP_SHAPE, params }) })).battlefields, first.battlefields, "the same weights, the same war");
  // Its memory is the side's, as the other kind's is.
  assert.deepEqual(first.battlefields[0].mind.map((list) => list.length), [TROOP_SHAPE.hidden + SEEN_COUNT, TROOP_SHAPE.hidden + SEEN_COUNT]);
  // Weights for another network are no staff: the engine's own decides.
  assert.deepEqual(runFronts(war(citySheet(), { staffPolicy: createTroopPolicy({ shape: MIND_SHAPE, params: weightsOf(1) }) })).battlefields, runFronts(war(citySheet())).battlefields);
});

test("the game uses the lab's own staff only in the lab, on unless its switch is turned off, a network where one is shipped and else the staff that looks ahead", async () => {
  const root = path.join(here, "../../..");
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").split("\r\n").join("\n");
  const gate = read("Game/AI/frontsGate.js");
  assert.ok(gate.includes("export const STRATEGY_NET_KEY = \"oh:strategyNet\";"));
  assert.ok(gate.includes("return typeof globalThis.window !== \"undefined\" && Boolean(globalThis.localStorage) && globalThis.localStorage.getItem(STRATEGY_NET_KEY) !== \"0\";"), "on in the lab build's page unless whoever is at the keyboard turns it off");
  const { strategyNetOn } = await import("../../../Game/AI/frontsGate.js");
  assert.equal(strategyNetOn(), false, "and never outside a page");
  // The turn hands it to the engine for the forecast and for the apply alike, so the two are one run.
  const apply = read("Game/AI/frontApply.js");
  // (With a plainer commander for a side a scenario's designer meant its war to lose: runtime/warOutcomes.js.)
  assert.ok(apply.includes("...(strategyNetOn() && trainedStaffPolicy() ? { staffPolicy: labStaffPolicy({ outcomes: warSettingsOf(world).outcomes, difficulty: normalizeDifficulty(game?.difficulty), players: humanCountriesOf(game) }) } : {}),"));
  assert.equal(apply.split("...turnRunInput({").length - 1, 2, "the run before the story and the run that applies it");
  const turn = read("Game/AI/frontTurn.js");
  // (With the cores its plans may be fought on together, where the run worker has them: rehearsers.js.)
  assert.ok(turn.includes("...(typeof staffPolicy === \"function\" ? { staffPolicy, ...(rehearsers ? { rehearsers } : {}) } : {}),"));
  // No scenario and no setting can ask for it.
  assert.equal(read("../server/gameFeatures.js").includes("strategyNet"), false);
  // What is shipped is read through the same door a file of weights is: none, or a staff.
  const { trainedStaffInfo, trainedStaffPolicy } = await import("./trained.js");
  const { TRAINED_STAFF } = await import("./weights.js");
  if (TRAINED_STAFF === null) {
    // The staff that looks ahead, with the weights shipped for it.
    assert.equal(typeof trainedStaffPolicy(), "function");
    assert.equal(trainedStaffPolicy().often, true);
    assert.equal(trainedStaffInfo().planner, true);
    const led = runFronts(war(sheet(), { staffPolicy: trainedStaffPolicy() }));
    assert.equal(led.battlefields.length, 1);
  } else {
    assert.equal(typeof trainedStaffPolicy(), "function");
    const shape = TRAINED_STAFF.shape?.head > 0 ? TROOP_SHAPE : MIND_SHAPE;
    assert.deepEqual(TRAINED_STAFF.shape, { ...shape }, "trained for a network this build has");
    assert.equal(TRAINED_STAFF.drafts, false, "a staff that calls up troops by itself is not shipped: the scripted staff never does");
    assert.equal(trainedStaffInfo().run, TRAINED_STAFF.run);
    // And it leads a war without a hitch.
    const led = runFronts(war(sheet(), { staffPolicy: trainedStaffPolicy() }));
    assert.equal(led.battlefields.length, 1);
    assert.deepEqual(led.battlefields[0].mind.map((list) => list.length), [shape.hidden + SEEN_COUNT, shape.hidden + SEEN_COUNT]);
    assert.equal(trainedStaffInfo().troops, shape === TROOP_SHAPE);
  }
});

test("the network decides with the engine's own arithmetic: nothing that differs between machines", () => {
  const forbidden = ["Math.random", "Math.sin", "Math.cos", "Math.tan", "Math.atan", "Math.exp", "Math.pow", "Math.log", "Math.hypot", "Math.tanh", "**", "Date.now", "new Date", "performance.now"];
  for (const name of ["net.js", "features.js", "policy.js", "troops.js"]) {
    const source = fs.readFileSync(path.join(here, name), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const word of forbidden) assert.equal(source.includes(word), false, `${word} in mind/${name}`);
  }
});

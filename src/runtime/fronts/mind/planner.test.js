/*! Open Historia — battlefields and fronts: a staff that looks ahead (experiment): tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mind/planner.test.js
//
// "Make it the stockfish of Open historia" (the owner, 2026-10-14): a staff
// that fights out plans on a copy of the battle before it gives any orders,
// and the fair duels it is measured and tuned in.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFrontRun, rehearsal, rehearseDay, rehearseOrders, runFronts } from "../engine.js";
import { frontInput, syntheticMap } from "../syntheticMap.js";
import { EVAL_NAMES, LATE_EVAL_NAMES, NET_FEATURES, PLAN_NAMES, PLAN_PARAMS, battlePrint, createPlanner, drain, plainPlanner, plannerFeatures, standing, withLateEval } from "./planner.js";
import { TROOP_ACTIONS, TROOP_FEATURE_COUNT, troopView } from "./troops.js";
import { makeDuel } from "../../../../tools/strategy-nn/duel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Aland Capital", lng: 21.5, lat: 51.25, population: 900000, capital: true },
  { name: "Westford", lng: 23.5, lat: 50.75, population: 60000 },
  { name: "Borduria Capital", lng: 26.5, lat: 51.25, population: 800000, capital: true },
  { name: "Eastmarch", lng: 24.5, lat: 50.25, population: 150000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "planner" });
// Every newer mechanic on, as a game with none set has them (Wars and Fronts Pt.2).
const MECHANICS = { fatigue: true, weather: true, supply: true, attrition: true };
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 30, strengthOf: () => 4, mechanics: MECHANICS, climateSeed: "planner", ...extra });
const liveOf = (battle, side) => battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);
const stateOf = (battle) => ({
  holders: Array.from(battle.field.holders),
  troops: battle.troops.map((list) => list.map((troop) => [troop.x, troop.y, troop.strength, troop.fatigue ?? 0])),
});

test("a rehearsal: the days it fights are the war's own, and nothing of the war is touched by it", () => {
  // Rehearsed on the second day, five days of carrying on are the five days the war then fights.
  let rehearsed = null;
  let compared = 0;
  const watching = (battle, side, context, run) => {
    if (side !== 0) return undefined;
    if (battle.daysRun === 1) {
      const copy = rehearsal(run, battle);
      for (let days = 0; days < 5; days += 1) assert.equal(rehearseDay(copy, run.day + 1 + days, { morning: days > 0 }), true);
      rehearsed = stateOf(copy.battle);
    }
    if (battle.daysRun === 6) {
      assert.deepEqual(stateOf(battle), rehearsed);
      compared += 1;
    }
    return undefined;
  };
  watching.often = true;
  const plain = runFronts(war());
  const watched = runFronts(war({ staffPolicy: watching }));
  assert.equal(compared, 1);
  assert.deepEqual(watched.battlefields, plain.battlefields, "and the war is the war it was");

  // Orders tried out on a copy every day, both sides, change nothing of the real war either.
  let tried = 0;
  const meddling = (battle, side, context, run) => {
    const copy = rehearsal(run, battle);
    const picked = liveOf(copy.battle, side);
    rehearseOrders(copy, side, [{ order: "advance", picked: picked.filter((index, at) => at % 2 === 0) }, { order: "dig in", picked: picked.filter((index, at) => at % 2 === 1) }], run.day + 1);
    for (let days = 0; days < 4; days += 1) rehearseDay(copy, run.day + 1 + days, { morning: days > 0 });
    tried += 1;
    return undefined;
  };
  meddling.often = true;
  const meddled = runFronts(war({ staffPolicy: meddling }));
  assert.ok(tried >= 50, `${tried} rehearsals`);
  assert.deepEqual(meddled.battlefields, plain.battlefields);
  assert.deepEqual(meddled.flips, plain.flips);
  assert.deepEqual(meddled.notes, plain.notes);
});

test("a staff of a run's own that looks often is asked every day, the engine's own days marked, and may keep what it ordered", () => {
  const asked = [];
  const often = (battle, side, context) => {
    asked.push([battle.daysRun, side, context.regular]);
    if (battle.daysRun === 0) return { troops: [{ order: "dig in", picked: liveOf(battle, side) }] };
    return { keep: true };
  };
  often.often = true;
  const kept = runFronts(war({ staffPolicy: often }));
  const days = [...new Set(asked.map(([day]) => day))];
  assert.deepEqual(days, Array.from({ length: 30 }, (_, day) => day), "every day");
  for (const [day, , regular] of asked) assert.equal(regular, day % 10 === 0, `day ${day}`);
  // Told to dig in once and kept to it: no order stands for a stretch of the line, as the scripted staff would give.
  assert.deepEqual(kept.battlefields[0].orders.filter((order) => !order.chosen), []);
  // One that does not look often is asked on the engine's own days only.
  const seldom = [];
  runFronts(war({ staffPolicy: (battle) => { seldom.push(battle.daysRun); return undefined; } }));
  assert.deepEqual([...new Set(seldom)], [0, 10, 20]);
});

test("the staff that looks ahead: every live troop given one order, the same war twice, and a plan of its own named each time", () => {
  assert.equal(PLAN_PARAMS, EVAL_NAMES.length + TROOP_ACTIONS.length * (NET_FEATURES + 1) + LATE_EVAL_NAMES.length);
  // Weights made before the later weighing are read with it at its default.
  assert.deepEqual(Array.from(withLateEval(plainPlanner().slice(0, PLAN_PARAMS - LATE_EVAL_NAMES.length))), Array.from(plainPlanner()));
  assert.equal(NET_FEATURES, TROOP_FEATURE_COUNT + 6);
  assert.equal(plainPlanner().length, PLAN_PARAMS);
  const answers = [];
  const chosen = [];
  const spy = (inner) => {
    const outer = (battle, side, context, run) => {
      const decided = inner(battle, side, context, run);
      answers.push({ day: battle.daysRun, decided, live: liveOf(battle, side).length });
      return decided;
    };
    outer.often = inner.often;
    return outer;
  };
  const first = runFronts(war({ staffPolicy: spy(createPlanner({ tally: (name) => chosen.push(name) })) }));
  assert.ok(chosen.length >= 6, chosen.join(", "));
  for (const name of chosen) assert.ok(PLAN_NAMES.includes(name), name);
  for (const { day, decided, live } of answers) {
    if (day % 5 !== 0) {
      assert.deepEqual(decided, { keep: true }, `day ${day}: between its looks it keeps its orders`);
      continue;
    }
    if (decided.keep) continue;
    const picked = decided.troops.flatMap((body) => body.picked);
    assert.equal(picked.length, live, "every live troop once");
    assert.equal(new Set(picked).size, picked.length);
    for (const body of decided.troops) {
      assert.ok(["hold", "dig in", "advance", "rest"].includes(body.order), body.order);
      for (const [lng, lat] of body.way ?? []) assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
    }
  }
  assert.deepEqual(runFronts(war({ staffPolicy: createPlanner() })).battlefields, first.battlefields, "the same weights, the same war");
});

test("what the staff that looks ahead sees and weighs: numbers for every troop, and a standing that is the other side's turned round", () => {
  let checked = 0;
  const look = (battle, side) => {
    if (battle.daysRun !== 12 || side !== 0) return undefined;
    const view = troopView(battle, 0);
    const features = plannerFeatures(battle, 0, view);
    assert.equal(features.length, view.rows.length);
    for (const row of features) {
      assert.equal(row.length, NET_FEATURES);
      for (const value of row) assert.ok(Number.isFinite(value) && value >= -1.5 && value <= 1.5, String(value));
    }
    const mine = standing(battle, 0);
    const theirs = standing(battle, 1);
    assert.equal(mine.length, EVAL_NAMES.length);
    for (let at = 0; at < mine.length; at += 1) assert.ok(Math.abs(mine[at] + theirs[at]) < 1e-9, `${EVAL_NAMES[at]}: ${mine[at]} and ${theirs[at]}`);
    assert.ok(mine[0] !== 0, "ground has changed hands by now");
    checked += 1;
    return undefined;
  };
  look.often = true;
  runFronts(war({ staffPolicy: look }));
  assert.equal(checked, 1);
});

test("a fair duel: the same board for both sides, turned half round", () => {
  const turn = { A: "B", B: "A", C: "D", D: "C" };
  for (let seed = 1; seed <= 40; seed += 1) {
    const duel = makeDuel(seed);
    const rows = duel.layout.length;
    const cols = duel.layout[0].length;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) assert.equal(duel.layout[rows - 1 - row][cols - 1 - col], turn[duel.layout[row][col]], `seed ${seed} row ${row} col ${col}`);
    }
    // As many cells, towns and people a side.
    const count = (letters) => duel.layout.join("").split("").filter((letter) => letters.includes(letter)).length;
    assert.equal(count("AC"), count("BD"));
    const westLng = 20;
    const middle = [westLng + (cols * duel.step) / 2, duel.north - (rows * duel.stepLat) / 2];
    const teamOf = (country) => duel.teams.findIndex((members) => members.includes(country));
    const towns = [[], []];
    for (const city of duel.cities) towns[teamOf(city.country)].push(city);
    assert.equal(towns[0].length, towns[1].length);
    for (const city of towns[0]) {
      const turned = towns[1].find((other) => Math.abs(other.lng - (2 * middle[0] - city.lng)) < 1e-9 && Math.abs(other.lat - (2 * middle[1] - city.lat)) < 1e-9);
      assert.ok(turned, `seed ${seed}: ${city.name} has its twin`);
      assert.equal(turned.population, city.population);
      assert.equal(Boolean(turned.capital), Boolean(city.capital));
    }
    assert.equal(towns[0].filter((city) => city.capital).length, duel.teams[0].length, "a capital a country");
    // The same armies, the same mustering, the same weight.
    assert.equal(new Set(duel.weights).size, 1);
    assert.equal(new Set(duel.military.map((entry) => JSON.stringify(entry))).size, 1);
    assert.equal(new Set(duel.muster.map((entry) => JSON.stringify(entry))).size, 1);
    // Walls and wings: one each, of the same make.
    assert.equal(duel.wall.filter((line) => teamOf(line.owner) === 0).length, duel.wall.filter((line) => teamOf(line.owner) === 1).length);
    assert.equal(new Set(duel.wall.map((line) => line.level)).size <= 1, true);
    const wingTeams = duel.wings.map((wing) => teamOf(duel.countries.indexOf(wing.ownerCode)));
    assert.equal(wingTeams.filter((team) => team === 0).length, wingTeams.filter((team) => team === 1).length);
    assert.deepEqual(makeDuel(seed), duel, "a seed is always the same duel");
  }
});

test("the staff that looks ahead thinks in steps a run may be stopped between, and decides as it does at once", () => {
  // "its SOO LAGGY while in war" (the owner, 2026-10-15): a look is a step a day rehearsed, and the run's days are
  // steps too (engine.js createFrontRun steps), which the game takes a slice at a time with the page drawn between.
  const whole = runFronts(war({ staffPolicy: createPlanner() }));
  const run = createFrontRun(war({ staffPolicy: createPlanner() }));
  let steps = 0;
  const days = run.steps(Infinity);
  for (let step = days.next(); !step.done; step = days.next()) steps += 1;
  assert.ok(run.finished());
  assert.ok(steps >= 100, `${steps} steps`);
  assert.deepEqual(run.finish().battlefields, whole.battlefields, "the same war, taken in steps");
  // A look asked at once is its steps taken one after another.
  const planner = createPlanner();
  assert.equal(typeof planner.steps, "function");
  let looked = null;
  runFronts(war({ staffPolicy: Object.assign((battle, side, context, at) => {
    if (!looked && battle.daysRun === 5) looked = { at: drain(planner.steps(battle, side, context, at)), now: planner(battle, side, context, at) };
    return planner(battle, side, context, at);
  }, { often: true }) }));
  assert.ok(looked);
  assert.deepEqual(looked.at, looked.now);
});

test("a staff with a memo has what it decided at a look again, and thinks afresh about a battle that stands otherwise", () => {
  // "why is it running 2 times?" / "cant you make it do both on the same run?" (the owner, 2026-10-15): a skip fights
  // its period before its story and again as it is applied, and the second time the staff thinks nothing through.
  const memo = new Map();
  const chosen = [];
  const remembering = createPlanner({ memo, tally: (name) => chosen.push(name) });
  const first = runFronts(war({ staffPolicy: remembering, seed: "memo" }));
  const thought = chosen.length;
  assert.ok(thought >= 6 && memo.size >= thought, `${thought} looks, ${memo.size} kept`);
  const again = runFronts(war({ staffPolicy: remembering, seed: "memo" }));
  assert.equal(chosen.length, thought, "every look had again, none thought through");
  assert.deepEqual(again.battlefields, first.battlefields);
  assert.deepEqual(runFronts(war({ staffPolicy: createPlanner(), seed: "memo" })).battlefields, first.battlefields, "the same war as a staff that remembers nothing");
  // Another run's looks are its own.
  runFronts(war({ staffPolicy: remembering, seed: "another" }));
  assert.ok(chosen.length > thought);
  // A battle that stands otherwise has another print: one troop moved, one cell changed hands.
  let prints = null;
  runFronts(war({ staffPolicy: Object.assign((battle) => {
    if (prints) return undefined;
    const before = battlePrint(battle);
    const troop = battle.troops[0].find((one) => one.strength > 0);
    troop.x += 0.25;
    const moved = battlePrint(battle);
    troop.x -= 0.25;
    const cell = battle.field.holders.findIndex((holder) => holder === 0);
    battle.field.holders[cell] = 1;
    const taken = battlePrint(battle);
    battle.field.holders[cell] = 0;
    prints = { before, moved, taken, back: battlePrint(battle) };
    return undefined;
  }, { often: true }) }));
  assert.equal(prints.back, prints.before);
  assert.notEqual(prints.moved, prints.before);
  assert.notEqual(prints.taken, prints.before);
});

test("the staff that looks ahead decides with the engine's own arithmetic", () => {
  const forbidden = ["Math.random", "Math.sin", "Math.cos", "Math.tan", "Math.atan", "Math.exp", "Math.pow", "Math.log", "Math.hypot", "Math.tanh", "**", "Date.now", "new Date", "performance.now"];
  const source = fs.readFileSync(path.join(here, "planner.js"), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const word of forbidden) assert.equal(source.includes(word), false, `${word} in mind/planner.js`);
});

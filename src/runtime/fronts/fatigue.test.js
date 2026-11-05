/*! Open Historia — battlefields and fronts: troops tire, and recover at rest: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/fatigue.test.js
//
// "Make advancing and movement tire troops."

import test from "node:test";
import assert from "node:assert/strict";

import { describeBattlefield } from "./brief.js";
import { decodeLevels, encodeLevels } from "./codec.js";
import { FATIGUE_ATTACK, FATIGUE_DEFEND, FATIGUE_EXHAUSTED, FATIGUE_MARCH, FATIGUE_REST, FATIGUE_REST_DUG, FATIGUE_REST_POCKET } from "./constants.js";
import { runFronts } from "./engine.js";
import { guardLeft, legsLeft, punchLeft, tireDay } from "./fatigue.js";
import { normalizeBattlefield } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { createTroop } from "./troops.js";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("a day's march and fighting tire a troop, and a day's rest freshens it", () => {
  const run = { advanceKm: [20, 35, 15], pace: 1 };
  const troop = (fields) => Object.assign(createTroop({ kind: 0 }), fields);
  const battle = (list) => ({ troops: [list, []] });
  // A full day's march under fire: the march and the attack.
  const marched = troop({ movedKm: 20, fought: true });
  tireDay(run, battle([marched]));
  assert.ok(near(marched.fatigue, FATIGUE_MARCH + FATIGUE_ATTACK), String(marched.fatigue));
  // Half a day's march, attacked where it stood: half the march and the defence.
  const held = troop({ movedKm: 10, engaged: true });
  tireDay(run, battle([held]));
  assert.ok(near(held.fatigue, FATIGUE_MARCH / 2 + FATIGUE_DEFEND));
  // More than a day's march counts as a day's.
  const far = troop({ movedKm: 60 });
  tireDay(run, battle([far]));
  assert.ok(near(far.fatigue, FATIGUE_MARCH));
  // At rest: freshened, the more so dug in, hardly at all cut off, the less so short of supply.
  const rest = (fields) => {
    const resting = troop({ fatigue: 0.5, ...fields });
    tireDay(run, battle([resting]));
    return 0.5 - resting.fatigue;
  };
  assert.ok(near(rest({}), FATIGUE_REST));
  assert.ok(near(rest({ dug: true }), FATIGUE_REST * FATIGUE_REST_DUG));
  assert.ok(near(rest({ pocket: true }), FATIGUE_REST * FATIGUE_REST_POCKET));
  assert.ok(near(rest({ supply: 0.5 }), FATIGUE_REST * 0.5));
  // A troop that shuffled a kilometre rested; never below fresh, never past spent.
  assert.ok(near(rest({ movedKm: 1 }), FATIGUE_REST));
  const fresh = troop({ fatigue: 0.01 });
  tireDay(run, battle([fresh]));
  assert.equal(fresh.fatigue, 0);
  const spent = troop({ fatigue: 0.99, movedKm: 20, fought: true });
  tireDay(run, battle([spent]));
  assert.equal(spent.fatigue, 1);
  // What a spent troop has left; a fresh one has everything.
  assert.deepEqual([punchLeft(0), guardLeft(0), legsLeft(0)], [1, 1, 1]);
  assert.ok(punchLeft(1) < 1 && guardLeft(1) < 1 && legsLeft(1) < 1);
  assert.ok(guardLeft(1) > punchLeft(1), "a tired troop still defends better than it attacks");
});

test("fatigue is kept a letter a troop, and a string that is not one reads as fresh", () => {
  const levels = [0, 0.5, 1, 0.25];
  const read = decodeLevels(encodeLevels(levels));
  read.forEach((value, at) => assert.ok(Math.abs(value - levels[at]) <= 1 / 126, `${value} for ${levels[at]}`));
  assert.deepEqual(decodeLevels("!?"), [0, 0]);
  assert.deepEqual(decodeLevels(""), []);
  assert.equal(encodeLevels([2, -1]), encodeLevels([1, 0]));
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "fatigue" });
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 30, strengthOf: () => 4, ...extra });
const heldBy = (extra) => {
  let last = null;
  const result = runFronts(war({ ...extra, watch: (seen) => { last = seen.holders; } }));
  return { held: [0, 1].map((side) => last.filter((holder) => holder === side).length), result };
};

// Aland advances along its whole line and Borduria holds, whatever happens: no staff deciding otherwise as the troops tire.
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });

test("a side that attacks day after day wears itself out, and takes less ground for it", () => {
  const fresh = heldBy({ staffPolicy: fixed });
  const tiring = heldBy({ staffPolicy: fixed, mechanics: { fatigue: true } });
  // Aland began the war and attacks: tired, it gets less far.
  assert.ok(fresh.held[0] > fresh.held[1], JSON.stringify(fresh.held));
  assert.ok(tiring.held[0] < fresh.held[0], `${tiring.held} against ${fresh.held}`);
  // Fatigue off: not a trace of it in what is kept.
  assert.equal(Object.hasOwn(fresh.result.battlefields[0].brief.carry, "tired"), false);
  // On: kept, a letter a troop, and the attackers more worn than the defenders.
  const [record] = tiring.result.battlefields;
  const tired = record.brief.carry.tired.map(decodeLevels);
  assert.equal(tired[0].length, record.troops[0].length / 7);
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
  assert.ok(mean(tired[0]) > mean(tired[1]), `${mean(tired[0])} against ${mean(tired[1])}`);
  assert.ok(mean(tired[0]) > 0.2, String(mean(tired[0])));
});

test("fatigue is carried from one run to the next, and a battlefield kept before it had any is fresh", () => {
  const first = runFronts(war({ mechanics: { fatigue: true } }));
  const [record] = first.battlefields;
  const kept = normalizeBattlefield(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(kept.brief.carry.tired, record.brief.carry.tired, "a save keeps it");
  // What the next run's troops begin with, as its staff first sees them.
  const begin = (battlefields) => {
    let seen = null;
    runFronts(war({
      mechanics: { fatigue: true },
      days: 1,
      battlefields,
      fromDate: record.asOf,
      staffPolicy: (battle) => {
        seen = seen ?? battle.troops[0].filter((troop) => troop.strength > 0).map((troop) => troop.fatigue);
        return undefined;
      },
    }));
    return seen;
  };
  const carried = begin([kept]);
  assert.ok(carried.some((value) => value > 0.1), JSON.stringify(carried.slice(0, 6)));
  const without = { ...kept, brief: { ...kept.brief, carry: { ...kept.brief.carry } } };
  delete without.brief.carry.tired;
  assert.ok(begin([without]).every((value) => value === 0), "an older battlefield's troops are fresh");
});

test("the story is told how many of a side's troops are exhausted", () => {
  // (Aland kept attacking all along its line: a staff of its own. Borduria's answers a breakthrough, staff.js.)
  const pressing = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : undefined);
  const long = runFronts(war({ mechanics: { fatigue: true }, days: 60, staffPolicy: pressing }));
  const [record] = long.battlefields;
  const strength = record.brief.strength;
  const exhausted = strength.map((side) => side.tired ?? 0);
  const decoded = record.brief.carry.tired.map(decodeLevels);
  assert.ok(exhausted[0] > 0, JSON.stringify(strength));
  assert.ok(exhausted[0] <= decoded[0].filter((value) => value >= FATIGUE_EXHAUSTED - 1 / 63).length + 1);
  assert.match(describeBattlefield(record), new RegExp(`${exhausted[0]} of them exhausted`));
  // Off, nothing is said of it.
  assert.doesNotMatch(describeBattlefield(runFronts(war({ days: 60, staffPolicy: pressing })).battlefields[0]), /exhausted/);
});

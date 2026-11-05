/*! Open Historia — battlefields and fronts: the newer mechanics' switchboard: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mechanics.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { runFronts } from "./engine.js";
import { MECHANICS, anyMechanic, readMechanics } from "./mechanics.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "mechanics" });
// A war the scripted staff fights: whoever began it attacks.
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, ...extra });

test("a mechanic is on only when the input turns it on with a literal true", () => {
  assert.deepEqual(Object.keys(readMechanics(null)), [...MECHANICS]);
  assert.equal(anyMechanic(readMechanics(null)), false);
  assert.equal(anyMechanic(readMechanics({ fatigue: "yes", weather: 1 })), false);
  assert.equal(readMechanics({ air: true }).air, true);
});

test("a run given no mechanic, or one given them in any other way than true, is the run it always was", () => {
  const plain = runFronts(war());
  assert.deepEqual(runFronts(war({ mechanics: {} })).battlefields, plain.battlefields);
  assert.deepEqual(runFronts(war({ mechanics: { fatigue: "yes", walls: 1 } })).battlefields, plain.battlefields);
  assert.deepEqual(runFronts(war({ mechanics: { fatigue: "yes", walls: 1 } })).flips, plain.flips);
});

test("what the morning makes of a side's troops is what the fight and the march go by", () => {
  // Who holds what at the end, as the run hands its days to whoever watches.
  const heldBy = (extra) => {
    let last = null;
    runFronts(war({ ...extra, watch: (seen) => { last = seen.holders; } }));
    return [0, 1].map((side) => last.filter((holder) => holder === side).length);
  };
  const even = heldBy({});
  // Readiness at 1 for both is no readiness at all.
  assert.deepEqual(heldBy({ steering: { readiness: { punch: [1, 1], guard: [1, 1], legs: [1, 1] } } }), even);
  // Aland began the war and takes ground; Borduria gives it.
  assert.ok(even[0] > even[1], JSON.stringify(even));
  // Aland's troops hitting half as hard and marching half as fast take less of it.
  const slow = heldBy({ steering: { readiness: { punch: [0.5, 1], legs: [0.5, 1] } } });
  assert.ok(slow[0] < even[0], `${JSON.stringify(slow)} against ${JSON.stringify(even)}`);
  // Borduria's defending at half its strength gives more of it.
  const thin = heldBy({ steering: { readiness: { guard: [1, 0.5] } } });
  assert.ok(thin[0] > even[0], `${JSON.stringify(thin)} against ${JSON.stringify(even)}`);
});

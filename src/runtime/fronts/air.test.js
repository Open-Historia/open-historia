/*! Open Historia — battlefields and fronts: air wings over the battlefield: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/air.test.js
//
// "Air units don't take part in front-line fighting currently: make them part
// of the actual battlefields."

import test from "node:test";
import assert from "node:assert/strict";

import { describeBattlefield } from "./brief.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "air" });
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const wing = (id, ownerCode, extra = {}) => ({ id, name: id, type: "air", ownerCode, strength: 100, lng: 21, lat: 51, ...extra });
const wings = (owner, count) => Array.from({ length: count }, (_, at) => wing(`${owner}-${at}`, owner));
const fight = (extra = {}) => {
  let last = null;
  const result = runFronts(frontInput(sheet(), {
    arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed,
    watch: (seen) => { last = seen.holders; },
    ...extra,
  }));
  const aland = result.battlefields[0].sides.findIndex((members) => members[0] === "Aland");
  return { result, held: last.filter((holder) => holder === aland).length };
};

test("the side that holds the sky over a battlefield takes more ground; with the mechanic off wings do nothing", () => {
  const ground = fight();
  const aloft = fight({ mechanics: { air: true }, units: wings("Aland", 6) });
  assert.ok(aloft.held > ground.held, `${aloft.held} against ${ground.held}`);
  // The enemy's wings in the sky take it back.
  const contested = fight({ mechanics: { air: true }, units: [...wings("Aland", 6), ...wings("Borduria", 6).map((unit) => ({ ...unit, lng: 27 }))] });
  assert.ok(contested.held < aloft.held, `${contested.held} against ${aloft.held}`);
  // Off, the same wings are nothing.
  assert.equal(fight({ units: wings("Aland", 6) }).held, ground.held);
  // Nor before there were aircraft, nor for a country with no air arm.
  assert.equal(fight({ mechanics: { air: true }, units: wings("Aland", 6), era: 1 }).held, fight({ era: 1 }).held);
  assert.equal(fight({ mechanics: { air: true, military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null), units: wings("Aland", 6) }).held,
    fight({ mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null) }).held);
  // The story is told who held the sky.
  assert.match(describeBattlefield(aloft.result.battlefields[0]), /Air: Aland holds the sky \(6 wings against 0\)/);
});

test("in a game's run a country with no wings on the map flies its air arm over its battlefield", () => {
  const strong = (name) => (name === "Aland" ? { air: 90 } : { air: 20 });
  const bare = fight({ mechanics: { air: true, military: true }, militaryOf: strong });
  const arms = fight({ mechanics: { air: true, military: true }, militaryOf: strong, airArms: true });
  assert.equal(bare.result.battlefields[0].brief.air, undefined, "without air arms nobody flies");
  assert.ok(arms.held > bare.held, `the better air arm takes more ground: ${arms.held} against ${bare.held}`);
  assert.match(describeBattlefield(arms.result.battlefields[0]), /Air: Aland holds the sky \(\d+ wings against \d+\)/);
  assert.equal(arms.result.unitChanges.some((change) => /^air arm/.test(change.unitId)), false, "an air arm is no unit of the world's");
  // A country with wings of its own on the map flies those and no air arm.
  const own = fight({ mechanics: { air: true, military: true }, militaryOf: strong, airArms: true, units: wings("Borduria", 1).map((unit) => ({ ...unit, lng: 27 })) });
  assert.match(describeBattlefield(own.result.battlefields[0]), /\(\d+ wings against 1\)|against \d+ wings/);
  assert.deepEqual(fight({ mechanics: { air: true, military: true }, militaryOf: strong, airArms: true }).held, arms.held, "the same run is the same war");
});

test("a storm grounds the wings, and wings that flew come back worn, once a wing", () => {
  const stormy = fight({ mechanics: { air: true, weather: true }, steering: { weather: "storm" }, units: wings("Aland", 6) });
  const stormyBare = fight({ mechanics: { weather: true }, steering: { weather: "storm" } });
  assert.equal(stormy.held, stormyBare.held, "in a storm nobody flies");
  const flown = fight({ mechanics: { air: true }, units: wings("Aland", 2) });
  const changes = flown.result.unitChanges.filter((change) => change.unitId.startsWith("Aland-"));
  assert.deepEqual(changes.map((change) => change.unitId).sort(), ["Aland-0", "Aland-1"]);
  for (const change of changes) {
    assert.equal(change.committedTo, "");
    assert.ok(change.strength < 100 && change.strength > 50, String(change.strength));
  }
  assert.deepEqual(fight({ mechanics: { air: true }, units: wings("Aland", 2) }).result.unitChanges, flown.result.unitChanges, "the same run is the same war");
});

test("a side's wings go where they are sent: to strike the other's troops, to support its own, or nowhere", () => {
  // ("Make it also be able to control and understand ... plane attacks", the owner, 2026-10-14.)
  const sent = (mission) => fight({
    mechanics: { air: true },
    units: wings("Aland", 6),
    staffPolicy: (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all", ...(mission ? { air: mission } : {}) } : { order: "hold", sector: "all" }),
  });
  const strengthOf = (run, name) => {
    const record = run.result.battlefields[0];
    const side = record.sides.findIndex((members) => members[0] === name);
    return record.brief.strength[side].n * record.brief.strength[side].pct;
  };
  const support = sent(null);
  const strike = sent("strike");
  const down = sent("grounded");
  assert.deepEqual(sent("support").result.battlefields, support.result.battlefields, "told nothing, a side's wings support its troops");
  // Striking, Borduria's troops are worn the more, and Aland's own advance has no close support.
  assert.ok(strengthOf(strike, "Borduria") < strengthOf(support, "Borduria"), `${strengthOf(strike, "Borduria")} against ${strengthOf(support, "Borduria")}`);
  assert.match(describeBattlefield(strike.result.battlefields[0]), /Air: Aland holds the sky/);
  const worn = (run) => run.result.unitChanges.filter((change) => change.unitId.startsWith("Aland-")).reduce((sum, change) => sum + (100 - change.strength), 0);
  assert.ok(worn(strike) > worn(support), "striking wears the wings the more");
  // Grounded (from the staff's first look, after the first morning's flying), they are hardly worn, and the
  // advance has none of their support.
  assert.equal(worn(down), 0);
  assert.ok(down.held < support.held, `${down.held} against ${support.held}`);
});

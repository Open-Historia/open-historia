/*! Open Historia — battlefields and fronts: a breakthrough is answered: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/breakthrough.test.js
//
// "At the moment drawing a route with all your forces and making the route go
// super deep into enemy territory makes it just sledgehammer through and
// nothing can stop it" (the owner, 2026-10-14). A side's staff answers a
// thrust into its ground (staff.js breakthroughAnswer), a narrow corridor
// feeds the thrust worse the longer it is (supply.js, CORRIDOR_COST), and
// every country goes to war with its peacetime army (muster.js).

import test from "node:test";
import assert from "node:assert/strict";

import { MIND_MARK } from "./constants.js";
import { runFronts } from "./engine.js";
import { spearheadsOf } from "./staff.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
// A long front, north to south, and a thrust down its middle to Borduria's far side.
const sheet = () => syntheticMap({ layout: Array.from({ length: 10 }, () => "AAAAAAAABBBBBBBB"), legend, west: 20, north: 53, step: 0.5, stepLat: 0.3, key: "breakthrough" });
const DEEP = [[27.8, 51.5]];
const liveOf = (battle, side) => battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);
// Aland sends the troops of the middle of its line down the route, and the rest hold; Borduria is left to its staff.
const thrusting = (seen) => {
  const policy = (battle, side) => {
    if (battle.sides[side][0] !== "Aland") return undefined;
    const middle = battle.field.rows / 2;
    const live = liveOf(battle, side);
    const going = live.filter((index) => Math.abs(battle.troops[side][index].y - middle) < battle.field.rows / 6);
    const holding = live.filter((index) => !going.includes(index));
    if (seen) seen(battle, side);
    return { troops: [{ order: "advance", picked: going, way: DEEP }, ...(holding.length > 0 ? [{ order: "hold", picked: holding }] : [])] };
  };
  return policy;
};
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 40, strengthOf: () => 4, era: 1, ...extra });

test("a thrust deep into a side's ground is answered at once, with a counter-offensive; with the older engine it never was", () => {
  // What Borduria stood under, each day the thrust's staff looked.
  const watched = [];
  const watch = (battle, side) => {
    const other = 1 - side;
    watched.push({
      day: battle.daysRun,
      heads: spearheadsOf(battle, other).length,
      mind: battle.orders.filter((order) => order.s === other && order.mark === MIND_MARK).length,
      sent: battle.troops[other].filter((troop) => troop.strength > 0 && troop.order && !troop.order.done && troop.order.standing?.mark === MIND_MARK).length,
    });
  };
  const policy = thrusting(watch);
  policy.often = true;
  const answered = runFronts(war({ mechanics: { muster: true }, staffPolicy: policy }));
  const [record] = answered.battlefields;
  // (What the run told: a battlefield's own log keeps only its latest.)
  const counter = answered.news.filter((entry) => entry.k === "counter");
  assert.equal(counter.length >= 1, true, JSON.stringify(answered.news));
  assert.equal(counter[0].s, record.sides.findIndex((members) => members[0] === "Borduria"));
  assert.match(counter[0].at, /^(city|region): /, "told by a place's name");
  // Seen on the day it appeared, not ten days on: the first day with a spearhead is the day of the answer.
  const first = watched.find((entry) => entry.heads > 0);
  assert.ok(first, "the thrust made a salient");
  const answeredOn = watched.find((entry) => entry.mind > 0);
  assert.ok(answeredOn && answeredOn.day <= first.day + 1, `seen on day ${first.day}, answered on day ${answeredOn?.day}`);
  // Troops sent to attack, under the staff's own orders troop by troop.
  assert.ok(watched.some((entry) => entry.sent > 0), "some sent to attack");
  // The older engine (no newer mechanic on) leaves Borduria to its staff's look every ten days.
  const older = thrusting(null);
  older.often = true;
  const olderRun = runFronts(war({ staffPolicy: older }));
  const [plain] = olderRun.battlefields;
  assert.deepEqual(olderRun.news.filter((entry) => entry.k === "counter"), []);
  assert.deepEqual(plain.orders.filter((order) => order.mark === MIND_MARK && plain.sides[order.s][0] === "Borduria"), []);
});

test("a side a staff of the run's own leads is its own: the engine's staff answers nothing for it", () => {
  const policy = (battle, side) => (battle.sides[side][0] === "Aland" ? thrusting(null)(battle, side) : { order: "hold", sector: "all" });
  policy.often = true;
  const run = runFronts(war({ mechanics: { muster: true }, staffPolicy: policy }));
  const [record] = run.battlefields;
  assert.deepEqual(run.news.filter((entry) => entry.k === "counter"), []);
  assert.deepEqual(record.orders.filter((order) => order.mark === MIND_MARK && record.sides[order.s][0] === "Borduria"), []);
});

test("a thrust fed down a narrow corridor is fed the worse the longer it is, with the supply mechanic", () => {
  const leastSupply = (mechanics) => {
    let least = 1;
    const policy = thrusting((battle, side) => {
      for (const index of liveOf(battle, side)) if (battle.troops[side][index].supply < least) least = battle.troops[side][index].supply;
    });
    policy.often = true;
    runFronts(war({ mechanics, staffPolicy: policy }));
    return least;
  };
  const open = leastSupply({ muster: true });
  const corridor = leastSupply({ muster: true, supply: true });
  assert.ok(corridor < open - 0.15, `${corridor} down the corridor, ${open} without`);
});

test("a war a person's own country began is fought from its battlefield's first day, unless someone has ordered that side already", () => {
  // (Aland began the war: the first side of it. A run whose battlefield opens on its first day.)
  const heldBy = (extra) => {
    let last = null;
    const result = runFronts(frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, watch: (seen) => { last = seen.holders; }, ...extra }));
    const aland = result.battlefields[0].sides.findIndex((members) => members[0] === "Aland");
    return { held: last.filter((holder) => holder === aland).length, result };
  };
  const nobody = heldBy({});
  const played = heldBy({ players: ["Aland"] });
  assert.ok(played.held > nobody.held * 1.02, `${played.held} cells held when Aland's player began it, ${nobody.held} when its staff did`);
  assert.ok(played.result.news.some((entry) => entry.k === "offensive" && entry.s === played.result.battlefields[0].sides.findIndex((members) => members[0] === "Aland")));
  // Ordered already (the person's own order, or the story's), it does as it was told: here, to hold.
  const told = heldBy({ players: ["Aland"], moments: [{ day: 0, type: "order", battlefield: "aland-war", side: "Aland", order: "hold", sector: "all" }] });
  assert.equal(told.result.news.some((entry) => entry.k === "offensive"), false);
  // The side a person plays that was attacked is never sent forward by the engine.
  const attacked = heldBy({ players: ["Borduria"] });
  const borduria = attacked.result.battlefields[0].sides.findIndex((members) => members[0] === "Borduria");
  assert.equal(attacked.result.news.some((entry) => entry.k === "offensive" && entry.s === borduria), false);
});

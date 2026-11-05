/*! Open Historia — battlefields and fronts: a side nobody plays decides for itself: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/staff.test.js
//
// "Have frontlines between 2 ai countries be more active, and have your
// opponents have their troops actually go on the offensive sometimes depending
// on whether they initiated the war or if they are defending themselves, and
// depending on how strong each side is the game engine can decide what to do
// tactically."

import test from "node:test";
import assert from "node:assert/strict";

import { STAFF_ATTACKER_ADVANCES, STAFF_ATTACKER_PROBES, STAFF_DEFENDER_ADVANCES, STAFF_DEFENDER_PROBES, STAFF_MARK, STAFF_REVIEW_DAYS, STAFF_STORY_ORDER_DAYS } from "./constants.js";
import { runFronts } from "./engine.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

// Aland began the war (it is the war's first side); Borduria defends.
const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "staff" });
const fight = ({ aland = 2, borduria = 2, players = [], days = 30, seed = "a seed", moments = [], staff = true, battlefields = undefined, fromDate = undefined } = {}) => {
  const world = sheet();
  const result = runFronts(frontInput(world, { arenas: new Map(), days, staff, players, seed, moments, strengthOf: (name) => (name === "Aland" ? aland : borduria), ...(battlefields ? { battlefields, fromDate } : {}) }));
  applyFlips(world, result.flips);
  const [record] = result.battlefields;
  const held = record?.field ? readBattlefield(record, world).held : [0, 0];
  const orders = (side) => (record?.orders ?? []).filter((order) => order.s === side && !order.chosen).map((order) => [order.order, order.sector, order.mark ?? "", order.by ?? ""]);
  return { result, record, share: held[0] / Math.max(1, held[0] + held[1]), aland: orders(0), borduria: orders(1), offensives: result.news.filter((entry) => entry.k === "offensive") };
};

test("the figures: the side that began the war attacks at odds a defender only holds at", () => {
  assert.ok(STAFF_ATTACKER_ADVANCES < STAFF_DEFENDER_ADVANCES && STAFF_ATTACKER_PROBES < STAFF_DEFENDER_PROBES);
  assert.ok(STAFF_ATTACKER_PROBES < 1 && STAFF_DEFENDER_PROBES > 1, "an even attacker tries something; an even defender holds");
  assert.ok(STAFF_REVIEW_DAYS >= 5 && STAFF_STORY_ORDER_DAYS >= 30);
});

test("much the stronger, the side that began the war advances along the whole line and the weaker digs in", () => {
  const out = fight({ aland: 4, borduria: 1 });
  // Its own staff's order, written as an ordinary standing order: on the first day, by its first country, marked as the staff's.
  assert.deepEqual(out.aland, [["advance", "all", STAFF_MARK, "Aland"]]);
  assert.deepEqual(out.borduria, [["dig in", "all", STAFF_MARK, "Borduria"]]);
  assert.deepEqual(out.offensives.map((entry) => [entry.d, entry.s, entry.at]), [["2024-03-02", 0, "the whole line"]]);
  // And it is carried out: the ground goes to it.
  assert.ok(out.result.flips.some((flip) => flip.to === "Aland"));
});

test("the side defending goes over to the attack when it has clearly the stronger army, and not at even odds", () => {
  const strong = fight({ aland: 1, borduria: 4 });
  assert.deepEqual(strong.borduria, [["advance", "all", STAFF_MARK, "Borduria"]]);
  assert.deepEqual(strong.aland, [["dig in", "all", STAFF_MARK, "Aland"]]);
  assert.deepEqual(strong.offensives.map((entry) => entry.s), [1]);
  // Half as strong again, a defender counter-attacks; the side that began it, now the weaker, holds and is given no order to.
  const ahead = fight({ aland: 2, borduria: 3 });
  assert.deepEqual(ahead.borduria, [["advance", "all", STAFF_MARK, "Borduria"]]);
  assert.deepEqual(ahead.aland, []);
  // At even odds the defender never attacks, whatever the period.
  for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) assert.deepEqual(fight({ seed }).borduria, [], seed);
});

test("at even odds the side that began the war attacks one stretch of the line, some periods and not others", () => {
  const runs = ["s1", "s2", "s3", "p3", "p5", "s6", "p1", "p2"].map((seed) => fight({ seed, days: 9 }));
  const attacked = runs.filter((out) => out.aland.some(([order]) => order === "advance"));
  assert.ok(attacked.length >= 3 && attacked.length < runs.length, `${attacked.length} of ${runs.length} periods`);
  for (const out of attacked) {
    // One stretch, by name, never the whole line: and the war is told of it.
    assert.equal(out.aland.length, 1);
    assert.notEqual(out.aland[0][1], "all");
    assert.equal(out.aland[0][2], STAFF_MARK);
    assert.equal(out.offensives[0].at, out.aland[0][1]);
  }
  // A front between two countries nobody plays is not still: over a month ground changes hands in most of them.
  const month = ["s1", "s2", "s3", "s5"].map((seed) => fight({ seed }));
  assert.ok(month.filter((out) => Math.abs(out.share - 0.5) > 0.03).length >= 3);
  // A later look replaces what the staff had it doing: it is never two attacks piled on each other.
  for (const out of month) assert.ok(out.aland.length <= 1, JSON.stringify(out.aland));
});

test("a side a person plays has no staff, and the side against it has", () => {
  // The player's own side is the stronger and began the war: on its battlefield's first day, ordered by nobody,
  // it goes over to the attack along the whole line ("when a front is deployed in the first time skip ... the
  // front doesnt do anything", the owner, 2026-10-14), and nothing more is ordered for it.
  const mine = fight({ aland: 4, borduria: 1, players: ["Aland"] });
  assert.deepEqual(mine.aland, [["advance", "all", STAFF_MARK, "Aland"]]);
  assert.deepEqual(mine.borduria, [["dig in", "all", STAFF_MARK, "Borduria"]]);
  // The other way round, the enemy does not wait to be attacked.
  const theirs = fight({ aland: 2, borduria: 3, players: ["Aland"] });
  assert.deepEqual(theirs.aland, [["advance", "all", STAFF_MARK, "Aland"]]);
  assert.deepEqual(theirs.borduria, [["advance", "all", STAFF_MARK, "Borduria"]]);
  assert.ok(theirs.share < 0.5, `the player has lost ground: ${theirs.share}`);
  // A person's side the war was begun against is never sent forward by the engine.
  const attacked = fight({ aland: 1, borduria: 4, players: ["Borduria"] });
  assert.deepEqual(attacked.borduria, []);
  // And a run told to leave every side to its orders does.
  const still = fight({ aland: 4, borduria: 1, staff: false });
  assert.deepEqual([still.aland, still.borduria, still.offensives], [[], [], []]);
});

test("the story still commands: its order stands, and only one grown old is the staff's to replace", () => {
  const hold = { day: 0, type: "order", battlefield: "The Front", side: "Borduria", order: "hold", sector: "all" };
  // Borduria is four times the stronger and is told to hold: for a month it holds.
  const month = fight({ aland: 1, borduria: 4, moments: [hold] });
  assert.deepEqual(month.borduria, [["hold", "all", "", "Borduria"]]);
  assert.deepEqual(month.offensives, []);
  // Left with that order past the days a story's order is left alone, its staff decides.
  const long = fight({ aland: 1, borduria: 4, days: STAFF_STORY_ORDER_DAYS + STAFF_REVIEW_DAYS + 2, moments: [hold] });
  assert.deepEqual(long.borduria, [["advance", "all", STAFF_MARK, "Borduria"]]);
  assert.ok(long.offensives[0].d > "2024-04-14", long.offensives[0].d);
  // An order the story gives later in a run replaces the staff's at once.
  const told = fight({ aland: 4, borduria: 1, days: 12, moments: [{ day: 5, type: "order", battlefield: "The Front", side: "Aland", order: "dig in", sector: "all" }] });
  assert.deepEqual(told.aland, [["dig in", "all", "", "Aland"]]);
});

test("what the staff decided is kept as its own, and the same run decides the same", () => {
  const first = fight({ aland: 3, borduria: 2, days: 4 });
  assert.deepEqual(first.aland, [["advance", "all", STAFF_MARK, "Aland"]]);
  // The next run knows the order for its staff's own: it goes on with it, and tells of no new offensive.
  const next = fight({ aland: 3, borduria: 2, days: 4, battlefields: [first.record], fromDate: "2024-03-05" });
  assert.deepEqual(next.aland, [["advance", "all", STAFF_MARK, "Aland"]]);
  assert.equal(next.record.orders.find((order) => order.s === 0).since, "2024-03-02");
  assert.deepEqual(next.offensives, []);
  // Worked out again from the same beginning it is the same war, troop for troop.
  assert.deepEqual(fight({ aland: 3, borduria: 2, days: 12 }).record, fight({ aland: 3, borduria: 2, days: 12 }).record);
});

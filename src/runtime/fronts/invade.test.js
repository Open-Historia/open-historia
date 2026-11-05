/*! Open Historia — battlefields and fronts: troops sent into a country that is not in the war: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/invade.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { describeBattlefield } from "./brief.js";
import { decodeTroops } from "./codec.js";
import { orderTroops } from "./command.js";
import { MAX_ORDER_ATTACKS, ROUTE_INTO_KM } from "./constants.js";
import { runFronts } from "./engine.js";
import { createFrame } from "./frame.js";
import { landWithin, othersOnWay, readAttacks } from "./invade.js";
import { plansOf } from "./plans.js";
import { normalizeBattlefield } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";

// Aland in the west, Borduria in the east, and Neutralia, which is in nobody's
// war, across the north between them.
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const sheet = () => syntheticMap({ layout: ["ANNBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities: [{ name: "Brod", lng: 23.5, lat: 50 }] });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const steering = { wander: 0 };
// Neutralia is a small state: a handful of formations, so that what is tested
// is whether its land can be entered, not who wins there.
const strengthOf = (name) => (name === "Neutralia" ? 0.2 : 2);
const input = (world, record, days, extra = {}) => frontInput(world, { battlefields: [record], days, steering, strengthOf, ...extra });
const opened = (world) => runFronts(input(world, battlefieldOn(world, {
  // Eight of Aland's in its north, beside Neutralia; Borduria dug in across the direct way further south.
  troops: [[...row(20.9, 50.42, 50.95, 8), ...row(20.9, 49.2, 50.2, 6)], row(21.1, 49.2, 50.2, 10, { dig: 1, state: 4 })],
  pool: [200, 0],
}), 0)).battlefields[0];
const north = [0, 1, 2, 3, 4, 5, 6, 7];
// East through the middle of Neutralia, then down into Borduria behind its line.
const THROUGH = [[21.3, 50.7], [22.7, 50.7], [23.3, 50.1]];

test("a way's countries: those outside the war whose land it goes well into, in the order it comes to them", () => {
  // Six cells by three, a kilometre... ten kilometres a cell: region 1 ours, 2 theirs, 3 and 4 somebody else's.
  const arena = { cols: 6, rows: 3, ids: ["", "a", "b", "n", "m"], region: Uint16Array.from([1, 3, 3, 3, 2, 2, 1, 3, 3, 4, 2, 2, 1, 1, 0, 4, 2, 2]) };
  const place = { kmAt: () => 10 };
  const holders = { a: "Aland", b: "Borduria", n: "Neutralia", m: "Marches" };
  const ask = (way, extra = {}) => othersOnWay({ arena, place, way, holderOf: (id) => holders[id] ?? "", inWar: (name) => name === "Aland" || name === "Borduria", ...extra });
  // Straight across the top row: thirty kilometres of Neutralia.
  assert.equal(ROUTE_INTO_KM, 30);
  assert.deepEqual(ask([[0.5, 0.5], [5.5, 0.5]]), ["Neutralia"]);
  // Down the fourth column: ten of Neutralia's (a corner clipped) and twenty of the Marches': nobody is attacked.
  assert.deepEqual(ask([[3.5, 0], [3.5, 3]]), []);
  // A way with a bend through both, long enough in each.
  assert.deepEqual(ask([[0.5, 1.5], [3.4, 1.5], [3.4, 0.2], [0.6, 0.2], [0.6, 0.9], [2.9, 0.9], [3.5, 2.9], [3.5, 1.1], [3.5, 2.9]]), ["Neutralia", "Marches"]);
  // Whoever is in the war already is not attacked by being walked into: that is what a battlefield is.
  assert.deepEqual(ask([[0.5, 0.5], [5.5, 0.5]], { inWar: () => true }), []);
  // The sea and land nobody holds are nobody; a way of one point is no way; off the frame is not looked at.
  assert.deepEqual(ask([[2.5, 2.2], [2.5, 2.9]]), []);
  assert.deepEqual(ask([[1.5, 0.5]]), []);
  assert.deepEqual(ask([[-9, 0.5], [-1, 0.5]]), []);
  assert.deepEqual(othersOnWay(), []);

  assert.deepEqual(readAttacks([" Neutralia ", "neutralia", "", null, "Marches"]), ["Neutralia", "Marches"]);
  assert.equal(readAttacks(Array.from({ length: 9 }, (_, index) => `Country ${index}`)).length, MAX_ORDER_ATTACKS);
  assert.deepEqual(readAttacks("Neutralia"), []);

  const held = Uint8Array.from([0, 0, 0, 1, 0]);
  assert.equal(landWithin(arena, held, 0.5, 2.5, 1), false);
  assert.equal(landWithin(arena, held, 0.5, 1.5, 1.2), true, "the cell beside it is Neutralia's");
});

test("a route drawn through a country outside the war says so on its order, and one that only clips its corner does not", () => {
  const world = sheet();
  const record = opened(world);
  const through = runFronts(input(world, orderTroops(record, { side: 0, troops: north, way: THROUGH, by: "Aland" }), 0)).battlefields[0];
  assert.deepEqual(through.orders.filter((order) => order.chosen).map((order) => order.attacks), [["Neutralia"]]);
  assert.deepEqual(normalizeBattlefield(through).orders.find((order) => order.chosen).attacks, ["Neutralia"], "the record keeps it");
  assert.deepEqual(through.sides, [["Aland"], ["Borduria"]], "nothing has happened yet: no day has passed");
  // South-east across the very corner of Neutralia: some ten kilometres of it.
  const clipped = runFronts(input(world, orderTroops(record, { side: 0, troops: north, way: [[20.95, 50.42], [21.3, 50.28], [22.4, 50.0]], by: "Aland" }), 0)).battlefields[0];
  assert.equal(clipped.orders.find((order) => order.chosen).attacks, undefined);
});

test("troops sent into a country outside the war bring it in against them: its land is fought over, it raises troops, and the run says who joined", () => {
  const world = sheet();
  const told = orderTroops(opened(world), { side: 0, troops: north, way: THROUGH, by: "Aland" });
  const result = runFronts(input(world, told, 14));
  const [record] = result.battlefields;

  // It is in the war from the day the first of them came to its border, on the side they are not on.
  assert.equal(result.joins.length, 1);
  const [join] = result.joins;
  assert.deepEqual([join.name, join.warId, join.side, join.by, join.battlefield], ["Neutralia", "war-1", 1, "Aland", "The front"]);
  assert.ok(join.day >= 1 && join.day <= 5, `on day ${join.day}`);
  assert.deepEqual(record.sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.deepEqual(result.news.filter((entry) => entry.k === "invaded").map((entry) => [entry.s, entry.at, entry.d]), [[0, "country: Neutralia", join.date]]);
  // It is in the war now, so the route attacks nobody new, and nothing that reads the order says it does.
  assert.deepEqual(record.orders.filter((order) => order.chosen).map((order) => order.attacks), [undefined], "the route is still being marched, and no longer says it attacks");
  assert.doesNotMatch(describeBattlefield(record, { viewer: "Aland" }), /not in the war/);
  // It stands on its own ground: a few formations of its own, in its own north.
  const theirs = decodeTroops(record.troops[1]);
  const neutral = theirs.filter((troop) => troop.owner === 1);
  assert.ok(neutral.length >= 2, `${neutral.length} formations of Neutralia's`);
  // And its land is ground now: what Aland's troops walked over is theirs.
  const map = readBattlefield(record, world);
  assert.equal(map.holderAt(21.3, 50.7), 0, "the ground just inside Neutralia has been taken");
  const reached = map.troops[0].filter((troop) => troop.strength > 0 && troop.lng > 21.05 && troop.lat > 50.35).length;
  assert.ok(reached >= 3, `${reached} of Aland's troops are inside Neutralia`);

  // The same troops with the same route and no such country in the way of it
  // would have been stopped at a wall: before any of this, they were.
  const walled = runFronts(input(world, orderTroops(opened(world), { side: 0, troops: north, way: [[20.95, 50.42], [21.3, 50.28], [22.4, 50.0]], by: "Aland" }), 14));
  assert.deepEqual(walled.joins, []);
  assert.deepEqual(walled.battlefields[0].sides, [["Aland"], ["Borduria"]]);
  assert.equal(readBattlefield(walled.battlefields[0], world).holderAt(21.6, 50.7), 2, "Neutralia's land is still a wall to this war");
});

test("the story naming the day such a country joins does not move the day: its attackers bring it in when they reach it", () => {
  const world = sheet();
  const told = orderTroops(opened(world), { side: 0, troops: north, way: THROUGH, by: "Aland" });
  const alone = runFronts(input(world, told, 14));
  // The answer to the same period says Neutralia joined Borduria's side "on the first day".
  const storied = runFronts(input(world, told, 14, { moments: [{ day: 0, type: "war", warId: "war-1", op: "join-b", names: ["Neutralia"] }] }));
  assert.deepEqual(storied.joins, alone.joins);
  assert.deepEqual(storied.battlefields[0].troops, alone.battlefields[0].troops, "the same run, to the last troop");
  // A country nobody is marching on joins on the day the story says, as it always has.
  const other = runFronts(input(world, opened(world), 3, { moments: [{ day: 1, type: "war", warId: "war-1", op: "join-b", names: ["Neutralia"] }] }));
  assert.deepEqual(other.battlefields[0].sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.deepEqual(other.joins, [], "and the engine has nothing to tell the ledger: the story wrote it");
});

test("what a route attacks is said wherever the order is read: on its plan in the war room, and in the brief the story is written from", () => {
  const world = sheet();
  const through = runFronts(input(world, orderTroops(opened(world), { side: 0, troops: north, way: THROUGH, by: "Aland" }), 0)).battlefields[0];
  const routes = plansOf(through, 0, { cities: world.map.cities, player: "Aland", people: ["aland"] }).filter((plan) => plan.kind === "route");
  assert.deepEqual(routes.map((plan) => [plan.attacks, plan.begun, plan.picked.length]), [[["Neutralia"], false, 8]]);
  assert.match(describeBattlefield(through, { viewer: "Aland" }), /8 formations sent along a route drawn for them, into Neutralia, which is not in the war/);
  // A route inside the war's own ground attacks nobody and says nothing of the kind.
  const inside = runFronts(input(world, orderTroops(opened(world), { side: 0, troops: north, way: [[21.3, 50.0], [22.4, 49.8]], by: "Aland" }), 0)).battlefields[0];
  assert.deepEqual(plansOf(inside, 0, { cities: world.map.cities, player: "Aland", people: ["aland"] }).filter((plan) => plan.kind === "route").map((plan) => plan.attacks), [[]]);
  assert.doesNotMatch(describeBattlefield(inside, { viewer: "Aland" }), /not in the war/);
});

test("the battlefield grows to hold what happens: a route that leaves its frame takes the troops past the old edge, into a country they were sent into as well", () => {
  const wide = (layout) => syntheticMap({ layout, legend, west: 20, north: 51, step: 1, stepLat: 1, cities: [] });
  const go = (world, box, way, days) => {
    const small = createFrame(box, { marginKm: 10 });
    const arenas = new Map();
    const run = (record, length) => runFronts(frontInput(world, { battlefields: [record], days: length, steering, strengthOf, arenas }));
    const start = run(battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), row(21.1, 49, 51, 3)], pool: [200, 0], frame: small }), 0).battlefields[0];
    const result = run(orderTroops(start, { side: 0, troops: [0, 1, 2, 3, 4, 5, 6, 7, 8], way, by: "Aland" }), days);
    const furthest = Math.max(...readBattlefield(result.battlefields[0], world).troops[0].filter((troop) => troop.strength > 0).map((troop) => troop.lng));
    return { small, result, record: result.battlefields[0], furthest };
  };
  // Their own war, on a frame that ends in the west of Borduria: the route goes on east of it.
  const own = go(wide(["ABBBBB", "ABBBBB"]), { west: 20, south: 49, east: 22.6, north: 51 }, [[21.4, 50], [22.3, 50.2], [24.6, 50.1]], 14);
  assert.ok(own.record.frame.cols > own.small.cols, `${own.small.cols} columns grew to ${own.record.frame.cols}`);
  assert.ok(own.furthest > 23.5, `the furthest of them is at ${own.furthest}, past where the frame ended (22.7)`);
  assert.deepEqual(own.result.joins, []);
  // And a country outside the war, most of whose land lies beyond the frame.
  const other = go(wide(["ABBNNN", "ABBNNN"]), { west: 20, south: 49, east: 23.3, north: 51 }, [[21.4, 50.5], [22.9, 50.5], [24.4, 50.2]], 14);
  assert.deepEqual(other.result.joins.map((join) => [join.name, join.side]), [["Neutralia", 1]]);
  assert.deepEqual(other.record.sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.ok(other.record.frame.cols > other.small.cols, `${other.small.cols} columns grew to ${other.record.frame.cols}`);
  assert.ok(other.furthest > 23.6, `the furthest of them is at ${other.furthest}, inside Neutralia past the old edge (23.4)`);
});

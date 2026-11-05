/*! Open Historia — battlefields and fronts: troops of one front sent against the enemy of another: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/handOver.test.js
//
// "Cannot retake own territory with troops from a different front. They can
// attack, but not paint the territory."
//
// Aland is at war with Borduria in the east and, in another war, with Cordovia
// in the north, which holds a strip of Aland's own land. Each war has its
// battlefield. Troops of the eastern front sent into the strip used to bring
// Cordovia into the EASTERN war as if it were a newcomer: the strip then lay
// on two battlefields, each with its own account of who held it, and the
// northern one went on showing it as Cordovia's whatever the troops did.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { orderTroops } from "./command.js";
import { runFronts } from "./engine.js";
import { applyFlips, enlarge, frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", C: "Cordovia", o: { owner: "Cordovia", sovereign: "Aland" }, "~": null };
// Cordovia across the north; under it Aland's own north, held by Cordovia; Borduria in the east.
const sheet = () => syntheticMap({ layout: enlarge(["CCCCCC", "ooooBB", "AAAABB", "AAAABB", "AAAABB"], 2), legend, west: 20, north: 54, step: 0.5, stepLat: 0.4, key: "hand-over" });
const wars = [
  { id: "war-1", title: "the eastern war", status: "active", sideA: ["Aland"], sideB: ["Borduria"] },
  { id: "war-2", title: "the northern war", status: "active", sideA: ["Cordovia"], sideB: ["Aland"] },
];
const input = (world, battlefields, days, extra = {}) => frontInput(world, { battlefields, days, wars, strengthOf: () => 2, steering: { wander: 0 }, players: ["Aland"], ...extra });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).length;
// The middle of the strip, and a way into it from the south-east.
const STRIP_LAT = 52.8;
const WAY = [[21.5, 52.3], [21.0, 52.8], [20.6, 52.9]];

const begin = () => {
  const world = sheet();
  const opened = runFronts(input(world, [], 0));
  const east = opened.battlefields.find((record) => record.sides.flat().includes("Borduria"));
  const north = opened.battlefields.find((record) => record.sides.flat().includes("Cordovia"));
  const side = east.sides[0].includes("Aland") ? 0 : 1;
  // The eight of Aland's on the eastern front that stand furthest north.
  const map = readBattlefield(east, world);
  const picked = map.troops[side].map((troop, index) => ({ index, lat: troop.lat, strength: troop.strength })).filter((troop) => troop.strength > 0)
    .sort((a, b) => b.lat - a.lat).slice(0, 8).map((troop) => troop.index);
  const told = opened.battlefields.map((record) => (record === east ? orderTroops(record, { side, troops: picked, way: WAY, by: "Aland" }) : record));
  return { world, opened, east, north, side, told };
};

test("each war has its own battlefield, and the land one enemy holds is a wall on the other's", () => {
  const { world, opened, east, north } = begin();
  assert.equal(opened.battlefields.length, 2);
  assert.deepEqual([east.warId, east.sides], ["war-1", [["Aland"], ["Borduria"]]]);
  assert.deepEqual([north.warId, north.sides], ["war-2", [["Cordovia"], ["Aland"]]]);
  // The strip is Cordovia's ground on the northern battlefield and nobody's on the eastern one.
  assert.equal(readBattlefield(north, world).holderAt(20.75, STRIP_LAT), 0);
  assert.equal(readBattlefield(east, world).holderAt(20.75, STRIP_LAT), 2);
});

test("a route into that land attacks nobody new: the order does not say it brings a country into the war", () => {
  const { world, told } = begin();
  const put = runFronts(input(world, told, 0));
  const east = put.battlefields.find((record) => record.sides.flat().includes("Borduria"));
  const [route] = east.orders.filter((order) => order.chosen);
  assert.ok(route && Array.isArray(route.way));
  assert.equal(route.attacks, undefined);
});

test("troops sent into it go over to the battlefield where that enemy is fought, with their route, and take the ground there", () => {
  const { world, told, side } = begin();
  const before = runFronts(input(world, told, 0));
  const northBefore = before.battlefields.find((record) => record.sides.flat().includes("Cordovia"));
  const heldBefore = readBattlefield(northBefore, world).held[1];

  const first = runFronts(input(world, told, 10));
  applyFlips(world, first.flips);
  const east = first.battlefields.find((record) => record.sides.flat().includes("Borduria"));
  const north = first.battlefields.find((record) => record.sides.flat().includes("Cordovia"));
  // Cordovia is in no new war, and nobody was told it joined one.
  assert.deepEqual(first.joins, []);
  assert.deepEqual(east.sides, [["Aland"], ["Borduria"]]);
  assert.deepEqual(north.sides, [["Cordovia"], ["Aland"]]);
  // The eight left the eastern front and stand on the northern one: nobody was lost and nobody was raised.
  assert.equal(live(east, side), 16);
  assert.equal(live(north, 1), 20);
  assert.equal(live(north, 0), live(northBefore, 0), "Cordovia raised no second army");
  // Their route is the northern battlefield's now.
  assert.deepEqual(east.orders.filter((order) => order.chosen), []);
  const [route] = north.orders.filter((order) => order.chosen);
  assert.deepEqual([route.s, route.order, route.by, route.way.length], [1, "advance", "Aland", WAY.length]);
  assert.deepEqual(first.news.filter((entry) => entry.k === "reinforced").map((entry) => entry.s), [1]);
  // On the eastern battlefield the strip is still a wall: it is fought over in one place only.
  assert.equal(readBattlefield(east, world).holderAt(20.75, STRIP_LAT), 2);

  // And there they take it: Aland's ground on the northern battlefield grows, and the land changes hands on the map.
  const second = runFronts(input(world, first.battlefields, 45, { fromDate: "2024-03-11" }));
  applyFlips(world, second.flips);
  const later = second.battlefields.find((record) => record.sides.flat().includes("Cordovia"));
  const heldAfter = readBattlefield(later, world).held[1];
  assert.ok(heldAfter > heldBefore + 100, `Aland held ${heldBefore} cells there and holds ${heldAfter}`);
  const retaken = second.flips.filter((flip) => flip.to === "Aland" && world.sovereignOf(flip.regionId) === "Aland");
  assert.ok(retaken.length >= 1, JSON.stringify(second.flips));
  assert.deepEqual(second.joins, []);
});

test("with no battlefield of that war to go over to, a route into another country is what it was: an attack on it", () => {
  const world = sheet();
  // Only the eastern war is being fought: Cordovia is at peace with Aland.
  const peaceful = [wars[0]];
  const opened = runFronts(frontInput(world, { battlefields: [], days: 0, wars: peaceful, strengthOf: () => 2, steering: { wander: 0 }, players: ["Aland"] }));
  const [east] = opened.battlefields;
  const side = east.sides[0].includes("Aland") ? 0 : 1;
  const map = readBattlefield(east, world);
  const picked = map.troops[side].map((troop, index) => ({ index, lat: troop.lat, strength: troop.strength })).filter((troop) => troop.strength > 0)
    .sort((a, b) => b.lat - a.lat).slice(0, 8).map((troop) => troop.index);
  const put = runFronts(frontInput(world, { battlefields: [orderTroops(east, { side, troops: picked, way: WAY, by: "Aland" })], days: 0, wars: peaceful, strengthOf: () => 2, steering: { wander: 0 }, players: ["Aland"] }));
  assert.deepEqual(put.battlefields[0].orders.filter((order) => order.chosen).map((order) => order.attacks), [["Cordovia"]]);
});

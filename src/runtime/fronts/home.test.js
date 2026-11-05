/*! Open Historia — battlefields and fronts: a country's forces at home, built up in peace: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/home.test.js
//
// "building up forces shouldnt happen on a border, it should just happen in
// your country around cities. you can them move them with war room tools to a
// border"; "other countries should also be able to militerize"; "it shouldnt
// prevent attacks, you should be able to start wars by moving troops into
// others land" (the owner, 2026-11-02).

import test from "node:test";
import assert from "node:assert/strict";

import { playerFronts } from "../../Game/GameUI/warRoomData.js";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { homeName } from "./home.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { applyWarRoomOp } from "./warRoomOps.js";

const legend = { A: "Aland", B: "Borduria" };
// Aland west of 24 E with two cities, the larger in the west; Borduria east of it.
const cities = [
  { name: "Westburg", lng: 20.6, lat: 51.4, population: 3_000_000 },
  { name: "Eastham", lng: 23.2, lat: 51.4, population: 600_000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, cities, key: "home" });
// At peace, two months into the game, every newer mechanic of these on.
const peace = (extra = {}) => frontInput(sheet(), {
  arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4, wars: [], gameBegan: "2024-01-01",
  mechanics: { marching: true }, players: ["Aland"],
  ...extra,
});
const callUp = (ref = 1, day = 0) => ({ day, type: "order", battlefield: "home: Aland", side: "Aland", order: "reinforce", sector: "all", given: true, ref });
const troopsAt = (record, side = 0) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).map((troop, index) => {
    const [lng, lat] = place.toLngLat(troop.x, troop.y);
    return { ...troop, index, lng, lat };
  }).filter((troop) => troop.strength > 0);
};
const homeOf = (result) => result.battlefields.find((record) => record.home === true && record.status !== "closed");

test("a country builds up its forces at home, round its cities, the more round the larger, and once a day", () => {
  const result = runFronts(peace({ moments: [callUp(1), callUp(2)] }));
  const home = homeOf(result);
  assert.ok(home, "its forces at home are a record of their own");
  assert.equal(home.name, homeName("Aland"));
  assert.equal(home.status, "standing");
  assert.deepEqual(home.sides, [["Aland"], ["Borduria"]]);
  const troops = troopsAt(home);
  assert.ok(troops.length >= 2, `${troops.length} called up`);
  // Round the cities: nobody stands on the border at 24 E, and more round Westburg than Eastham.
  assert.ok(troops.every((troop) => troop.lng < 23.7), "none on the border");
  const west = troops.filter((troop) => Math.abs(troop.lng - 20.6) < 0.8).length;
  const east = troops.filter((troop) => Math.abs(troop.lng - 23.2) < 0.8).length;
  assert.ok(west > east, `${west} round Westburg, ${east} round Eastham`);
  // The second call-up of the day called nobody up.
  assert.deepEqual(result.notes.filter((note) => note.kind === "called-today").map((note) => note.side), ["Aland"]);
  // A day on, it may call up again.
  const later = runFronts(peace({ battlefields: result.battlefields, moments: [callUp(3, 1)], days: 1 }));
  assert.ok(troopsAt(homeOf(later)).length > troops.length);
});

test("its forces at home go where a route is drawn for them over its own land, and the War Room is there for them", () => {
  const home = homeOf(runFronts(peace({ moments: [callUp()] })));
  // The War Room is the player's there while any of them are there.
  assert.deepEqual(playerFronts([home], "Aland").map((front) => front.name), [homeName("Aland")]);
  assert.deepEqual(playerFronts([{ ...home, troops: ["", ""] }], "Aland"), []);
  // No front to go forward from: an advance is refused; a route is not.
  const troops = troopsAt(home);
  assert.ok(applyWarRoomOp([home], { op: "order", battlefield: home.name, troops: [troops[0].index], order: "advance" }, { player: "Aland" }).error);
  const routed = applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: troops.map((troop) => troop.index), way: [[22.6, 51.4], [23.6, 51.4]] }, { player: "Aland" });
  assert.equal(routed.error, undefined);
  const result = runFronts(peace({ battlefields: [routed.record], days: 6 }));
  assert.equal(result.starts.length, 0, "no war: the route stays in its own land");
  const moved = troopsAt(homeOf(result));
  const before = troops.reduce((sum, troop) => sum + troop.lng, 0) / troops.length;
  const after = moved.reduce((sum, troop) => sum + troop.lng, 0) / moved.length;
  assert.ok(after > before + 0.8, `east from ${before.toFixed(2)} to ${after.toFixed(2)}`);
  assert.ok(moved.every((troop) => troop.lng < 24), "and never past the border");
});

test("a route into another country's land is the war with it beginning, and those near its battlefield fight on it", () => {
  const home = homeOf(runFronts(peace({ moments: [callUp()] })));
  const troops = troopsAt(home);
  // The ones round Eastham, near the border, sent into Borduria.
  const near = troops.filter((troop) => troop.lng > 22.4).map((troop) => troop.index);
  assert.ok(near.length > 0);
  const routed = applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: near, way: [[23.6, 51.4], [25, 51.4]] }, { player: "Aland" }).record;
  const result = runFronts(peace({ battlefields: [routed], days: 1 }));
  assert.equal(result.starts.length, 1);
  assert.deepEqual([result.starts[0].attacker, result.starts[0].defender], ["Aland", "Borduria"]);
  const front = result.battlefields.find((record) => record.status === "active");
  assert.ok(front, "its battlefield opened");
  const side = front.sides.findIndex((members) => members.includes("Aland"));
  assert.ok(front.log.some((entry) => entry.k === "drafted" && /from Aland's forces at home/.test(entry.at)), "those near it joined it");
  // They are at home no more; those far off, round Westburg, still are.
  const left = troopsAt(homeOf(result));
  assert.ok(left.length < troops.length && left.length > 0, `${troops.length} at home before, ${left.length} now`);
  assert.ok(troopsAt(front, side).length > 0);
});

test("the story militarises any country: its forces at home called up, then stationed on a border", () => {
  const built = runFronts(peace({ players: [], moments: [{ ...callUp(), side: "Aland", given: false }] }));
  const home = homeOf(built);
  assert.ok(home && troopsAt(home).length > 0, "a country nobody plays builds up too");
  const sent = runFronts(peace({ players: [], battlefields: built.battlefields, days: 10, moments: [{ day: 1, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", objective: "country: Borduria", effort: "major", ref: 9 }] }));
  const stood = troopsAt(homeOf(sent));
  assert.ok(stood.every((troop) => troop.lng > 23), `all on the border: ${stood.map((troop) => troop.lng.toFixed(1)).join(", ")}`);
  assert.equal(sent.starts.length, 0, "and no war for it");
  // Only a country orders its own.
  const other = runFronts(peace({ battlefields: built.battlefields, moments: [{ ...callUp(4), side: "Borduria" }] }));
  assert.ok(other.notes.some((note) => note.kind === "side-not-fighting"));
});

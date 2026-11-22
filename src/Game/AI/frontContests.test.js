/*! Open Historia — contests that nothing holds up: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontContests.test.js
//
// "it just labeled that region which is in the middle of ussr terrtory contested by germany" (a player, 2026-11-10):
// a story's contest of Brest, deep behind the Soviet line, on a day it told a battle there that never was, stood for
// good. A contest is fighting for a region; one its side cannot reach is not made, one on a battlefield's ground is
// the engine's to draw, and one already on the map that nothing holds up is cleared (frontTurn.js checkContests).

import test from "node:test";
import assert from "node:assert/strict";

import { withoutClaimants } from "../../runtime/gameState.js";
import { buildWorldGrid } from "../../runtime/fronts/worldGrid.js";
import { checkContests, regionNeighbours } from "./frontTurn.js";

// A row of regions west to east: Aland's two, then Borduria's four. "Deep" is Borduria's far east.
const box = (west, east) => ({ type: "Polygon", coordinates: [[[west, 50], [east, 50], [east, 51], [west, 51], [west, 50]]] });
const strip = [
  ["a1", "Westmark", "Aland"], ["a2", "Eastmark", "Aland"],
  ["b1", "Border", "Borduria"], ["b2", "Middle", "Borduria"], ["b3", "Inland", "Borduria"], ["b4", "Deep", "Borduria"],
].map(([id, name, owner], index) => ({ id, name, owner, geometry: box(20 + index, 21 + index) }));
const sheet = buildWorldGrid(strip.map(({ id, geometry }) => ({ id, geometry })), { step: 0.25 });
const owners = new Map(strip.map((region) => [region.id, region.owner]));
const names = new Map(strip.map((region) => [region.id, region.name]));
const wars = [{ sideA: ["Aland", "Cisland"], sideB: ["Borduria"] }];
const sidesOf = (a, b) => {
  const [first, second] = [wars[0].sideA, wars[0].sideB];
  if (first.includes(a) && second.includes(b)) return first;
  if (second.includes(a) && first.includes(b)) return second;
  return null;
};
const contest = (regionId, actorCode, fromCode = "Borduria") => ({ op: "contest", regionId, actorCode, fromCode });
const event = (id, ops) => ({ id, date: "1941-02-02", title: `Fighting ${id}`, impacts: { regionControlOps: ops } });
const base = (overrides = {}) => ({
  holderOf: (id) => owners.get(id) ?? "",
  sovereignOf: (id) => owners.get(id) ?? "",
  sidesOf,
  fieldOf: () => null,
  regionName: (id) => names.get(id) ?? "",
  ...overrides,
});

test("a region's neighbours are read off the map's sheet", () => {
  const around = regionNeighbours(sheet, ["b1", "b4"]);
  assert.deepEqual([...around.get("b1")].sort(), ["a2", "b2"]);
  assert.deepEqual([...around.get("b4")].sort(), ["b3"]);
});

test("a story's contest is made where its side reaches the region, and not deep behind the other's line", () => {
  const events = [event("e1", [contest("b1", "Aland"), contest("b4", "Aland"), contest("b2", "Cisland")])];
  const neighbours = regionNeighbours(sheet, ["b1", "b2", "b4"]);
  const checked = checkContests({ ...base(), events, neighbours });
  // The border region touches Aland's land; Deep touches only Borduria's; Middle touches Border, which is Borduria's.
  assert.deepEqual(checked.events[0].impacts.regionControlOps.map((op) => op.regionId), ["b1"]);
  assert.equal(checked.notes.length, 1);
  assert.equal(checked.notes[0].kind, "dropped");
  assert.match(checked.notes[0].text, /^Contests were not made \(Aland on region: Deep; Cisland on region: Middle\): nothing of the contesting side's is in or next to the region\./);
  assert.doesNotMatch(checked.notes[0].text, /\bb\d\b/, "names, never ids");
  // An ally's land counts: with Cisland holding Border, Aland reaches Middle.
  const allied = checkContests({ ...base({ holderOf: (id) => (id === "b1" ? "Cisland" : owners.get(id)) }), events: [event("e2", [contest("b2", "Aland")])], neighbours });
  assert.equal(allied.events[0].impacts.regionControlOps.length, 1);
});

test("on a battlefield's ground a story's contest is left out: the engine draws that line", () => {
  const field = { name: "The Front", contested: [] };
  const checked = checkContests({ ...base({ fieldOf: (id, a, b) => (a === "Aland" && b === "Borduria" ? field : null) }), events: [event("e1", [contest("b1", "Aland")])], neighbours: regionNeighbours(sheet, ["b1"]) });
  assert.deepEqual(checked.events[0].impacts.regionControlOps, []);
  assert.match(checked.notes[0].text, /^A contest was left out \(Aland on region: Border\): the region lies on a battlefield of that war, where the fighting decides who holds the ground\./);
});

test("a contest already on the map that nothing holds up is cleared, and one on the line or in reach stands", () => {
  const field = { name: "The Front", contested: [["b2", "Borduria"]] };
  const claimants = { b4: ["Aland"], b2: ["Aland"], b1: ["Aland"], a1: ["Borduria"] };
  const checked = checkContests({
    ...base({ fieldOf: (id, a, b) => (["b1", "b2", "b4"].includes(id) && a === "Aland" && b === "Borduria" ? field : null) }),
    events: [],
    claimants,
    neighbours: regionNeighbours(sheet, ["b1", "b2", "b4"]),
  });
  // Deep: nowhere near. Middle: on the line. Border: next to Aland's land. Westmark: no battlefield there, a claim left alone.
  assert.deepEqual(checked.expired, [{ regionId: "b4", claimant: "Aland" }]);
  assert.equal(checked.notes[0].kind, "adjusted");
  assert.match(checked.notes[0].text, /^A contest was cleared \(Aland on region: Deep\): none of that side's troops stand in the region or next to it any more\./);
  // The lawful sovereign's own stripe on ground another holds is no contest.
  const occupied = checkContests({ ...base({ holderOf: () => "Aland", fieldOf: () => field }), claimants: { b4: ["Borduria"] }, neighbours: new Map() });
  assert.deepEqual(occupied.expired, []);

  const world = { regionClaimants: { b4: ["Aland", "Cisland"], b3: ["Aland"] }, settledRegionClaims: [] };
  const after = withoutClaimants(world, [{ regionId: "b4", claimant: "aland" }, { regionId: "b3", claimant: "Aland" }]);
  assert.deepEqual(after.regionClaimants, { b4: ["Cisland"] });
  assert.deepEqual(after.settledRegionClaims, ["b3"], "a region with nobody left is settled");
  assert.equal(withoutClaimants(world, [{ regionId: "b2", claimant: "Aland" }]), world, "nothing to take off, the same world");
});

test("with no contest and no claimant on a battlefield, nothing is asked of the map", () => {
  let asked = 0;
  const checked = checkContests({ ...base({ fieldOf: () => { asked += 1; return null; } }), events: [event("e1", [{ op: "control", regionId: "b1", fromCode: "Borduria", toCode: "Aland" }])], claimants: { a1: ["Borduria"] } });
  assert.equal(checked.notes.length, 0);
  assert.equal(asked, 1, "only the one claimant is weighed");
});

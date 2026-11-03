/*! Open Historia — battlefields and fronts: a region the story says was taken: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/storyCaptures.test.js
//
// "make sure the simulation ai is able to say that a region is taken by an army
// which causes the nearest troops to move accordingly so when that event
// happens, the region has been taken"; "the max number of nearby units
// redirected should be based on the size of the region. there should also be a
// minimum number and if that minimum is not met then the region transfer
// fails" (the owner, 2026-10-28).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { STORY_TAKER_KM2, STORY_TAKERS_MOST, takersFor } from "./constants.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"];
// Regions of about 70 by 55 km (one each of the sheet's letters), or four times that.
const small = () => syntheticMap({ layout, legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "story-captures" });
const large = () => syntheticMap({ layout, legend, west: 20, north: 56, step: 2, stepLat: 1, key: "story-captures-large" });
const run = (sheet, extra = {}) => runFronts(frontInput(sheet, { days: 0, ...extra }));
const liveAt = (record, side) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).map((troop) => {
    const [lng, lat] = place.toLngLat(troop.x, troop.y);
    return { lng, lat };
  });
};
const capture = (regionId, to, day = 1) => ({ day, type: "control", regionId, to, capture: true, ref: "e1" });

test("a region asks one taker for every so many km², at least one, at most a few, and a third of that to be taken", () => {
  assert.deepEqual(takersFor(1500), { least: 1, most: 1 });
  assert.deepEqual(takersFor(20000), { least: 2, most: 5 });
  assert.deepEqual(takersFor(150000), { least: 3, most: STORY_TAKERS_MOST });
  assert.deepEqual(takersFor(0), { least: 1, most: 1 });
  assert.deepEqual(takersFor(STORY_TAKER_KM2 * 2), { least: 1, most: 2 });
});

test("a small region on the line the story gives a side is stood in by that side's nearest, no more than its size asks", () => {
  const [record] = run(small()).battlefields;
  const aland = record.sides.findIndex((members) => members.includes("Aland"));
  const borduria = 1 - aland;
  // Column 4, row 2: Borduria's first column, where its line stands.
  const onLine = ({ lng, lat }) => lng >= 24 && lng < 25 && lat <= 52 && lat > 51.5;
  assert.ok(liveAt(record, borduria).filter(onLine).length > 0, "Borduria stands in it before");
  const result = run(small(), { battlefields: [record], days: 1, moments: [capture("r4-2", "Aland")] });
  const after = result.battlefields[0];
  assert.equal(result.notes.filter((note) => note.kind === "capture-failed").length, 0);
  const standing = liveAt(after, aland).filter(onLine).length;
  assert.ok(standing >= 1 && standing <= 3, `${standing} of Aland's troops in it (a region this size asks one)`);
  assert.equal(liveAt(after, aland).length, liveAt(record, aland).length, "they moved there; nobody was raised or lost");
  assert.equal(liveAt(after, borduria).filter(onLine).length, 0, "Borduria's fell back out of it");
  assert.equal(liveAt(after, borduria).length, liveAt(record, borduria).length, "and lost nobody for it");
  assert.ok(after.log.some((entry) => entry.k === "whole" && entry.s === aland && /region/.test(entry.at)));
});

test("a region too far from the taker's troops is not taken: nothing moves, and the turn is told why", () => {
  const [record] = run(small()).battlefields;
  const aland = record.sides.findIndex((members) => members.includes("Aland"));
  const borduria = 1 - aland;
  // Column 7, row 2: three columns behind Borduria's line, some 200 km from any of Aland's troops.
  const far = ({ lng, lat }) => lng >= 27 && lng < 28 && lat <= 52 && lat > 51.5;
  const result = run(small(), { battlefields: [record], days: 1, moments: [capture("r7-2", "Aland")] });
  const after = result.battlefields[0];
  assert.deepEqual(result.notes.filter((note) => note.kind === "capture-failed").map((note) => [note.taker, note.regionId, note.ref]), [["Aland", "r7-2", "e1"]]);
  assert.equal(result.flips.some((flip) => flip.regionId === "r7-2" && flip.to === "Aland"), false, "the region was not handed over");
  assert.equal(liveAt(after, aland).filter(far).length, 0, "nobody of Aland's went there");
  assert.equal(liveAt(after, borduria).length, liveAt(record, borduria).length, "Borduria lost nobody");
  // A region handed over by other means than an army (a treaty) goes over whoever stands near.
  const ceded = run(small(), { battlefields: [record], days: 1, moments: [{ day: 1, type: "control", regionId: "r7-2", to: "Aland", ref: "e1" }] });
  assert.equal(ceded.notes.filter((note) => note.kind === "capture-failed").length, 0);
});

test("a larger region takes more of the taker's troops", () => {
  const [record] = run(large()).battlefields;
  const aland = record.sides.findIndex((members) => members.includes("Aland"));
  // Column 4, row 2 of the larger sheet: Borduria's first column, about 135 by 110 km.
  const onLine = ({ lng, lat }) => lng >= 28 && lng < 30 && lat <= 54 && lat > 53;
  const result = run(large(), { battlefields: [record], days: 1, moments: [capture("r4-2", "Aland")] });
  assert.equal(result.notes.filter((note) => note.kind === "capture-failed").length, 0);
  const standing = liveAt(result.battlefields[0], aland).filter(onLine).length;
  assert.ok(standing >= 2, `${standing} of Aland's troops in a region that asks four`);
});

test("a region given to a country on neither side moves nobody", () => {
  const [record] = run(small()).battlefields;
  const result = run(small(), { battlefields: [record], days: 1, moments: [capture("r6-2", "Neutralia")] });
  const after = result.battlefields[0];
  for (const side of [0, 1]) assert.equal(liveAt(after, side).length, liveAt(record, side).length);
});

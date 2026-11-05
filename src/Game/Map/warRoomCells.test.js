/*! Open Historia — the war room's shading of a battlefield's ground: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/warRoomCells.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { runFronts } from "../../runtime/fronts/engine.js";
import { decodeMask, encodeMask } from "../../runtime/fronts/codec.js";
import { frontInput, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { cellRuns, rehearsalShading, supplyShading } from "./warRoomCells.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "war-room-cells" });
const recordOf = (extra = {}) => runFronts(frontInput(sheet(), { arenas: new Map(), troops: 1, days: 4, strengthOf: () => 3, mechanics: { supply: true }, ...extra })).battlefields[0];

test("a run of cells along a row is one rectangle, on the frame's own places", () => {
  const frame = { lng0: 10, lat0: 0, cell: 1, cols: 4, rows: 2, flat: true, scale: 1 };
  const kinds = ["a", "a", "", "b", "", "a", "a", "a"];
  const features = cellRuns(frame, (cell) => kinds[cell]);
  assert.deepEqual(features.map((feature) => feature.properties.kind), ["a", "b", "a"]);
  for (const feature of features) assert.equal(feature.geometry.coordinates[0].length, 5);
});

test("the supply map shades the player's own ground that is stretched or cut off, and the other side's cut off", () => {
  const record = recordOf();
  assert.equal(typeof record.brief.supply, "string");
  const { data, areas } = supplyShading(record, 0);
  // Two countries side by side, each fed from home: nothing is cut off yet.
  assert.equal(areas.cut, 0);
  assert.equal(areas.theirsCut, 0);
  for (const feature of data.features) assert.ok(["stretched", "cut", "theirs-cut"].includes(feature.properties.kind));
  // No record, no side, or no supply kept: nothing.
  assert.equal(supplyShading(null, 0).data.features.length, 0);
  assert.equal(supplyShading(record, -1).data.features.length, 0);
  assert.equal(supplyShading({ ...record, brief: {} }, 0).areas, null);
});

test("a rehearsal shades what the player would gain and lose, and nothing where nothing changes hands", () => {
  const record = recordOf();
  const same = rehearsalShading(record, record, 0);
  assert.equal(same.data.features.length, 0);
  assert.deepEqual([same.gainedKm2, same.lostKm2], [0, 0]);
  // Afterwards side 0 holds three cells of side 1's, and side 1 one of side 0's.
  const { cols, rows } = record.frame;
  const holders = decodeMask(record.field.mask, cols * rows);
  const theirs = [...holders.keys()].filter((cell) => holders[cell] === 1).slice(0, 3);
  const ours = [...holders.keys()].filter((cell) => holders[cell] === 0).slice(0, 1);
  const after = Uint8Array.from(holders);
  for (const cell of theirs) after[cell] = 0;
  for (const cell of ours) after[cell] = 1;
  const shaded = rehearsalShading(record, { ...record, field: { ...record.field, mask: encodeMask(after) } }, 0);
  const cellsOf = (kind) => shaded.data.features.filter((feature) => feature.properties.kind === kind).reduce((sum, feature) => {
    const ring = feature.geometry.coordinates[0];
    return sum + Math.round((ring[1][0] - ring[0][0]) / (ring[1][0] - ring[0][0] || 1));
  }, 0);
  assert.ok(cellsOf("gained") >= 1 && cellsOf("lost") >= 1);
  assert.ok(shaded.gainedKm2 > shaded.lostKm2 && shaded.lostKm2 > 0);
  // From the other side's chair, the same change the other way round.
  const turned = rehearsalShading(record, { ...record, field: { ...record.field, mask: encodeMask(after) } }, 1);
  assert.deepEqual([turned.gainedKm2, turned.lostKm2], [shaded.lostKm2, shaded.gainedKm2]);
});

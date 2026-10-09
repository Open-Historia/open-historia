/*! Open Historia — Political Cartography Pipeline v2 boundary regression tests © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  affectedOwnersForRegionChanges,
  buildPoliticalBoundaryTopology,
  createPoliticalBoundaryState,
  politicalBoundaryStateCollection,
  updatePoliticalBoundaryState,
} from "./politicalBoundaryTopology.js";

const square = (id, owner, x0, x1) => ({
  type: "Feature",
  properties: { id, owner },
  geometry: {
    type: "Polygon",
    coordinates: [[[x0, 0], [x1, 0], [x1, 1], [x0, 1], [x0, 0]]],
  },
});

const lineOwners = (feature) => String(feature?.properties?.owners ?? "");

test("political boundary topology is ownership-independent and incrementally reclassifies changed region edges", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      square("a", "A", 0, 1),
      square("b", "B", 1, 2),
      square("c", "C", 2, 3),
    ],
  };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const state = createPoliticalBoundaryState(topology, {});
  const before = politicalBoundaryStateCollection(state);
  assert.equal(before.features.length, 2);
  assert.deepEqual(new Set(before.features.map(lineOwners)), new Set(["A | B", "B | C"]));
  assert.deepEqual(
    before.features.find((feature) => lineOwners(feature) === "A | B")?.properties?.ownerList,
    ["A", "B"],
    "renderer filters must receive the complete owner list for a frontier group",
  );

  const patch = updatePoliticalBoundaryState(state, { b: "A" }, ["b"]);
  assert.ok(patch.stats.changedSegmentCount > 0);
  assert.ok(patch.stats.changedGroupCount > 0);
  const after = politicalBoundaryStateCollection(state);
  assert.equal(after.features.length, 1);
  assert.deepEqual(after.features.map(lineOwners), ["A | C"]);
  assert.ok(patch.patch.removeIds.length >= 1, "obsolete A|B and B|C group ids must be removed/updated");
});

test("ownership update touches only segments incident to changed regions", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      square("a", "A", 0, 1),
      square("b", "B", 1, 2),
      square("c", "C", 2, 3),
      square("d", "D", 3, 4),
    ],
  };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const state = createPoliticalBoundaryState(topology, {});
  const beforeCD = politicalBoundaryStateCollection(state).features.find((feature) => lineOwners(feature) === "C | D");
  assert.ok(beforeCD);

  const result = updatePoliticalBoundaryState(state, { a: "B" }, ["a"]);
  const afterCD = politicalBoundaryStateCollection(state).features.find((feature) => lineOwners(feature) === "C | D");
  assert.deepEqual(afterCD, beforeCD, "unrelated C|D boundary must remain byte-for-byte untouched");
  assert.ok(result.stats.changedSegmentCount <= 1, "only the edge incident to region a should be reclassified");
});

test("affected owners are derived from canonical base ownership when an override disappears", () => {
  const regions = { type: "FeatureCollection", features: [square("a", "A", 0, 1)] };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  assert.deepEqual(
    new Set(affectedOwnersForRegionChanges(topology, { a: "B" }, {}, ["a"])),
    new Set(["A", "B"]),
  );
});

test("boundary feature ids cannot collide for distinct owner groups", () => {
  // These two owner-group strings collide under the old 32-bit FNV-1a ID.
  // MapLibre updateData requires unique feature IDs, so the political boundary
  // protocol must preserve exact owner-group identity instead of hash identity.
  const regions = {
    type: "FeatureCollection",
    features: [
      square("x1", "A53866", 0, 1),
      square("x2", "B866", 1, 2),
      square("y1", "A73047", 10, 11),
      square("y2", "B47", 11, 12),
    ],
  };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const state = createPoliticalBoundaryState(topology, {});
  const features = politicalBoundaryStateCollection(state).features;
  assert.equal(features.length, 2);
  assert.equal(new Set(features.map((feature) => String(feature.id))).size, 2);
});

// Seam recovery and robustness, through the path the boundary worker runs
// (polityBoundariesWorker.js): buildPoliticalBoundaryTopology with its default
// precision and match tolerance, then createPoliticalBoundaryState.
const liveBoundaries = (features, ownershipOverrides = {}) => {
  const topology = buildPoliticalBoundaryTopology({ type: "FeatureCollection", features });
  const state = createPoliticalBoundaryState(topology, ownershipOverrides);
  return { topology, state, features: politicalBoundaryStateCollection(state).features };
};
const linesOf = (features) => features.map((feature) => [lineOwners(feature), feature.geometry.coordinates]);

test("a shared administrative edge inside one polity draws no border", () => {
  const { features } = liveBoundaries([square("west", "Union", 0, 1), square("east", "Union", 1, 2)]);
  assert.deepEqual(features, []);
});

test("a shared edge between different polities is kept and stitched into one line", () => {
  const { features } = liveBoundaries([square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)]);
  assert.deepEqual(linesOf(features), [["Eastland | Westland", [[[1, 0], [1, 1]]]]]);
});

test("one long frontier edge is reconciled with several shorter neighbours", () => {
  // The two sides were simplified independently: no vertex of the long west
  // edge matches the east side's, so only seam recovery can find the border.
  const west = square("west", "Westland", 0, 1);
  const east = square("east", "Eastland", 1, 2);
  east.geometry.coordinates[0] = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.6], [1, 0.25], [1, 0]];
  const { topology, features } = liveBoundaries([west, east]);
  assert.ok(topology.stats.recoveredTopologySegmentCount >= 3);
  assert.deepEqual(linesOf(features), [["Eastland | Westland", [[[1, 0], [1, 0.25], [1, 0.6], [1, 1]]]]]);
});

test("the tiny source drift between neighbouring frontiers is reconciled", () => {
  const { topology, features } = liveBoundaries([
    square("west", "Westland", 0, 1),
    square("east", "Eastland", 1.0015, 2),
  ]);
  assert.ok(topology.stats.recoveredTopologySegmentCount >= 1);
  assert.deepEqual(linesOf(features), [["Eastland | Westland", [[[1, 0], [1, 1]]]]]);
});

test("a recovered seam is reclassified by an ownership change like any other edge", () => {
  const { state } = liveBoundaries([square("west", "Westland", 0, 1), square("east", "Eastland", 1.0015, 2)]);
  const patch = updatePoliticalBoundaryState(state, { east: "Westland" }, ["east"]);
  assert.equal(politicalBoundaryStateCollection(state).features.length, 0);
  assert.equal(patch.patch.removeIds.length, 1);

  updatePoliticalBoundaryState(state, {}, ["east"]);
  assert.deepEqual(linesOf(politicalBoundaryStateCollection(state).features), [["Eastland | Westland", [[[1, 0], [1, 1]]]]]);
});

test("an ownership override reclassifies a border from the start", () => {
  const { features } = liveBoundaries(
    [square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)],
    { east: "Westland" },
  );
  assert.deepEqual(features, []);
});

test("legacy owner codes are canonicalised before ownership is compared", () => {
  const { features } = liveBoundaries(
    [square("west", "Spain", 0, 1), square("east", "France", 1, 2)],
    { east: "ESP" },
  );
  assert.deepEqual(features, []);
});

test("malformed features are skipped without losing valid borders", () => {
  const { topology, features } = liveBoundaries([
    { type: "Feature", properties: { id: "bad" }, geometry: null },
    square("west", "Westland", 0, 1),
    square("east", "Eastland", 1, 2),
  ]);
  assert.equal(topology.stats.skippedFeatureCount, 1);
  assert.deepEqual(linesOf(features), [["Eastland | Westland", [[[1, 0], [1, 1]]]]]);
});


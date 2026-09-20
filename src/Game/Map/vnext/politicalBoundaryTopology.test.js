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

// The puppet overlay traces a Puppet's whole territory. The frontier groups
// above only hold edges between TWO owners, so an island Puppet (Australia)
// had no line at all and a continental one lost its coast.
test("an owner outline goes all the way round, coast included, and not between its own regions", async () => {
  const { deriveOwnerOutlines } = await import("./politicalBoundaryTopology.js");
  const regions = {
    type: "FeatureCollection",
    features: [
      square("a", "A", 0, 1),
      square("b", "B", 1, 2),
      square("c", "B", 2, 3),
      // An island: shares no edge with anyone.
      { ...square("i", "I", 10, 11) },
    ],
  };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const { data } = deriveOwnerOutlines(topology, {}, ["B", "I"]);
  const byOwner = new Map(data.features.map((feature) => [feature.properties.owner, feature]));
  assert.deepEqual([...byOwner.keys()].sort(), ["B", "I"], "only the owners asked for");

  const length = (feature) => feature.geometry.coordinates
    .flatMap((line) => line.slice(1).map((point, index) => Math.hypot(point[0] - line[index][0], point[1] - line[index][1])))
    .reduce((sum, value) => sum + value, 0);
  // B is two unit squares side by side: a 2x1 rectangle, perimeter 6. The edge
  // it shares with A counts; the edge between its own two regions does not.
  assert.ok(Math.abs(length(byOwner.get("B")) - 6) < 1e-6, `B's outline is its perimeter, got ${length(byOwner.get("B"))}`);
  assert.ok(Math.abs(length(byOwner.get("I")) - 4) < 1e-6, "the island is outlined all round");

  // Ownership overrides are honoured: hand c to A and B shrinks to one square.
  const moved = deriveOwnerOutlines(topology, { c: "A" }, ["B"]).data.features[0];
  assert.ok(Math.abs(length(moved) - 4) < 1e-6);
  assert.deepEqual(deriveOwnerOutlines(topology, {}, []).data.features, []);
});

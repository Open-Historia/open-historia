/*! Open Historia — political boundary owner metadata regression test © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPoliticalBoundaryTopology,
  createPoliticalBoundaryState,
  politicalBoundaryStateCollection,
} from "./politicalBoundaryTopology.js";

const square = (id, owner, x0, x1) => ({
  type: "Feature",
  properties: { id, owner },
  geometry: {
    type: "Polygon",
    coordinates: [[[x0, 0], [x1, 0], [x1, 1], [x0, 1], [x0, 0]]],
  },
});

test("derived political boundaries carry structured ownerList metadata", () => {
  const regions = { type: "FeatureCollection", features: [
    square("A.1", "Alpha", 0, 1),
    square("B.1", "Beta", 1, 2),
  ] };
  const topology = buildPoliticalBoundaryTopology(regions);
  const data = politicalBoundaryStateCollection(createPoliticalBoundaryState(topology, {}));
  const shared = data.features.find((feature) => feature.properties?.ownerList?.includes("Alpha")
    && feature.properties?.ownerList?.includes("Beta"));
  assert.ok(shared, "expected the Alpha/Beta frontier");
  assert.deepEqual(shared.properties.ownerList, ["Alpha", "Beta"]);
});

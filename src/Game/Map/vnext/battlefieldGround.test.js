/*! Open Historia — a battlefield's ground: its regions, their mesh, and the borders its picture draws © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { GROUND_MESH_LONGEST, groundMesh, mercatorX, mercatorY, regionBox, regionsInAreas } from "./battlefieldGround.js";
import {
  battlefieldSegmentIds,
  buildPoliticalBoundaryTopology,
  createPoliticalBoundaryState,
  politicalBoundaryStateCollection,
  setExcludedBoundarySegments,
  updatePoliticalBoundaryState,
} from "./politicalBoundaryTopology.js";

const square = (id, owner, x0, x1, y0 = 0, y1 = 1) => ({
  type: "Feature",
  id,
  properties: { id, owner },
  geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
});
const owners = (state) => new Set(politicalBoundaryStateCollection(state).features.map((feature) => String(feature.properties.owners)));

test("a battlefield draws its sides' regions that reach into its frame, each once", () => {
  const regions = [square("a", "Alpha", 0, 1), square("b", "Beta", 1, 2), square("c", "Gamma", 2, 3), square("d", "Alpha", 10, 11)];
  const owner = { a: "Alpha", b: "Beta", c: "Gamma", d: "Alpha" };
  const result = regionsInAreas({
    regions,
    ownerOf: (id) => owner[id],
    areas: [
      { key: "one", bounds: [0.5, 0, 2.5, 1], members: ["alpha", "Beta"] },
      { key: "two", bounds: [0, 0, 11, 1], members: ["Alpha"] },
    ],
  });
  assert.deepEqual(result, [
    { key: "one", regionIds: ["a", "b"] },
    { key: "two", regionIds: ["d"] },
  ]);
  assert.deepEqual(regionBox(regions[0].geometry), [0, 0, 1, 1]);
  // A frame given past the date line still finds its regions.
  assert.deepEqual(regionsInAreas({ regions, ownerOf: (id) => owner[id], areas: [{ key: "x", bounds: [360.2, 0, 361, 1], members: ["Alpha"] }] })[0].regionIds, ["a"]);
});

test("the ground mesh covers each region with triangles marked by region", () => {
  const holed = {
    id: "h",
    geometry: {
      type: "Polygon",
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    },
  };
  const mesh = groundMesh({ regions: [square("a", "Alpha", -6, -5), holed], regionIds: ["a", "h"], anchorLng: 0 });
  assert.equal(mesh.positions.length % 6, 0, "whole triangles");
  assert.equal(mesh.regionOf.length, mesh.positions.length / 2);
  assert.deepEqual([...new Set(mesh.regionOf)], [0, 1]);
  // The holed square's triangles add up to its area less the hole's (in the flat sheet).
  let area = 0;
  for (let i = 0; i < mesh.positions.length; i += 6) {
    if (mesh.regionOf[i / 2] !== 1) continue;
    const [ax, ay, bx, by, cx, cy] = mesh.positions.slice(i, i + 6);
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  const outer = (mercatorX(4) - mercatorX(0)) * (mercatorY(0) - mercatorY(4));
  const hole = (mercatorX(3) - mercatorX(1)) * (mercatorY(1) - mercatorY(3));
  assert.ok(Math.abs(area - (outer - hole)) < 1e-6, `area ${area} vs ${outer - hole}`);
  // No triangle left long enough to sink under a globe's curve.
  for (let i = 0; i < mesh.positions.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = mesh.positions.slice(i, i + 6);
    const longest = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - bx, cy - by), Math.hypot(ax - cx, ay - cy));
    assert.ok(longest <= GROUND_MESH_LONGEST + 1e-6, `a side ${longest} long`);
  }
});

test("a region across the date line is one piece near the battlefield", () => {
  const across = { id: "x", geometry: { type: "Polygon", coordinates: [[[179, 0], [181, 0], [181, 1], [179, 1], [179, 0]]] } };
  const west = { id: "y", geometry: { type: "Polygon", coordinates: [[[-179, 0], [-178, 0], [-178, 1], [-179, 1], [-179, 0]]] } };
  const mesh = groundMesh({ regions: [across, west], regionIds: ["x", "y"], anchorLng: 180 });
  const xs = [...mesh.positions].filter((_, index) => index % 2 === 0);
  assert.ok(Math.min(...xs) >= mercatorX(179) - 1e-9 && Math.max(...xs) <= mercatorX(182) + 1e-9, "the west region is moved a turn east, beside the battlefield");
});

test("the borders a battlefield's picture draws are left out of the map's, and come back with it", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("a", "Alpha", 0, 1), square("b", "Beta", 1, 2), square("c", "Gamma", 2, 3), square("d", "Beta", 1, 2, 1, 2)],
  };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const state = createPoliticalBoundaryState(topology, {});
  assert.deepEqual(owners(state), new Set(["Alpha | Beta", "Beta | Gamma"]));

  // Alpha against Beta, framed round a and b: the border between them is the picture's.
  const ids = battlefieldSegmentIds(state, [{ regionIds: ["a", "b"], bounds: [-0.5, -0.5, 2.5, 1.5] }]);
  assert.ok(ids.size >= 1);
  const result = setExcludedBoundarySegments(state, ids, {});
  assert.ok(result.patch.removeIds.length + result.patch.upsert.length > 0);
  assert.deepEqual(owners(state), new Set(["Beta | Gamma"]), "the Alpha-Beta border is drawn by the battlefield");

  // An ownership change keeps it left out.
  updatePoliticalBoundaryState(state, { c: "Alpha" }, ["c"]);
  assert.deepEqual(owners(state), new Set(["Alpha | Beta"]), "b against c is outside the battlefield's regions and stays the map's");

  // A frame that ends halfway along a border leaves that border the map's.
  const cut = battlefieldSegmentIds(state, [{ regionIds: ["a", "b"], bounds: [-0.5, -0.5, 2.5, 0.5] }]);
  assert.equal(cut.size, 0);

  // The battlefield gone, the border is back.
  setExcludedBoundarySegments(state, [], { c: "Alpha" });
  assert.equal(politicalBoundaryStateCollection(state).features.length, 1);
  assert.ok(politicalBoundaryStateCollection(state).features[0].properties.ownerList.includes("Alpha"));
});

test("a forced exclusion sends every group it touches whole, even one it empties", () => {
  const regions = { type: "FeatureCollection", features: [square("a", "Alpha", 0, 1), square("b", "Beta", 1, 2)] };
  const topology = buildPoliticalBoundaryTopology(regions, { precision: 1000, matchTolerance: 1 });
  const ids = battlefieldSegmentIds(createPoliticalBoundaryState(topology, {}), [{ regionIds: ["a", "b"], bounds: [-1, -1, 3, 2] }]);
  // Made with the battlefield already left out, as the worker remakes its state.
  const state = createPoliticalBoundaryState(topology, {}, { excluded: ids });
  assert.equal(politicalBoundaryStateCollection(state).features.length, 0);
  const again = setExcludedBoundarySegments(state, ids, {}, { force: true });
  assert.equal(again.patch.removeIds.length, 1, "the emptied group is removed by its id even though the worker never drew it");
  assert.equal(again.changedSegmentCount, 0);
});

/*! Open Historia — group areas on the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/vnext/groupAreas.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildPoliticalBoundaryTopology } from "./politicalBoundaryTopology.js";
import { buildGroupAreaIndex, deriveGroupAreas, EMPTY_GROUP_AREA_DATA } from "./groupAreas.js";

const box = (id, owner, x0, x1, y0 = 0, y1 = 1) => ({
  type: "Feature",
  id,
  properties: { id, owner, name: id },
  geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
});
const collection = (...features) => ({ type: "FeatureCollection", features });

const derive = (regions, groupAreas, groups = { Cartel: { color: "#e11d48" } }, extra = {}) => {
  const topology = buildPoliticalBoundaryTopology(regions);
  return deriveGroupAreas({ topology, index: buildGroupAreaIndex(topology), regions, groupAreas, groups, ...extra });
};
const lines = (result) => result.outlines.features.flatMap((feature) => feature.geometry.coordinates);
const onVertical = (line, x) => line.some((point, index) => index > 0
  && Math.abs(point[0] - x) < 1e-9 && Math.abs(line[index - 1][0] - x) < 1e-9);

test("a group's outline runs round its whole area: frontier and coast, never the seams inside it", () => {
  const regions = collection(box("a1", "A", 0, 1), box("a2", "A", 1, 2), box("b1", "B", 2, 3), box("c1", "C", 3, 4));
  const result = derive(regions, { a2: "Cartel", b1: "Cartel" });
  const chains = lines(result);
  assert.equal(chains.length, 1, "one ring");
  const ring = chains[0];
  assert.deepEqual(ring[0], ring.at(-1), "closed");
  assert.ok(onVertical(ring, 1) && onVertical(ring, 3), "the frontier with a1 and with c1");
  assert.equal(onVertical(ring, 2), false, "the border between a2 and b1 is inside the area, whoever owns each");
  const xs = ring.map((point) => point[0]);
  assert.equal(Math.min(...xs), 1);
  assert.equal(Math.max(...xs), 3);
});

test("the tint is every member region's shape, one surface per group, in the group's colour", () => {
  const regions = collection(box("a1", "A", 0, 1), box("a2", "A", 1, 2), box("b1", "B", 2, 3));
  const result = derive(regions, { a1: "Cartel", b1: "Cartel", a2: "Militia" }, {
    Cartel: { color: "#e11d48" },
    Militia: { color: "#3b82f6" },
  });
  assert.equal(result.fills.features.length, 2);
  const cartel = result.fills.features.find((feature) => feature.properties.group === "Cartel");
  assert.equal(cartel.properties.color, "#e11d48");
  assert.equal(cartel.geometry.type, "MultiPolygon");
  assert.equal(cartel.geometry.coordinates.length, 2, "a1 and b1, not unioned");
  // Two groups side by side: each outline runs along the border they share.
  for (const name of ["Cartel", "Militia"]) {
    const outline = result.outlines.features.find((feature) => feature.properties.group === name);
    assert.ok(outline.geometry.coordinates.some((line) => onVertical(line, 1)), `${name} is outlined along x=1`);
  }
});

test("a seam whose two sides were simplified apart is not drawn inside the area", () => {
  // p's right side and q's left side miss each other by 0.001° — inside the
  // topology's recovery tolerance — so they are one seam, not two coasts.
  const p = box("p", "A", 0, 1);
  const q = {
    ...box("q", "B", 1.001, 2),
    geometry: { type: "Polygon", coordinates: [[[1.001, 0], [2, 0], [2, 1], [1.001, 1], [1.001, 0.5], [1.001, 0]]] },
  };
  const result = derive(collection(p, q, box("r", "C", 2, 3)), { p: "Cartel", q: "Cartel" });
  for (const line of lines(result)) {
    assert.equal(onVertical(line, 1), false, "p's side of the seam");
    assert.equal(onVertical(line, 1.001), false, "q's side of the seam");
  }
  assert.ok(lines(result).some((line) => onVertical(line, 2)), "the frontier with r is drawn");
});

test("an area with an unknown group, an unknown region, or nothing at all draws nothing", () => {
  const regions = collection(box("a1", "A", 0, 1));
  assert.equal(derive(regions, { a1: "Nobody" }).fills.features.length, 0);
  assert.equal(derive(regions, { zz: "Cartel" }).fills.features.length, 0);
  assert.equal(derive(regions, {}).outlines.features.length, 0);
  assert.equal(deriveGroupAreas({}), EMPTY_GROUP_AREA_DATA);
});

test("the name sits on the member nearest the area's middle", () => {
  const regions = collection(box("w", "A", 0, 1), box("m", "A", 1, 2), box("e", "A", 2, 3));
  const points = [{ lng: 0.5, lat: 0.5, weight: 1 }, { lng: 1.5, lat: 0.5, weight: 1 }, { lng: 2.5, lat: 0.5, weight: 1 }];
  const result = derive(regions, { w: "Cartel", m: "Cartel", e: "Cartel" }, undefined, { pointFor: (index) => points[index] });
  assert.equal(result.labels.features.length, 1);
  assert.deepEqual(result.labels.features[0].geometry.coordinates, [1.5, 0.5]);
  assert.equal(result.labels.features[0].properties.regions, 3);
});

test("the regions worker answers a group-areas request from its caches, outside the political pipeline", async () => {
  const messages = [];
  globalThis.self = { postMessage: (message) => messages.push(message) };
  await import(`./polityBoundariesWorker.js?group-areas-test=${Date.now()}`);
  const send = async (data) => {
    const start = messages.length;
    await globalThis.self.onmessage({ data });
    return messages.slice(start);
  };
  const regions = collection(box("a1", "A", 0, 1), box("a2", "A", 1, 2), box("b1", "B", 2, 3));
  await send({ requestId: 1, type: "initialize", geometryEpoch: "e1", regions, ownershipOverrides: {}, regionClaimants: {} });
  const out = await send({
    requestId: "group-areas-1",
    type: "group-areas",
    geometryEpoch: "e1",
    groupAreas: { a2: "Cartel", b1: "Cartel" },
    groups: { Cartel: { color: "#10b981" } },
  });
  assert.equal(out.length, 1, "one answer, and no cartography revision");
  assert.equal(out[0].messageType, "group-areas-result");
  assert.equal(out[0].requestId, "group-areas-1");
  assert.equal(out[0].geometryEpoch, "e1");
  assert.equal(out[0].fills.features[0].properties.color, "#10b981");
  assert.equal(out[0].outlines.features.length, 1);
  assert.equal(out[0].labels.features.length, 1);
});

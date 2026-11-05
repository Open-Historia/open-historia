import test from "node:test";
import assert from "node:assert/strict";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import Polygon from "ol/geom/Polygon.js";

import { MAX_DETAIL_METERS, MIN_DETAIL_METERS, detailToleranceMeters, mapDetailMeters, simplifyShared } from "./simplifyRegions.js";

const wiggle = (steps, amplitude) => Array.from({ length: steps + 1 }, (_, i) => [1000, (1000 * i) / steps + 0]).map(([x, y], i) => [x + (i % 2 ? amplitude : 0), y]).slice(1, -1);
const pair = (steps = 400, amplitude = 2) => {
  const border = wiggle(steps, amplitude);
  const west = new Polygon([[[0, 0], [1000, 0], ...border, [1000, 1000], [0, 1000], [0, 0]]]);
  const east = new Polygon([[[1000, 0], [2000, 0], [2000, 1000], [1000, 1000], ...border.slice().reverse(), [1000, 0]]]);
  return [west, east];
};
const edges = (geometry) => {
  const found = new Set();
  const polygons = geometry.getType() === "Polygon" ? [geometry.getCoordinates()] : geometry.getCoordinates();
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1].join(",");
      const b = ring[i].join(",");
      found.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  return found;
};
const vertices = (geometry) => geometry.getFlatCoordinates().length / 2;
const sharedBetween = (a, b) => [...edges(a)].filter((edge) => edges(b).has(edge));

test("a border two regions share is simplified once, the same on both sides", () => {
  const [west, east] = pair();
  const [simpleWest, simpleEast] = simplifyShared([west, east], { tolerance: 5 });
  assert.ok(vertices(simpleWest) < 10 && vertices(simpleEast) < 10, `${vertices(simpleWest)} / ${vertices(simpleEast)}`);
  assert.ok(sharedBetween(simpleWest, simpleEast).length >= 1, "they still meet");
  const onFrame = (edge) => {
    const [[x1, y1], [x2, y2]] = edge.split("|").map((point) => point.split(",").map(Number));
    return (x1 === 0 && x2 === 0) || (y1 === 0 && y2 === 0) || (y1 === 1000 && y2 === 1000);
  };
  const eastEdges = edges(simpleEast);
  assert.deepEqual([...edges(simpleWest)].filter((edge) => !onFrame(edge) && !eastEdges.has(edge)), [], "every inner edge of the west is an edge of the east");
  assert.deepEqual(simpleWest.getExtent(), [0, 0, 1000, 1000]);
});

test("an enclave and the hole it fills stay the same shape", () => {
  const ring = Array.from({ length: 200 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 200;
    const radius = 300 + (i % 2 ? 1 : 0);
    return [1000 + radius * Math.cos(angle), 1000 + radius * Math.sin(angle)];
  });
  const inner = new Polygon([[...ring, ring[0]]]);
  const outer = new Polygon([[[0, 0], [2000, 0], [2000, 2000], [0, 2000], [0, 0]], [...ring.slice().reverse(), ring[ring.length - 1]]]);
  const [simpleOuter, simpleInner] = simplifyShared([outer, inner], { tolerance: 5 });
  const hole = edges(new Polygon([simpleOuter.getCoordinates()[1]]));
  assert.deepEqual([...edges(simpleInner)].sort(), [...hole].sort());
  assert.ok(vertices(simpleInner) < 200);
});

test("only the regions that may move are simplified, but a border they share moves on both sides", () => {
  const [west, east] = pair();
  const lonely = new Polygon([[[5000, 0], ...wiggle(400, 2).map(([x, y]) => [x + 4000, y]), [5000, 1000], [5000, 0]]]);
  const [simpleWest, simpleEast, untouched] = simplifyShared([west, east, lonely], { tolerance: 5, movable: [true, false, false] });
  assert.ok(sharedBetween(simpleWest, simpleEast).length >= 1);
  assert.ok(vertices(simpleEast) < 10, "the fixed neighbour takes the shared border as it now runs");
  assert.equal(vertices(untouched), vertices(lonely), "a region apart from those moving is left as it was");
});

test("islets too small to keep are dropped, and a region is never lost", () => {
  const islands = new MultiPolygon([[[[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]], [[[5000, 5000], [5001, 5000], [5001, 5001], [5000, 5001], [5000, 5000]]]]);
  const [kept] = simplifyShared([islands], { tolerance: 5 });
  assert.equal(kept.getCoordinates().length, 1);
  const speck = new Polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
  assert.equal(simplifyShared([speck], { tolerance: 5 })[0], speck);
});

test("a map's detail is the length of its typical border segment, and the tolerance is half of it within bounds", () => {
  const [west, east] = pair(100, 0);
  assert.ok(mapDetailMeters([west, east]) > 0);
  assert.equal(detailToleranceMeters([new Polygon([[[0, 0], [1, 0], [1, 1], [0, 0]]])]), MIN_DETAIL_METERS);
  assert.equal(detailToleranceMeters([new Polygon([[[0, 0], [1e7, 0], [1e7, 1e7], [0, 0]]])]), MAX_DETAIL_METERS);
  assert.equal(detailToleranceMeters([]), MIN_DETAIL_METERS);
});

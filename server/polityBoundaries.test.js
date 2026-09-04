import assert from "node:assert/strict";
import test from "node:test";

import { derivePolityBoundaries } from "../src/Game/Map/vnext/polityBoundaries.js";

const square = (id, owner, minX, maxX) => ({
  type: "Feature",
  properties: { id, owner },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [minX, 0],
      [maxX, 0],
      [maxX, 1],
      [minX, 1],
      [minX, 0],
    ]],
  },
});

const coordinatesOf = (data) => data.features.flatMap((feature) => feature.geometry.coordinates);

test("Map vNext omits a shared administrative edge inside one polity", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Union", 0, 1), square("east", "Union", 1, 2)],
  };

  const result = derivePolityBoundaries(regions);

  assert.equal(result.stats.boundarySegmentCount, 0);
  assert.deepEqual(result.data.features, []);
});

test("Map vNext retains and stitches a shared edge between different polities", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)],
  };

  const result = derivePolityBoundaries(regions);

  assert.equal(result.stats.boundarySegmentCount, 1);
  assert.equal(result.stats.boundaryChainCount, 1);
  assert.deepEqual(coordinatesOf(result.data), [[[1, 0], [1, 1]]]);
});

test("Map vNext reconciles one long frontier edge with several shorter neighbours", () => {
  const west = square("west", "Westland", 0, 1);
  const east = square("east", "Eastland", 1, 2);
  east.geometry.coordinates[0] = [
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 0.6],
    [1, 0.25],
    [1, 0],
  ];
  const regions = { type: "FeatureCollection", features: [west, east] };

  const result = derivePolityBoundaries(regions);

  assert.ok(result.stats.recoveredBoundarySegmentCount >= 3);
  assert.equal(result.stats.boundaryChainCount, 1);
  assert.deepEqual(coordinatesOf(result.data), [[[1, 0], [1, 0.25], [1, 0.6], [1, 1]]]);
});

test("Map vNext reconciles the tiny source drift between neighbouring frontiers", () => {
  const west = square("west", "Westland", 0, 1);
  const east = square("east", "Eastland", 1.0015, 2);

  const result = derivePolityBoundaries({ type: "FeatureCollection", features: [west, east] });

  assert.ok(result.stats.recoveredBoundarySegmentCount >= 1);
  assert.equal(result.stats.boundaryChainCount, 1);
  assert.deepEqual(coordinatesOf(result.data), [[[1, 0], [1, 1]]]);
});

test("Map vNext ownership overrides immediately reclassify a border", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)],
  };

  const result = derivePolityBoundaries(regions, { east: "Westland" });

  assert.equal(result.stats.boundarySegmentCount, 0);
});

test("Map vNext canonicalizes legacy owner codes before comparing ownership", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Spain", 0, 1), square("east", "France", 1, 2)],
  };

  const result = derivePolityBoundaries(regions, { east: "ESP" });

  assert.equal(result.stats.boundarySegmentCount, 0);
});

test("Map vNext skips malformed features without losing valid boundaries", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "bad" }, geometry: null },
      square("west", "Westland", 0, 1),
      square("east", "Eastland", 1, 2),
    ],
  };

  const result = derivePolityBoundaries(regions);

  assert.equal(result.stats.skippedFeatureCount, 1);
  assert.equal(result.stats.boundarySegmentCount, 1);
});

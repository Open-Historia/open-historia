import assert from "node:assert/strict";
import test from "node:test";

import { derivePolitySurfaces } from "../src/Game/Map/vnext/politySurfaces.js";

const square = (id, owner, minX, maxX, gid0 = "") => ({
  type: "Feature",
  properties: { id, owner, gid0 },
  geometry: {
    type: "Polygon",
    coordinates: [[[minX, 0], [maxX, 0], [maxX, 1], [minX, 1], [minX, 0]]],
  },
});

test("Map vNext dissolves adjacent regions into one live polity surface", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Union", 0, 1), square("east", "Union", 1, 2)],
  };

  const result = derivePolitySurfaces(regions);

  assert.equal(result.data.features.length, 1);
  assert.equal(result.data.features[0].properties.owner, "Union");
  assert.equal(result.data.features[0].properties.regionCount, 2);
  assert.equal(result.data.features[0].geometry.coordinates.length, 1);
});

test("Map vNext ownership overrides rebuild the dissolved polity shape", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)],
  };

  const result = derivePolitySurfaces(regions, { east: "Westland" });

  assert.equal(result.data.features.length, 1);
  assert.equal(result.data.features[0].properties.owner, "Westland");
  assert.equal(result.data.features[0].properties.regionCount, 2);
});

test("Map vNext preserves separate polities as separate render surfaces", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("west", "Westland", 0, 1), square("east", "Eastland", 1, 2)],
  };

  const result = derivePolitySurfaces(regions);

  assert.equal(result.data.features.length, 2);
  assert.deepEqual(
    result.data.features.map((feature) => feature.properties.owner).sort(),
    ["Eastland", "Westland"],
  );
});

test("Map vNext surfaces retain their underlying geographic identities", () => {
  const regions = {
    type: "FeatureCollection",
    features: [square("a", "Union", 0, 1, "DEU"), square("b", "Union", 1, 2, "POL")],
  };
  const result = derivePolitySurfaces(regions);
  assert.deepEqual(result.data.features[0].properties.gadm0, ["DEU", "POL"]);
});

test("Map vNext removes only microscopic dissolve holes from the display surface", () => {
  const region = square("holed", "Union", 0, 2);
  region.geometry.coordinates.push([
    [0.5, 0.5], [0.5001, 0.5], [0.5001, 0.5001], [0.5, 0.5001], [0.5, 0.5],
  ]);
  region.geometry.coordinates.push([
    [1, 0.2], [1.2, 0.2], [1.2, 0.4], [1, 0.4], [1, 0.2],
  ]);

  const result = derivePolitySurfaces({ type: "FeatureCollection", features: [region] });
  const polygon = result.data.features[0].geometry.coordinates[0];

  assert.equal(polygon.length, 2, "the real hole remains and the pinhole is removed");
});

// A collinear ring has no area, so polygon-clipping's union of two of them is
// empty without throwing - the total-failure case that unionBatch's bisection,
// which only rescues a partial one, does not cover.
const degenerate = (id, owner) => ({
  type: "Feature",
  properties: { id, owner, gid0: "" },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] },
});

test("Map vNext keeps a polity whose union collapses to nothing", () => {
  const regions = {
    type: "FeatureCollection",
    features: [degenerate("a", "Russia"), degenerate("b", "Russia")],
  };

  const result = derivePolitySurfaces(regions);

  assert.equal(result.data.features.length, 1, "the polity still has a surface");
  const [surface] = result.data.features;
  assert.equal(surface.properties.owner, "Russia");
  assert.equal(surface.properties.regionCount, 2);
  assert.equal(surface.properties.dissolveFallback, true, "and is marked as undissolved");
  assert.ok(surface.geometry.coordinates.length > 0, "carrying its raw pieces");
});

test("Map vNext reports the polities that could not be dissolved", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      degenerate("a", "Russia"),
      degenerate("b", "Russia"),
      square("west", "Union", 0, 1),
      square("east", "Union", 1, 2),
    ],
  };

  const result = derivePolitySurfaces(regions);

  assert.equal(result.stats.polityCount, 2);
  assert.equal(result.stats.dissolvedPolityCount, 1);
  assert.equal(result.stats.fallbackPolityCount, 1);
  assert.equal(result.stats.emptyUnionPolityCount, 1);
  assert.equal(result.stats.droppedPolityCount, 0);
});

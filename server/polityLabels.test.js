import assert from "node:assert/strict";
import test from "node:test";

import { buildPolityLabelCollections } from "../src/runtime/countryLabels.js";
import { derivePolitySurfaces } from "../src/Game/Map/vnext/politySurfaces.js";

const surface = (owner, coordinates) => ({
  type: "Feature",
  properties: { owner },
  geometry: { type: "MultiPolygon", coordinates },
});

test("Map vNext emits one live label for a polity with disconnected landmasses", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Union", [
      [[[0, 0], [12, 0], [12, 3], [0, 3], [0, 0]]],
      [[[30, 0], [31, 0], [31, 1], [30, 1], [30, 0]]],
    ])],
  });

  const labels = [...result.lineLabelData.features, ...result.pointLabelData.features];
  assert.equal(labels.length, 1);
  assert.equal(labels[0].properties.owner, "Union");
});

test("Map vNext polity labels use the scenario name and remain inside a concave shape", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Old Name", [[[
      [0, 0], [5, 0], [5, 1], [1, 1], [1, 5], [0, 5], [0, 0],
    ]]])],
  }, { nameResolver: () => "Live Federation" });

  const label = result.lineLabelData.features[0] ?? result.pointLabelData.features[0];
  assert.equal(result.lineLabelData.features.length + result.pointLabelData.features.length, 1);
  assert.equal(label.properties.name, "LIVE FEDERATION");
  const coordinates = label.geometry.type === "Point"
    ? [label.geometry.coordinates]
    : label.geometry.coordinates;
  assert.ok(coordinates.every(([lng, lat]) => (
    (lng <= 1.001 && lat <= 5.001) || (lng <= 5.001 && lat <= 1.001)
  )));
});

test("Map vNext emits one native whole-word label without detached glyphs", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Arc", [[[
      [-10, 0], [-5, -1], [0, 0], [5, 3], [8, 8], [9, 14],
      [7, 20], [4, 24], [2, 22], [4, 18], [5, 13], [4, 9],
      [2, 5], [-2, 2], [-6, 1], [-10, 2], [-10, 0],
    ]]])],
  }, { nameResolver: () => "Arc Republic" });

  assert.equal(result.lineLabelData.features.length, 0);
  assert.equal(result.pointLabelData.features.length, 1);
  assert.equal(result.pointLabelData.features[0].properties.name, "ARC REPUBLIC");
  assert.equal(result.pointLabelData.features[0].properties.hasCurvedLabel, false);
  assert.equal(result.curvedLabelData.features.length, 0);
  assert.equal(result.glyphLabelData.features.length, 0);
  assert.equal(result.pointLabelData.features[0].geometry.type, "Point");
  assert.equal(result.pointLabelData.features[0].properties.owner, "Arc");
  assert.ok(result.pointLabelData.features[0].properties.priorityScale > 0);
  assert.ok(result.pointLabelData.features[0].properties.pathLength > 0);
});

test("Map vNext keeps giant polity geometry stable when the viewport changes", () => {
  const surfaces = {
    type: "FeatureCollection",
    features: [surface("Continental Union", [[[
      [-20, 35], [160, 35], [160, 75], [-20, 75], [-20, 35],
    ]]])],
  };
  const left = buildPolityLabelCollections(surfaces, {
    viewportBounds: { west: 0, south: 40, east: 50, north: 70 },
  });
  const right = buildPolityLabelCollections(surfaces, {
    viewportBounds: { west: 80, south: 40, east: 130, north: 70 },
  });

  assert.deepEqual(left, right);
  const label = left.lineLabelData.features[0] ?? left.pointLabelData.features[0];
  assert.ok(label.properties.letterSpacing >= 0.08);
});

test("Map vNext emits one non-repeating whole-word feature for a continental polity", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [surface("Canada", [[[
      [-140, 45], [-52, 45], [-52, 70], [-140, 70], [-140, 45],
    ]]])],
  });

  assert.equal(result.lineLabelData.features.length, 0);
  assert.equal(result.pointLabelData.features.length, 1);
  assert.equal(result.pointLabelData.features[0].properties.name, "CANADA");
  assert.ok(result.pointLabelData.features[0].properties.pathLength > 0);
  assert.ok(result.pointLabelData.features[0].properties.pathWidth > 0);
});

test("compact and continental polities both stay one whole-word feature", () => {
  const result = buildPolityLabelCollections({
    type: "FeatureCollection",
    features: [
      surface("Compact", [[[[10, 45], [12, 45], [12, 47], [10, 47], [10, 45]]]]),
      surface("Continental", [[[[-125, 25], [-65, 25], [-65, 50], [-125, 50], [-125, 25]]]]),
    ],
  });

  const labels = [...result.lineLabelData.features, ...result.pointLabelData.features];
  assert.deepEqual(
    labels.map((feature) => feature.properties.name).sort(),
    ["COMPACT", "CONTINENTAL"],
  );
  assert.equal(result.curvedLabelData.features.length, 0);
  assert.equal(labels.length, 2);
});

test("live polity labels expand when ownership transfers add territory", () => {
  const region = (id, owner, minX, maxX) => ({
    type: "Feature",
    properties: { id, owner },
    geometry: {
      type: "Polygon",
      coordinates: [[[minX, 0], [maxX, 0], [maxX, 4], [minX, 4], [minX, 0]]],
    },
  });
  const regions = {
    type: "FeatureCollection",
    features: [region("ukraine", "Ukraine", 0, 4), region("border-zone", "Russia", 4, 8)],
  };
  const labelFor = (surfaces, owner) => {
    const labels = buildPolityLabelCollections(surfaces);
    return [...labels.lineLabelData.features, ...labels.pointLabelData.features]
      .find((feature) => feature.properties.owner === owner);
  };

  const before = labelFor(derivePolitySurfaces(regions).data, "Ukraine");
  const after = labelFor(
    derivePolitySurfaces(regions, { "border-zone": "Ukraine" }).data,
    "Ukraine",
  );

  assert.ok(after.properties.priorityScale > before.properties.priorityScale);
  assert.ok(after.properties.areaScale > before.properties.areaScale);
  assert.ok(after.properties.shapeWidth > before.properties.shapeWidth);
});

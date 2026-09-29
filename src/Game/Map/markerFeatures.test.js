/*! Open Historia — built-structure map feature tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  UNOWNED_MARKER_COLOR,
  buildMarkerFeatureCollection,
  markerOwnerColor,
} from "./markerFeatures.js";
import { parseColorToRgb } from "./cssColor.js";

const base = (overrides = {}) => ({
  id: "m1",
  name: "Westwall",
  kind: "fortification",
  ownerCode: "Third Reich",
  lng: 7.1,
  lat: 49.2,
  ...overrides,
});

test("a structure takes its owner's palette colour", () => {
  const data = buildMarkerFeatureCollection([base()], { colorMap: { "Third Reich": [120, 40, 30] } });
  assert.equal(data.features.length, 1);
  assert.equal(data.features[0].properties.rgb, "rgb(120, 40, 30)");
});

test("a polity coloured only in the live registry colours its structures", () => {
  // A polity the AI founds mid-game, or a scenario colours only in
  // polityOverrides, is missing from colors.json.
  const rgb = markerOwnerColor("British Empire", {
    colorMap: {},
    polityOverrides: { "British Empire": { color: "#c0507a" } },
  });
  assert.equal(rgb, "rgb(192, 80, 122)");
});

test("colors.json wins over the registry, as it does for region fills", () => {
  const rgb = markerOwnerColor("France", {
    colorMap: { France: [10, 20, 30] },
    polityOverrides: { France: { color: "#ffffff" } },
  });
  assert.equal(rgb, "rgb(10, 20, 30)");
});

test("an owner code resolves to the name the palette is keyed by", () => {
  assert.equal(markerOwnerColor("ESP", { colorMap: { Spain: [200, 30, 40] } }), "rgb(200, 30, 40)");
});

test("owner names are exact keys: a near name is not the same polity", () => {
  const rgb = markerOwnerColor("Russia", { colorMap: { "Russian Federation": [1, 2, 3] } });
  assert.equal(rgb, UNOWNED_MARKER_COLOR);
});

test("unowned and unknown-owner structures read as parchment", () => {
  assert.equal(markerOwnerColor("", { colorMap: { "": [1, 2, 3] } }), UNOWNED_MARKER_COLOR);
  assert.equal(markerOwnerColor("Nowhere", {}), UNOWNED_MARKER_COLOR);
  assert.equal(markerOwnerColor("Nowhere", { polityOverrides: { Nowhere: { color: "not a colour" } } }), UNOWNED_MARKER_COLOR);
});

test("a palette read after the polity was founded recolours the same markers", () => {
  const markers = [base({ ownerCode: "New Polity" })];
  const before = buildMarkerFeatureCollection(markers, { colorMap: {} });
  const after = buildMarkerFeatureCollection(markers, { colorMap: { "New Polity": [5, 6, 7] } });
  assert.equal(before.features[0].properties.rgb, UNOWNED_MARKER_COLOR);
  assert.equal(after.features[0].properties.rgb, "rgb(5, 6, 7)");
});

test("markers without a name or a position are not drawn", () => {
  const data = buildMarkerFeatureCollection([
    base({ id: "a" }),
    base({ id: "b", name: "" }),
    base({ id: "c", lng: Number.NaN }),
  ]);
  assert.deepEqual(data.features.map((feature) => feature.id), ["a"]);
  assert.deepEqual(buildMarkerFeatureCollection([]).features, []);
  assert.deepEqual(buildMarkerFeatureCollection(undefined).features, []);
});

test("CSS colours parse from hex, short hex and rgb()", () => {
  assert.deepEqual(parseColorToRgb("#c0507a"), [192, 80, 122]);
  assert.deepEqual(parseColorToRgb("c07"), [204, 0, 119]);
  assert.deepEqual(parseColorToRgb("rgba(300, 5, 6, 0.5)"), [255, 5, 6]);
  assert.equal(parseColorToRgb(""), null);
  assert.equal(parseColorToRgb("teal"), null);
});

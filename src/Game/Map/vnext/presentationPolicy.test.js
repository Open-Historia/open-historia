/*! Open Historia — marker presentation for the Workshop's feature kinds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import {
  MARKER_FAMILY,
  MARKER_VISIBILITY_TIER,
  POLITICAL_FILL_OPACITY_STOPS,
  getMarkerPresentation,
  politicalFillOpacityAtZoom,
} from "./presentationPolicy.js";
import { MAP_FEATURE_KINDS } from "../../../Editor/mapFeatures.js";

test("the conquest flood draws at the strength MapLibre gives the political fill", () => {
  // The ramp Nations.jsx builds from the same stops, evaluated by MapLibre.
  const ramp = ["interpolate", ["linear"], ["zoom"], ...POLITICAL_FILL_OPACITY_STOPS.flat()];
  const compiled = createPropertyExpression(ramp, latest.paint_fill["fill-opacity"]);
  assert.equal(compiled.result, "success", JSON.stringify(compiled.value));
  for (let zoom = 0; zoom <= 16; zoom += 0.25) {
    const expected = compiled.value.evaluate({ zoom });
    assert.ok(Math.abs(politicalFillOpacityAtZoom(zoom) - expected) < 1e-9, `zoom ${zoom}`);
  }
});

// What each kind the Map feature tool offers should be drawn as in the game.
const INTENDED_FAMILY = {
  landmark: MARKER_FAMILY.landmark,
  "military hq": MARKER_FAMILY.military,
  "military base": MARKER_FAMILY.military,
  fortress: MARKER_FAMILY.military,
  airfield: MARKER_FAMILY.military,
  port: MARKER_FAMILY.infrastructure,
  mine: MARKER_FAMILY.resource,
  "oil field": MARKER_FAMILY.resource,
  "industrial plant": MARKER_FAMILY.industryScience,
  "power plant": MARKER_FAMILY.industryScience,
  "research facility": MARKER_FAMILY.industryScience,
  embassy: MARKER_FAMILY.diplomatic,
};

test("every Workshop feature kind is drawn in its intended family", () => {
  for (const { id } of MAP_FEATURE_KINDS) {
    assert.ok(Object.hasOwn(INTENDED_FAMILY, id), `no intended family written down for "${id}"`);
    // A plain name, so only the kind decides.
    const presentation = getMarkerPresentation({ kind: id, name: "Site", status: "active" });
    assert.equal(presentation.family, INTENDED_FAMILY[id], `"${id}"`);
  }
});

test("an oil field gets the resource diamond at regional zoom however it is written", () => {
  for (const kind of ["oil field", "oil_field", "oilfield", "Oil Field"]) {
    const presentation = getMarkerPresentation({ kind, name: "Kirkuk", status: "active" });
    assert.equal(presentation.family, MARKER_FAMILY.resource, kind);
    assert.equal(presentation.glyph, "◆", kind);
    assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.regional, kind);
  }
  for (const kind of ["gas field", "gasfield", "coal field", "coalfield", "ore_field"]) {
    assert.equal(getMarkerPresentation({ kind, name: "Site" }).family, MARKER_FAMILY.resource, kind);
  }
});

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
  const compiled = createPropertyExpression(ramp, "layers[0].paint.fill-opacity", latest.paint_fill["fill-opacity"]);
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

test("the game's own oil field gets the resource diamond at regional zoom however its spacing is written", () => {
  for (const kind of ["oil field", "oil_field", "oil-field", "Oil Field"]) {
    const presentation = getMarkerPresentation({ kind, name: "Kirkuk", status: "active" });
    assert.equal(presentation.family, MARKER_FAMILY.resource, kind);
    assert.equal(presentation.glyph, "◆", kind);
    assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.regional, kind);
  }
});

// A structure is drawn by the family it was given (the skip says it when it
// builds one), never by English words in its kind or name: "военная база"
// used to be a local landmark and "military base" a strategic base.
test("a structure is drawn by its family, the same in every language, and by no words", () => {
  const base = getMarkerPresentation({ kind: "military base", name: "Fort Alba", family: "military" });
  const baza = getMarkerPresentation({ kind: "военная база", name: "Форт Альба", family: "military" });
  assert.deepEqual(baza, base);
  assert.equal(baza.glyph, "▲");
  assert.equal(baza.visibilityTier, MARKER_VISIBILITY_TIER.strategic);
  // Words alone say nothing: a kind the game does not offer, with no family, is a landmark.
  for (const kind of ["военная база", "missile silo", "gas field", "embassy annex"]) {
    const presentation = getMarkerPresentation({ kind, name: "National Strategic Command" });
    assert.equal(presentation.family, MARKER_FAMILY.landmark, kind);
    assert.equal(presentation.glyph, "•", kind);
    assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.local, kind);
  }
  // A family the game does not have is none.
  assert.equal(getMarkerPresentation({ kind: "x", family: "castle" }).family, MARKER_FAMILY.landmark);
});

test("strategic weight is a structure's own flag, not a word in its name", () => {
  const plain = getMarkerPresentation({ kind: "embassy", name: "Embassy" });
  const strategic = getMarkerPresentation({ kind: "embassy", name: "Embassy", strategic: true });
  assert.equal(strategic.priority - plain.priority, 7);
  assert.equal(strategic.visibilityTier, MARKER_VISIBILITY_TIER.regional);
  assert.equal(plain.visibilityTier, MARKER_VISIBILITY_TIER.local);
  // "National", "Central", "Nuclear" in a name used to add the weight; now nothing does but the flag.
  assert.equal(getMarkerPresentation({ kind: "embassy", name: "National Central Nuclear Embassy" }).priority, plain.priority);
  assert.equal(getMarkerPresentation({ kind: "embassy", name: "Embassy", strategic: "yes" }).priority, plain.priority);
});

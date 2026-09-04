import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKER_FAMILY,
  MARKER_VISIBILITY_TIER,
  getMarkerPresentation,
} from "../src/Game/Map/vnext/presentationPolicy.js";

test("Map vNext classifies resource areas independently from cities", () => {
  const presentation = getMarkerPresentation({
    name: "Dobele Lithium Basin",
    kind: "resource basin",
    status: "active",
  });

  assert.equal(presentation.family, MARKER_FAMILY.resource);
  assert.equal(presentation.glyph, "◆");
  assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.regional);
});

test("Map vNext gives military sites a distinct strategic marker family", () => {
  const presentation = getMarkerPresentation({
    name: "National Air Defence Command",
    kind: "military hq",
    status: "active",
  });

  assert.equal(presentation.family, MARKER_FAMILY.military);
  assert.equal(presentation.glyph, "▲");
  assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.strategic);
});

test("Map vNext demotes destroyed features without changing their identity", () => {
  const active = getMarkerPresentation({ name: "Coastal Fortress", kind: "fortress", status: "active" });
  const destroyed = getMarkerPresentation({ name: "Coastal Fortress", kind: "fortress", status: "destroyed" });

  assert.equal(active.family, destroyed.family);
  assert.ok(destroyed.priority < active.priority);
  assert.equal(destroyed.visibilityTier, MARKER_VISIBILITY_TIER.local);
});

test("Map vNext keeps unknown authored kinds available as local landmarks", () => {
  const presentation = getMarkerPresentation({ name: "Founders Memorial", kind: "other" });

  assert.equal(presentation.family, MARKER_FAMILY.landmark);
  assert.equal(presentation.visibilityTier, MARKER_VISIBILITY_TIER.local);
});

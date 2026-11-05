/*! Open Historia — the feature types the GM tools offer tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/mapFeatureKinds.test.js
//
// The invariant: the icon a player picks a feature type by is the glyph the
// map draws for it, and the GM tools offer every type the Workshop does.

import test from "node:test";
import assert from "node:assert/strict";

import { MAP_FEATURE_KINDS as WORKSHOP_FEATURE_KINDS } from "../../Editor/mapFeatures.js";
import { getMarkerPresentation } from "../Map/vnext/presentationPolicy.js";
import { GM_MAP_FEATURE_KINDS } from "./mapFeatureKinds.js";

test("every type's icon is the glyph the map draws for it", () => {
  for (const kind of GM_MAP_FEATURE_KINDS) {
    if (kind.id === "other") continue;
    assert.equal(kind.icon, getMarkerPresentation({ kind: kind.id }).glyph, kind.id);
  }
});

test("the GM tools offer every Workshop type, a city, a temporary marker and a custom type", () => {
  const ids = GM_MAP_FEATURE_KINDS.map((kind) => kind.id);
  for (const kind of WORKSHOP_FEATURE_KINDS) assert.ok(ids.includes(kind.id), kind.id);
  for (const id of ["city", "temporary marker", "other"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, "no type twice");
});

test("the glyphs the audit found wrong now match the map", () => {
  const icon = (id) => GM_MAP_FEATURE_KINDS.find((kind) => kind.id === id).icon;
  assert.equal(icon("landmark"), "•");
  assert.equal(icon("port"), "■");
  assert.equal(icon("airfield"), "▲");
  assert.equal(icon("city"), "●");
  assert.equal(icon("industrial plant"), "✦");
  assert.equal(icon("temporary marker"), "•", "no family of its own: drawn as a landmark");
});

test("an oil field, which the Workshop offers as a resource, draws as one", () => {
  assert.equal(getMarkerPresentation({ kind: "oil field" }).family, "resource");
  assert.equal(getMarkerPresentation({ kind: "oil-field" }).glyph, "◆");
});

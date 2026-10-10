/*! Open Historia — which built-in maps a scenario lets players pick © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/allowedBasemaps.test.js
// A scenario's author chooses, in the Map Editor, which built-in (real-world)
// maps players may switch to in Settings → Map (world.allowedBasemaps). A made-up
// world allows none: the player's pick of, say, Satellite is ignored there.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ESRI_BASEMAPS, allowedBuiltinBasemaps, decodeAllowedBasemaps, hasOwnMap, normalizeAllowedBasemaps } from "./assets.js";
import { buildGameSeed, scenarioHasOwnMap } from "../Editor/exportPreset.js";

test("no choice made: every built-in map is allowed, as before", () => {
  assert.equal(normalizeAllowedBasemaps(undefined), null);
  assert.equal(allowedBuiltinBasemaps(null), ESRI_BASEMAPS);
});

test("an empty list allows only the scenario's own map", () => {
  assert.deepEqual(allowedBuiltinBasemaps([]), []);
});

test("a list allows exactly those maps, and unknown ids are ignored", () => {
  assert.deepEqual(normalizeAllowedBasemaps(["topo", "nonsense", "imagery"]), ["imagery", "topo"]);
  assert.deepEqual(allowedBuiltinBasemaps(["topo"]).map((b) => b.id), ["topo"]);
});

test("the Map Editor writes the author's choice into the scenario", () => {
  const doc = { metadata: { allowedBasemaps: [] }, features: [], ownerSchema: 4 };
  const empty = { type: "FeatureCollection", features: [] };
  assert.deepEqual(buildGameSeed(doc, empty).world.allowedBasemaps, []);
  assert.equal(buildGameSeed({ ...doc, metadata: {} }, empty).world.allowedBasemaps, null);
});

// On a scenario with a map of its own an unset list offers no built-in map
// (basemapPick.test.js), so the Map Editor shows nothing ticked there.
test("the Map Editor knows when the scenario has a map of its own", () => {
  const drawn = { kind: "vector", geojson: { type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: {} }] } };
  assert.equal(scenarioHasOwnMap({ metadata: {} }), false);
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: null } }), false);
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: drawn } }), true);
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: { kind: "image", dataUrl: "data:image/png;base64,AA==" } } }), true);
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: { kind: "plain" } } }), true);
  // A detailed map always sits on a drawn basemap of its own.
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: drawn, tiledBasemap: { id: "got-world", version: 1 } } }), true);
});

// World state carries the list as one string, so an unchanged list keeps its
// identity between polls (useWorldState.js); the game and Settings read it back
// the same way.
test("the allowed list is read back from world state the one way", () => {
  assert.equal(decodeAllowedBasemaps(null), null);
  assert.equal(decodeAllowedBasemaps(undefined), null);
  assert.deepEqual(decodeAllowedBasemaps(""), []);
  assert.deepEqual(decodeAllowedBasemaps("topo,imagery"), ["topo", "imagery"]);
});

// One test of "a map of its own", on the scenario's world.background, for the
// game, Settings and the Map Editor alike.
test("a scenario has a map of its own when its background names a kind", () => {
  assert.equal(hasOwnMap(null), false);
  assert.equal(hasOwnMap({}), false);
  assert.equal(hasOwnMap({ kind: "vector" }), true);
  assert.equal(hasOwnMap({ kind: "image" }), true);
  assert.equal(hasOwnMap({ kind: "plain" }), true);
});

/*! Open Historia — a scenario names its detailed map, never carries it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/exportPresetTiled.test.js
// The map editor writes the detailed map the author chose into the scenario as
// a name (docs/adr/0005, docs/adr/0006): an official map by id and version, the
// author's own by checksum. The drawing on screen is its basemap, and there
// must be one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE, buildBackgroundForGame, scenarioHasOwnMap } from "./exportPreset.js";

const DRAWN = { kind: "vector", geojson: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }] } };

test("an official map is named by id and version over the drawing on screen", () => {
  const { background, backgroundData } = buildBackgroundForGame(DRAWN, { id: "got-world", version: 9, name: "Westeros", fillOpacity: [[2, 0.4], [10, 0.2]] });
  assert.deepEqual(background, { kind: "vector", tiled: { id: "got-world", version: 9, name: "Westeros" }, fillOpacity: [[2, 0.4], [10, 0.2]] });
  assert.deepEqual(backgroundData, { geojson: DRAWN.geojson });
});

test("a detailed map with no basemap drawn is refused, so no scenario is ever empty sea without it", () => {
  for (const drawing of [null, { kind: "vector", geojson: { type: "FeatureCollection", features: [] } }, { kind: "image", dataUrl: "data:," }]) {
    assert.throws(() => buildBackgroundForGame(drawing, { hash: "a".repeat(64), name: "Mine" }), (error) => error.message === DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE);
  }
});

test("an old download link, size or only-map flag on the choice is never written into the scenario", () => {
  const { background } = buildBackgroundForGame(DRAWN, { hash: "a".repeat(64), name: "Mine", bytes: 5, hubUrl: "https://github.com/x/y/releases/download/v1/a.pmtiles", onlyMap: true });
  assert.deepEqual(background.tiled, { hash: "a".repeat(64), name: "Mine" });
});

// A detailed starting map taken out (scenarioMaps.js removeMap) clears the name and keeps
// the drawing: the scenario still has its own map, now without the detailed one.
test("with its detailed map removed a scenario keeps the basemap drawn under it", () => {
  const { background, backgroundData } = buildBackgroundForGame(DRAWN, null);
  assert.deepEqual(background, { kind: "vector" });
  assert.deepEqual(backgroundData, { geojson: DRAWN.geojson });
  assert.equal(scenarioHasOwnMap({ metadata: { customBackground: DRAWN, tiledBasemap: null } }), true);
});

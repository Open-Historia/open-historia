/*! Open Historia — scenario relief tiles over a vector background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/scenarioTerrain.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCENARIO_TERRAIN_PAINTED,
  buildScenarioTerrainStyle,
  createReliefTileLoader,
  getShownRelief,
  publishShownRelief,
  subscribeShownRelief,
  normalizeScenarioTerrain,
  wantsScenarioTerrain,
} from "./scenarioTerrain.js";

test("only a vector background can declare relief tiles", () => {
  assert.equal(normalizeScenarioTerrain(null), null);
  assert.equal(normalizeScenarioTerrain({ kind: "vector" }), null);
  assert.equal(normalizeScenarioTerrain({ kind: "image", terrain: { maxzoom: 8 } }), null, "an image background already replaces the map");
  assert.deepEqual(normalizeScenarioTerrain({ kind: "vector", terrain: {} }), { minzoom: 0, maxzoom: 8 });
});

test("zooms are clamped and ordered; bad bounds are dropped", () => {
  assert.deepEqual(
    normalizeScenarioTerrain({ kind: "vector", terrain: { minzoom: 5, maxzoom: 2, bounds: [10, 0, 5, 1] } }),
    { minzoom: 5, maxzoom: 5 },
  );
  assert.deepEqual(
    normalizeScenarioTerrain({ kind: "vector", terrain: { minzoom: -3, maxzoom: 40, bounds: [0, -42, 93, 49.5] } }),
    { minzoom: 0, maxzoom: 22, bounds: [0, -42, 93, 49.5] },
  );
});

test("the player's Painted choice turns relief off; anything else keeps it", () => {
  assert.equal(wantsScenarioTerrain(""), true);
  assert.equal(wantsScenarioTerrain(undefined), true);
  assert.equal(wantsScenarioTerrain(SCENARIO_TERRAIN_PAINTED), false);
});

test("no terrain, no style: the vector background is left exactly as it was", () => {
  assert.deepEqual(buildScenarioTerrainStyle(null, "pmtiles://x"), { sources: {}, layers: [] });
  assert.deepEqual(buildScenarioTerrainStyle({ minzoom: 0, maxzoom: 8 }, ""), { sources: {}, layers: [] });
});

test("relief is one raster source and one layer, carrying the declared zooms", () => {
  const style = buildScenarioTerrainStyle({ minzoom: 0, maxzoom: 8, bounds: [0, -42, 93, 49.5] }, "pmtiles://http://x/terrain");
  const source = style.sources["custom-bg-terrain"];
  assert.equal(source.type, "raster");
  // A tile template through the gap-safe relief protocol, not a TileJSON url.
  assert.equal(source.url, undefined);
  assert.deepEqual(source.tiles, ["ohrelief://http://x/terrain/{z}/{x}/{y}"]);
  assert.equal(source.maxzoom, 8);
  assert.deepEqual(source.bounds, [0, -42, 93, 49.5]);
  assert.deepEqual(style.layers.map((layer) => [layer.id, layer.type, layer.source]), [["custom-bg-terrain", "raster", "custom-bg-terrain"]]);
});

test("a relief tile the archive lacks comes back transparent, never empty", async () => {
  const seen = [];
  const load = createReliefTileLoader(async (params) => {
    seen.push(params.url);
    return params.url.endsWith("/5/1/1") ? { data: new Uint8Array([1, 2, 3]) } : { data: null };
  });
  const present = await load({ url: "ohrelief://http://x/terrain/5/1/1", type: "arrayBuffer" }, new AbortController());
  const missing = await load({ url: "ohrelief://http://x/terrain/5/2/2", type: "arrayBuffer" }, new AbortController());
  assert.deepEqual(seen, ["pmtiles://http://x/terrain/5/1/1", "pmtiles://http://x/terrain/5/2/2"], "asks pmtiles for the same archive");
  assert.deepEqual([...present.data], [1, 2, 3]);
  // A PNG: without a body MapLibre leaves the tile loading and the map never idles.
  assert.deepEqual([...missing.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("a scenario's lighter fill ramp is kept only when it is a clean list of rising stops", () => {
  const ramp = [[1.5, 0.46], [5, 0.44], [8, 0.28], [14, 0.24]];
  assert.deepEqual(normalizeScenarioTerrain({ kind: "vector", terrain: { fillOpacity: ramp } }).fillOpacity, ramp);
  assert.deepEqual(
    normalizeScenarioTerrain({ kind: "vector", terrain: { fillOpacity: [[2, 0], [9, 3]] } }).fillOpacity,
    [[2, 0.05], [9, 1]],
    "opacities clamp so owners never vanish entirely",
  );
  for (const bad of [[[5, 0.4]], [[5, 0.4], [3, 0.3]], [[5, 0.4], ["x", 0.3]], "0.3", {}]) {
    assert.equal(normalizeScenarioTerrain({ kind: "vector", terrain: { fillOpacity: bad } }).fillOpacity, undefined);
  }
});

test("the shown relief is shared with subscribers and cleared back to none", () => {
  let calls = 0;
  const unsubscribe = subscribeShownRelief(() => { calls += 1; });
  publishShownRelief({ minzoom: 0, maxzoom: 8, fillOpacity: [[1, 0.5], [8, 0.3]] });
  publishShownRelief({ minzoom: 0, maxzoom: 8, fillOpacity: [[1, 0.5], [8, 0.3]] });
  assert.deepEqual(getShownRelief().fillOpacity, [[1, 0.5], [8, 0.3]]);
  assert.equal(calls, 1, "an unchanged relief does not re-render the political layers");
  publishShownRelief(null);
  assert.equal(getShownRelief(), null);
  assert.equal(calls, 2);
  unsubscribe();
});

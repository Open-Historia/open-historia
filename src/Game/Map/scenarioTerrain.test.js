/*! Open Historia — a scenario's Tiled Basemap over its vector background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
  resolveTiledBasemap,
  scenarioTiledBasemap,
  wantsScenarioTerrain,
} from "./scenarioTerrain.js";

const HASH = "a".repeat(64);
const NAMED = { kind: "vector", tiled: { hash: HASH, name: "Westeros relief", bytes: 485_000_000, hubUrl: "https://github.com/x/y/releases/download/v1/westeros.pmtiles" } };
const INSTALLED = { id: "westeros-relief", kind: "tiled", contentHash: HASH, minzoom: 0, maxzoom: 14, bounds: [0.2, -42.4, 92.8, 49.4] };

test("only a vector background can name a Tiled Basemap, by its content hash", () => {
  assert.equal(scenarioTiledBasemap(null), null);
  assert.equal(scenarioTiledBasemap({ kind: "vector" }), null);
  assert.equal(scenarioTiledBasemap({ kind: "image", tiled: { hash: HASH } }), null, "an image background already replaces the map");
  assert.equal(scenarioTiledBasemap({ kind: "vector", tiled: { hash: "not-a-hash" } }), null);
  assert.deepEqual(scenarioTiledBasemap(NAMED), NAMED.tiled);
  assert.equal(scenarioTiledBasemap({ kind: "vector", tiled: { hash: HASH, hubUrl: "javascript:alert(1)" } }).hubUrl, undefined, "only an https link is kept");
});

test("an installed Tiled Basemap is drawn with the zooms and bounds of its own archive", () => {
  const { tiles: terrain, missing } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: INSTALLED, archiveUrl: "http://x/api/basemaps/westeros-relief/archive" });
  assert.equal(missing, null);
  assert.deepEqual(terrain, { minzoom: 0, maxzoom: 14, bounds: [0.2, -42.4, 92.8, 49.4], url: "pmtiles://http://x/api/basemaps/westeros-relief/archive" });
  const style = buildScenarioTerrainStyle(terrain, terrain.url);
  assert.equal(style.sources["custom-bg-terrain"].maxzoom, 14);
  assert.deepEqual(style.sources["custom-bg-terrain"].tiles, ["ohrelief://http://x/api/basemaps/westeros-relief/archive/{z}/{x}/{y}"]);
});

test("a Tiled Basemap the player does not have leaves the painted fallback, and says what to download", () => {
  const { tiles: terrain, missing } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: null, archiveUrl: "" });
  assert.equal(terrain, null, "no relief source: the vector background alone");
  assert.deepEqual(missing, NAMED.tiled);
});

test("Painted, an image, or a plain vector background asks for no relief and offers no download", () => {
  for (const [descriptor, setting] of [[NAMED, SCENARIO_TERRAIN_PAINTED], [{ kind: "image" }, ""], [{ kind: "vector" }, ""]]) {
    assert.deepEqual(resolveTiledBasemap({ descriptor, setting, basemap: INSTALLED, archiveUrl: "http://x/a" }), { tiles: null, missing: null });
  }
});

test("a library entry that is not a Tiled Basemap, or has another hash, is not drawn", () => {
  for (const basemap of [{ ...INSTALLED, kind: "vector" }, { ...INSTALLED, contentHash: "b".repeat(64) }]) {
    const { tiles: terrain, missing } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap, archiveUrl: "http://x/a" });
    assert.equal(terrain, null);
    assert.deepEqual(missing, NAMED.tiled);
  }
});

test("zooms are clamped and ordered; bad bounds are dropped", () => {
  const draw = (meta) => resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: { ...INSTALLED, ...meta }, archiveUrl: "http://x/a" }).tiles;
  assert.deepEqual(draw({ minzoom: 5, maxzoom: 2, bounds: [10, 0, 5, 1] }), { minzoom: 5, maxzoom: 5, url: "pmtiles://http://x/a" });
  assert.deepEqual(draw({ minzoom: -3, maxzoom: 40 }), { minzoom: 0, maxzoom: 22, bounds: [0.2, -42.4, 92.8, 49.4], url: "pmtiles://http://x/a" });
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
  assert.deepEqual(seen.slice(0, 2), ["pmtiles://http://x/terrain/5/1/1", "pmtiles://http://x/terrain/5/2/2"], "asks pmtiles for the same archive");
  assert.deepEqual(seen.slice(2), ["pmtiles://http://x/terrain/4/1/1", "pmtiles://http://x/terrain/3/0/0", "pmtiles://http://x/terrain/2/0/0", "pmtiles://http://x/terrain/1/0/0", "pmtiles://http://x/terrain/0/0/0"], "then its ancestors, none of which exist");
  assert.deepEqual([...present.data], [1, 2, 3]);
  // A PNG: without a body MapLibre leaves the tile loading and the map never idles.
  assert.deepEqual([...missing.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("a scenario's lighter fill ramp is kept only when it is a clean list of rising stops", () => {
  const draw = (fillOpacity) => resolveTiledBasemap({ descriptor: { ...NAMED, fillOpacity }, setting: "", basemap: INSTALLED, archiveUrl: "http://x/a" }).tiles.fillOpacity;
  const ramp = [[1.5, 0.46], [5, 0.44], [8, 0.28], [14, 0.24]];
  assert.deepEqual(draw(ramp), ramp);
  assert.deepEqual(draw([[2, 0], [9, 3]]), [[2, 0.05], [9, 1]], "opacities clamp so owners never vanish entirely");
  for (const bad of [[[5, 0.4]], [[5, 0.4], [3, 0.3]], [[5, 0.4], ["x", 0.3]], "0.3", {}]) {
    assert.equal(draw(bad), undefined);
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

test("a missing relief tile is drawn from its nearest ancestor, cropped to the right quarter", async () => {
  const asked = [];
  const upscales = [];
  const load = createReliefTileLoader(async (params) => {
    asked.push(params.url);
    // Only zoom 9 exists: deeper detail was rendered just around cities.
    return /\/9\/\d+\/\d+$/.test(params.url) ? { data: new Uint8Array([9]) } : { data: null };
  }, { upscale: async (bytes, levels, ox, oy) => { upscales.push([[...bytes], levels, ox, oy]); return new Uint8Array([7, 7]); } });
  const tile = await load({ url: "ohrelief://http://x/terrain/11/1135/1002", type: "arrayBuffer" }, new AbortController());
  assert.deepEqual([...tile.data], [7, 7]);
  assert.deepEqual(asked, [
    "pmtiles://http://x/terrain/11/1135/1002",
    "pmtiles://http://x/terrain/10/567/501",
    "pmtiles://http://x/terrain/9/283/250",
  ]);
  // 1135 = 283·4 + 3, 1002 = 250·4 + 2: the child sits at column 3, row 2 of the ancestor.
  assert.deepEqual(upscales, [[[9], 2, 3, 2]]);
});

test("with no ancestor, or no way to scale one, a missing relief tile is transparent", async () => {
  const none = createReliefTileLoader(async () => ({ data: null }), { upscale: async () => new Uint8Array([1]) });
  const empty = await none({ url: "ohrelief://http://x/terrain/5/3/3" }, new AbortController());
  assert.deepEqual([...empty.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const cannotScale = createReliefTileLoader(async (p) => (p.url.endsWith("/4/1/1") ? { data: new Uint8Array([4]) } : { data: null }), { upscale: async () => null });
  const fallback = await cannotScale({ url: "ohrelief://http://x/terrain/5/3/3" }, new AbortController());
  assert.deepEqual([...fallback.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

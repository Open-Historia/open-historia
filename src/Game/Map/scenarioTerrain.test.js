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
  tiledBasemapOffer,
  wantsScenarioTerrain,
} from "./scenarioTerrain.js";

const HASH = "a".repeat(64);
// A scenario names an official map by id and the lowest version it needs
// (docs/adr/0006), or the author's own map by checksum.
const NAMED = { kind: "vector", tiled: { id: "got-world", version: 9, name: "Game of Thrones world map" } };
const BY_HASH = { kind: "vector", tiled: { hash: HASH, name: "My relief" } };
const INSTALLED = { id: "got-world-v9", kind: "tiled", contentHash: HASH, official: { id: "got-world", version: 9 }, minzoom: 0, maxzoom: 14, bounds: [0.2, -42.4, 92.8, 49.4] };
const v = (version, bytes = 400_000_000 + version) => ({ version, bytes, sha256: String(version % 10).repeat(64) });
const OFFICIAL = { id: "got-world", name: "Game of Thrones world map", versions: [v(8), v(9), v(10)] };

test("only a vector background can name a Tiled Basemap: by official id and version, or by checksum", () => {
  assert.equal(scenarioTiledBasemap(null), null);
  assert.equal(scenarioTiledBasemap({ kind: "vector" }), null);
  assert.equal(scenarioTiledBasemap({ kind: "image", tiled: { id: "got-world" } }), null, "an image background already replaces the map");
  assert.equal(scenarioTiledBasemap({ kind: "vector", tiled: { hash: "not-a-hash" } }), null);
  assert.equal(scenarioTiledBasemap({ kind: "vector", tiled: { id: "Not An Id!" } }), null);
  assert.deepEqual(scenarioTiledBasemap(NAMED), NAMED.tiled);
  assert.deepEqual(scenarioTiledBasemap(BY_HASH), BY_HASH.tiled);
  assert.equal(scenarioTiledBasemap({ kind: "vector", tiled: { id: "got-world" } }).version, 1, "no version: any will do");
  assert.deepEqual(
    scenarioTiledBasemap({ kind: "vector", tiled: { id: "got-world", version: 9, hash: HASH, hubUrl: "https://x" } }),
    { id: "got-world", version: 9 },
    "an official id wins over a checksum, and a download link is never taken from a scenario",
  );
});

test("an installed Tiled Basemap is drawn with the zooms and bounds of its own archive", () => {
  const { tiles: terrain, missing, update } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: INSTALLED, archiveUrl: "http://x/api/basemaps/got-world-v9/archive" });
  assert.equal(missing, null);
  assert.equal(update, null, "no official list read: nothing to offer");
  assert.deepEqual(terrain, { minzoom: 0, maxzoom: 14, bounds: [0.2, -42.4, 92.8, 49.4], url: "pmtiles://http://x/api/basemaps/got-world-v9/archive" });
  const style = buildScenarioTerrainStyle(terrain, terrain.url);
  assert.equal(style.sources["custom-bg-terrain"].maxzoom, 14);
  assert.deepEqual(style.sources["custom-bg-terrain"].tiles, ["ohrelief://http://x/api/basemaps/got-world-v9/archive/{z}/{x}/{y}"]);
});

test("a map the player does not have leaves the basemap, and offers the newest official version with its size", () => {
  const { tiles: terrain, missing } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: null, archiveUrl: "", official: OFFICIAL });
  assert.equal(terrain, null, "no relief source: the vector background alone");
  assert.deepEqual(missing, { id: "got-world", name: "Game of Thrones world map", version: 10, bytes: 400_000_010 }, "the newest, so later scenarios need nothing more");
});

test("a map the official list does not have (or could not be read) is unavailable; one named by checksum alone cannot be downloaded", () => {
  const offline = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: null, archiveUrl: "", official: null });
  assert.deepEqual(offline.missing, { id: "got-world", name: "Game of Thrones world map", unavailable: true });
  const tooOld = tiledBasemapOffer({ named: { id: "got-world", version: 11 }, installed: null, official: OFFICIAL });
  assert.equal(tooOld.missing.unavailable, true, "the list has no version as new as the scenario needs");
  const own = resolveTiledBasemap({ descriptor: BY_HASH, setting: "", basemap: null, archiveUrl: "", official: null });
  assert.deepEqual(own.missing, { hash: HASH, name: "My relief", unofficial: true });
});

test("a newer version is offered, never forced: the player's version is drawn meanwhile", () => {
  const made8 = { kind: "vector", tiled: { id: "got-world", version: 8 } };
  const optional = resolveTiledBasemap({ descriptor: made8, setting: "", basemap: INSTALLED, archiveUrl: "http://x/a", official: OFFICIAL });
  assert.ok(optional.tiles, "drawn on the version the player has");
  assert.equal(optional.missing, null, "never a second download of the same map");
  assert.deepEqual(optional.update, { id: "got-world", name: "Game of Thrones world map", version: 10, bytes: 400_000_010, have: 9, needed: false });

  const made10 = { kind: "vector", tiled: { id: "got-world", version: 10 } };
  const needed = resolveTiledBasemap({ descriptor: made10, setting: "", basemap: INSTALLED, archiveUrl: "http://x/a", official: OFFICIAL });
  assert.ok(needed.tiles, "a scenario made on a newer version still draws on the older one");
  assert.equal(needed.missing, null);
  assert.equal(needed.update.needed, true);

  const current = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: { ...INSTALLED, official: { id: "got-world", version: 10 } }, archiveUrl: "http://x/a", official: OFFICIAL });
  assert.equal(current.update, null, "the newest already");
});

test("a scenario naming a file by checksum is drawn on that file, or on the newer version that replaced it", () => {
  const exact = resolveTiledBasemap({ descriptor: BY_HASH, setting: "", basemap: INSTALLED, archiveUrl: "http://x/a" });
  assert.ok(exact.tiles);
  const replaced = { ...INSTALLED, contentHash: "b".repeat(64), supersedes: [HASH], official: { id: "got-world", version: 10 } };
  assert.ok(resolveTiledBasemap({ descriptor: BY_HASH, setting: "", basemap: replaced, archiveUrl: "http://x/a" }).tiles);
});

test("Painted, an image, or a plain vector background asks for no relief and offers nothing", () => {
  for (const [descriptor, setting] of [[NAMED, SCENARIO_TERRAIN_PAINTED], [{ kind: "image" }, ""], [{ kind: "vector" }, ""]]) {
    assert.deepEqual(
      resolveTiledBasemap({ descriptor, setting, basemap: INSTALLED, archiveUrl: "http://x/a", official: OFFICIAL }),
      { tiles: null, missing: null, update: null },
    );
  }
});

test("a library entry that is not a Tiled Basemap, or another map, is not drawn", () => {
  for (const basemap of [{ ...INSTALLED, kind: "vector" }, { ...INSTALLED, official: { id: "middle-earth", version: 9 } }]) {
    const { tiles: terrain, missing } = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap, archiveUrl: "http://x/a", official: OFFICIAL });
    assert.equal(terrain, null);
    assert.equal(missing.version, 10);
  }
  const other = resolveTiledBasemap({ descriptor: BY_HASH, setting: "", basemap: { ...INSTALLED, contentHash: "b".repeat(64) }, archiveUrl: "http://x/a" });
  assert.equal(other.tiles, null);
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

// Archived and deleted versions never reach the game's list (server/officialBasemaps.js
// drops them), so these lists hold only what is still downloadable.
test("a player holding an archived or deleted version keeps it, and is offered the newest available one as an update", () => {
  const holding2 = { ...INSTALLED, official: { id: "got-world", version: 9 } };
  const listWithout9 = { ...OFFICIAL, versions: [v(8), v(10)] };
  const drawn = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: holding2, archiveUrl: "http://x/a", official: listWithout9 });
  assert.ok(drawn.tiles, "their copy still draws");
  assert.equal(drawn.missing, null);
  assert.equal(drawn.update.version, 10);
});

test("a scenario whose minimum version was deleted accepts any newer version still offered", () => {
  const made9 = { kind: "vector", tiled: { id: "got-world", version: 9 } };
  const { missing } = resolveTiledBasemap({ descriptor: made9, setting: "", basemap: null, archiveUrl: "", official: { ...OFFICIAL, versions: [v(8), v(10)] } });
  assert.equal(missing.version, 10);
  const none = resolveTiledBasemap({ descriptor: made9, setting: "", basemap: null, archiveUrl: "", official: { ...OFFICIAL, versions: [v(8)] } });
  assert.equal(none.missing.unavailable, true, "only older versions left: the basemap");
});

test("a withdrawn map is no longer offered; a player who has it keeps drawing it, with no update", () => {
  const withdrawn = { id: "got-world", name: "Game of Thrones world map", versions: [], withdrawn: true };
  const without = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: null, archiveUrl: "", official: withdrawn });
  assert.deepEqual(without.missing, { id: "got-world", name: "Game of Thrones world map", unavailable: true, withdrawn: true });
  const holding = resolveTiledBasemap({ descriptor: NAMED, setting: "", basemap: INSTALLED, archiveUrl: "http://x/a", official: withdrawn });
  assert.ok(holding.tiles);
  assert.equal(holding.update, null);
});

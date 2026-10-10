/*! Open Historia — a scenario's other basemaps of its own: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/ownBasemaps.test.js
//
// A scenario can carry more basemaps of its own than its main one, and players
// switch between them in Settings → Map. The Map Editor keeps them in
// doc.metadata.ownBasemaps; the game gets world.ownBasemaps and the
// ownBasemapsData asset.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameSeed } from "./exportPreset.js";
import { buildOwnBasemapsForGame, moveOwnBasemapsBetween, ownBasemapFromLibrary, ownBasemapsFromGame } from "./ownBasemaps.js";
import { layOutScenarioBundle } from "../../server/mapProjection.js";

const PICTURE = { kind: "image", dataUrl: "data:image/png;base64,AA==" };
const DRAWN = {
  kind: "vector",
  geojson: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [10, 20] } }] },
};
const EMPTY = { type: "FeatureCollection", features: [] };

test("the scenario's other basemaps reach the game light, their payloads apart", () => {
  const doc = {
    features: [],
    ownerSchema: 4,
    metadata: { customBackground: PICTURE, ownBasemaps: [{ id: "political", name: "Political", background: PICTURE }, { id: "terrain", name: "Terrain", background: DRAWN }] },
  };
  const seed = buildGameSeed(doc, EMPTY);
  assert.deepEqual(seed.world.ownBasemaps, [{ id: "political", name: "Political", kind: "image" }, { id: "terrain", name: "Terrain", kind: "vector" }]);
  assert.deepEqual(seed.ownBasemapsData, { political: { dataUrl: PICTURE.dataUrl }, terrain: { geojson: DRAWN.geojson } });
  // None: nothing in the world, and the asset is cleared.
  const none = buildGameSeed({ ...doc, metadata: { customBackground: PICTURE } }, EMPTY);
  assert.equal(none.world.ownBasemaps, null);
  assert.equal(none.ownBasemapsData, null);
});

test("a round trip through the game keeps them, and drops one whose payload is gone", () => {
  const { ownBasemaps, ownBasemapsData } = buildOwnBasemapsForGame([{ id: "a", name: "A", background: PICTURE }, { id: "b", name: "B", background: DRAWN }]);
  assert.deepEqual(ownBasemapsFromGame(ownBasemaps, ownBasemapsData), [{ id: "a", name: "A", background: PICTURE }, { id: "b", name: "B", background: DRAWN }]);
  assert.deepEqual(ownBasemapsFromGame(ownBasemaps, { a: ownBasemapsData.a }).map((own) => own.id), ["a"]);
  assert.deepEqual(ownBasemapsFromGame(ownBasemaps, null), []);
});

test("one of Your basemaps becomes one of the scenario's own, named by its checksum", () => {
  const entry = ownBasemapFromLibrary({ id: "lib-1", contentHash: "abc123", name: "Terrain", kind: "vector" }, { geojson: DRAWN.geojson });
  assert.deepEqual(entry, { id: "abc123", name: "Terrain", background: DRAWN });
  assert.equal(ownBasemapFromLibrary({ id: "lib-2", kind: "image" }, {}), null);
});

test("a drawn one moves with the map into another projection; a picture stays", () => {
  const list = [{ id: "p", name: "P", background: PICTURE }, { id: "d", name: "D", background: DRAWN }];
  assert.equal(moveOwnBasemapsBetween(list, { type: "mercator" }, { type: "mercator" }), null);
  const moved = moveOwnBasemapsBetween(list, { type: "mercator" }, { type: "equirectangular" });
  assert.deepEqual(moved[0], list[0]);
  assert.notDeepEqual(moved[1].background.geojson.features[0].geometry.coordinates, [10, 20]);
});

test("a bundle laid out in its projection moves the drawn ones too", () => {
  const bundle = {
    data: { world: { projection: { type: "equirectangular" } } },
    assets: { ownBasemapsData: { mode: "embedded", data: { d: { geojson: DRAWN.geojson }, p: { dataUrl: PICTURE.dataUrl } } } },
  };
  const laid = layOutScenarioBundle(bundle);
  assert.notEqual(laid, bundle, "a declared equirectangular map is laid out");
  assert.equal(laid.assets.ownBasemapsData.data.p.dataUrl, PICTURE.dataUrl);
  assert.notDeepEqual(laid.assets.ownBasemapsData.data.d.geojson.features[0].geometry.coordinates, [10, 20]);
});

test("a detailed map among them reaches the game named, never carried, and comes back", () => {
  const relief = { id: "relief", name: "Westeros relief", detailed: { id: "got-world", version: 2 }, fillOpacity: [[3, 0.2], [8, 0.5]], over: "terrain" };
  const { ownBasemaps, ownBasemapsData } = buildOwnBasemapsForGame([{ id: "terrain", name: "Terrain", background: DRAWN }, relief]);
  assert.deepEqual(ownBasemaps[1], { id: "relief", name: "Westeros relief", kind: "tiled", tiled: { id: "got-world", version: 2 }, fillOpacity: [[3, 0.2], [8, 0.5]], over: "terrain" });
  assert.deepEqual(Object.keys(ownBasemapsData), ["terrain"], "a detailed map has no payload");
  assert.deepEqual(ownBasemapsFromGame(ownBasemaps, ownBasemapsData)[1], relief);
  // One whose drawn map did not come is dropped with it.
  assert.deepEqual(ownBasemapsFromGame(ownBasemaps, {}), []);
});

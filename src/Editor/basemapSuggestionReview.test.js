/*! Open Historia — reviewing a suggestion's basemaps and detailed map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/basemapSuggestionReview.test.js
//
// In the Workshop the author accepts a suggestion's basemap changes one at a
// time. What has to hold:
//   - each is "open" while the map has the post's value, "applied" once it has
//     the suggested one, and a "conflict" when the author changed it too;
//   - accepting writes it to the document and Undo puts back what was there;
//   - a detailed map goes on a drawn basemap in Mercator only, bringing the
//     suggestion's basemap and projection with it, and a map is converted
//     only once its detailed map is off.

import test from "node:test";
import assert from "node:assert/strict";

import { acceptMapChanges, applyMapChange, mapChangeStatus, planAccept, undoRefusal } from "./suggestionReview.js";
import { DETAILED_MAP_PROJECTION_MESSAGE } from "./projectionConvert.js";
import { DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE } from "./exportPreset.js";
import { canonicalJson, hashText } from "../runtime/scenarioChanges.js";

const DRAWN = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };
const PICTURE = "data:image/png;base64,AAAA";
const hashOf = (payload) => hashText(canonicalJson(payload));

const setup = (metadata = {}) => {
  const state = { doc: { metadata: { ...metadata } } };
  const d = { patchMetadata: (patch) => { state.doc = { ...state.doc, metadata: { ...state.doc.metadata, ...patch } }; } };
  const ctx = { d, get doc() { return state.doc; } };
  return { state, d, ctx };
};

test("the built-in maps players may switch to: open, accepted, undone", () => {
  const { state, ctx, d } = setup();
  const change = { id: "map:allowedBasemaps", area: "map", kind: "allowed-basemaps", from: null, to: ["topo"] };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.deepEqual(state.doc.metadata.allowedBasemaps, ["topo"]);
  assert.equal(mapChangeStatus(change, ctx), "applied");
  undo();
  assert.equal(state.doc.metadata.allowedBasemaps, null);
  d.patchMetadata({ allowedBasemaps: [] });
  assert.equal(mapChangeStatus(change, ctx), "conflict", "the author chose none since");
});

test("another basemap of the scenario's own: added, renamed, removed, each undone", () => {
  const { state, ctx } = setup();
  const add = { id: "own-basemap-add:terrain", area: "map", kind: "own-basemap-add", key: "terrain", to: { name: "Terrain", kind: "vector", hash: hashOf({ geojson: DRAWN }), data: { geojson: DRAWN } } };
  assert.equal(mapChangeStatus(add, ctx), "open");
  const undoAdd = applyMapChange(add, ctx);
  assert.deepEqual(state.doc.metadata.ownBasemaps, [{ id: "terrain", name: "Terrain", background: { kind: "vector", geojson: DRAWN } }]);
  assert.equal(mapChangeStatus(add, ctx), "applied");

  const rename = { id: "own-basemap-change:terrain", area: "map", kind: "own-basemap-change", key: "terrain", from: { name: "Terrain", kind: "vector", hash: add.to.hash }, to: { ...add.to, name: "Relief" } };
  assert.equal(mapChangeStatus(rename, ctx), "open");
  const undoRename = applyMapChange(rename, ctx);
  assert.equal(state.doc.metadata.ownBasemaps[0].name, "Relief");
  assert.equal(mapChangeStatus(rename, ctx), "applied");
  undoRename();
  assert.equal(state.doc.metadata.ownBasemaps[0].name, "Terrain");

  const remove = { id: "own-basemap-remove:terrain", area: "map", kind: "own-basemap-remove", key: "terrain", from: rename.from };
  assert.equal(mapChangeStatus(remove, ctx), "open");
  const undoRemove = applyMapChange(remove, ctx);
  assert.equal(state.doc.metadata.ownBasemaps, null);
  assert.equal(mapChangeStatus(remove, ctx), "applied");
  undoRemove();
  assert.equal(state.doc.metadata.ownBasemaps.length, 1);
  undoAdd();
  assert.equal(state.doc.metadata.ownBasemaps, null);
});

test("a change to a basemap the author has since removed is missing, and one they changed is a conflict", () => {
  const { ctx, d } = setup();
  const change = { id: "own-basemap-change:p", area: "map", kind: "own-basemap-change", key: "p", from: { name: "P", kind: "image", hash: hashOf({ dataUrl: PICTURE }) }, to: { name: "Q", kind: "image", hash: hashOf({ dataUrl: PICTURE }), data: { dataUrl: PICTURE } } };
  assert.equal(mapChangeStatus(change, ctx), "missing");
  d.patchMetadata({ ownBasemaps: [{ id: "p", name: "Mine", background: { kind: "image", dataUrl: PICTURE } }] });
  assert.equal(mapChangeStatus(change, ctx), "conflict");
});

test("the detailed map: put on, then undone, apart from the basemap", () => {
  const { state, ctx } = setup({ customBackground: { kind: "vector", geojson: DRAWN } });
  const change = { id: "map:detailedMap", area: "map", kind: "detailed-map", from: null, to: { id: "got-world", version: 2, name: "Westeros relief", fillOpacity: [[3, 0.2]] } };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const result = acceptMapChanges([change], ctx, { changes: [change] });
  assert.equal(result.refused, undefined);
  assert.deepEqual(state.doc.metadata.tiledBasemap, { id: "got-world", version: 2, name: "Westeros relief", fillOpacity: [[3, 0.2]] });
  assert.deepEqual(state.doc.metadata.customBackground, { kind: "vector", geojson: DRAWN }, "the basemap under it is untouched");
  assert.equal(mapChangeStatus(change, ctx), "applied");
  result.undoers.get(change.id)();
  assert.equal(state.doc.metadata.tiledBasemap, null);
});

test("a detailed map is refused without a drawn basemap or out of Mercator", () => {
  const change = { id: "map:detailedMap", area: "map", kind: "detailed-map", from: null, to: { id: "got-world", version: 1 } };
  const picture = setup({ customBackground: { kind: "image", dataUrl: PICTURE } });
  assert.equal(acceptMapChanges([change], picture.ctx, { changes: [change] }).refused, DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE);
  assert.equal(picture.state.doc.metadata.tiledBasemap, undefined, "nothing was accepted");
  const flat = setup({ customBackground: { kind: "vector", geojson: DRAWN }, projection: { type: "equirectangular" } });
  assert.equal(acceptMapChanges([change], flat.ctx, { changes: [change] }).refused, DETAILED_MAP_PROJECTION_MESSAGE);
});

test("a detailed map brings the suggestion's drawn basemap with it", () => {
  const { state, ctx } = setup({ customBackground: { kind: "image", dataUrl: PICTURE } });
  ctx.setBackground = (saved) => ctx.d.patchMetadata({ customBackground: saved });
  const background = { id: "map:background", area: "map", kind: "background", from: { kind: "image", hash: hashOf({ dataUrl: PICTURE }) }, to: { kind: "vector", hash: hashOf({ geojson: DRAWN }), data: { geojson: DRAWN } } };
  const detailed = { id: "map:detailedMap", area: "map", kind: "detailed-map", from: null, to: { id: "got-world", version: 1 } };
  const changes = [detailed, background];
  assert.deepEqual(planAccept([detailed], ctx, { changes }).map((change) => change.id), ["map:background", "map:detailedMap"]);
  const result = acceptMapChanges([detailed], ctx, { changes });
  assert.equal(result.refused, undefined);
  assert.equal(state.doc.metadata.customBackground.kind, "vector");
  assert.equal(state.doc.metadata.tiledBasemap.id, "got-world");
});

test("taking the detailed map off comes before a change of projection", () => {
  const { state, ctx } = setup({ customBackground: { kind: "vector", geojson: DRAWN }, tiledBasemap: { id: "got-world", version: 1 } });
  const conversions = [];
  ctx.convertProjection = (from, to) => {
    conversions.push(state.doc.metadata.tiledBasemap ?? null);
    ctx.d.patchMetadata({ projection: to });
  };
  const off = { id: "map:detailedMap", area: "map", kind: "detailed-map", from: { id: "got-world", version: 1 }, to: null };
  const projection = { id: "map:projection", area: "map", kind: "projection", from: { type: "mercator" }, to: { type: "equirectangular" } };
  const result = acceptMapChanges([projection], ctx, { changes: [projection, off] });
  assert.equal(result.refused, undefined);
  assert.deepEqual(result.accepted, ["map:detailedMap", "map:projection"]);
  assert.deepEqual(conversions, [null], "the map was converted with no detailed map on it");
  // Putting the old detailed map back now would put it on a map out of Mercator.
  assert.equal(undoRefusal(off, ctx), DETAILED_MAP_PROJECTION_MESSAGE);
});

test("a detailed map among the scenario's maps: added over a drawn one, which comes with it", () => {
  const { state, ctx } = setup();
  const drawn = { id: "own-basemap-add:terrain", area: "map", kind: "own-basemap-add", key: "terrain", to: { name: "Terrain", kind: "vector", hash: hashOf({ geojson: DRAWN }), data: { geojson: DRAWN } } };
  const data = { tiled: { id: "got-world", version: 2 }, over: "terrain" };
  const relief = { id: "own-basemap-add:relief", area: "map", kind: "own-basemap-add", key: "relief", to: { name: "Relief", kind: "tiled", hash: hashOf(data), data } };
  const changes = [relief, drawn];
  assert.deepEqual(planAccept([relief], ctx, { changes }).map((change) => change.id), ["own-basemap-add:terrain", "own-basemap-add:relief"]);
  const result = acceptMapChanges([relief], ctx, { changes });
  assert.equal(result.refused, undefined);
  assert.deepEqual(state.doc.metadata.ownBasemaps.at(-1), { id: "relief", name: "Relief", detailed: { id: "got-world", version: 2 }, over: "terrain" });
  assert.equal(mapChangeStatus(relief, ctx), "applied");
  const moved = { id: "own-basemap-change:relief", area: "map", kind: "own-basemap-change", key: "relief", from: { name: "Relief", kind: "tiled", hash: relief.to.hash }, to: { ...relief.to, hash: hashOf({ ...data, over: "" }), data: { ...data, over: "" } } };
  assert.equal(mapChangeStatus(moved, ctx), "open");
});

test("the starting map's name: open, accepted, undone", () => {
  const { state, ctx } = setup();
  const change = { id: "map:startingMapName", area: "map", kind: "map-field", field: "startingMapName", from: "", to: "Westeros" };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.equal(state.doc.metadata.startingMapName, "Westeros");
  assert.equal(mapChangeStatus(change, ctx), "applied");
  undo();
  assert.equal(state.doc.metadata.startingMapName, "");
});

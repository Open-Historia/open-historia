import test from "node:test";
import assert from "node:assert/strict";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { fromLonLat } from "ol/proj.js";
import { buildRegionChanges } from "./regionChanges.js";
import { applyRegionDelta } from "../../server/regionDelta.js";
import {
  EDITOR_MAX_ZOOM, EDITOR_MIN_ZOOM, EDITOR_FOCUS_MAX_ZOOM,
  EDITOR_REGION_DECIMALS, EDITOR_REGION_GEOJSON_OPTIONS,
} from "./editorZoomPrecision.js";

test("native editor view reaches the four additional close-up zoom levels and clamps beyond them", () => {
  const view = new View({
    center: fromLonLat([24, 56]),
    zoom: 2.1,
    minZoom: EDITOR_MIN_ZOOM,
    maxZoom: EDITOR_MAX_ZOOM,
  });
  assert.equal(EDITOR_MAX_ZOOM, 24);
  assert.equal(EDITOR_FOCUS_MAX_ZOOM, 20);
  for (const level of [20, 21, 22, 23, 24]) {
    view.setZoom(level);
    assert.ok(Math.abs(view.getZoom() - level) < 1e-8, "cannot reach zoom " + level);
  }
  view.setZoom(27);
  assert.ok(view.getZoom() <= 24, "native view must remain bounded");
});

test("close-up WGS84 region coordinates survive native GeoJSON export, reload and delta save", () => {
  assert.equal(EDITOR_REGION_DECIMALS, 7);
  const ring = [
    [24.1234567, 56.1234567],
    [24.1234578, 56.1234567],
    [24.1234578, 56.1234589],
    [24.1234567, 56.1234567],
  ];
  const feature = new Feature(new Polygon([ring.map((coord) => fromLonLat(coord))]));
  feature.setId("fine-boundary");
  feature.setProperties({ name: "Fine-grained test region", owner: "X", typeId: "land" });
  const format = new GeoJSON();
  const exported = format.writeFeatureObject(feature, EDITOR_REGION_GEOJSON_OPTIONS);
  const savedRing = exported.geometry.coordinates[0];
  assert.deepEqual(savedRing[0], ring[0]);
  assert.deepEqual(savedRing[1], ring[1]);
  assert.deepEqual(savedRing[2], ring[2]);
  assert.notEqual(savedRing[0][0], savedRing[1][0], "nearby vertices must not collapse to the old 5-decimal grid");
  const changed = buildRegionChanges({ writtenFeatures: [exported] });
  assert.equal(changed.full, true);
  const stored = { type: "FeatureCollection", features: changed.features };
  const reloaded = format.readFeature(stored.features[0], {
    dataProjection: "EPSG:4326", featureProjection: "EPSG:3857",
  });
  const again = format.writeFeatureObject(reloaded, EDITOR_REGION_GEOJSON_OPTIONS);
  assert.deepEqual(again.geometry.coordinates, exported.geometry.coordinates);
  const noDelta = buildRegionChanges({ writtenFeatures: [again], saved: changed.marks });
  assert.equal(noDelta.full, false);
  assert.deepEqual(noDelta.changed, []);
  const altered = { ...again, properties: { ...again.properties, name: "Edited after reload" } };
  const delta = buildRegionChanges({ writtenFeatures: [altered], saved: changed.marks });
  const applied = applyRegionDelta(stored, { changed: delta.changed, removed: delta.removed, count: 1 });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.regions.features[0].geometry.coordinates, exported.geometry.coordinates);
});

test("region editing, clipboard export and suggestions all use the zoom and precision contract", async () => {
  const { readFileSync } = await import("node:fs");
  const editor = readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  const suggestions = readFileSync(new URL("./SuggestionReviewPanel.jsx", import.meta.url), "utf8");
  assert.match(editor, /maxZoom: EDITOR_MAX_ZOOM/);
  assert.equal((editor.match(/maxZoom: EDITOR_FOCUS_MAX_ZOOM/g) || []).length, 5,
    "region, selection, war shape, group and owner navigation must not stop at legacy zoom 7/8");
  assert.match(suggestions, /maxZoom: EDITOR_FOCUS_MAX_ZOOM/);
  assert.match(editor, /\.\.\.EDITOR_REGION_GEOJSON_OPTIONS/);
  assert.match(editor, /const options = EDITOR_REGION_GEOJSON_OPTIONS/);
  assert.doesNotMatch(editor, /decimals: 5/);
  const control = readFileSync(new URL("./editorZoomControl.js", import.meta.url), "utf8");
  assert.match(control, /"aria-label", "Editor zoom level"/);
  assert.match(editor, /"change:resolution", updateZoomReadout/);
  assert.match(editor, /\.un\("change:resolution", updateZoomReadout\)/);
  assert.match(editor, /zoomControl\.dispose\(\)/);
});

test("the old five-decimal export would merge two boundaries that the new format preserves", () => {
  const format = new GeoJSON();
  const a = fromLonLat([24.1234567, 56.1234567]);
  const b = fromLonLat([24.1234578, 56.1234567]);
  const c = fromLonLat([24.1234578, 56.1234589]);
  const feature = new Feature(new Polygon([[a, b, c, a]]));
  const old = format.writeFeatureObject(feature, { ...EDITOR_REGION_GEOJSON_OPTIONS, decimals: 5 });
  const fine = format.writeFeatureObject(feature, EDITOR_REGION_GEOJSON_OPTIONS);
  assert.equal(old.geometry.coordinates[0][0][0], old.geometry.coordinates[0][1][0]);
  assert.notEqual(fine.geometry.coordinates[0][0][0], fine.geometry.coordinates[0][1][0]);
});

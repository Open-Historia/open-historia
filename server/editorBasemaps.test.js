import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const basemaps = fs.readFileSync(path.resolve(here, "../src/Editor/basemaps.js"), "utf8");
const picker = fs.readFileSync(path.resolve(here, "../src/Editor/BasemapPicker.jsx"), "utf8");
const olMap = fs.readFileSync(path.resolve(here, "../src/Editor/OlMap.jsx"), "utf8");
const doc = fs.readFileSync(path.resolve(here, "../src/Editor/useMapDocument.js"), "utf8");
const assets = fs.readFileSync(path.resolve(here, "../src/runtime/assets.js"), "utf8");

test("the editor exposes both dark physical basemaps", () => {
  assert.match(basemaps, /id: "ocean-dark"/);
  assert.match(basemaps, /label: "Ocean - Dark"/);
  assert.match(basemaps, /id: "atlas-relief-dark"/);
  assert.match(basemaps, /label: "Atlas Relief - Dark"/);
});

test("dark basemap cards visibly preview their grade", () => {
  assert.match(basemaps, /previewFilter:/);
  assert.match(picker, /imageFilter=\{b\.previewFilter\}/);
  assert.match(picker, /filter: imageFilter \|\| "none"/);
});

test("OpenLayers editor gives dark variants a dark physical presentation", () => {
  assert.match(basemaps, /editorOpacity:/);
  assert.match(basemaps, /editorBackground:/);
  assert.match(olMap, /opacity: Number\.isFinite\(esri\.editorOpacity\) \? esri\.editorOpacity : 1/);
  assert.match(olMap, /esri\?\.editorBackground \|\| BASEMAP_BG\[basemap\]/);
});

test("Ocean remains the default without overriding authored scenarios", () => {
  assert.match(doc, /basemap: "ocean"/);
  assert.match(assets, /export const DEFAULT_BASEMAP_ID = "ocean"/);
  assert.match(assets, /if \(isBuiltinBasemapId\(scenarioId\)\) return scenarioId/);
});

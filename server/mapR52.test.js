import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");

test("R5.4.6 polity label sources stay static across camera zoom", () => {
  assert.match(nations, /data=\{rawLivePolityPointLabelData\}/);
  assert.match(nations, /data=\{rawLivePolityLineLabelData\}/);
  assert.doesNotMatch(nations, /activeLivePolityPointLabelData|activeLivePolityLineLabelData/);
  assert.doesNotMatch(nations, /setLabelViewport|labelViewport/);
  assert.match(nations, /mapInstance\.on\("zoomend", updateZoom\)/);
  assert.doesNotMatch(nations, /mapInstance\.on\("moveend", update\)/);
});

test("R5.4.6 renderer confirmation runs only after idle and never during movement", () => {
  assert.match(nations, /mapInstance\.on\("idle", confirmRenderedCurves\)/);
  assert.match(nations, /mapInstance\.on\("movestart", clearRenderConfirmation\)/);
  assert.match(nations, /mapInstance\.isMoving\?\.\(\) \|\| mapInstance\.isZooming\?\.\(\)/);
  assert.doesNotMatch(nations, /mapInstance\.on\("moveend", confirmRenderedCurves\)/);
  assert.doesNotMatch(nations, /mapInstance\.on\("zoom", confirmRenderedCurves\)/);
});

test("R5.2 uses one ESRI raster source across the zoom range", () => {
  assert.doesNotMatch(world, /satellite-lowres/);
  assert.match(world, /id: "satellite-layer"/);
  assert.doesNotMatch(world, /id: "satellite-layer"[\s\S]{0,100}minzoom:\s*3/);
  assert.match(world, /"raster-fade-duration": 0/);
});

test("R5.2 drag profiler records source/style/GPU churn", () => {
  assert.match(world, /sourceEventsDuringMove/);
  assert.match(world, /styleEventsDuringMove/);
  assert.match(world, /webglLossesDuringMove/);
});

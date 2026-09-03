import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.6 has no theoretical owner pre-hide list", () => {
  assert.doesNotMatch(nations, /const expectedWarpOwnerList|const pointNotWarpedFilter/);
  assert.match(nations, /renderConfirmedCurveOwners/);
});

test("R5.4.6 movement clears render confirmation so point fallback becomes guaranteed again", () => {
  assert.match(nations, /const clearRenderConfirmation = \(\) => \{/);
  assert.match(nations, /setRenderConfirmedCurveOwners\(\(current\) => \(current\.length \? \[\] : current\)\)/);
  assert.match(nations, /mapInstance\.on\("movestart", clearRenderConfirmation\)/);
});

test("R5.4.6 renderer confirmation refuses to inspect while moving or zooming", () => {
  const start = nations.indexOf("const confirmRenderedCurves");
  const end = nations.indexOf('mapInstance.on("movestart"', start);
  const handoff = nations.slice(start, end);

  assert.match(handoff, /mapInstance\.isMoving\?\.\(\) \|\| mapInstance\.isZooming\?\.\(\)/);
  assert.match(handoff, /queryRenderedFeatures\(\{ layers: curveLayers \}\)/);
});

test("R5.4.6 curve confirmation is attached to idle, not the hot camera loop", () => {
  assert.match(nations, /mapInstance\.on\("idle", confirmRenderedCurves\)/);
  assert.doesNotMatch(nations, /mapInstance\.on\("move", confirmRenderedCurves\)/);
  assert.doesNotMatch(nations, /mapInstance\.on\("zoom", confirmRenderedCurves\)/);
});

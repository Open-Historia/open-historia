import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.6 curve-capable polities never enter the collision-managed point fallback", () => {
  const managedStart = nations.indexOf("const livePointManagedFilter");
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const managed = nations.slice(managedStart, overlapStart);

  assert.match(managed, /\["==", \["coalesce", \["get", "curveBand"\], "none"\], "none"\]/);
  assert.doesNotMatch(managed, /\["!=", \["coalesce", \["get", "curveBand"\], "none"\], "none"\]/);
});

test("R5.4.6 curve-capable point fallback stays guaranteed until the renderer confirms its owner", () => {
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const overlap = nations.slice(overlapStart, lineStart);

  assert.match(overlap, /\["!=", \["coalesce", \["get", "curveBand"\], "none"\], "none"\]/);
  assert.match(overlap, /renderedCurveOwnersLiteral/);
  assert.match(overlap, /\["!", \["in", \["get", "owner"\], renderedCurveOwnersLiteral\]\]/);
});

test("R5.4.6 curved labels keep placement priority over point fallbacks", () => {
  const line = nations.indexOf('id="country-live-polity-line-label-source"');
  const point = nations.indexOf('id="country-live-polity-point-label-source"');
  assert.ok(line >= 0 && point >= 0 && line < point);
});

test("R5.4.6 renderer inspection is bounded to the two live curve layers", () => {
  const start = nations.indexOf("const confirmRenderedCurves");
  const end = nations.indexOf('mapInstance.on("movestart"', start);
  const handoff = nations.slice(start, end);

  assert.match(handoff, /"country-line-labels-live-world"/);
  assert.match(handoff, /"country-line-labels-live-detail"/);
  assert.match(handoff, /queryRenderedFeatures\(\{ layers: curveLayers \}\)/);
  assert.doesNotMatch(handoff, /\.setData\s*\(/);
});

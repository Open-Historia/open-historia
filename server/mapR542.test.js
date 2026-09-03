import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.2 world-band curves never pre-hide their point fallback", () => {
  assert.match(nations, /if \(props\.curveBand === "world"\) continue;/);
});

test("R5.4.2 world-band point fallback is collision-managed", () => {
  const managedStart = nations.indexOf("const livePointManagedFilter");
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const managed = nations.slice(managedStart, overlapStart);
  const overlap = nations.slice(overlapStart, lineStart);

  assert.match(managed, /\["==", \["coalesce", \["get", "curveBand"\], "none"\], "world"\]/);
  assert.match(overlap, /\["!=", \["coalesce", \["get", "curveBand"\], "none"\], "world"\]/);
});

test("R5.4.2 curved labels get collision priority over point fallbacks", () => {
  const line = nations.indexOf('id="country-live-polity-line-label-source"');
  const point = nations.indexOf('id="country-live-polity-point-label-source"');
  assert.ok(line >= 0 && point >= 0);
  assert.ok(line < point);
});

test("R5.4.2 label handoff block contains no rendered-feature scan", () => {
  const start = nations.indexOf("const expectedWarpOwnerList");
  const end = nations.indexOf("const activePointLabelData", start);
  const handoff = nations.slice(start, end);
  assert.doesNotMatch(handoff, /queryRenderedFeatures\s*\(/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.3 no curved polity is pre-hidden by theoretical warp eligibility", () => {
  assert.doesNotMatch(nations, /const expectedWarpOwnerList|const pointNotWarpedFilter/);
});

test("R5.4.3 every curve-capable polity uses managed point fallback", () => {
  const managedStart = nations.indexOf("const livePointManagedFilter");
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const managed = nations.slice(managedStart, overlapStart);
  const overlap = nations.slice(overlapStart, lineStart);

  assert.match(managed, /\["!=", \["coalesce", \["get", "curveBand"\], "none"\], "none"\]/);
  assert.match(overlap, /\["==", \["coalesce", \["get", "curveBand"\], "none"\], "none"\]/);
});

test("R5.4.3 curved source keeps placement priority over point fallback", () => {
  const line = nations.indexOf('id="country-live-polity-line-label-source"');
  const point = nations.indexOf('id="country-live-polity-point-label-source"');
  assert.ok(line >= 0 && point >= 0 && line < point);
});

test("R5.4.3 hot label handoff contains no rendered-feature function call", () => {
  const start = nations.indexOf("const rawLivePolityPointLabelData");
  const end = nations.indexOf("const activePointLabelData", start);
  assert.doesNotMatch(nations.slice(start, end), /\.\s*queryRenderedFeatures\s*\(/);
});

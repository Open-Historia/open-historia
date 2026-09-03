import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.4 major/regional curve labels keep guaranteed point presentation through handoff", () => {
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const overlap = nations.slice(overlapStart, lineStart);

  assert.match(overlap, /\["continental", "major", "regional"\]/);
  assert.match(overlap, /\["\+", \["coalesce", \["get", "curveMinZoom"\], 99\], 0\.45\]/);
});

test("R5.4.4 non-world curves wait for the same 0.45 zoom safety buffer", () => {
  const start = nations.indexOf("const liveDetailLineFilter");
  const end = nations.indexOf("const activePointLabelData", start);
  const detail = nations.slice(start, end);

  assert.match(detail, /\["\+", \["coalesce", \["get", "curveMinZoom"\], 99\], 0\.45\]/);
});

test("R5.4.4 point and curve handoff are mutually separated, not permanently duplicated", () => {
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const overlap = nations.slice(overlapStart, lineStart);
  const detailStart = nations.indexOf("const liveDetailLineFilter");
  const detailEnd = nations.indexOf("const activePointLabelData", detailStart);
  const detail = nations.slice(detailStart, detailEnd);

  assert.match(overlap, /"<"/);
  assert.match(detail, /"<="/);
});

test("R5.4.4 does not restore rendered-feature scans or source mutation", () => {
  const start = nations.indexOf("const rawLivePolityPointLabelData");
  const end = nations.indexOf("const activePointLabelData", start);
  const hot = nations.slice(start, end);
  assert.doesNotMatch(hot, /\.\s*queryRenderedFeatures\s*\(/);
  assert.doesNotMatch(hot, /\.setData\s*\(/);
});

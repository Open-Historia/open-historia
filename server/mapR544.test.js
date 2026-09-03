import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

test("R5.4.6 point fallback no longer uses the theoretical curveMinZoom handoff", () => {
  const overlapStart = nations.indexOf("const livePointOverlapFilter");
  const lineStart = nations.indexOf("const liveWorldLineFilter");
  const overlap = nations.slice(overlapStart, lineStart);

  assert.match(overlap, /renderedCurveOwnersLiteral/);
  assert.doesNotMatch(overlap, /curveMinZoom/);
  assert.doesNotMatch(overlap, /0\.45/);
});

test("R5.4.6 detail curves may keep their placement buffer without hiding the point fallback", () => {
  const start = nations.indexOf("const liveDetailLineFilter");
  const end = nations.indexOf("const activePointLabelData", start);
  const detail = nations.slice(start, end);

  assert.match(detail, /\["\+", \["coalesce", \["get", "curveMinZoom"\], 99\], 0\.45\]/);
});

test("R5.4.6 guaranteed point layer cannot lose the fallback to label collision", () => {
  const start = nations.indexOf('id="country-labels-live-overlap"');
  const end = nations.indexOf("paint={integratedLabelLayerPaint}", start);
  const layer = nations.slice(start, end);

  assert.match(layer, /"text-allow-overlap": true/);
  assert.match(layer, /"text-ignore-placement": true/);
});

test("R5.4.6 renderer-confirmed handoff never mutates label GeoJSON", () => {
  const start = nations.indexOf("const clearRenderConfirmation");
  const end = nations.indexOf("// Development-time proof", start);
  const handoff = nations.slice(start, end);

  assert.match(handoff, /queryRenderedFeatures\(\{ layers: curveLayers \}\)/);
  assert.doesNotMatch(handoff, /\.setData\s*\(/);
});

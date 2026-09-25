import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { labelRasterCanvas, releaseLabelRasterCanvas } from "./polityTextRasterLifetime.js";

const fakeCanvas = (width = 1500, height = 180) => ({ width, height });

test("a label's canvas is let go after its upload and drawn again when needed", () => {
  const drawn = [];
  const rasterize = (options) => {
    drawn.push(options.text);
    return { canvas: fakeCanvas() };
  };
  const first = fakeCanvas();
  const entry = {
    raster: { canvas: first, width: 1500, height: 180, aspectRatio: 1500 / 180 },
    rasterOptions: { text: "RUSSIAN FEDERATION", fontSizePx: 128 },
  };

  assert.equal(labelRasterCanvas(entry, rasterize), first, "the canvas in hand is used as is");
  assert.deepEqual(drawn, []);

  assert.equal(releaseLabelRasterCanvas(entry), true);
  assert.equal(entry.raster.canvas, null);
  assert.deepEqual([first.width, first.height], [0, 0], "its pixels are freed at once");
  // Everything the ribbon was built from stays.
  assert.equal(entry.raster.aspectRatio, 1500 / 180);

  const again = labelRasterCanvas(entry, rasterize);
  assert.deepEqual(drawn, ["RUSSIAN FEDERATION"]);
  assert.equal(entry.raster.canvas, again);
  assert.equal(labelRasterCanvas(entry, rasterize), again, "drawn once, not per frame");
  assert.deepEqual(drawn, ["RUSSIAN FEDERATION"]);
});

test("a label with no recipe to draw it again keeps its canvas", () => {
  const canvas = fakeCanvas();
  const entry = { raster: { canvas } };
  assert.equal(releaseLabelRasterCanvas(entry), false);
  assert.equal(entry.raster.canvas, canvas);
  assert.equal(canvas.width, 1500);
  assert.equal(labelRasterCanvas({ raster: { canvas: null } }), null);
  assert.equal(labelRasterCanvas({}), null);
  assert.equal(releaseLabelRasterCanvas(null), false);
});

test("the layer uploads through the lifetime helpers, and every prepared label keeps its recipe", () => {
  const layer = fs.readFileSync(new URL("./polityTextCustomLayer.js", import.meta.url), "utf8");
  assert.match(layer, /const canvas = labelRasterCanvas\(entry\);/);
  assert.match(layer, /texImage2D\(gl\.TEXTURE_2D, 0, gl\.RGBA, gl\.RGBA, gl\.UNSIGNED_BYTE, canvas\)/);
  assert.match(layer, /entry\.texture = texture;\s+\/\/[^\n]*\n[^\n]*\n\s+releaseLabelRasterCanvas\(entry\);/);
  assert.match(layer, /rasterOptions,\s+samples,\s+hasTerritorialEnvelope: true/);
  assert.match(layer, /rasterOptions,\s+samples,\s+hasTerritorialEnvelope: false/);
});

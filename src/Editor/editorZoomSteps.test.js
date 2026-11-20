import test from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_ZOOM_STEP_BREAK,
  EDITOR_COARSE_ZOOM_STEP,
  EDITOR_FINE_ZOOM_STEP,
  EDITOR_WHEEL_UNITS_PER_NOTCH,
  editorZoomStep,
  nextEditorZoom,
} from "./editorZoomSteps.js";

test("progressive steps retain fast global navigation and become gentler at zoom 7", () => {
  assert.equal(EDITOR_ZOOM_STEP_BREAK, 7);
  assert.equal(EDITOR_COARSE_ZOOM_STEP, 1);
  assert.equal(EDITOR_FINE_ZOOM_STEP, 0.7);
  assert.equal(EDITOR_WHEEL_UNITS_PER_NOTCH, 100);
  assert.equal(editorZoomStep(2.2), 1);
  assert.equal(editorZoomStep(6.9), 1);
  assert.equal(editorZoomStep(7), 0.7);
  assert.equal(editorZoomStep(7.1), 0.7);
  assert.equal(editorZoomStep(24), 0.7);
  const closeUpScale = 2 ** EDITOR_FINE_ZOOM_STEP;
  assert.ok(closeUpScale > 1.6 && closeUpScale < 1.65, "one fine step should scale by about 1.62, not 2x");
});

test("zoom step up/down is reversible including the threshold crossing", () => {
  for (const zoom of [1, 2.2, 6.9, 7, 7.1, 7.8, 9.25, 19.7, 22]) {
    const up = nextEditorZoom(zoom, 1);
    const back = nextEditorZoom(up, -1);
    assert.ok(Math.abs(back - zoom) < 2e-6, `roundtrip up/down at zoom ${zoom}: ${up} -> ${back}`);
  }
  for (const zoom of [2.2, 6.9, 7, 7.1, 7.8, 9.25, 19.7, 23.2, 24]) {
    const down = nextEditorZoom(zoom, -1);
    const back = nextEditorZoom(down, 1);
    if (zoom > 23.3) {
      assert.ok(back <= 24);
    } else {
      assert.ok(Math.abs(back - zoom) < 2e-6, `roundtrip down/up at zoom ${zoom}`);
    }
  }
  assert.equal(nextEditorZoom(24, 1), 24);
  assert.equal(nextEditorZoom(1, -1), 1);
  assert.equal(nextEditorZoom(7.1, 0), 7.1);
  assert.equal(nextEditorZoom(NaN, 1), NaN);
});

test("close-up navigation reaches maximum in a practical number of steps", () => {
  let zoom = 7;
  let steps = 0;
  while (zoom < 24 && steps < 40) {
    const next = nextEditorZoom(zoom, 1);
    assert.ok(next > zoom, "zoom must always make forward progress below 24");
    zoom = next;
    steps += 1;
  }
  assert.equal(zoom, 24);
  assert.equal(steps, 25, "0.7 steps from 7 to 24 should take 25 clicks/notches");
});

test("both OL +/- and wheel use the native progressive step contract", async () => {
  const { readFileSync } = await import("node:fs");
  const map = readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  const control = readFileSync(new URL("./editorZoomControl.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(map, /defaultControls\(\{ rotate: false, zoom: false \}\)\.extend\(\[zoomControl\.control\]\)/);
  assert.match(map, /wheelZoom\.deltaPerZoom_ = EDITOR_WHEEL_UNITS_PER_NOTCH \/ editorZoomStep\(level\)/);
  assert.match(map, /zoomControl\.update\(level\)/);
  assert.match(map, /zoomControl\.dispose\(\)/);
  assert.match(control, /nextEditorZoom\(level, direction\)/);
  assert.match(control, /element\.append\(zoomIn, readout, zoomOut\)/);
  assert.match(control, /"aria-label", "Editor zoom level"/);
  assert.match(styles, /\.ol-zoom\.oh-editor-zoom-control/);
  assert.match(styles, /\.oh-editor-zoom-value/);
  assert.match(styles, /\.oh-editor-zoom-caption/);
});

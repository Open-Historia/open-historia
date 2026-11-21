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

test("fine zoom starts at Z6 and is 10% smaller than the former 0.7-level increment", () => {
  assert.equal(EDITOR_ZOOM_STEP_BREAK, 6);
  assert.equal(EDITOR_COARSE_ZOOM_STEP, 1);
  assert.equal(EDITOR_FINE_ZOOM_STEP, 0.63);
  assert.equal(EDITOR_WHEEL_UNITS_PER_NOTCH, 100);
  assert.equal(editorZoomStep(2.2), 1);
  assert.equal(editorZoomStep(5.9), 1);
  assert.equal(editorZoomStep(6), 0.63);
  assert.equal(editorZoomStep(6.1), 0.63);
  assert.equal(editorZoomStep(7), 0.63);
  assert.equal(editorZoomStep(24), 0.63);
  assert.equal(nextEditorZoom(5, 1), 6, "coarse zoom should still reach Z6 exactly");
  assert.equal(nextEditorZoom(6, 1), 6.63, "first fine step begins at Z6");
  assert.equal(nextEditorZoom(6.63, -1), 6);
  assert.equal(nextEditorZoom(5.5, 1), 6.315, "a threshold-crossing click uses the same continuous step map");
  assert.equal(nextEditorZoom(6.315, -1), 5.5);
  const closeUpScale = 2 ** EDITOR_FINE_ZOOM_STEP;
  assert.ok(closeUpScale > 1.54 && closeUpScale < 1.56, "one fine step scales by about 1.55, down from 1.62");
});

test("zoom step up/down is reversible including the threshold crossing", () => {
  for (const zoom of [1, 2.2, 5.7, 5.9, 6, 6.1, 6.9, 7, 7.1, 7.8, 9.25, 19.7, 22]) {
    const up = nextEditorZoom(zoom, 1);
    const back = nextEditorZoom(up, -1);
    assert.ok(Math.abs(back - zoom) < 2e-6, `roundtrip up/down at zoom ${zoom}: ${up} -> ${back}`);
  }
  for (const zoom of [2.2, 5.7, 5.9, 6, 6.1, 6.9, 7, 7.1, 7.8, 9.25, 19.7, 23.2, 24]) {
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
  assert.equal(nextEditorZoom(6.1, 0), 6.1);
  assert.equal(nextEditorZoom(NaN, 1), NaN);
});

test("close-up navigation reaches maximum in a practical number of steps", () => {
  let zoom = 6;
  let steps = 0;
  while (zoom < 24 && steps < 40) {
    const next = nextEditorZoom(zoom, 1);
    assert.ok(next > zoom, "zoom must always make forward progress below 24");
    zoom = next;
    steps += 1;
  }
  assert.equal(zoom, 24);
  assert.equal(steps, 29, "0.63 steps from Z6 to Z24 should take 29 clicks/notches");
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
  assert.ok(control.includes("At zoom ${EDITOR_ZOOM_STEP_BREAK}"), "Tooltip threshold must derive from the canonical constant");
  assert.ok(control.includes("${EDITOR_FINE_ZOOM_STEP} zoom levels"), "Tooltip step must derive from the canonical constant");
  assert.match(styles, /\.ol-zoom\.oh-editor-zoom-control/);
  assert.match(styles, /\.oh-editor-zoom-value/);
  assert.match(styles, /\.oh-editor-zoom-caption/);
});


test("compact editor-only zoom controls on narrow screens retain buttons and the zoom value", async () => {
  const { readFileSync } = await import("node:fs");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const mobile = styles.slice(styles.indexOf("@media (max-width: 600px)"));
  assert.ok(mobile && mobile !== styles, "The editor's mobile zoom needs a narrow breakpoint");
  assert.match(mobile, /\.ol-zoom\.oh-editor-zoom-control\s*\{[^}]*width:\s*42px\s*!important/s);
  assert.match(mobile, /\.ol-zoom\.oh-editor-zoom-control button\s*\{[^}]*width:\s*36px\s*!important;[^}]*height:\s*32px\s*!important/s);
  assert.match(mobile, /\.ol-zoom\.oh-editor-zoom-control \.oh-editor-zoom-readout\s*\{[^}]*min-height:\s*18px/s);
  assert.match(mobile, /\.ol-zoom\.oh-editor-zoom-control \.oh-editor-zoom-caption\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.ol-zoom\.oh-editor-zoom-control\s*\{[^}]*width:\s*60px\s*!important/s, "Desktop size remains unchanged");
});

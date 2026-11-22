import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_LAYER_DEFS, overlayVisibilityPatch } from "./editorLayerVisibility.js";

test("layer manager exposes the exact seven native OpenLayers visibility keys", () => {
  assert.deepEqual(EDITOR_LAYER_DEFS.map(({ key }) => key), [
    "regions", "labels", "groups", "features", "units", "fortifications", "freezing",
  ]);
  assert.equal(new Set(EDITOR_LAYER_DEFS.map(({ key }) => key)).size, EDITOR_LAYER_DEFS.length);
  assert.ok(EDITOR_LAYER_DEFS.every((row) => row.label && row.description && row.group));
});

test("inspection preset keeps political regions visible but hides every optional overlay", () => {
  const patch = overlayVisibilityPatch("regions-only");
  assert.equal(patch.regions, true);
  assert.deepEqual(Object.entries(patch).filter(([, visible]) => visible).map(([key]) => key), ["regions"]);
});

test("show all restores each native editor layer without touching scenario state", () => {
  assert.ok(Object.values(overlayVisibilityPatch("show-all")).every(Boolean));
  assert.equal(overlayVisibilityPatch("unsupported"), null);
});

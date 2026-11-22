import test from "node:test";
import assert from "node:assert/strict";
import { streetReferenceActive } from "./editorStreetReference.js";

test("street reference is opt-in, online, and independent of persisted basemap IDs", () => {
  assert.equal(streetReferenceActive({ enabled: false, online: true }), false);
  assert.equal(streetReferenceActive({ enabled: true, online: false }), false);
  assert.equal(streetReferenceActive({ enabled: true, online: true }), true);
});

test("custom authored background always takes precedence over temporary modern streets", () => {
  for (const kind of ["image", "vector", "raster", "plain"]) {
    assert.equal(streetReferenceActive({ enabled: true, online: true, background: { kind } }), false);
  }
  assert.equal(streetReferenceActive({ enabled: true, online: true, background: null }), true);
});

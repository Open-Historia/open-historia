/*! Open Historia — build label tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/buildLabel.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { buildLabel, desktopBuildLabel } from "./buildLabel.js";

test("the Android app names its track and build, not 'web'", () => {
  // The Android build sets VITE_OH_WEB as well: the native check must come first.
  assert.equal(buildLabel({ VITE_OH_WEB: true, VITE_OH_NATIVE: true, VITE_APP_TRACK: "beta", VITE_APP_BUILD: "5" }), "android beta #5");
  assert.equal(buildLabel({ VITE_OH_WEB: true, VITE_OH_NATIVE: true, VITE_APP_BUILD: "15" }), "android stable #15");
  assert.equal(buildLabel({ VITE_OH_WEB: true, VITE_OH_NATIVE: true }), "android stable", "an unstamped local build");
});

test("the website names its deploy", () => {
  assert.equal(buildLabel({ VITE_OH_WEB: true, VITE_OH_NATIVE: false, VITE_WEB_BUILD: "1790000000000" }), "web 1790000000000");
  assert.equal(buildLabel({ VITE_OH_WEB: true, VITE_WEB_BUILD: "" }), "web");
});

test("dev and the desktop/local bundle", () => {
  assert.equal(buildLabel({ DEV: true }), "dev");
  assert.equal(buildLabel({}), "desktop/local");
});

test("the desktop app's stamp comes from its server's reply", () => {
  assert.equal(desktopBuildLabel("18123456789"), "desktop #18123456789");
  assert.equal(desktopBuildLabel(""), "", "the zip's local server has no stamp");
  assert.equal(desktopBuildLabel(undefined), "");
});

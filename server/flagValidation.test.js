/*! Open Historia — flag validation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/flagValidation.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { MAX_FLAG_BYTES, validateFlagDataUrl } from "./flagValidation.js";

const png = (base64 = "iVBORw0KGgo=") => `data:image/png;base64,${base64}`;

test("a small image of a known type is a flag", () => {
  for (const type of ["png", "jpeg", "jpg", "webp", "gif", "svg+xml", "PNG"]) {
    assert.doesNotThrow(() => validateFlagDataUrl(`data:image/${type};base64,AAAA`), type);
  }
});

test("anything that is not a base64 image data URL is refused", () => {
  assert.throws(() => validateFlagDataUrl(""), /base64 image data URL/);
  assert.throws(() => validateFlagDataUrl("data:image/png,rawbytes"), /base64 image data URL/);
  assert.throws(() => validateFlagDataUrl("data:image/png;base64,not base64!"), /base64 image data URL/);
  assert.throws(() => validateFlagDataUrl("data:text/html;base64,AAAA"), /base64 image data URL/);
});

test("an unknown image type is refused by name", () => {
  assert.throws(() => validateFlagDataUrl("data:image/bmp;base64,AAAA"), /Unsupported flag image type: bmp/);
});

test("the size cap is on the decoded bytes, at 2 MB", () => {
  const atCap = "A".repeat((MAX_FLAG_BYTES / 3) * 4);
  assert.doesNotThrow(() => validateFlagDataUrl(png(atCap)));
  assert.throws(() => validateFlagDataUrl(png(`${atCap}AAAA`)), /That flag is too large \(2048 KB; the limit is 2048 KB\)/);
});

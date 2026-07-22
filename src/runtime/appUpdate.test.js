/*! Open Historia — update-check helper tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/appUpdate.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { toBuild, parseUpdateManifest, isUpdateAvailable } from "./appUpdate.js";

test("toBuild accepts positive integers (number or string)", () => {
  assert.equal(toBuild(5), 5);
  assert.equal(toBuild("42"), 42);
});
test("toBuild floors fractional values", () => {
  assert.equal(toBuild(7.9), 7);
});
test("toBuild rejects zero, negatives, NaN, null, undefined, junk", () => {
  for (const v of [0, -1, NaN, null, undefined, "", "abc", {}, []]) assert.equal(toBuild(v), null);
});

test("parseUpdateManifest normalizes a full payload", () => {
  assert.deepEqual(
    parseUpdateManifest({ build: "12", apk: " https://x/a.apk ", notes: " hi " }),
    { build: 12, apk: "https://x/a.apk", notes: "hi" },
  );
});
test("parseUpdateManifest defaults apk/notes to empty strings", () => {
  assert.deepEqual(parseUpdateManifest({ build: 3 }), { build: 3, apk: "", notes: "" });
});
test("parseUpdateManifest returns null without a usable build", () => {
  for (const v of [null, undefined, "nope", 5, {}, { build: 0 }, { build: "x" }, { apk: "a" }]) {
    assert.equal(parseUpdateManifest(v), null);
  }
});
test("parseUpdateManifest ignores non-string apk/notes", () => {
  assert.deepEqual(parseUpdateManifest({ build: 1, apk: 9, notes: {} }), { build: 1, apk: "", notes: "" });
});

test("isUpdateAvailable true when latest build is strictly newer", () => {
  assert.equal(isUpdateAvailable(10, { build: 11 }), true);
});
test("isUpdateAvailable false when equal", () => {
  assert.equal(isUpdateAvailable(10, { build: 10 }), false);
});
test("isUpdateAvailable false when latest is older", () => {
  assert.equal(isUpdateAvailable(10, { build: 9 }), false);
});
test("isUpdateAvailable false when current build is unknown (dev/web/desktop)", () => {
  for (const c of [null, undefined, 0, NaN, "x"]) assert.equal(isUpdateAvailable(c, { build: 999 }), false);
});
test("isUpdateAvailable false when manifest is missing/invalid", () => {
  for (const m of [null, undefined, {}, { build: 0 }, "nope"]) assert.equal(isUpdateAvailable(5, m), false);
});
test("isUpdateAvailable accepts string build numbers on both sides", () => {
  assert.equal(isUpdateAvailable("10", { build: "11" }), true);
});
test("isUpdateAvailable never throws on hostile input", () => {
  assert.doesNotThrow(() => isUpdateAvailable({}, []));
  assert.doesNotThrow(() => isUpdateAvailable(Symbol.iterator, () => {}));
});

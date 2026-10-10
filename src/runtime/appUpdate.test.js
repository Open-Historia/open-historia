/*! Open Historia — update-check helper tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/appUpdate.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_UPDATE_SETTLED_STATES,
  LAUNCH_UPDATE_ATTEMPT_LIMIT,
  LAUNCH_UPDATE_WINDOW_MS,
  describeUpdateFailure,
  desktopUpdateProgressIsStale,
  desktopUpdateProgressMatchesBuild,
  isUpdateAvailable,
  isUpdateSettled,
  launchUpdateAttempts,
  parseUpdateManifest,
  recordLaunchUpdateAttempt,
  shouldUpdateAtLaunch,
  toBuild,
} from "./appUpdate.js";

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

// The banner polls for download progress only while the updater is unsettled, so a
// state wrongly called settled stops that poll for good and freezes the banner
// mid-update. These pin the classification rather than the wording.
test("isUpdateSettled is true only for states that never change again", () => {
  for (const state of APP_UPDATE_SETTLED_STATES) assert.equal(isUpdateSettled(state), true);
});
test("isUpdateSettled treats every transient updater state as still running", () => {
  for (const state of ["idle", "checking", "available", "downloading"]) {
    assert.equal(isUpdateSettled(state), false, `${state} must keep the progress poll alive`);
  }
});
// The regression this was written for: "available" is what the updater reports
// between finding an update and its first download-progress event. Classifying it as
// settled stopped the poll there and left the banner stuck while the download ran on.
test("isUpdateSettled keeps polling through 'available'", () => {
  assert.equal(isUpdateSettled("available"), false);
});
test("isUpdateSettled treats an unknown or absent state as still running", () => {
  for (const state of [undefined, null, "", "something-new", 0, {}]) {
    assert.equal(isUpdateSettled(state), false);
  }
});
test("APP_UPDATE_SETTLED_STATES holds exactly the finished states", () => {
  assert.deepEqual([...APP_UPDATE_SETTLED_STATES].sort(), ["error", "none", "ready"]);
});

test("desktop updater progress belongs only to the release build it started for", () => {
  assert.equal(desktopUpdateProgressMatchesBuild("35868314676", "35868314676"), true);
  assert.equal(desktopUpdateProgressMatchesBuild("35868314676", "35900000000"), false);
  for (const [progressBuild, availableBuild] of [
    ["", "35900000000"],
    ["35868314676", ""],
    [null, "35900000000"],
    [undefined, undefined],
  ]) {
    assert.equal(desktopUpdateProgressMatchesBuild(progressBuild, availableBuild), false);
  }
});

test("a settled updater result becomes stale when a newer desktop build is published", () => {
  for (const state of APP_UPDATE_SETTLED_STATES) {
    assert.equal(desktopUpdateProgressIsStale("old-build", "new-build", state), true, state);
  }
  for (const state of ["idle", "checking", "available", "downloading"]) {
    assert.equal(
      desktopUpdateProgressIsStale("old-build", "new-build", state),
      false,
      `${state} must finish before the old attempt is discarded`,
    );
  }
  assert.equal(desktopUpdateProgressIsStale("same-build", "same-build", "ready"), false);
});

test("describeUpdateFailure keeps the updater's reason and reads as one sentence", () => {
  assert.equal(
    describeUpdateFailure("No newer version in the update feed."),
    "The app could not update itself: No newer version in the update feed.",
  );
  assert.equal(
    describeUpdateFailure("  net::ERR_INTERNET_DISCONNECTED \n"),
    "The app could not update itself: net::ERR_INTERNET_DISCONNECTED.",
  );
});
test("describeUpdateFailure copes with no reason at all", () => {
  for (const v of ["", "   ", ".", null, undefined]) assert.equal(describeUpdateFailure(v), "The app could not update itself.");
});
test("describeUpdateFailure clips a stack-trace-sized reason", () => {
  const text = describeUpdateFailure("x".repeat(400));
  assert.ok(text.length < 200, text.length);
  assert.ok(text.endsWith("…."), text.slice(-5));
});

// Opening the game updates it; the banner is for an update found while it is open.
test("the first check after the page opens updates the game", () => {
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 900, build: "b2", stored: null }), true);
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 900, build: 16, stored: undefined }), true);
});
test("a later check, or a first one that came back late, shows the banner instead", () => {
  assert.equal(shouldUpdateAtLaunch({ firstCheck: false, elapsedMs: 900, build: "b2", stored: null }), false);
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: LAUNCH_UPDATE_WINDOW_MS + 1, build: "b2", stored: null }), false);
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: NaN, build: "b2", stored: null }), false);
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 900, build: "", stored: null }), false);
});
test("a build that did not take at launch twice is left to the banner", () => {
  let stored = null;
  for (let attempt = 0; attempt < LAUNCH_UPDATE_ATTEMPT_LIMIT; attempt += 1) {
    assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 10, build: 16, stored }), true);
    stored = recordLaunchUpdateAttempt(stored, 16);
  }
  assert.equal(launchUpdateAttempts(stored, 16), LAUNCH_UPDATE_ATTEMPT_LIMIT);
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 10, build: 16, stored }), false);
  // The number and the string name the same build.
  assert.equal(launchUpdateAttempts(stored, "16"), LAUNCH_UPDATE_ATTEMPT_LIMIT);
  // A newer build gets its own tries.
  assert.equal(shouldUpdateAtLaunch({ firstCheck: true, elapsedMs: 10, build: 17, stored }), true);
  assert.equal(recordLaunchUpdateAttempt(stored, 17), JSON.stringify({ build: "17", attempts: 1 }));
});
test("an unreadable record counts as no attempts", () => {
  for (const stored of [null, undefined, "", "{", "null", "[]", '{"build":"16","attempts":"x"}', '{"build":"16","attempts":-3}']) {
    assert.equal(launchUpdateAttempts(stored, 16), 0, String(stored));
  }
});

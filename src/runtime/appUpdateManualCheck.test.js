/*! Open Historia — manual update-check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/appUpdateManualCheck.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  APP_UPDATE_MANUAL_CHECK_EVENT,
  APP_UPDATE_MANUAL_CHECK_RESULT_EVENT,
  appUpdateCheckDescription,
} from "./appUpdateManualCheck.js";

test("manual update-check events are stable and distinct", () => {
  assert.equal(APP_UPDATE_MANUAL_CHECK_EVENT, "oh:app-update-check-now");
  assert.equal(APP_UPDATE_MANUAL_CHECK_RESULT_EVENT, "oh:app-update-check-result");
  assert.notEqual(APP_UPDATE_MANUAL_CHECK_EVENT, APP_UPDATE_MANUAL_CHECK_RESULT_EVENT);
});

test("manual update-check descriptions cover every player-visible result", () => {
  assert.match(appUpdateCheckDescription({ status: "checking" }), /Checking/);
  assert.match(appUpdateCheckDescription({ status: "available" }), /Update available/);
  assert.match(appUpdateCheckDescription({ status: "current" }), /up to date/);
  assert.match(appUpdateCheckDescription({ status: "unsupported" }), /does not support/);
  assert.match(appUpdateCheckDescription({ status: "error" }), /Could not check/);
});

test("Settings asks the banner to check instead of duplicating updater fetches", () => {
  const settings = fs.readFileSync(new URL("../Game/GameUI/settings.jsx", import.meta.url), "utf8");
  assert.match(settings, /requestAppUpdateCheck\(\)/);
  assert.match(settings, /APP_UPDATE_MANUAL_CHECK_RESULT_EVENT/);
  assert.match(settings, /Check for updates/);
  assert.doesNotMatch(settings, /api\/app-update/);
});

test("the banner owns manual checks and routes them through the normal probes", () => {
  const banner = fs.readFileSync(new URL("./AppUpdateBanner.jsx", import.meta.url), "utf8");
  assert.match(banner, /APP_UPDATE_MANUAL_CHECK_EVENT/);
  assert.match(banner, /probe\(\{ manual: manualCheckToken > 0 \}\)/);
  assert.match(banner, /check\(\{ manual: manualCheckToken > 0 && \(isApp \|\| isWeb\) \}\)/);
  assert.match(banner, /publishAppUpdateCheckResult\(\{ status: "available"/);
});

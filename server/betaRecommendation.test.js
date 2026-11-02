/*! Open Historia — the stable app no longer asks the player to get the beta: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/betaRecommendation.test.js
//
// The stable app asked, after a first install and after each update, "Do you
// want to download the beta version for the best experience?" (asked for
// 2026-10-10). "make it so when beta is merged to main this popup is removed
// from the stable app" (the owner, 2026-11-02): the dialog is gone here, so the
// merge into main takes it out of the stable app. The update window's own
// Download the beta button stays.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("no dialog asks the player to download the beta when the game opens", () => {
  assert.equal(existsSync(new URL("../electron/betaRecommendation.cjs", import.meta.url)), false);
  const main = read("../electron/main.cjs");
  assert.doesNotMatch(main, /betaRecommendation/);
  assert.doesNotMatch(main, /recommendBeta/);
  assert.doesNotMatch(main, /beta-recommendation\.json/);
  assert.doesNotMatch(main, /download the beta version for the best experience/);
});

test("the update window still offers the beta's download, opened in the player's browser", () => {
  const main = read("../electron/main.cjs");
  assert.match(main, /ipcMain\.handle\("setup:open-beta", \(\) => shell\.openExternal\(BETA_DOWNLOAD_URL\)\)/);
  const page = read("../electron/setup.html");
  assert.match(page, /<button type="button" class="recommended" id="getBeta">Download the beta<\/button>/);
});

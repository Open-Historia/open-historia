/*! Open Historia — library landing-page UX architecture © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/libraryLandingUx.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./libraryBar.jsx", import.meta.url), "utf8");

test("desktop library chrome stays grouped and uses named icon actions", () => {
  assert.match(source, /const APP_SHELL_MAX_WIDTH = "3000px"/);
  assert.doesNotMatch(source, /const APP_SHELL_MAX_WIDTH = "1760px"/);
  for (const kind of ["settings", "refresh", "import"]) {
    assert.match(source, new RegExp(`case "${kind}":`));
  }
  assert.match(source, /<ButtonIcon kind="settings" \/> Settings/);
  assert.match(source, /icon: "refresh", label: "Refresh"/);
  assert.match(source, /icon: "import", label: "Import Game"/);
  assert.match(source, /icon: "import", label: "Import Scenario"/);
  assert.doesNotMatch(source, /Import game/);
});

test("library landing uses one meaningful browse collection instead of duplicate sort shelves", () => {
  assert.match(source, /const MenuRow = \(\{ children, description, emptyText, icon, title \}\) =>/);
  assert.match(source, /const LibraryCollection = \(\{ children, controls, description, emptyText, title \}\) =>/);
  assert.match(source, /const LIBRARY_GRID_TEMPLATE = "repeat\(auto-fill, minmax\(min\(100%, 16\.5rem\), 1fr\)\)"/);
  assert.match(source, /gridTemplateColumns: LIBRARY_GRID_TEMPLATE/);
  assert.doesNotMatch(source, /LIBRARY_GRID_MAX_WIDTH/);
  assert.ok((source.match(/<section style=\{\{ marginBottom: isMobile \? "1\.75rem"/g) || []).length >= 2);
  assert.match(source, /lastPlayedGames\.slice\(0, isMobile \? 5 : 6\)/);
  assert.match(source, /title="Continue Playing"/);
  assert.match(source, /title="All Games"/);
  assert.match(source, /title="Recently Used"/);
  assert.match(source, /title="Scenario Library"/);
  assert.doesNotMatch(source, /title="Most Played"/);
  assert.doesNotMatch(source, /title="Last Updated"/);
});

test("games and scenarios expose search, filters and in-place sorting", () => {
  assert.match(source, /aria-label="Search games"/);
  assert.match(source, /\[['"]active['"], ['"]Active['"]\]/);
  assert.match(source, /<option value="turns">Most turns<\/option>/);
  assert.match(source, /aria-label="Search scenarios"/);
  assert.match(source, /\[['"]community['"], ['"]Community['"]\]/);
  assert.match(source, /<option value="updated">Recently updated<\/option>/);
});


test("scenario cards deliberately strengthen contrast behind authored text", () => {
  assert.match(source, /const SCENARIO_CARD_TEXT_SHADOW = "0 1px 2px rgba\(0,0,0,0\.96\), 0 6px 18px rgba\(0,0,0,0\.82\), 0 16px 34px rgba\(0,0,0,0\.64\)"/);
  assert.match(source, /rgba\(4,6,12,0\.46\) 30%/);
  assert.match(source, /rgba\(5,8,14,0\.86\) 72%/);
  assert.match(source, /color: "rgba\(248,248,250,0\.96\)"/);
  assert.match(source, /textShadow: SCENARIO_CARD_TEXT_SHADOW/);
});

test("game and scenario actions use the same compact icon vocabulary", () => {
  for (const kind of ["play", "archive", "edit", "clone", "update", "menu"]) {
    assert.match(source, new RegExp(`case "${kind}":`));
  }
  assert.match(source, /<ButtonIcon kind="archive" \/> \{game\.archived \? "Unarchive" : "Archive"\}/);
  assert.match(source, /<ButtonIcon kind="edit" \/> Edit/);
  assert.match(source, /<ButtonIcon kind="clone" \/> Clone Scenario/);
});

test("the UI refresh intentionally leaves the decorative page background for later", () => {
  assert.doesNotMatch(source, /midnight_compass_world_map|landing.*background.*url|world_map\.png/i);
});

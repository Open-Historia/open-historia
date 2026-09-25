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

test("library shelves use responsive desktop grids with section descriptions and dividers", () => {
  assert.match(source, /const MenuRow = \(\{ children, description, emptyText, icon, title \}\) =>/);
  assert.match(source, /gridTemplateColumns: "repeat\(auto-fill, minmax\(min\(100%, 18\.75rem\), 20rem\)\)"/);
  assert.match(source, /justifyContent: "start"/);
  assert.match(source, /linear-gradient\(90deg, rgba\(255,255,255,0\.12\), rgba\(255,255,255,0\.02\)\)/);
  assert.match(source, /description="Continue where you left off\."/);
  assert.match(source, /description="Your most active games\."/);
  assert.match(source, /description="Your most active scenarios\."/);
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

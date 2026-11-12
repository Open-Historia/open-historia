/*! Open Historia — tests of the switch on the reading a country gets when its pane is opened © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/statsAssessOnOpen.test.js
//
// stats.jsx is JSX and cannot be loaded here, so the wiring is read as text; the
// setting itself is exercised through mapSettings.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "../../runtime/mapSettings.js";

const stats = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("./settings.jsx", import.meta.url), "utf8");

const withStore = (stored, work) => {
  const before = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => (key in stored ? stored[key] : null) };
  try { return work(); } finally {
    if (before === undefined) delete globalThis.localStorage; else globalThis.localStorage = before;
  }
};

test("the reading is on until the player turns it off", () => {
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.assessOnOpen), true, "no store");
  assert.equal(withStore({}, () => getMapSettingDefaultOn(MAP_SETTING_KEYS.assessOnOpen)), true, "nothing stored");
  assert.equal(withStore({ [MAP_SETTING_KEYS.assessOnOpen]: "1" }, () => getMapSettingDefaultOn(MAP_SETTING_KEYS.assessOnOpen)), true);
  assert.equal(withStore({ [MAP_SETTING_KEYS.assessOnOpen]: "0" }, () => getMapSettingDefaultOn(MAP_SETTING_KEYS.assessOnOpen)), false);
});

test("the pane's background reading waits on the switch, and the sheet a tab shows does not", () => {
  // Politics and Diplomacy: the background reading, only with the switch on.
  assert.match(stats, /if \(cancelled \|\| !assessOnOpen \|\| generatingRef\.current\?\.code === targetCountry\) return;\s+void ensureCountryAssessed\(targetCountry, \{ reason: "stats pane" \}\);/);
  // The effect runs again when the switch moves.
  assert.match(stats, /\[active, targetCountry, loadSheet, statSheetDefinitionReady, statsView, assessOnOpen\]/);
  // Economy shows the sheet: opening it is asking, whatever the switch says.
  const economy = stats.slice(stats.indexOf('if (statsView === "economy") {\r\n            loadSheet()') >= 0 ? stats.indexOf('if (statsView === "economy") {\r\n            loadSheet()') : stats.indexOf('if (statsView === "economy") {\n            loadSheet()'));
  assert.ok(economy.length > 0 && economy.length < stats.length, "the Economy branch was found");
  assert.equal(/assessOnOpen/.test(economy.slice(0, economy.indexOf("} else if"))), false);
  // It is read as a default-on setting: an absent key must not read as off.
  assert.match(stats, /const assessOnOpen = useMapSettingDefaultOn\(MAP_SETTING_KEYS\.assessOnOpen\);/);
});

test("Settings offers the switch through the default-on hook", () => {
  assert.match(settings, /const assessOnOpenOn = useMapSettingDefaultOn\(MAP_SETTING_KEYS\.assessOnOpen\);/);
  assert.match(settings, /label="Assess a country when I open it"/);
});

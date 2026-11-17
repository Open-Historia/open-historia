/*! Open Historia — the Scenario Editor's war settings: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/scenarioWarSettings.test.js
//
// "An explicit era setting per scenario", "a scenario default mobilisation
// time", the men a counter stands for, the share of people who can fight, and
// switches for the front engine's newer mechanics: set in the Fronts tab of
// the Scenario Editor and saved with its form as world.warSettings.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formDiffers } from "../../runtime/editorForm.js";
import { TECHNOLOGY_WEIGHT_MODERN, WAR_MECHANICS, warSettingsOf } from "../../runtime/warSettings.js";
import { compactWarSettings, warNumberText, withWarMechanic, withWarNumber, withWarSettings } from "./scenarioWarSettings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").replace(/\r\n/g, "\n");

test("a scenario that sets nothing holds nothing, and a switch turned off and on again is no change", () => {
  for (const nothing of [undefined, null, {}, { mechanics: { fatigue: true, air: true } }, { era: 9, manpowerShare: 0 }]) {
    assert.equal(compactWarSettings(nothing), null, JSON.stringify(nothing));
  }
  const off = withWarMechanic(null, "weather", false);
  assert.deepEqual(off, { mechanics: { weather: false }, era: null, menPerCounter: null, manpowerShare: null, technologyWeight: null, muster: null });
  assert.equal(withWarMechanic(off, "weather", true), null);
  assert.equal(formDiffers({ warSettings: withWarMechanic(off, "weather", true) }, { warSettings: compactWarSettings({}) }), false);
  // The same settings make the same form however they were written.
  const written = { muster: [[1, 90], [0.5, 21]], mechanics: { air: false, fatigue: true, walls: false }, era: 1 };
  assert.equal(JSON.stringify(compactWarSettings(written)), JSON.stringify(withWarMechanic(withWarMechanic(withWarSettings(null, { era: 1, muster: [[0.5, 21], [1, 90]] }), "walls", false), "air", false)));
});

test("the era, the men a counter stands for, the share of people who can fight and the mustering curve", () => {
  const era = withWarSettings(null, { era: 2 });
  assert.equal(era.era, 2);
  assert.equal(withWarSettings(era, { era: null }), null, "automatic again");
  assert.deepEqual(withWarNumber(null, "menPerCounter", "2000"), { settings: { mechanics: {}, era: null, menPerCounter: 2000, manpowerShare: null, technologyWeight: null, muster: null }, ok: true });
  assert.equal(withWarNumber(null, "menPerCounter", "2k").ok, false, "a letter for a thousand is no figure, in any language");
  assert.equal(withWarNumber(null, "menPerCounter", "5,000,000").settings.menPerCounter, 1000000, "held to the most");
  assert.equal(withWarNumber(null, "manpowerShare", "0.5").settings.manpowerShare, 1, "held to the least");
  assert.equal(withWarNumber(null, "manpowerShare", "60%").settings.manpowerShare, 60);
  assert.equal(withWarNumber(withWarNumber(null, "manpowerShare", "60").settings, "manpowerShare", "").settings, null, "an empty field is the default again");
  assert.deepEqual(withWarNumber(era, "menPerCounter", "lots"), { settings: era, ok: false });
  // The importance of technology (militaryPower.js): 0 is the men alone, and it is held to 0..10.
  assert.equal(withWarNumber(null, "technologyWeight", "0").settings.technologyWeight, 0);
  assert.equal(withWarNumber(null, "technologyWeight", "1,5").settings.technologyWeight, 1.5);
  assert.equal(withWarNumber(null, "technologyWeight", "40").settings.technologyWeight, 10, "held to the most");
  assert.equal(withWarNumber(null, "technologyWeight", "-2").ok, false);
  assert.equal(withWarNumber(withWarNumber(null, "technologyWeight", "2").settings, "technologyWeight", "").settings, null, "empty: the modern world's again");
  assert.equal(warNumberText({ technologyWeight: 2.5 }, "technologyWeight"), "2.5");
  assert.deepEqual([warNumberText({ menPerCounter: 12000 }, "menPerCounter"), warNumberText({ manpowerShare: 12.5 }, "manpowerShare"), warNumberText(null, "manpowerShare")], ["12,000", "12.5", ""]);
  const curve = withWarSettings(null, { muster: [[0.4, 10], [1, 120]] });
  assert.deepEqual(curve.muster, [[0.4, 10], [1, 120]]);
  assert.equal(withWarSettings(curve, { muster: null }), null);
});

test("what the form holds is what the game fights by", () => {
  const form = withWarMechanic(withWarNumber(withWarSettings(null, { era: 0, muster: [[0.5, 30], [1, 200]] }), "manpowerShare", "25").settings, "air", false);
  const world = { warSettings: JSON.parse(JSON.stringify(form)) };
  const settings = warSettingsOf(world);
  assert.deepEqual(settings.mechanics, Object.fromEntries(WAR_MECHANICS.map((key) => [key, key !== "air"])));
  assert.deepEqual([settings.era, settings.manpowerShare, settings.muster], [0, 25, [[0.5, 30], [1, 200]]]);
  assert.deepEqual(compactWarSettings(world.warSettings), form, "and the form it builds again");
});

test("the Wars feature carries the settings, and Save writes them with the scenario's world", () => {
  const library = read("libraryBar.jsx");
  assert.ok(library.includes("warSettings: compactWarSettings(world.warSettings),"), "the form is built from the world");
  assert.ok(library.includes("? { warSettings: compactWarSettings(editorState.warSettings) }"), "and saved into it");
  const settingsAt = library.indexOf("<ScenarioWarSettings\n                  value={formState.warSettings ?? null}");
  assert.ok(settingsAt > 0 && settingsAt < library.indexOf("<ScenarioFrontsPanel"), "above the fronts the scenario begins with");
  assert.ok(library.includes("extras={kind === \"scenario\" ? {\n            fronts: (\n              <>\n                <ScenarioWarSettings"), "under the Wars feature in the Features tab");
  const panel = read("ScenarioWarSettings.jsx");
  for (const label of ["Troop fatigue", "Seasons and weather", "Terrain", "Fortified lines", "Mustering", "Countries' military figures", "Air in battles", "Automatic (read off the date)"]) {
    assert.ok(panel.includes(`"${label}"`) || panel.includes(`>${label}<`), label);
  }
  assert.ok(panel.includes("<MusterChart"));
  // The importance of technology, the modern world's by default, and saying so: "by default set it to a multiplier
  // good for modern day and have it say that by default its configured for the modern world" (the owner, 2026-11-04).
  assert.ok(panel.includes(">Importance of technology<"));
  assert.ok(panel.includes('onText={typed("technologyWeight")}'));
  assert.ok(panel.includes(`>Empty: ${TECHNOLOGY_WEIGHT_MODERN}, configured for the modern world.<`));
});

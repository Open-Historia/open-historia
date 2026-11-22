/*! Open Historia — the Scenario Editor's unit types: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/scenarioUnitTypes.test.js
//
// The scenario's own unit types are written in the Scenario Editor (Features, under Wars), saved with its form, and
// handed to the Workshop, where a unit placed can be of one.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formDiffers } from "../../runtime/editorForm.js";
import { UNIT_TYPES_MOST } from "../../runtime/unitTypes.js";
import {
  formUnitTypes,
  newUnitType,
  savedUnitTypes,
  typedUnitTypeFigure,
  withNewUnitType,
  withRenamedUnitTypeOwners,
  withUnitType,
  withUnitTypeOwner,
  withoutUnitType,
  withoutUnitTypeOwner,
} from "./scenarioUnitTypes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8").replace(/\r\n/g, "\n");

test("a type is added by its name, an ordinary infantry unit until the author says otherwise, its id kept when renamed", () => {
  assert.equal(newUnitType([], "   "), null, "no name, no type");
  const one = withNewUnitType([], " Red Dragon ");
  assert.deepEqual(one, [{ id: "red-dragon", name: "Red Dragon", base: "infantry", attack: 1, toughness: 1, speed: 1, icon: "", note: "", owners: [] }]);
  const two = withNewUnitType(one, "Red dragon");
  assert.deepEqual(two.map((type) => type.id), ["red-dragon", "red-dragon-2"], "two of one name are two types");
  const renamed = withUnitType(two, "red-dragon", { name: "Wyrm", base: "air", attack: 5 });
  assert.deepEqual([renamed[0].id, renamed[0].name, renamed[0].base, renamed[0].attack], ["red-dragon", "Wyrm", "air", 5]);
  assert.deepEqual(withoutUnitType(renamed, "red-dragon").map((type) => type.id), ["red-dragon-2"]);
  // At most UNIT_TYPES_MOST.
  const full = Array.from({ length: UNIT_TYPES_MOST }, (_, index) => ({ id: `t${index}`, name: `T${index}` }));
  assert.equal(withNewUnitType(full, "One more"), full);
});

test("a figure is typed as a figure, held to its bounds; an empty field is an ordinary unit's", () => {
  assert.deepEqual(typedUnitTypeFigure("5", 10), { value: 5, ok: true });
  assert.deepEqual(typedUnitTypeFigure("×2,5", 10), { value: 2.5, ok: true });
  assert.deepEqual(typedUnitTypeFigure("40", 10), { value: 10, ok: true });
  assert.deepEqual(typedUnitTypeFigure("9", 5), { value: 5, ok: true });
  assert.deepEqual(typedUnitTypeFigure("0.01", 10), { value: 0.1, ok: true });
  assert.deepEqual(typedUnitTypeFigure("", 10), { value: 1, ok: true });
  assert.equal(typedUnitTypeFigure("strong", 10).ok, false);
  assert.equal(typedUnitTypeFigure("-3", 10).ok, false);
});

test("the countries that may field a type: added once, taken off, and following the Workshop's renames", () => {
  let types = withNewUnitType([], "Dragon");
  types = withUnitTypeOwner(types, "dragon", "Wessex");
  types = withUnitTypeOwner(types, "dragon", " wessex ");
  types = withUnitTypeOwner(types, "dragon", "Mercia");
  assert.deepEqual(types[0].owners, ["Wessex", "Mercia"]);
  assert.deepEqual(withoutUnitTypeOwner(types, "dragon", "WESSEX")[0].owners, ["Mercia"]);
  assert.deepEqual(withRenamedUnitTypeOwners(types, [{ from: "Wessex", to: "England" }, { from: "England", to: "Britain" }])[0].owners, ["Britain", "Mercia"]);
  assert.equal(withRenamedUnitTypeOwners(types, []), types);
});

test("the form opens as the world keeps them, and a form saved and opened again is no change", () => {
  const world = { unitTypes: [{ id: "dragon", name: "Dragon", base: "air", attack: 5, toughness: 4, speed: 2, icon: "🐉", note: "Breathes fire.", owners: ["Wessex"] }] };
  const form = formUnitTypes(world);
  assert.deepEqual(form, world.unitTypes);
  assert.deepEqual(formUnitTypes({}), []);
  // What the author typed is saved through the world's own reading of it, and opens again as it was saved.
  const typed = withUnitType(form, "dragon", { name: "  Dragon  ", attack: 12 });
  const saved = savedUnitTypes(typed);
  assert.deepEqual([saved[0].name, saved[0].attack], ["Dragon", 10]);
  assert.equal(formDiffers({ unitTypes: formUnitTypes({ unitTypes: saved }) }, { unitTypes: saved }), false);
});

test("the editor writes them with the scenario, offers them under Wars, and hands them to the Workshop", () => {
  const bar = read("libraryBar.jsx");
  assert.match(bar, /unitTypes: formUnitTypes\(world\),/, "the form opens with the world's");
  assert.match(bar, /\{ unitTypes: savedUnitTypes\(editorState\.unitTypes\) \}/, "Save writes them");
  assert.match(bar, /<ScenarioUnitTypes\n\s*value=\{formState\.unitTypes \?\? \[\]\}/, "under Wars, after how its wars are fought");
  assert.ok(bar.indexOf("<ScenarioUnitTypes") > bar.indexOf("<ScenarioWarSettings") && bar.indexOf("<ScenarioUnitTypes") < bar.indexOf("<ScenarioMilitaryPanel"));
  assert.match(bar, /unitTypes: savedUnitTypes\(unitTypes === undefined \? world\.unitTypes : unitTypes\),/, "the Workshop is seeded with them");
  assert.match(bar, /unitTypes: editorState\?\.unitTypes,/, "as the form holds them, saved or not");
  const editor = fs.readFileSync(path.join(here, "..", "..", "Editor", "MapEditor.jsx"), "utf8");
  assert.match(editor, /unitTypes=\{initialMap\?\.unitTypes \?\? \[\]\}/);
  assert.match(editor, /\{ unitType: String\(u\.unitType\)\.trim\(\) \}/, "a unit placed of one keeps it when the Workshop opens again");
});

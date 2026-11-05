/*! Open Historia — Country Editor: what a Save writes tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/countryEditorStats.test.js
//
// The invariant: a Save writes what the player changed and nothing else, so a
// turn that moved the country while the editor was open is not undone.

import test from "node:test";
import assert from "node:assert/strict";

import { changedEditorFields, countryStatPatchFromForm, editorStateChanged } from "./countryEditorStats.js";

// Germany's form as it loaded; a turn has since dropped stability to 40.
const loaded = {
  name: "Germany", color: "#444444", capital: "Berlin", continent: "Europe", currency: "Mark",
  populationM: "67", gdpB: "3500", stability: "70", gdpGrowth: "1.5", inflation: "2", unemployment: "5",
  publicDebt: "60", budgetBalance: "-1", sovereignty: "80", foodAutonomy: "", energyAutonomy: "",
  economicIndependence: "", internalSecurity: "", internationalReputation: "75",
  agriculture: 1, industry: 29, services: 70,
};

test("changing only the colour writes no statistics at all", () => {
  const form = { ...loaded, color: "#aa0000" };
  const changed = changedEditorFields(form, loaded);
  assert.deepEqual([...changed], ["color"]);
  assert.equal(countryStatPatchFromForm({ form, changed }), null);
});

test("an edited field is written, and only it", () => {
  const form = { ...loaded, inflation: "4.5", capital: "Bonn" };
  const patch = countryStatPatchFromForm({ form, changed: changedEditorFields(form, loaded) });
  assert.deepEqual(patch, { capital: "Bonn", economy: { inflation: 4.5 } });
});

test("deflation is written as typed, not raised to 0%", () => {
  const form = { ...loaded, inflation: "-2.5" };
  const patch = countryStatPatchFromForm({ form, changed: changedEditorFields(form, loaded) });
  assert.deepEqual(patch, { economy: { inflation: -2.5 } });
});

test("numbers the form shows as numbers and the loaded text compare equal", () => {
  const form = { ...loaded, stability: 70, agriculture: "1" };
  assert.deepEqual([...changedEditorFields(form, loaded)], []);
});

test("one sector share changed writes all three, and a blank one is refused", () => {
  const form = { ...loaded, agriculture: 10, industry: 25, services: 65 };
  const patch = countryStatPatchFromForm({ form, changed: changedEditorFields(form, loaded) });
  assert.deepEqual(patch, { gdpBreakdown: { agriculture: 10, industry: 25, services: 65 } });
  const broken = { ...loaded, agriculture: "" };
  assert.throws(() => countryStatPatchFromForm({ form: broken, changed: changedEditorFields(broken, loaded) }), /all three/);
});

test("an out-of-range edit is refused with its label", () => {
  const form = { ...loaded, stability: "140" };
  assert.throws(() => countryStatPatchFromForm({ form, changed: changedEditorFields(form, loaded) }), /Stability must be between 0 and 100/);
});

test("government and leader come from the political actor only when it is passed", () => {
  const actor = { government: { form: "Federal republic", headOfGovernment: { name: "A. Leader" } } };
  assert.deepEqual(
    countryStatPatchFromForm({ form: loaded, changed: new Set(), politicalActor: actor }),
    { government: "Federal republic", leader: "A. Leader" },
  );
  assert.equal(countryStatPatchFromForm({ form: loaded, changed: new Set(), politicalActor: null }), null);
});

test("the political form counts as changed only when it was edited", () => {
  const politics = { parties: [{ id: "p1", name: "Centre", ruling: true }], traitValues: { hawkishness: "" } };
  assert.equal(editorStateChanged(structuredClone(politics), politics), false);
  assert.equal(editorStateChanged({ ...politics, parties: [{ id: "p1", name: "Centre", ruling: false }] }, politics), true);
});

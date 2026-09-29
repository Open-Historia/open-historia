/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
// Run: node --test src/Editor/documentUndo.test.js
//
// Ctrl+Z after a group rename or erase used to bring the regions' tags back
// but not the group's record, and a city or unit the Delete tool removed was
// gone for good. These are the document halves of those undo steps.
import test from "node:test";
import assert from "node:assert/strict";

import { groupEraseSteps, groupRenameSteps, removeRowStep } from "./documentUndo.js";

// A document setter as useMapDocument has them: a value or an updater.
const store = (initial) => {
  const box = { value: initial };
  box.set = (updater) => {
    box.value = typeof updater === "function" ? updater(box.value) : updater;
  };
  return box;
};

test("a removed unit comes back where it was on undo and leaves again on redo", () => {
  const units = store([{ id: "u1" }, { id: "u2", name: "Guard" }, { id: "u3" }]);
  const step = removeRowStep(units.value, units.set, "u2");
  assert.deepEqual(units.value.map((u) => u.id), ["u1", "u3"]);

  step.undo();
  assert.deepEqual(units.value.map((u) => u.id), ["u1", "u2", "u3"]);
  assert.equal(units.value[1].name, "Guard");

  step.redo();
  assert.deepEqual(units.value.map((u) => u.id), ["u1", "u3"]);
});

test("an undone removal does not duplicate a row that came back meanwhile, and fits a shorter list", () => {
  const cities = store([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const step = removeRowStep(cities.value, cities.set, "c");
  cities.set([{ id: "c" }]);
  step.undo();
  assert.deepEqual(cities.value.map((c) => c.id), ["c"]);

  cities.set([]);
  step.undo();
  assert.deepEqual(cities.value.map((c) => c.id), ["c"]);
});

test("removing a row that is not there has no undo step", () => {
  const cities = store([{ id: "a" }]);
  assert.equal(removeRowStep(cities.value, cities.set, "zzz"), null);
  assert.deepEqual(cities.value, [{ id: "a" }]);
});

test("a group rename moves the record, and undo moves it back with its description and colour", () => {
  const groups = store({ Cartel: { name: "Cartel", description: "Drug traffickers", color: "#aa3300" } });
  const steps = groupRenameSteps(groups.set, "Cartel", "Sinaloa Cartel");
  steps.redo();
  assert.deepEqual(groups.value, { "Sinaloa Cartel": { name: "Sinaloa Cartel", description: "Drug traffickers", color: "#aa3300" } });

  steps.undo();
  assert.deepEqual(groups.value, { Cartel: { name: "Cartel", description: "Drug traffickers", color: "#aa3300" } });

  steps.redo();
  assert.deepEqual(Object.keys(groups.value), ["Sinaloa Cartel"]);
});

test("a rename of a group named only on regions gives the new name the fallback record", () => {
  const groups = store({});
  groupRenameSteps(groups.set, "Militia", "Home Guard", { description: "", color: "#123456" }).redo();
  assert.deepEqual(groups.value, { "Home Guard": { description: "", color: "#123456", name: "Home Guard" } });
});

test("a group erase removes the record, and undo restores it as it was", () => {
  const record = { name: "Outbreak", description: "A zombie outbreak", color: "#44aa44" };
  const groups = store({ Outbreak: record, Other: { name: "Other" } });
  const steps = groupEraseSteps(groups.set, "Outbreak", record);
  steps.redo();
  assert.deepEqual(Object.keys(groups.value), ["Other"]);

  steps.undo();
  assert.deepEqual(groups.value.Outbreak, record);

  steps.redo();
  assert.equal(groups.value.Outbreak, undefined);
});

test("undoing the erase of a group that had no record leaves the registry alone", () => {
  const groups = store({ Other: { name: "Other" } });
  const steps = groupEraseSteps(groups.set, "Loose", null);
  steps.redo();
  steps.undo();
  assert.deepEqual(groups.value, { Other: { name: "Other" } });
});

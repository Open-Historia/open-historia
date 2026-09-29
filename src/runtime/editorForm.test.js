/*! Open Historia — the editor form against what is saved tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/editorForm.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { changedFields, followSavedFields, formDiffers } from "./editorForm.js";

test("after a Workshop save the form follows the country and date it moved, unless the author changed them", () => {
  // The Workshop deleted Prussia and the save moved the player to Austria and
  // stamped a date. The drawer, still open, must not write Prussia back.
  const before = { country: "Prussia", gameDate: "" };
  const after = { country: "Austria", gameDate: "2016-01-01" };
  const form = { name: "Europe 1860", description: "typed but unsaved", country: "Prussia", gameDate: "" };
  assert.deepEqual(followSavedFields(form, before, after, ["country", "gameDate"]), {
    name: "Europe 1860",
    description: "typed but unsaved",
    country: "Austria",
    gameDate: "2016-01-01",
  });

  const edited = { ...form, country: "Bavaria" };
  assert.equal(followSavedFields(edited, before, after, ["country", "gameDate"]).country, "Bavaria", "the author's own change stands");
  assert.equal(followSavedFields(null, before, after, ["country"]), null, "no form, nothing to follow");
  assert.equal(followSavedFields({ country: "" }, {}, {}, ["country"]).country, "", "a missing value reads as blank");
});

test("a game editor save carries only the fields changed in the form", () => {
  // Opened on round 1 in January, played to June, then renamed: the date in
  // the form is January's and must not be sent back.
  const baseline = { name: "Saga", country: "Norway", gameDate: "1000-01-01", language: "English", labelFont: "" };
  const form = { ...baseline, name: "Saga of the North", labelFont: "Georgia" };
  assert.deepEqual(changedFields(form, baseline, ["country", "gameDate", "language"]), {}, "nothing for game.json: its date stays where play took it");
  assert.deepEqual(changedFields(form, baseline, ["labelFont", "language"]), { labelFont: "Georgia" });
  assert.deepEqual(changedFields({ ...form, gameDate: "" }, baseline, ["gameDate"]), { gameDate: "" }, "a field cleared on purpose is a change");
});

test("a form differs from what is saved only when a value does, not the order it was written in", () => {
  const saved = { description: "A long passage", prompts: { guidance: { leader: { tone: "Grim" }, tasks: {} } } };
  assert.equal(formDiffers({ prompts: { guidance: { tasks: {}, leader: { tone: "Grim" } } }, description: "A long passage" }, saved), false);
  assert.equal(formDiffers({ ...saved, description: "A longer passage" }, saved), true);
  assert.equal(formDiffers({ ...saved, prompts: { guidance: { leader: { tone: "Hopeful" }, tasks: {} } } }, saved), true);
  assert.equal(formDiffers({ custom: false, sections: [] }, { custom: false, sections: [] }), false);
  assert.equal(formDiffers({ sections: [{ key: "a" }, { key: "b" }] }, { sections: [{ key: "b" }, { key: "a" }] }), true, "a list's order is its content");
});

/*! Open Historia — the editor form against what is saved tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/editorForm.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { followSavedFields } from "./editorForm.js";

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

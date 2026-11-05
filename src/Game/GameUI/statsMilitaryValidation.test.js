/*! Open Historia — the Economy tab and a stat sheet with military figures: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/statsMilitaryValidation.test.js
//
// Players met "The stat sheet failed validation: $.military is not allowed" on
// the Economy tab (2026-10-16): a country's sheet carries its military figures
// in the backend (runtime/militaryStats.js), which the model's schema for a
// sheet does not list, and the tab checked the whole sheet against that schema.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateGameplayPayload } from "../AI/gameplaySchemas.js";

const stats = readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");

test("the schema refuses a sheet's military figures, so the tab checks the sheet without them", () => {
  const refused = validateGameplayPayload("countryStatSheet", { military: { quality: 60 } });
  assert.equal(refused.valid, false);
  // Both checks of the tab: a kept sheet, and one just generated.
  assert.match(stats, /validateGameplayPayload\("countryStatSheet", withoutBackendFields\(sheet\)\)\.valid/);
  assert.match(stats, /validateGameplayPayload\("countryStatSheet", withoutBackendFields\(generated\)\)/);
  assert.doesNotMatch(stats, /validateGameplayPayload\("countryStatSheet", (sheet|generated)\)/);
  assert.match(stats, /const withoutBackendFields = \(sheet\) => \{[\s\S]*?delete checked\.military;/);
});

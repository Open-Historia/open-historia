/*! Open Historia — the name under a counter: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/unitLabels.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { shortUnitLabel } from "./unitLabels.js";

// A counter's label is the unit's name as written, in every language alike: no English formation word is taken
// off it and no list of connectives decides where it is cut (the owner, 2026-11-13: no keywording anywhere).
test("a counter is labelled with its unit's name as written, in any language", () => {
  assert.equal(shortUnitLabel("1st Guards Tank Army"), "1st Guards Tank Army");
  assert.equal(shortUnitLabel("Gulf of Guinea Strike Group"), "Gulf of Guinea Strike Group");
  assert.equal(shortUnitLabel("1re armée blindée de la Garde"), "1re armée blindée de la Garde");
  assert.equal(shortUnitLabel("1-я гвардейская танковая армия"), "1-я гвардейская танковая армия");
  assert.equal(shortUnitLabel("第1近衛戦車軍"), "第1近衛戦車軍");
  assert.equal(shortUnitLabel("  USN   Amphibious Squadron "), "USN Amphibious Squadron", "spacing aside");
  assert.equal(shortUnitLabel(null), "");
});

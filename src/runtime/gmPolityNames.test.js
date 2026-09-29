/*! Open Historia — names already in use tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gmPolityNames.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { polityNameInUse } from "./gmPolityNames.js";

const world = {
  polityOverrides: { Atlantis: { code: "Atlantis", name: "Atlantis" } },
  ownerCodes: ["Lemuria"],
  regionOwnershipOverrides: { "reg-1": "Mu" },
  regionSovereigntyOverrides: { "reg-1": "Hyperborea" },
  regionClaimants: { "reg-2": ["Thule"] },
};
// The panel's country list: the map's own owners, stock ones included.
const mapPolities = [{ code: "France", name: "France" }, { code: "Northmark", name: "Northmark" }];

test("a name the game already uses anywhere is taken", () => {
  for (const name of ["Atlantis", "Lemuria", "Mu", "Hyperborea", "Thule", "France", "Northmark"]) {
    assert.equal(polityNameInUse(world, name, mapPolities), true, name);
  }
});

test("a map-only country such as France is taken though it has no override", () => {
  assert.equal(polityNameInUse({ polityOverrides: {} }, "France", mapPolities), true);
});

test("a new name is free, and names are compared exactly", () => {
  assert.equal(polityNameInUse(world, "Avalon", mapPolities), false);
  assert.equal(polityNameInUse(world, "Kingdom of France", mapPolities), false);
  assert.equal(polityNameInUse(world, "  ", mapPolities), false);
});

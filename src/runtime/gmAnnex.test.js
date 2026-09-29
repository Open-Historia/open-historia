/*! Open Historia — Cheats annexation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gmAnnex.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { regionOwnerNow, regionsHeldBy } from "./gmAnnex.js";

// A hand-drawn map: no country codes, owners by name.
const drawn = [
  { id: "reg_1", name: "Northmark Hills", country: "Northmark", countryCode: "" },
  { id: "reg_2", name: "Northmark Coast", country: "Northmark", countryCode: "" },
  { id: "reg_3", name: "Avalon Vale", country: "Avalon", countryCode: "" },
];

test("a drawn region's owner is the name the map gives it", () => {
  assert.equal(regionOwnerNow(drawn[0], {}), "Northmark");
  assert.equal(regionOwnerNow(drawn[0], { reg_1: "Avalon" }), "Avalon");
});

test("a stock region without a baked owner falls back to its country code's name", () => {
  assert.equal(regionOwnerNow({ id: "FRA.1_1", countryCode: "FRA", country: "" }, {}), "France");
  // A scenario that bakes a different owner is read as the map shows it.
  assert.equal(regionOwnerNow({ id: "FRA.1_1", countryCode: "FRA", country: "Burgundy" }, {}), "Burgundy");
});

test("annexing a drawn country finds every region it holds", () => {
  const held = regionsHeldBy(drawn, {}, "Northmark");
  assert.deepEqual(held.map((region) => region.id), ["reg_1", "reg_2"]);
  assert.equal(held[0].name, "Northmark Hills");
});

test("regions already moved by an override count for their new owner only", () => {
  const overrides = { reg_2: "Avalon", "ghost-9": "Northmark" };
  assert.deepEqual(regionsHeldBy(drawn, overrides, "Northmark").map((region) => region.id), ["reg_1", "ghost-9"]);
  assert.deepEqual(regionsHeldBy(drawn, overrides, "Avalon").map((region) => region.id), ["reg_2", "reg_3"]);
});

test("names are exact: nothing is folded", () => {
  assert.deepEqual(regionsHeldBy(drawn, {}, "northmark"), []);
  assert.deepEqual(regionsHeldBy(drawn, {}, ""), []);
});

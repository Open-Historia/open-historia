/*! Open Historia — region vocabulary tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/regionVocab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { buildRegionOwnershipText, regionOwnerCode } from "./regionVocab.js";

const CATALOG = [
  { id: "FRA.1_1", name: "Bourgogne", country: "France", countryCode: "FRA" },
  { id: "FRA.2_1", name: "Bretagne", country: "France", countryCode: "FRA" },
  { id: "DEU.1_1", name: "Bayern", country: "Germany", countryCode: "DEU" },
  { id: "DEU.2_1", name: "Ostpreussen", country: "Germany", countryCode: "DEU" },
  { id: "DEU.3_1", name: "Sachsen", country: "Germany", countryCode: "DEU" },
];

test("regionOwnerCode falls back to the base country when there is no override", () => {
  assert.equal(regionOwnerCode(CATALOG[0], {}), "FRA");
  assert.equal(regionOwnerCode(CATALOG[0], { "FRA.1_1": "DEU" }), "DEU"); // override wins
});

test("enumerates regions grouped by owner on a STOCK map (no overrides) — the core gap", () => {
  const text = buildRegionOwnershipText(CATALOG, {});
  // Every region appears as `name (id)`, grouped under its base owner.
  assert.match(text, /Bourgogne \(FRA\.1_1\)/);
  assert.match(text, /Bayern \(DEU\.1_1\)/);
  assert.match(text, /- FRA \[2 regions\]:/);
  assert.match(text, /- DEU \[3 regions\]:/);
});

test("an override moves a region into the new owner's group", () => {
  const text = buildRegionOwnershipText(CATALOG, { "DEU.1_1": "FRA" }); // France annexed Bayern
  assert.match(text, /- FRA \[3 regions\]:.*Bayern \(DEU\.1_1\)/s);
  assert.match(text, /- DEU \[2 regions\]:/);
});

test("priorityCodes are listed first, in order", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { priorityCodes: ["DEU", "FRA"] });
  assert.ok(text.indexOf("- DEU") < text.indexOf("- FRA"), "DEU should precede FRA when prioritized first");
});

test("polityNames decorate the owner header", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { polityNames: { fra: "French Republic" } });
  assert.match(text, /- FRA \(French Republic\) \[2 regions\]:/);
});

test("ownerCap truncates a group with a (+N more) marker; nothing is silently hidden", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { ownerCap: 1 });
  assert.match(text, /Bayern \(DEU\.1_1\), \(\+2 more\)/);
});

test("totalCap bounds output and notes omitted owners", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { totalCap: 2, ownerCap: 40 });
  assert.match(text, /more owners? not listed/);
});

test("empty / missing catalog degrades to a safe line, never throws", () => {
  assert.match(buildRegionOwnershipText([], {}), /No region catalog is available/);
  assert.match(buildRegionOwnershipText(null, null), /No region catalog is available/);
});

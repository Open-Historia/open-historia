/*! Open Historia — country info panel rule tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryInfoPanel.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { classifyPolityRegions, resolvePanelPolity } from "./countryInfoPanel.js";
import { regionBaseOwner } from "./ownerNames.js";

// ---- regions ---------------------------------------------------------------

// The stock catalog: GADM regions carry the code, and sometimes the name.
const stockCatalog = [
  { id: "FRA.1_1", name: "Auvergne-Rhône-Alpes", countryCode: "FRA", country: "" },
  { id: "FRA.2_1", name: "Bourgogne-Franche-Comté", countryCode: "FRA", country: "" },
  { id: "FRA.3_1", name: "Bretagne", countryCode: "FRA", country: "France" },
  { id: "DEU.1_1", name: "Baden-Württemberg", countryCode: "DEU", country: "" },
  { id: "DEU.2_1", name: "Bayern", countryCode: "DEU", country: "" },
];

test("a region's base owner is its baked country, else the country its code names", () => {
  assert.equal(regionBaseOwner({ country: "Occitania", countryCode: "FRA" }), "Occitania");
  assert.equal(regionBaseOwner({ country: "", countryCode: "FRA" }), "France");
  assert.equal(regionBaseOwner({ countryCode: "" }), "");
  assert.equal(regionBaseOwner(null), "");
});

test("a stock country's own regions count as sovereign without any override", () => {
  const lists = classifyPolityRegions({ catalog: stockCatalog, world: {}, polityKey: "France" });
  assert.deepEqual(lists.sovereign, ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Bretagne"]);
  assert.deepEqual(lists.controlledForeign, []);
  assert.deepEqual(lists.occupiedSovereign, []);
});

test("conquest, occupation and a legal transfer land in the right lists", () => {
  const world = {
    // France annexed Baden-Württemberg outright and occupies Bayern; Germany
    // occupies Bretagne, which stays French in law.
    regionOwnershipOverrides: { "DEU.1_1": "France", "DEU.2_1": "France", "FRA.3_1": "Germany" },
    regionSovereigntyOverrides: { "DEU.2_1": "Germany", "FRA.3_1": "France" },
  };
  const france = classifyPolityRegions({ catalog: stockCatalog, world, polityKey: "France" });
  assert.deepEqual(france.sovereign, ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Bretagne", "Baden-Württemberg"]);
  assert.deepEqual(france.controlledForeign, ["Bayern"]);
  assert.deepEqual(france.occupiedSovereign, ["Bretagne"]);

  const germany = classifyPolityRegions({ catalog: stockCatalog, world, polityKey: "Germany" });
  assert.deepEqual(germany.sovereign, ["Bayern"]);
  assert.deepEqual(germany.controlledForeign, ["Bretagne"]);
  assert.deepEqual(germany.occupiedSovereign, ["Bayern"]);
});

test("owners written as a code or a display name fold onto the key; other names stay apart", () => {
  const world = {
    polityOverrides: { Germany: { name: "Third Reich", aliases: [] } },
    regionOwnershipOverrides: { "FRA.1_1": "DEU", "FRA.2_1": "Third Reich" },
  };
  const lists = classifyPolityRegions({ catalog: stockCatalog, world, polityKey: "Germany" });
  assert.deepEqual(lists.sovereign, ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Baden-Württemberg", "Bayern"]);
  // Exact keys: "Russia" is not "Russian Federation".
  const russia = classifyPolityRegions({
    catalog: [{ id: "RUS.1_1", name: "Adygey", countryCode: "", country: "Russian Federation" }],
    world: {},
    polityKey: "Russia",
  });
  assert.deepEqual(russia.sovereign, []);
});

test("a drawn map's regions count by their baked owner", () => {
  const drawn = [
    { id: "reg_1", name: "Latium", country: "Roman Republic", countryCode: "" },
    { id: "reg_2", name: "Samnium", country: "Samnites", countryCode: "" },
  ];
  const world = { regionOwnershipOverrides: { reg_2: "Roman Republic", stale_stock: "Roman Republic" } };
  const lists = classifyPolityRegions({ catalog: drawn, world, polityKey: "Roman Republic" });
  assert.deepEqual(lists.sovereign, ["Latium", "Samnium"]);
  // A stale override for a region the drawn map does not have is not territory.
  assert.equal(lists.sovereign.includes("stale_stock"), false);
  // With the merged catalog, overrides the catalog lacks are still listed by id.
  const merged = classifyPolityRegions({ catalog: drawn, world, polityKey: "Roman Republic", includeUncatalogued: true });
  assert.deepEqual(merged.sovereign, ["Latium", "Samnium", "stale_stock"]);
});

test("no key, no regions", () => {
  assert.deepEqual(classifyPolityRegions({ catalog: stockCatalog, world: {}, polityKey: "" }).sovereign, []);
});

test("the panel resolves a click to the polity's stable key and current name", () => {
  const world = { polityOverrides: { Germany: { name: "Third Reich", aliases: ["Reich"] } } };
  const resolved = resolvePanelPolity({ name: "Germany", code: "Germany" }, world);
  assert.equal(resolved.stableKey, "Germany");
  assert.equal(resolved.currentName, "Third Reich");
  assert.deepEqual(resolved.polity.aliases, ["Reich"]);
  assert.equal(resolvePanelPolity({ name: "France", code: "France" }, {}).stableKey, "France");
});

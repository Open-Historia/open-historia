/*! Open Historia — country info panel rule tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryInfoPanel.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  briefingCacheKey,
  classifyPolityRegions,
  createBriefingCache,
  createEventMatcher,
  knownPolityNames,
  resolvePanelPolity,
  sortEventsNewestFirst,
} from "./countryInfoPanel.js";
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

// ---- related events --------------------------------------------------------

const matcherFor = (key, name = key, world = {}, aliases = []) =>
  createEventMatcher({ key, name, aliases, knownNames: knownPolityNames(world) });

const prose = (title, description = "") => ({ title, description, impacts: {} });

test("text matching: Niger is not Nigeria", () => {
  const niger = matcherFor("Niger");
  assert.equal(niger(prose("Nigeria holds elections")), false);
  assert.equal(niger(prose("Coup in Niger")), true);
  assert.equal(niger(prose("Niger's junta expels envoys")), true);
  assert.equal(matcherFor("Nigeria")(prose("Coup in Niger")), false);
});

test("text matching: Sudan is not South Sudan, but both named counts", () => {
  const sudan = matcherFor("Sudan");
  assert.equal(sudan(prose("South Sudan declares independence")), false);
  assert.equal(sudan(prose("Border talks", "South Sudan and Sudan agree on Abyei.")), true);
  assert.equal(matcherFor("South Sudan")(prose("South Sudan declares independence")), true);
});

test("text matching: Guinea is not Papua New Guinea, Equatorial Guinea or Guinea-Bissau", () => {
  const guinea = matcherFor("Guinea");
  assert.equal(guinea(prose("Papua New Guinea hosts a summit")), false);
  assert.equal(guinea(prose("Oil found off Equatorial Guinea")), false);
  assert.equal(guinea(prose("Guinea-Bissau votes")), false);
  assert.equal(guinea(prose("Bauxite strike in Guinea")), true);
});

test("text matching ignores case and handles accented names", () => {
  const ivory = matcherFor("Côte d'Ivoire");
  assert.equal(ivory(prose("CÔTE D'IVOIRE signs the accord")), true);
  assert.equal(ivory(prose("Côte d'Ivoirean exporters")), false);
  assert.equal(matcherFor("Chad")(prose("Chadian troops advance")), false);
});

test("a longer name belonging to the polity itself does not hide it", () => {
  const world = { polityOverrides: { Sudan: { name: "Sudan", aliases: ["Republic of the Sudan"] } } };
  const sudan = matcherFor("Sudan", "Sudan", world, ["Republic of the Sudan"]);
  assert.equal(sudan(prose("The Republic of the Sudan protests")), true);
});

test("a renamed polity matches its key and its new name", () => {
  const world = { polityOverrides: { Germany: { name: "Third Reich" }, "East Germany": { name: "East Germany" } } };
  const matcher = matcherFor("Germany", "Third Reich", world);
  assert.equal(matcher(prose("The Third Reich remilitarises the Rhineland")), true);
  assert.equal(matcher(prose("Germany signs the pact")), true);
  assert.equal(matcher(prose("East Germany signs the pact")), false);
});

test("every impact kind that names a polity matches it exactly", () => {
  const matcher = matcherFor("France");
  const byImpact = (impacts) => matcher({ title: "Untitled", description: "", impacts });
  assert.equal(byImpact({ polityChanges: [{ code: "France" }] }), true);
  assert.equal(byImpact({ regionTransfers: [{ regionId: "x", toCode: "France", fromCode: "Spain" }] }), true);
  assert.equal(byImpact({ regionTransfers: [{ regionId: "x", toCode: "Spain", fromCode: "France" }] }), true);
  assert.equal(byImpact({ regionControlOps: [{ op: "control", fromCode: "Spain", toCode: "France" }] }), true);
  assert.equal(byImpact({ regionControlOps: [{ op: "contest", fromCode: "Spain", actorCode: "France" }] }), true);
  assert.equal(byImpact({ regionControlOps: [{ op: "clear_contest", claimantCode: "France" }] }), true);
  assert.equal(byImpact({ regionClaims: [{ regionId: "x", claimantCode: "France" }] }), true);
  assert.equal(byImpact({ politicalActorOps: [{ op: "appoint", polityKey: "France" }] }), true);
  assert.equal(byImpact({ unitOps: [{ op: "spawn", unit: { ownerCode: "France" } }] }), true);
  assert.equal(byImpact({ markerOps: [{ op: "build", marker: { ownerCode: "France" } }] }), true);
  assert.equal(byImpact({ createdChats: [{ countries: ["France"] }] }), true);
  assert.equal(byImpact({ createdChats: [{ countries: [{ code: "", name: "France" }] }] }), true);
  // Exact: another polity's impacts, or a folded spelling, are not France's.
  assert.equal(byImpact({ polityChanges: [{ code: "Spain" }] }), false);
  assert.equal(byImpact({ polityChanges: [{ code: "france" }] }), false);
  assert.equal(byImpact({}), false);
});

test("related events come newest first, undated last", () => {
  const events = [
    { id: "a", date: "1939-09-01" },
    { id: "b", date: "1940-05-10" },
    { id: "c", date: "" },
    { id: "d", date: "1940-05-10" },
    { id: "e", date: "1914-07-28" },
  ];
  assert.deepEqual(sortEventsNewestFirst(events).map((event) => event.id), ["d", "b", "a", "e", "c"]);
});

test("BC dates sort by the calendar, not the text", () => {
  const events = [{ id: "300bc", date: "-0300-01-01" }, { id: "218bc", date: "-0218-03-01" }];
  assert.deepEqual(sortEventsNewestFirst(events).map((event) => event.id), ["218bc", "300bc"]);
});

// ---- advisor report cache --------------------------------------------------

test("the briefing key changes with the campaign, polity, round, date and language", () => {
  const base = { gameId: "g1", polity: "France", date: "1940-05-10", round: 3, language: "English" };
  const key = briefingCacheKey(base);
  assert.equal(briefingCacheKey({ ...base }), key);
  for (const change of [{ gameId: "g2" }, { polity: "Germany" }, { date: "1940-06-10" }, { round: 4 }, { language: "French" }]) {
    assert.notEqual(briefingCacheKey({ ...base, ...change }), key, JSON.stringify(change));
  }
});

test("the briefing cache keeps the newest entries within its bound", () => {
  const cache = createBriefingCache({ max: 2 });
  cache.set("a", "A");
  cache.set("b", "B");
  cache.set("a", "A2");
  cache.set("c", "C");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A2");
  assert.equal(cache.get("c"), "C");
  cache.clear();
  assert.equal(cache.size, 0);
});

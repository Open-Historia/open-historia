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

test("regionRenames override region names in sovereign lists", () => {
  const world = {
    regionRenames: {
      "fra.1_1": "New Auvergne",
      "bayern": "Free State of Bavaria",
    },
  };
  const france = classifyPolityRegions({ catalog: stockCatalog, world, polityKey: "France" });
  assert.equal(france.sovereign.includes("New Auvergne"), true);
  assert.equal(france.sovereign.includes("Auvergne-Rhône-Alpes"), false);

  const germany = classifyPolityRegions({ catalog: stockCatalog, world, polityKey: "Germany" });
  assert.equal(germany.sovereign.includes("Free State of Bavaria"), true);
  assert.equal(germany.sovereign.includes("Bayern"), false);
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

const matcherFor = (key, name = key, aliases = [], formerNames = []) =>
  createEventMatcher({ key, name, aliases, formerNames });

const prose = (title, description = "", fields = {}) => ({ title, description, impacts: {}, ...fields });
const about = (concerns, title = "An event") => prose(title, "", { concerns });

// An event is about a polity when it says so (its `concerns`), when the
// polity fights in it, or when the polity is among its places as a country:
// exact names, case and spacing aside. Its words are never read for a name.
test("an event is about the polities it says it concerns, by their exact names: Niger is not Nigeria", () => {
  const niger = matcherFor("Niger");
  assert.equal(niger(about(["Nigeria"])), false);
  assert.equal(niger(about(["Niger"])), true);
  assert.equal(niger(about(["  NIGER "])), true, "case and spacing aside");
  assert.equal(matcherFor("Nigeria")(about(["Niger"])), false);
  assert.equal(matcherFor("Sudan")(about(["South Sudan"])), false);
  assert.equal(matcherFor("Sudan")(about(["South Sudan", "Sudan"])), true);
  assert.equal(matcherFor("Guinea")(about(["Papua New Guinea", "Equatorial Guinea", "Guinea-Bissau"])), false);
  assert.equal(matcherFor("Côte d'Ivoire")(about(["CÔTE D'IVOIRE"])), true);
});

test("its words name nothing: in English or in French, only what it says it concerns counts", () => {
  const germany = matcherFor("Germany");
  // Words alone: nobody's, in any language (the panel used to list the first
  // and never the second).
  assert.equal(germany(prose("Germany signs the pact", "Berlin agrees.")), false);
  assert.equal(germany(prose("L'Allemagne signe le pacte", "Berlin accepte.")), false);
  // The same event said to concern Germany, in each language: listed alike.
  assert.equal(germany(prose("Germany signs the pact", "", { concerns: ["Germany"] })), true);
  assert.equal(germany(prose("L'Allemagne signe le pacte", "", { concerns: ["Germany"] })), true);
  // A US state written about is not the country of the same name.
  assert.equal(matcherFor("Georgia")(prose("Storms hit Georgia", "Atlanta floods.", { concerns: ["United States"] })), false);
});

test("who fights in it and the countries among its places count, and an old event has only those", () => {
  const poland = matcherFor("Republic of Poland");
  assert.equal(poland(prose("Battle", "", { combatants: ["Republic of Poland", "German Reich"] })), true);
  assert.equal(poland(prose("A summit", "", { places: [{ kind: "country", name: "Republic of Poland" }] })), true);
  // A city or a region found on the map names no polity of its own.
  assert.equal(poland(prose("A summit", "", { places: [{ kind: "city", name: "Republic of Poland", lng: 21, lat: 52 }] })), false);
  assert.equal(poland(prose("Republic of Poland votes")), false);
});

test("the names a world knows are its polities' keys, names and aliases, and every real country", () => {
  const names = knownPolityNames({ polityOverrides: { Germany: { name: "Third Reich", aliases: ["Reich"] } } });
  for (const name of ["Germany", "Third Reich", "Reich", "France"]) assert.ok(names.includes(name), name);
});

test("a polity's declared aliases and the names it had before a rename are its own", () => {
  const sudan = matcherFor("Sudan", "Sudan", ["Republic of the Sudan"]);
  assert.equal(sudan(about(["Republic of the Sudan"])), true);
  const reich = matcherFor("Germany", "Third Reich", [], ["Weimar Republic"]);
  assert.equal(reich(about(["Third Reich"])), true);
  assert.equal(reich(about(["Germany"])), true);
  assert.equal(reich(about(["Weimar Republic"])), true);
  assert.equal(reich(about(["East Germany"])), false);
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

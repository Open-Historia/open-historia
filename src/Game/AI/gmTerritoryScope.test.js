import test from "node:test";
import assert from "node:assert/strict";
import {
  detectExplicitBaseTerritoryScope,
  requestDemandsExhaustiveTerritorialScope,
  resolveGameMasterBaseGeographyScope,
  scopeContainsRegion,
} from "./gmTerritoryScope.js";

const catalog = [
  { id: "PRK.1", name: "Sinuiju", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.2", name: "Pyongyang", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.3", name: "Hamhung", country: "North Korea", countryCode: "PRK" },
  { id: "KOR.1", name: "Seoul", country: "South Korea", countryCode: "KOR" },
  { id: "FRA.1", name: "Ile-de-France", country: "France", countryCode: "FRA" },
  { id: "FRA.2", name: "Normandie", country: "France", countryCode: "FRA" },
];

// A wider world for the qualifier cases: the countries a partial request names.
const wider = [
  ...catalog,
  { id: "UKR.1", name: "Kharkiv", country: "Ukraine", countryCode: "UKR" },
  { id: "UKR.2", name: "Kyiv", country: "Ukraine", countryCode: "UKR" },
  { id: "UKR.3", name: "Lviv", country: "Ukraine", countryCode: "UKR" },
  { id: "POL.1", name: "Lubelskie", country: "Poland", countryCode: "POL" },
  { id: "POL.2", name: "Mazowieckie", country: "Poland", countryCode: "POL" },
  { id: "RUS.1", name: "Belgorod", country: "Russian Federation", countryCode: "RUS" },
  { id: "USA.1", name: "Guam", country: "United States", countryCode: "USA" },
];

test("detects all North Korean states as one base-geography footprint", () => {
  const scope = detectExplicitBaseTerritoryScope(
    "make the DPRK independent, in all north korean states. not just contested - legally as well.",
    catalog,
  );
  assert.equal(scope?.countryCode, "PRK");
  assert.deepEqual(scope?.regionIds, ["PRK.1", "PRK.2", "PRK.3"]);
  assert.equal(scopeContainsRegion(scope, "PRK.2"), true);
  assert.equal(scopeContainsRegion(scope, "KOR.1"), false);
});

test("detects an exhaustive France footprint without treating current ownership as the scope", () => {
  const scope = detectExplicitBaseTerritoryScope("transfer all of France territories to Germany", catalog);
  assert.equal(scope?.countryCode, "FRA");
  assert.deepEqual(scope?.regionIds, ["FRA.1", "FRA.2"]);
});

test("does not expand a single-region request", () => {
  assert.equal(detectExplicitBaseTerritoryScope("transfer Sinuiju to the DPRK", catalog), null);
});

test("fails closed when a broad request does not identify one rendered base geography", () => {
  assert.equal(detectExplicitBaseTerritoryScope("transfer all occupied regions to Germany", catalog), null);
});

test("an unqualified whole-footprint phrase still expands, with filler and a hand-over after the noun", () => {
  assert.equal(detectExplicitBaseTerritoryScope("give all Ukrainian regions to Russia", wider)?.countryCode, "UKR");
  assert.equal(detectExplicitBaseTerritoryScope("grant independence to all the north korean states", wider)?.countryCode, "PRK");
  assert.equal(detectExplicitBaseTerritoryScope("all United States territories go to Mexico", wider)?.countryCode, "USA");
});

test("a request that narrows the scope to part of a country never expands to the whole footprint", () => {
  for (const request of [
    "Poland cedes all its eastern provinces to the Soviet Union",
    "transfer all Ukrainian regions east of the Dnieper to Novorossiya",
    "Transfer all the Ukrainian regions on the left bank of the Dnieper to Novorossiya",
    "Novorossiya takes control of every Ukrainian province it occupies",
    "Ukraine loses all of its territory east of the Dnieper; the rest stays",
    "All French overseas territories in the Caribbean go to the United States",
    "Give Zmiiv to Russia and settle all the border areas quietly",
  ]) {
    assert.equal(detectExplicitBaseTerritoryScope(request, wider), null, request);
  }
});


test("broad multi-geography GM requests require the native exhaustive-scope envelope", () => {
  assert.equal(requestDemandsExhaustiveTerritorialScope("make the Baltic states independent in all Baltic territories"), true);
  assert.equal(requestDemandsExhaustiveTerritorialScope("transfer every Ukrainian region to Novorossiya"), true);
  assert.equal(requestDemandsExhaustiveTerritorialScope("transfer Harju to Estonia"), false);
});

test("territorial preservation language does not manufacture an exhaustive mutation", () => {
  assert.equal(
    requestDemandsExhaustiveTerritorialScope("Make Lithuania an open satellite state of Latvia. Lithuania remains a separate sovereign country and keeps all of its territory."),
    false,
  );
  assert.equal(requestDemandsExhaustiveTerritorialScope("Lithuania retains all of its territory after becoming a client state"), false);
  assert.equal(requestDemandsExhaustiveTerritorialScope("all Lithuanian territory remains Lithuanian"), false);
});

test("multi-geography GM scope expands every rendered region across all named base countries", () => {
  const baltic = [
    { id: "EST.1", name: "Harju", country: "Estonia", countryCode: "EST" },
    { id: "EST.2", name: "Tartu", country: "Estonia", countryCode: "EST" },
    { id: "LVA.1", name: "Riga", country: "Latvia", countryCode: "LVA" },
    { id: "LVA.2", name: "Kurzeme", country: "Latvia", countryCode: "LVA" },
    { id: "LTU.1", name: "Vilnius", country: "Lithuania", countryCode: "LTU" },
    { id: "LTU.2", name: "Kaunas", country: "Lithuania", countryCode: "LTU" },
    { id: "POL.1", name: "Warsaw", country: "Poland", countryCode: "POL" },
  ];
  const scope = resolveGameMasterBaseGeographyScope(["Estonia", "Latvia", "Lithuania"], baltic);
  assert.equal(scope.error, "");
  assert.deepEqual(scope.countries.map((entry) => entry.name), ["Estonia", "Latvia", "Lithuania"]);
  assert.deepEqual(scope.regions.map((entry) => entry.id), ["EST.1", "EST.2", "LVA.1", "LVA.2", "LTU.1", "LTU.2"]);
});

test("multi-geography GM scope fails closed when the model names a geography the rendered map cannot resolve", () => {
  const result = resolveGameMasterBaseGeographyScope(["Ukraine", "Atlantis"], wider);
  assert.match(result.error, /Atlantis.*did not match any rendered base geography/);
  assert.deepEqual(result.regions, []);
});

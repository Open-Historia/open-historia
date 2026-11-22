import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGameMasterBaseGeographyScope } from "./gmTerritoryScope.js";

// The GM's territorialScopes name base geographies; native code expands every
// rendered region in them. The names are looked up exactly (code or name, case
// and spacing aside), and the request's own words are never read.

const catalog = [
  { id: "PRK.1", name: "Sinuiju", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.2", name: "Pyongyang", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.3", name: "Hamhung", country: "North Korea", countryCode: "PRK" },
  { id: "KOR.1", name: "Seoul", country: "South Korea", countryCode: "KOR" },
  { id: "FRA.1", name: "Ile-de-France", country: "France", countryCode: "FRA" },
  { id: "FRA.2", name: "Normandie", country: "France", countryCode: "FRA" },
];

const wider = [
  ...catalog,
  { id: "UKR.1", name: "Kharkiv", country: "Ukraine", countryCode: "UKR" },
  { id: "UKR.2", name: "Kyiv", country: "Ukraine", countryCode: "UKR" },
  { id: "UKR.3", name: "Lviv", country: "Ukraine", countryCode: "UKR" },
  { id: "POL.1", name: "Lubelskie", country: "Poland", countryCode: "POL" },
];

test("a base geography is found by its exact name or code, case and spacing aside", () => {
  for (const name of ["North Korea", "north  korea", "NORTH KOREA", "PRK", "prk"]) {
    const scope = resolveGameMasterBaseGeographyScope([name], catalog);
    assert.equal(scope.error, "", name);
    assert.deepEqual(scope.regions.map((region) => region.id), ["PRK.1", "PRK.2", "PRK.3"], name);
  }
});

test("a part of a name, a stem or another wording is no base geography: it fails closed", () => {
  // Stems once matched: "Korean" was North or South Korea, and "Korea" either.
  for (const name of ["Korea", "Korean", "North Korean states", "the North Korea", "DPRK"]) {
    const scope = resolveGameMasterBaseGeographyScope([name], catalog);
    assert.match(scope.error, /did not match any rendered base geography/, name);
    assert.deepEqual(scope.regions, [], name);
  }
});

test("a map whose base geographies are named in Cyrillic resolves them the same way", () => {
  const cyrillic = [
    { id: "PRK.1", name: "Синыйджу", country: "Северная Корея", countryCode: "PRK" },
    { id: "KOR.1", name: "Сеул", country: "Южная Корея", countryCode: "KOR" },
  ];
  assert.deepEqual(resolveGameMasterBaseGeographyScope(["Северная Корея"], cyrillic).regions.map((region) => region.id), ["PRK.1"]);
  assert.deepEqual(resolveGameMasterBaseGeographyScope(["СЕВЕРНАЯ  КОРЕЯ"], cyrillic).regions.map((region) => region.id), ["PRK.1"]);
  assert.match(resolveGameMasterBaseGeographyScope(["Корея"], cyrillic).error, /did not match/);
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
  assert.match(resolveGameMasterBaseGeographyScope([], wider).error, /requires at least one base country/);
});

// The engine read the administrator's request itself: an English phrase ("all
// North Korean states") moved a whole footprint with no territorialScopes, and
// an answer without them was refused for "all"/"every" in the request.
// gameplay.js does not load under bare node, so this is read as source.
test("the request's words are never read for a scope, and never refuse an answer", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.doesNotMatch(gameplay, /detectExplicitBaseTerritoryScope|requestDemandsExhaustiveTerritorialScope|explicitScopeText|explicitBaseScope/);
  const expander = gameplay.slice(gameplay.indexOf("const expandGameMasterTerritorialScopes = async"));
  assert.match(expander.slice(0, 900), /const scopes = normalizeArray\(candidate\?\.territorialScopes\);\s*if \(!scopes\.length\) return "";/);
});

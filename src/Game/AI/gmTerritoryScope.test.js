import test from "node:test";
import assert from "node:assert/strict";
import { detectExplicitBaseTerritoryScope, scopeContainsRegion } from "./gmTerritoryScope.js";

const catalog = [
  { id: "PRK.1", name: "Sinuiju", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.2", name: "Pyongyang", country: "North Korea", countryCode: "PRK" },
  { id: "PRK.3", name: "Hamhung", country: "North Korea", countryCode: "PRK" },
  { id: "KOR.1", name: "Seoul", country: "South Korea", countryCode: "KOR" },
  { id: "FRA.1", name: "Ile-de-France", country: "France", countryCode: "FRA" },
  { id: "FRA.2", name: "Normandie", country: "France", countryCode: "FRA" },
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

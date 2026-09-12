import test from "node:test";
import assert from "node:assert/strict";

import {
  expandWholeCountryTransfer,
  wholeCountrySourceToken,
} from "./territoryTransferScope.js";

const catalog = [
  { id: "fra-mainland", name: "France" },
  { id: "fra-overseas", name: "Guangzhouwan" },
  { id: "ger-mainland", name: "Germany" },
];

const ownerById = {
  "fra-mainland": "french republic",
  "fra-overseas": "french republic",
  "ger-mainland": "german empire",
};

const options = {
  catalog,
  resolveOwnerName: (value) => String(value ?? "").trim(),
  canonicalOwnerKey: (value) => String(value ?? "").trim().toLowerCase(),
  ownerKeyOf: (regionId) => ownerById[regionId] || "",
};

test("whole-country scope is owned by fromCode, not a stray regionId", () => {
  const transfer = {
    fromCode: "French Republic",
    toCode: "German Empire",
    regionId: "Guangzhouwan",
    regionName: "Guangzhouwan",
    wholeCountry: true,
  };

  assert.equal(wholeCountrySourceToken(transfer), "French Republic");
  assert.deepEqual(
    expandWholeCountryTransfer(transfer, options).map((entry) => entry.regionId),
    ["fra-mainland", "fra-overseas"],
  );
});

test("legacy whole-country payloads may still use the polity name in regionId when fromCode is absent", () => {
  const expanded = expandWholeCountryTransfer({
    toCode: "German Empire",
    regionId: "French Republic",
    wholeCountry: true,
  }, options);

  assert.deepEqual(expanded.map((entry) => entry.regionId), ["fra-mainland", "fra-overseas"]);
  assert.ok(expanded.every((entry) => entry.wholeCountry === undefined));
});

test("whole-country expansion excludes regions already controlled by the destination", () => {
  const expanded = expandWholeCountryTransfer({
    fromCode: "French Republic",
    toCode: "French Republic",
    regionId: "French Republic",
    wholeCountry: true,
  }, options);

  assert.deepEqual(expanded, []);
});

test("an unknown losing polity does not fall back to one coincidentally named province", () => {
  const expanded = expandWholeCountryTransfer({
    fromCode: "Unknown Polity",
    toCode: "German Empire",
    regionId: "Guangzhouwan",
    wholeCountry: true,
  }, options);

  assert.deepEqual(expanded, []);
});

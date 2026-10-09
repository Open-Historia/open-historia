/*! Open Historia — the names polity labels show © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import assert from "node:assert/strict";
import test from "node:test";

import { toCountryName } from "../../../runtime/ownerNames.js";
import { labelFoldKey, resolvePolityLabelNames } from "./polityNaming.js";

const record = (owner) => ({ owner });

// The owners the map's regions carry, with the game's own canonicaliser.
const names = (owners, polityOverrides = {}, extra = {}) => resolvePolityLabelNames({
  records: owners.map(record),
  polityOverrides,
  canonicalOwner: toCountryName,
  ...extra,
});

test("a polity is labelled with the name the scenario gave it, never a stock short form", () => {
  const labels = names(
    ["Latvian lineage", "Russian Federation"],
    { "Latvian lineage": { name: "Republic of Latvia" } },
  );
  assert.equal(labels["Latvian lineage"], "Republic of Latvia");
  assert.equal(labels["Russian Federation"], "Russian Federation");
});

test("rival regimes sharing one homeland keep their own names", () => {
  const labels = names(
    ["red-germany", "imperial-germany"],
    {
      "red-germany": { name: "German People's Republic" },
      "imperial-germany": { name: "Imperial Germany" },
    },
  );
  assert.equal(labels["red-germany"], "German People's Republic");
  assert.equal(labels["imperial-germany"], "Imperial Germany");
});

test("an invented polity name is never stemmed into a guessed country", () => {
  const labels = names(
    ["Imperial Kwantung Territories", "China"],
    {
      "Imperial Kwantung Territories": { name: "Imperial Kwantung Territories" },
      China: { name: "People's Republic of China" },
    },
  );
  assert.equal(labels["Imperial Kwantung Territories"], "Imperial Kwantung Territories");
  assert.equal(labels.China, "People's Republic of China");
});

test("a scenario's cartographic label wins over the name, without changing identity", () => {
  assert.equal(
    names(["Polish lineage"], { "Polish lineage": { name: "Polish Provisional Government", mapLabel: "Poland" } })["Polish lineage"],
    "Poland",
  );
  assert.equal(
    names(["Polish lineage"], { "Polish lineage": { name: "Polish Provisional Government", mapDistinctLabel: "Free Poland" } })["Polish lineage"],
    "Free Poland",
  );
});

test("colliding labels fall back to the owners' stable identities", () => {
  const labels = names(["west", "east", "north"], {
    west: { name: "Germany" },
    east: { name: "Germany" },
    north: { name: "Denmark" },
  });
  assert.deepEqual(labels, { west: "west", east: "east", north: "Denmark" });
});

test("labels collide when they read the same: case, accents and punctuation aside", () => {
  const labels = names(["a", "b"], { a: { name: "Côte d'Ivoire" }, b: { name: "COTE DIVOIRE" } });
  assert.deepEqual(labels, { a: "a", b: "b" });
});

test("labels in other scripts collide only with the same name", () => {
  // Folded to a-z, every such name was "" and collided with every other.
  const labels = names(["China", "Russia", "Egypt"], {
    China: { name: "中国" },
    Russia: { name: "Россия" },
    Egypt: { name: "مصر" },
  });
  assert.deepEqual(labels, { China: "中国", Russia: "Россия", Egypt: "مصر" });
  assert.equal(labelFoldKey("Россия"), labelFoldKey("РОССИЯ"));
  assert.notEqual(labelFoldKey("中国"), labelFoldKey("Россия"));
});

test("owner codes are keyed by the name they canonicalise to", () => {
  // A region taken by "ESP" and an override filed under the code: both are
  // Spain's, the namespace the boundary worker keys its geometry by.
  const labels = resolvePolityLabelNames({
    records: [record("France")],
    regionOwnershipOverrides: { "region-1": "ESP" },
    polityOverrides: { ESP: { name: "Kingdom of Spain" } },
    canonicalOwner: toCountryName,
  });
  assert.deepEqual(Object.keys(labels).sort(), ["France", "Spain"]);
  assert.equal(labels.Spain, "Kingdom of Spain");
});

test("an override under the name itself wins over one under its code", () => {
  const labels = names(["Spain"], {
    ESP: { name: "From the code" },
    Spain: { name: "From the name" },
  });
  assert.equal(labels.Spain, "From the name");
});

test("names are exact keys: a near name is another polity", () => {
  const labels = names(["Russia", "Russian Federation"], { "Russian Federation": { name: "The Federation" } });
  assert.equal(labels.Russia, "Russia");
  assert.equal(labels["Russian Federation"], "The Federation");
});

test("the label goes through the display name and then the player's language", () => {
  const seen = [];
  const labels = names(["Spain"], { Spain: { name: "Kingdom of Spain" } }, {
    displayName: (raw, owner) => {
      seen.push([raw, owner]);
      return `${raw}!`;
    },
    translate: (label) => (label === "Kingdom of Spain!" ? "Reino de España" : label),
  });
  assert.deepEqual(seen, [["Kingdom of Spain", "Spain"]]);
  assert.equal(labels.Spain, "Reino de España");
});

test("a translation that comes back empty leaves the owner's name", () => {
  assert.equal(names(["Spain"], {}, { translate: () => "" }).Spain, "Spain");
});

test("owners come from the regions, the ownership overrides and the registry", () => {
  const labels = resolvePolityLabelNames({
    records: [record(" Alpha "), record(""), null],
    regionOwnershipOverrides: { r1: "Beta", r2: "" },
    polityOverrides: { Gamma: {}, "": { name: "nobody" } },
  });
  assert.deepEqual(labels, { Alpha: "Alpha", Beta: "Beta", Gamma: "Gamma" });
  assert.deepEqual(resolvePolityLabelNames(), {});
});

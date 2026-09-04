import assert from "node:assert/strict";
import test from "node:test";

import { resolveContextualPolityLabels } from "../src/Game/Map/vnext/polityNaming.js";

const surface = (owner, gadm0 = []) => ({
  type: "Feature",
  properties: { owner, gadm0 },
  geometry: { type: "MultiPolygon", coordinates: [] },
});

test("Map vNext labels a polity with the name the scenario gave it, never a stock short form", () => {
  const labels = resolveContextualPolityLabels(
    { features: [surface("Latvian lineage", ["LVA"]), surface("Russian Federation", ["RUS"])] },
    { "Latvian lineage": { name: "Republic of Latvia" } },
  );
  assert.equal(labels.get("Latvian lineage"), "Republic of Latvia");
  assert.equal(labels.get("Russian Federation"), "Russian Federation");
});

test("Map vNext distinguishes rival regimes sharing one homeland", () => {
  const labels = resolveContextualPolityLabels(
    { features: [surface("red-germany", ["DEU"]), surface("imperial-germany", ["DEU"])] },
    {
      "red-germany": { name: "German People's Republic" },
      "imperial-germany": { name: "Imperial Germany" },
    },
  );
  assert.equal(labels.get("red-germany"), "German People's Republic");
  assert.equal(labels.get("imperial-germany"), "Imperial Germany");
});

test("Map vNext never stems an invented polity name into a guessed country", () => {
  const labels = resolveContextualPolityLabels(
    { features: [surface("Imperial Kwantung Territories", ["CHN"]), surface("China", ["CHN"])] },
    {
      "Imperial Kwantung Territories": { name: "Imperial Kwantung Territories" },
      China: { name: "People's Republic of China" },
    },
  );
  assert.equal(labels.get("Imperial Kwantung Territories"), "Imperial Kwantung Territories");
  assert.equal(labels.get("China"), "People's Republic of China");
});

test("Map vNext supports explicit scenario cartographic labels without changing identity", () => {
  const labels = resolveContextualPolityLabels(
    { features: [surface("Polish lineage", ["POL"])] },
    { "Polish lineage": { name: "Polish Provisional Government", mapLabel: "Poland" } },
  );
  assert.equal(labels.get("Polish lineage"), "Poland");
});

test("Map vNext falls back to stable identities when imported distinct names collide", () => {
  const labels = resolveContextualPolityLabels(
    { features: [surface("west", ["DEU"]), surface("east", ["DEU"])] },
    { west: { name: "Germany" }, east: { name: "Germany" } },
  );
  assert.equal(labels.get("west"), "west");
  assert.equal(labels.get("east"), "east");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildGameSeed, gameCityToFeature } from "./exportPreset.js";
import { normalizeCustomCityFeatureCollection } from "../runtime/cityFeatures.js";

const doc = (features) => ({
  name: "test",
  metadata: { kind: "import-world", startDate: "1950-01-01" },
  types: [{ id: "land", name: "Land" }],
  features,
  colorOverrides: {},
  flags: {},
  tags: {},
  polities: {},
});
const noRegions = { type: "FeatureCollection", features: [] };

// Save into the scenario, then open its map again.
const roundTrip = (features) =>
  buildGameSeed(doc(features), noRegions).cities.features.map((f, i) => gameCityToFeature(f, `feat_${i}`));

test("a city's tags, symbol and country survive saving a scenario and reopening its map", () => {
  const [fort, capital] = roundTrip([
    { id: "a", name: "Brest", type: "Coordinate", symbol: "star", coord: [23.7, 52.1], country: "Belarus", population: 340000, tags: ["city", "fortress", "border"], tier: 2 },
    { id: "b", name: "Minsk", type: "Coordinate", symbol: "circle", coord: [27.56, 53.9], country: "Belarus", population: 2000000, tags: ["city", "capital", "industry"] },
  ]);
  assert.equal(fort.name, "Brest");
  assert.equal(fort.symbol, "star");
  assert.equal(fort.country, "Belarus");
  assert.deepEqual(fort.tags, ["city", "fortress", "border"]);
  assert.equal(fort.tier, 2);
  assert.equal(capital.symbol, "circle");
  assert.deepEqual(capital.tags, ["city", "capital", "industry"]);
});

test("an ordinary city writes nothing extra, and comes back as it went", () => {
  const seed = buildGameSeed(doc([
    { id: "a", name: "Lyon", type: "Coordinate", symbol: "square", coord: [4.83, 45.76], country: "", population: 520000, tags: ["city"] },
    { id: "b", name: "Paris", type: "Coordinate", symbol: "square", coord: [2.35, 48.85], population: 2100000, tags: ["capital", "city"] },
  ]), noRegions);
  for (const f of seed.cities.features) {
    assert.equal("tags" in f.properties, false);
    assert.equal("symbol" in f.properties, false);
    assert.equal("country" in f.properties, false);
  }
  const [lyon, paris] = seed.cities.features.map((f, i) => gameCityToFeature(f, `feat_${i}`));
  assert.deepEqual(lyon.tags, ["city"]);
  assert.equal(lyon.symbol, "square");
  assert.equal(lyon.country, "");
  assert.deepEqual(paris.tags, ["city", "capital"]);
});

test("the game still reads the cities, with the new properties passed through", () => {
  const seed = buildGameSeed(doc([
    { id: "a", name: "Brest", type: "Coordinate", symbol: "star", coord: [23.7, 52.1], country: "Belarus", population: 340000, tags: ["city", "fortress"] },
  ]), noRegions);
  const [city] = normalizeCustomCityFeatureCollection(seed.cities).features;
  assert.equal(city.properties.city, "Brest");
  assert.equal(city.properties._ohCapital, false);
  assert.deepEqual(city.properties.tags, ["city", "fortress"]);
});

test("a stored city without the new properties opens as before", () => {
  const feature = gameCityToFeature({
    type: "Feature",
    geometry: { type: "Point", coordinates: [30.52, 50.45, 0] },
    properties: { city: "Kyiv", population: 2900000, capital: "primary", tier: 3, populationByYear: { 1950: 1000000 } },
  }, "feat_1");
  assert.deepEqual(feature.coord, [30.52, 50.45]);
  assert.deepEqual(feature.tags, ["city", "capital"]);
  assert.equal(feature.symbol, "square");
  assert.equal(feature.tier, 3);
  assert.deepEqual(feature.populationByYear, { 1950: 1000000 });
  assert.equal(gameCityToFeature({ type: "Feature", properties: { city: "Nowhere" }, geometry: null }, "x"), null);
});

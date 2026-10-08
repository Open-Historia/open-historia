import test from "node:test";
import assert from "node:assert/strict";
import { buildGameSeed, gameCityToFeature } from "./exportPreset.js";
import { normalizeCustomCityFeatureCollection } from "../runtime/cityFeatures.js";
import { normalizeRegionTypes } from "../runtime/regionTypes.js";

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

test("the map's region types go to the game with the scenario, and a round trip keeps them", () => {
  const types = [
    { id: "land", name: "Land" },
    { id: "sea", name: "Sea", overrideColor: [20, 60, 140], passable: false, note: "the author's own field" },
  ];
  const regions = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "reg_1", owner: "", typeId: "sea" } }],
  };
  const seed = buildGameSeed({ ...doc([]), types }, regions);
  assert.deepEqual(seed.world.regionTypes.map((type) => type.id), ["land", "sea"]);
  assert.deepEqual(seed.world.regionTypes[1].overrideColor, [20, 60, 140]);
  assert.equal(seed.world.regionTypes[1].passable, false);
  assert.equal(seed.world.regionTypes[1].note, "the author's own field");
  assert.equal(seed.regions.features[0].properties.typeId, "sea", "each region still names its type");
  // What the Workshop reads back when it opens the scenario (MapEditor.jsx).
  assert.deepEqual(normalizeRegionTypes(seed.world.regionTypes), seed.world.regionTypes);
});

// --- the map's projection and where its picture lies (server/mapProjection.js) ---

test("a save writes the projection and the picture's bounds, and nothing for a map that has neither", () => {
  const plain = buildGameSeed({ ...doc([]), metadata: { ...doc([]).metadata, customBackground: { kind: "image", dataUrl: "data:image/png;base64,AAAA" } } }, noRegions);
  assert.deepEqual(plain.world.background, { kind: "image" }, "a picture that fills the square is saved as it always was");
  assert.equal("projection" in plain.world, false);

  const bounds = { west: -180, south: -66.51326, east: 180, north: 66.51326 };
  const laid = buildGameSeed({
    ...doc([]),
    metadata: { ...doc([]).metadata, projection: { type: "equirectangular" }, customBackground: { kind: "image", dataUrl: "data:image/png;base64,AAAA", bounds } },
  }, noRegions);
  assert.deepEqual(laid.world.background, { kind: "image", bounds });
  assert.deepEqual(laid.world.projection, { type: "equirectangular", laidOut: true }, "marked laid out, so an import never converts it again");
  assert.deepEqual(laid.backgroundData, { dataUrl: "data:image/png;base64,AAAA" });

  const freeform = buildGameSeed({ ...doc([]), metadata: { ...doc([]).metadata, projection: { type: "freeform", aspect: 1.5 } } }, noRegions);
  assert.deepEqual(freeform.world.projection, { type: "freeform", aspect: 1.5, laidOut: true });

  // Away from Mercator with no basemap of its own: a plain sea, no payload.
  const sea = buildGameSeed({ ...doc([]), metadata: { ...doc([]).metadata, projection: { type: "robinson" }, customBackground: { kind: "plain" } } }, noRegions);
  assert.deepEqual(sea.world.background, { kind: "plain" });
  assert.equal(sea.backgroundData, null);
  assert.equal(sea.world.customRegions, true);
});

test("a Mercator map that only disables the globe or the looping still saves that", () => {
  const seed = buildGameSeed({ ...doc([]), metadata: { ...doc([]).metadata, projection: { type: "mercator", globe: false, wrap: false } } }, noRegions);
  assert.deepEqual(seed.world.projection, { type: "mercator", globe: false, wrap: false, laidOut: true });
});

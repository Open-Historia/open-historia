import test from "node:test";
import assert from "node:assert/strict";
import {
  customCityFeatureCount,
  isPrimaryCityCapital,
  normalizeCustomCityFeatureCollection,
} from "../src/runtime/cityFeatures.js";

const point = (properties, coordinates = [24.1, 56.9]) => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates },
});

test("Fault Lines name + boolean-capital features normalize for MapLibre", () => {
  const result = normalizeCustomCityFeatureCollection({
    type: "FeatureCollection",
    features: [point({ name: "Riga", tier: 3, capital: true, population: 700000 })],
  });
  assert.equal(customCityFeatureCount(result), 1);
  const props = result.features[0].properties;
  assert.equal(props.city, "Riga");
  assert.equal(props.name, "Riga");
  assert.equal(props._ohCapital, true);
  assert.equal(props._ohTier, 3);
});

test("legacy city + primary capital form remains compatible", () => {
  const result = normalizeCustomCityFeatureCollection({
    type: "FeatureCollection",
    features: [point({ city: "Paris", tier: 4, capital: "primary" })],
  });
  const props = result.features[0].properties;
  assert.equal(props.city, "Paris");
  assert.equal(props._ohCapital, true);
  assert.equal(props._ohTier, 4);
});

test("capital tag is accepted", () => {
  assert.equal(isPrimaryCityCapital({ tags: ["city", "capital"] }), true);
});

test("invalid and non-point rows are safely dropped", () => {
  const result = normalizeCustomCityFeatureCollection({
    type: "FeatureCollection",
    features: [
      point({ name: "Valid" }),
      { type: "Feature", properties: { name: "Polygon" }, geometry: { type: "Polygon", coordinates: [] } },
      point({ name: "" }),
    ],
  });
  assert.equal(customCityFeatureCount(result), 1);
});

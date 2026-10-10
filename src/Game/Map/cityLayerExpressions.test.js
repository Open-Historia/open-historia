import test from "node:test";
import assert from "node:assert/strict";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { cityPopulationExpr, populationFilter, populationLabelFilter } from "./cityLayerExpressions.js";

// Evaluate the real filters with MapLibre's own expression engine.
const shows = (filter, zoom, properties) => {
  const compiled = featureFilter(filter);
  return compiled.filter({ zoom }, { type: 1, properties, geometry: [] });
};

const town = { city: "Smallville", population: 40000, capital: "" };

test("a stock town the AI grew into a major city draws where major cities do", () => {
  const pop = cityPopulationExpr({ smallville: 3500000 });
  assert.equal(shows(populationFilter(pop), 4, town), true);
  assert.equal(shows(populationLabelFilter(pop), 4, town), false, "labels still wait for 4M at z4");
  assert.equal(shows(populationLabelFilter(cityPopulationExpr({ smallville: 4500000 })), 4, town), true);
  // Without the override the town stays hidden until close zoom.
  const tilePop = cityPopulationExpr({});
  assert.equal(shows(populationFilter(tilePop), 4, town), false);
  assert.equal(shows(populationFilter(tilePop), 8, town), false);
});

test("a city razed to nothing leaves the map at every zoom", () => {
  const metropolis = { city: "Metropolis", population: 8000000, capital: "" };
  assert.equal(shows(populationFilter(cityPopulationExpr({})), 3, metropolis), true);
  const pop = cityPopulationExpr({ metropolis: 0 });
  for (const zoom of [3, 5.5, 7, 9]) {
    assert.equal(shows(populationFilter(pop), zoom, metropolis), false, `zoom ${zoom}`);
    assert.equal(shows(populationLabelFilter(pop), zoom, metropolis), false, `zoom ${zoom}`);
  }
});

test("capitals show whatever their population", () => {
  const capital = { city: "Capital City", population: 10, capital: "primary" };
  const pop = cityPopulationExpr({ "capital city": 0 });
  assert.equal(shows(populationFilter(pop), 3, capital), true);
  assert.equal(shows(populationLabelFilter(pop), 3, capital), true);
});

test("a population set under a city's new name reaches the tile's old name", () => {
  const pop = cityPopulationExpr({ stalingrad: 3500000 }, { tsaritsyn: "Stalingrad" });
  assert.equal(shows(populationFilter(pop), 4, { city: "Tsaritsyn", population: 60000, capital: "" }), true);
});

test("overrides that differ only in case make one valid expression", () => {
  const pop = cityPopulationExpr({ Paris: 5000000, paris: 5000000 });
  assert.equal(shows(populationFilter(pop), 3, { city: "Paris", population: 10, capital: "" }), true);
});

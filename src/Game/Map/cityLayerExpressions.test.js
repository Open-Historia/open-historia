import test from "node:test";
import assert from "node:assert/strict";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { capitalExpr, cityPopulationExpr, populationFilter, populationLabelFilter } from "./cityLayerExpressions.js";
import { capitalNamesOf } from "./useWorldState.js";

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

test("a city a country makes its capital is a capital, by its new name too (a Discord test game, 2026-10-27)", () => {
  // Hill Kingdom renamed Millbrook to Hillcrown and made it its capital.
  const world = {
    cityRenames: { millbrook: "Hillcrown" },
    countryStats: { "Hill Kingdom": { capital: "Hillcrown" }, Gone: { capital: "Ashgrove" }, "Hill folk": { capital: "Yarrowfield Hollow (largest village)" } },
    polityOverrides: { Gone: { status: "dissolved" } },
  };
  const names = capitalNamesOf(world).split("\n");
  assert.deepEqual(names, ["hillcrown", "yarrowfield hollow (largest village)"], "a dissolved country's capital no longer counts");
  const capital = capitalExpr(names, world.cityRenames);
  const millbrook = { city: "Millbrook", population: 69800, capital: "" };
  const pop = cityPopulationExpr({});
  assert.equal(shows(capital, 4, millbrook), true);
  assert.equal(shows(populationFilter(pop, capital), 3, millbrook), true, "drawn at every zoom, as capitals are");
  assert.equal(shows(populationLabelFilter(pop, capital), 3, millbrook), true);
  assert.equal(shows(capital, 4, { city: "Ashgrove", population: 1, capital: "" }), false);
  // The map's own capitals stay capitals, and with no capitals named nothing changes.
  assert.equal(shows(capital, 4, { city: "Vaelthorn", population: 1, capital: "primary" }), true);
  assert.deepEqual(capitalExpr([], {}), ["==", ["get", "capital"], "primary"]);
});

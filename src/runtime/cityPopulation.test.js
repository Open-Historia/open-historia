/*! Open Historia — a city's population by year: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/cityPopulation.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  cityPopulationKey,
  effectiveCityPopulation,
  gameDateFractionalYear,
  latestPopulation,
  populationByYearField,
  populationForDate,
  populationForYear,
  readPopulationByYear,
  withPopulationsForYear,
} from "./cityPopulation.js";

test("a series reads from an object, a list, or Natural Earth's flat fields", () => {
  assert.deepEqual(readPopulationByYear({ populationByYear: { 1950: 1000, "-500": 20, 2000: "3000", 1990: 0 } }), { 1950: 1000, "-500": 20, 2000: 3000 });
  assert.deepEqual(readPopulationByYear({ populations: [{ year: 1900, population: 50 }, [1910, 70], { year: 0, population: 9 }] }), { 1900: 50, 1910: 70 });
  assert.deepEqual(readPopulationByYear({ POP1950: 5, pop_2000: 9, population_2020: 11, POP_MAX: 99, pop2025: 0 }), { 1950: 5, 2000: 9, 2020: 11 },
    "POP_MAX is not a year, and Natural Earth's 0 is no figure");
  assert.deepEqual(readPopulationByYear({ populationByYear: "{\"1950\":12}" }), { 1950: 12 }, "a map click's JSON text");
  assert.deepEqual(readPopulationByYear({ population: 5 }), {});
  assert.deepEqual(populationByYearField({ population: 5 }), {});
  assert.deepEqual(populationByYearField({ POP1950: 5 }), { populationByYear: { 1950: 5 } });
  assert.equal(latestPopulation({ 1950: 5, 2000: 9 }), 9);
});

test("the population for a date runs straight between the years around it, and holds outside them", () => {
  const byYear = { 1950: 1000, 2000: 2000 };
  assert.equal(populationForYear(byYear, 1975), 1500);
  assert.equal(populationForYear(byYear, 1900), 1000, "before the first year: the first figure");
  assert.equal(populationForYear(byYear, 2050), 2000, "after the last: the last");
  assert.equal(populationForDate(byYear, "1975-01-01"), 1500);
  assert.equal(populationForDate(byYear, "1975-12-31"), 1520, "a date late in the year is nearly a whole year along");
  assert.equal(populationForDate({}, "1975-01-01"), null);
  assert.equal(populationForDate(byYear, "not a date"), null);
});

test("across the start of the era there is no year zero", () => {
  // 2 BC (astronomical -1) to AD 2 (astronomical 2): three years apart, not four.
  const byYear = { "-2": 100, 2: 400 };
  assert.equal(populationForYear(byYear, 1), 300, "AD 1 is two of the three years along");
  assert.equal(populationForYear(byYear, -1), 200, "1 BC is one along");
  assert.equal(gameDateFractionalYear("-0001-01-01"), 0);
});

test("a population set by hand wins over the series, which then is not read", () => {
  const props = { city: "Lagos", population: 900, POP1950: 300, POP2000: 7000 };
  assert.equal(effectiveCityPopulation(props, { date: "1950-01-01" }), 300);
  assert.equal(effectiveCityPopulation(props, { date: "1950-01-01", cityPopulations: { lagos: 12345 } }), 12345);
  assert.equal(effectiveCityPopulation(props, {}), 900, "no date: the file's own figure");
  assert.equal(effectiveCityPopulation({ city: "Nowhere" }, { date: "1950-01-01" }), 0);
  assert.equal(cityPopulationKey(" Lagos "), "lagos");
});

test("the map's cities take the year's figure, and a map without series is handed back as it was", () => {
  const plain = { type: "FeatureCollection", features: [{ type: "Feature", properties: { city: "A", population: 5 }, geometry: { type: "Point", coordinates: [0, 0] } }] };
  assert.equal(withPopulationsForYear(plain, 1950), plain);
  const dated = {
    type: "FeatureCollection",
    features: [
      ...plain.features,
      { type: "Feature", properties: { city: "B", population: 1, populationByYear: { 1900: 100, 2000: 300 } }, geometry: { type: "Point", coordinates: [1, 1] } },
    ],
  };
  const out = withPopulationsForYear(dated, 1950);
  assert.notEqual(out, dated);
  assert.equal(out.features[0], dated.features[0], "a city without a series is untouched");
  assert.equal(out.features[1].properties.population, 200);
  assert.equal(dated.features[1].properties.population, 1, "the loaded collection is not mutated");
  assert.equal(withPopulationsForYear(dated, null), dated);
});

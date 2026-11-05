import assert from "node:assert/strict";
import test from "node:test";

import { fortifyCostFor, fortifyCostReckoner } from "./fortifyCost.js";

// The engineers price every height of a line with one reckoner, which reads the
// country's sheets once (2026-10-24): it must price exactly as fortifyCostFor.
const world = {
  polityOverrides: {
    Testland: { name: "Testland", population: 8000000, military: { manpowerShare: 6 } },
    Otherland: { name: "Otherland" },
  },
  countryStats: {
    Testland: { population: { total: 9000000 }, economy: { gdp: 100 } },
  },
};
const line = [[10, 50], [10.5, 50.2], [11, 50.1], [11.6, 50.4]];

test("a reckoner prices every line and level as fortifyCostFor does", () => {
  for (const country of ["Testland", "Otherland", "Nowhere"]) {
    const costOf = fortifyCostReckoner(world, country);
    for (let level = 1; level <= 10; level += 1) {
      for (const points of [line, line.slice(1), line.slice(1, -1), []]) {
        assert.deepEqual(costOf(points, level), fortifyCostFor(world, country, points, level), `${country} level ${level}`);
      }
    }
  }
});

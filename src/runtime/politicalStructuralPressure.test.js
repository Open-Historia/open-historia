import test from "node:test";
import assert from "node:assert/strict";

import { normalizePoliticalActors } from "./politicalActors.js";
import { derivePoliticalStructuralSignals } from "./politicalStructuralPressure.js";

const baseWorld = () => ({
  politicalActors: normalizePoliticalActors({
    byPolity: {
      A: { polityKey: "A", government: { form: "Republic" }, parties: [] },
      B: { polityKey: "B", government: { form: "Republic" }, parties: [] },
    },
  }),
  countryStats: {},
  relations: [],
  wars: [],
});

const issuesFor = (signals, polity) => new Set((signals[polity] || []).map((entry) => entry.issue));

test("structural Stats stress creates political pressure signals without inventing events", () => {
  const world = baseWorld();
  world.countryStats.A = {
    stability: 30,
    economy: { gdpGrowth: -4, inflation: 12, unemployment: 11 },
  };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const issues = issuesFor(result, "A");
  assert.ok(issues.has("economic_stress"));
  assert.ok(issues.has("cost_of_living"));
  assert.ok(issues.has("unemployment"));
  assert.ok(issues.has("institutional_trust"));
  assert.equal(result.B, undefined);
  assert.ok(result.A.every((entry) => entry.source?.kind === "structural"));
});

test("active wars create security pressure and sustained wars add war weariness", () => {
  const world = baseWorld();
  world.wars = [{
    id: "war-ab",
    status: "active",
    sideA: ["A"],
    sideB: ["B"],
    startedDate: "2013-01-01",
  }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  for (const polity of ["A", "B"]) {
    const issues = issuesFor(result, polity);
    assert.ok(issues.has("security"));
    assert.ok(issues.has("war_weariness"));
  }
});

test("hostile bilateral relations raise bounded security pressure for both existing actors", () => {
  const world = baseWorld();
  world.relations = [{ a: "A", b: "B", score: -75, status: "hostile" }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.ok(issuesFor(result, "A").has("security"));
  assert.ok(issuesFor(result, "B").has("security"));
  assert.ok(result.A.every((entry) => entry.salience <= 100 && entry.strain <= 100));
});

test("structural derivation never creates signals for a polity without a Political Actor", () => {
  const world = baseWorld();
  world.countryStats.Unknown = { economy: { inflation: 50, unemployment: 30, gdpGrowth: -20 } };
  world.relations = [{ a: "Unknown", b: "A", score: -100 }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.equal(result.Unknown, undefined);
  assert.ok(result.A);
});

test("structural derivation is deterministic and scales persistent exposure without linear turn spam", () => {
  const world = baseWorld();
  world.countryStats.A = { economy: { inflation: 15 } };
  const one = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const twelve = derivePoliticalStructuralSignals(world, { months: 12, updatedAt: "2015-03-22" });
  const twelveAgain = derivePoliticalStructuralSignals(world, { months: 12, updatedAt: "2015-03-22" });
  assert.deepEqual(twelve, twelveAgain);
  const oneCost = one.A.find((entry) => entry.issue === "cost_of_living").salience;
  const twelveCost = twelve.A.find((entry) => entry.issue === "cost_of_living").salience;
  assert.ok(twelveCost > oneCost);
  assert.ok(twelveCost < oneCost * 12);
});


test("economic structural pressure prefers recent deterioration over modern-era assumptions", () => {
  const world = baseWorld();
  world.countryStats.A = { stability: 60, economy: { inflation: 6, unemployment: 8, gdpGrowth: 1 } };
  let result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "1867-02-01" });
  assert.equal(result.A, undefined);

  world.countryStatsHistory = {
    A: [{ date: "1867-01-01", inflation: 2, unemployment: 5, stability: 70 }],
  };
  result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "1867-02-01" });
  const issues = issuesFor(result, "A");
  assert.ok(issues.has("cost_of_living"));
  assert.ok(issues.has("unemployment"));
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWorldState,
  advanceProjectsInWorld,
  applyProjectOutcomesToWorld,
} from "./gameState.js";
import { publicProjectOutcomes } from "./projectDisclosure.js";

const sheet = () => ({
  stability: 50,
  economy: { gdp: 1_000_000, budgetBalance: 0, publicDebt: 0, gdpGrowth: 0 },
});
const record = ({ id, ownerCode, durationDays, change, secrecy = "public" }) => ({
  id, name: "Hospitals", ownerCode, status: "active", funding: "normal",
  secrecy, startedAt: "2041-05-01", progress: 0, spent: 0,
  plan: { durationDays, monthlyCost: 0, milestones: [],
    effects: [{ type: "stat", stat: "economy.gdp", change }] },
});
const step = (projects, countryStats) => {
  const original = normalizeWorldState({ projects, countryStats });
  const advanced = advanceProjectsInWorld({
    baseWorld: original, world: original, host: "France",
    fromDate: "2041-05-01", toDate: "2041-05-16", round: 2,
  });
  const settled = applyProjectOutcomesToWorld({
    world: advanced.world, outcomes: advanced.outcomes,
    host: "France", round: 2, date: "2041-05-16",
  });
  return { advanced, settled };
};

test("the completion of Germany's Hospitals must not settle France's same-named unfinished project", () => {
  const { advanced, settled } = step([
    record({ id: "fr-long", ownerCode: "France", durationDays: 100, change: 1 }),
    record({ id: "de-short", ownerCode: "Germany", durationDays: 7, change: 2 }),
  ], { France: sheet(), Germany: sheet() });
  const completed = advanced.outcomes.find((row) => row.type === "complete");
  assert.ok(completed);
  assert.equal(completed.projectId, "de-short");
  assert.equal(completed.owner, "Germany");
  assert.equal(settled.world.countryStats.France.economy.gdp, 1_000_000);
  assert.equal(settled.world.countryStats.Germany.economy.gdp, 1_020_000);
  assert.equal(settled.world.projects.find((row) => row.id === "fr-long").effectsAppliedAt, "");
  assert.equal(settled.world.projects.find((row) => row.id === "de-short").effectsAppliedAt, completed.date);
});

test("two same-owner programmes with the same title complete independently by ID", () => {
  const { advanced, settled } = step([
    record({ id: "fr-long", ownerCode: "France", durationDays: 100, change: 1 }),
    record({ id: "fr-short", ownerCode: "France", durationDays: 7, change: 2 }),
  ], { France: sheet() });
  const finished = advanced.outcomes.find((row) => row.type === "complete");
  assert.equal(finished?.projectId, "fr-short");
  assert.equal(settled.world.countryStats.France.economy.gdp, 1_020_000);
  assert.equal(settled.world.projects.find((row) => row.id === "fr-long").effectsAppliedAt, "");
  assert.equal(settled.world.projects.find((row) => row.id === "fr-short").effectsAppliedAt, finished.date);
});

test("legacy name-only outcome fallback must be unique within its polity", () => {
  const world = normalizeWorldState({
    projects: [
      record({ id: "fr", ownerCode: "France", durationDays: 7, change: 1 }),
      record({ id: "de", ownerCode: "Germany", durationDays: 7, change: 2 }),
    ],
    countryStats: { France: sheet(), Germany: sheet() },
  });
  const actual = applyProjectOutcomesToWorld({
    world, outcomes: [{ type: "complete", project: "Hospitals", owner: "Germany", date: "2041-05-08" }],
    host: "France", date: "2041-05-08",
  });
  assert.equal(actual.world.countryStats.Germany.economy.gdp, 1_020_000);
  assert.equal(actual.world.countryStats.France.economy.gdp, 1_000_000);
  assert.equal(actual.world.projects.find((row) => row.id === "de").effectsAppliedAt, "2041-05-08");
});

test("legacy name-only outcome with ambiguous candidates fails closed", () => {
  const world = normalizeWorldState({
    projects: [
      record({ id: "fr-a", ownerCode: "France", durationDays: 7, change: 1 }),
      record({ id: "fr-b", ownerCode: "France", durationDays: 7, change: 2 }),
    ],
    countryStats: { France: sheet() },
  });
  const result = applyProjectOutcomesToWorld({
    world, outcomes: [{ type: "complete", project: "Hospitals", owner: "France", date: "2041-05-08" }],
    host: "France", date: "2041-05-08",
  });
  assert.equal(result.world.countryStats.France.economy.gdp, 1_000_000);
  assert.equal(result.applied.length, 0);
  assert.ok(result.world.projects.every((row) => !row.effectsAppliedAt));
});

test("a mismatching owner accompanying an explicit project ID cannot redirect a completion", () => {
  const world = normalizeWorldState({
    projects: [record({ id: "de", ownerCode: "Germany", durationDays: 7, change: 2 })],
    countryStats: { France: sheet(), Germany: sheet() },
  });
  const result = applyProjectOutcomesToWorld({
    world, outcomes: [{ type: "complete", projectId: "de", project: "Hospitals", owner: "France", date: "2041-05-08" }],
    host: "France", date: "2041-05-08",
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.world.countryStats.Germany.economy.gdp, 1_000_000);
});

test("public narration can distinguish same-name public and covert projects with exact IDs", () => {
  const projects = [
    record({ id: "public", ownerCode: "France", durationDays: 7, change: 1 }),
    record({ id: "secret", ownerCode: "France", durationDays: 7, change: 2, secrecy: "covert" }),
  ];
  const outcomes = [
    { type: "complete", projectId: "public", project: "Hospitals", owner: "France", date: "2041-05-08" },
    { type: "complete", projectId: "secret", project: "Hospitals", owner: "France", date: "2041-05-08" },
  ];
  assert.deepEqual(publicProjectOutcomes(outcomes, projects, "France").map((row) => row.projectId), ["public"]);
});

test("a public project ID paired with another project's secret name is not public evidence", () => {
  const projects = [
    { id: "public", ownerCode: "France", name: "Public Roads", secrecy: "public" },
    { id: "secret", ownerCode: "France", name: "Operation Silent", secrecy: "covert" },
  ];
  const forged = [{ type: "complete", projectId: "public", project: "Operation Silent", owner: "France", date: "2041-05-08" }];
  assert.deepEqual(publicProjectOutcomes(forged, projects, "France"), []);
});

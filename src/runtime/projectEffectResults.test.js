// Run: node --test src/runtime/projectEffectResults.test.js
//
// A player's report, 2026-11-26: "Project was completed and the listed changes
// didn't happen. There also seems to be caps to their impact and areas they can
// effect. E.g. a 100% sustainability goal will impact energy autonomy but not
// internal security, national stability, international reputation, etc".
//
// Two flaws. The model was given a grammar of stat paths and left to guess the
// keys, so on a sheet of the scenario's own (the Modern Day 2026 sheet of the
// testdata save: nationalStability, internalSecurity … are customStats) it
// wrote paths the sheet does not have; and on completion an effect on a figure
// the sheet did not have, or on a country whose figures had not been read, was
// passed over without a word. Now the paths are the sheet's own, sent as the
// planner's schema enum (statPaths.js), and every effect ends with a result the
// project keeps and the player is shown (gameState.js applyProjectOutcomesToWorld).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyProjectOutcomesToWorld, normalizeWorldState } from "./gameState.js";
import { statPathEnum, statPathsOf, withStatPathEnum } from "./statPaths.js";
import { PROJECT_PLAN_SCHEMA } from "../Game/AI/gameplaySchemas.js";

const save = JSON.parse(readFileSync(new URL("./testdata/nemoModernDay2026.json", import.meta.url), "utf8"));

test("the paths an effect may name are the sheet's own: every figure of a scenario's sheet, none it lacks", () => {
  const paths = statPathEnum({ definition: save.statSheet, sheet: save.countryStats.Nemo });
  for (const path of ["customStats.nationalStability", "customStats.internalSecurity", "customStats.internationalReputation", "customStats.energyAutonomy", "customStats.gdp"]) {
    assert.ok(paths.includes(path), path);
  }
  assert.ok(!paths.includes("stability"), "the standard sheet's figure is not this sheet's");
  assert.ok(!paths.some((path) => path.startsWith("indices.")));
  assert.equal(paths.length, Object.keys(save.countryStats.Nemo.customStats).length);
  // The standard sheet: stability, the six indices, the economy, the people.
  const standard = statPathEnum({ definition: null, sheet: null });
  for (const path of ["stability", "indices.internalSecurity", "indices.internationalReputation", "indices.energyAutonomy", "economy.gdp", "economy.inflation", "population.total"]) {
    assert.ok(standard.includes(path), path);
  }
  // Labels come from the scenario.
  assert.equal(statPathsOf({ definition: save.statSheet }).find((entry) => entry.path === "customStats.internalSecurity").label, "Internal security");
});

test("the planner's schema carries the paths as an enum on effects and yields alike, and nothing else changes", () => {
  const paths = statPathEnum({ definition: save.statSheet, sheet: save.countryStats.Nemo });
  const tool = withStatPathEnum(PROJECT_PLAN_SCHEMA, paths);
  assert.deepEqual(tool.properties.effects.items.properties.stat.enum, paths);
  assert.deepEqual(tool.properties.yields.items.properties.stat.enum, paths);
  assert.equal(PROJECT_PLAN_SCHEMA.properties.effects.items.properties.stat.enum, undefined, "the shared schema is not changed");
  assert.deepEqual(tool.required, PROJECT_PLAN_SCHEMA.required);
  assert.equal(withStatPathEnum(PROJECT_PLAN_SCHEMA, []), PROJECT_PLAN_SCHEMA);
});

const completed = (effects, extra = {}) => ({
  id: "project-sustainability",
  name: "Hundred Per Cent Sustainability",
  status: "complete",
  progress: 100,
  completedAt: "2028-08-01",
  plan: { durationDays: 90, monthlyCost: 0, milestones: [], effects },
  ...extra,
});
const outcome = { type: "complete", date: "2028-08-01", projectId: "project-sustainability", project: "Hundred Per Cent Sustainability", owner: "Nemo" };

test("a completion's effects land on every figure they name, and what cannot land is said, never passed over", () => {
  const world = normalizeWorldState({
    countryStats: save.countryStats,
    groups: save.groups,
    projects: [completed([
      { type: "stat", stat: "customStats.energyAutonomy", change: 8 },
      { type: "stat", stat: "customStats.internalSecurity", change: 3 },
      { type: "stat", stat: "customStats.nationalStability", change: 4 },
      { type: "stat", stat: "customStats.internationalReputation", change: 5 },
      // The standard sheet's path on a sheet of the scenario's own: what used to vanish.
      { type: "stat", stat: "stability", change: 4 },
      { type: "relation", country: "Nemo", change: 5 },
      { type: "structure", name: "Solar Array" },
    ])],
  });
  const { world: after, applied, refused } = applyProjectOutcomesToWorld({ world, outcomes: [outcome], date: "2028-08-01", host: "Nemo" });
  const sheet = after.countryStats.Nemo.customStats;
  assert.equal(sheet.energyAutonomy, 61 + 8);
  assert.equal(sheet.internalSecurity, Math.min(100, 94 + 3));
  assert.equal(sheet.nationalStability, 90 + 4);
  assert.equal(sheet.internationalReputation, 4 + 5);
  assert.equal(applied.length, 4);
  assert.deepEqual(refused.map((entry) => entry.reason).sort(), ["noFigure", "noPlace", "sameCountry"]);
  const results = after.projects[0].effectResults;
  assert.equal(results.length, 7, "one result for every effect");
  assert.deepEqual(results.map((row) => row.status), ["applied", "applied", "applied", "applied", "refused", "refused", "refused"]);
  assert.equal(results[4].reason, "noFigure");
  assert.ok(after.projects[0].effectsAppliedAt);
  // Exactly once: the same outcome again changes nothing.
  const again = applyProjectOutcomesToWorld({ world: after, outcomes: [outcome], date: "2028-08-01", host: "Nemo" });
  assert.equal(again.world.countryStats.Nemo.customStats.energyAutonomy, 69);
  assert.equal(again.world.projects[0].effectResults.length, 7);
});

test("an effect on a country whose figures have not been read waits, and lands once they are", () => {
  const world = normalizeWorldState({
    countryStats: {},
    polityOverrides: { Norway: { name: "Norway" } },
    projects: [completed([{ type: "stat", stat: "indices.energyAutonomy", change: 6 }, { type: "stat", stat: "indices.internalSecurity", change: 2 }], { ownerCode: "Norway" })],
  });
  const first = applyProjectOutcomesToWorld({ world, outcomes: [{ ...outcome, owner: "Norway" }], date: "2028-08-01", host: "Norway" });
  assert.equal(first.applied.length, 0);
  assert.equal(first.refused.length, 0);
  assert.deepEqual(first.world.projects[0].effectResults.map((row) => row.status), ["waiting", "waiting"]);
  assert.equal(first.world.projects[0].effectsWaiting.length, 2);
  // Its figures are read; the next turn's call carries them out, with no outcome needed.
  const read = normalizeWorldState({ ...first.world, countryStats: { Norway: { stability: 70, indices: { energyAutonomy: 50, internalSecurity: 80 } } } });
  const next = applyProjectOutcomesToWorld({ world: read, outcomes: [], date: "2028-11-01", host: "Norway" });
  assert.equal(next.world.countryStats.Norway.indices.energyAutonomy, 56);
  assert.equal(next.world.countryStats.Norway.indices.internalSecurity, 82);
  assert.equal(next.applied.length, 2);
  assert.deepEqual(next.world.projects[0].effectResults.map((row) => row.status), ["applied", "applied"]);
  assert.equal(next.world.projects[0].effectsWaiting, undefined);
});

test("an old save's project with neither field loads and completes as before", () => {
  const world = normalizeWorldState({ countryStats: { France: { stability: 50 } }, projects: [completed([{ type: "stat", stat: "stability", change: 5 }], { ownerCode: "France" })] });
  assert.equal(world.projects[0].effectResults, undefined);
  const { world: after } = applyProjectOutcomesToWorld({ world, outcomes: [{ ...outcome, owner: "France" }], date: "2028-08-01", host: "France" });
  assert.equal(after.countryStats.France.stability, 55);
});

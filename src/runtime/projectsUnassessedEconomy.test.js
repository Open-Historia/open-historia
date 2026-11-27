// Run: node --test src/runtime/projectsUnassessedEconomy.test.js
//
// A player's report, 2026-11-26: "No native GDP baseline: paid projects cannot
// receive funding until assessed", with their save (testdata/
// nemoModernDay2026.json, trimmed). They play Nemo, a group, in a scenario with
// a stat sheet of its own. Nemo's sheet carries only the scenario's values; the
// hidden economy under it (statsBackend.js) was never kept, because the model
// wrote it with 0 people (Nemo is a machine) and a backend without people was
// thrown away whole, economy and all. With no economy on record the projects
// engine gave Nemo no budget, and every paid project stalled "for funds" for
// good: three of them at 0% since 2027.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { monthlyProjectBudget, ownerMeans, tickProjects } from "./projectEngine.js";
import { readStatsBackend, statsBackendOf, statsBackendPatch } from "./statsBackend.js";
import { mergeCountryStatPatch } from "./countryStats.js";

const save = JSON.parse(readFileSync(new URL("./testdata/nemoModernDay2026.json", import.meta.url), "utf8"));
const host = save.game.country;
const world = { countryStats: save.countryStats, projectFundingMode: save.projectFundingMode, groups: save.groups };
const stalled = save.projects.filter((project) => project.status === "stalled");

test("the save as it is: Nemo has no economy on record and three paid projects stalled for funds", () => {
  assert.equal(monthlyProjectBudget(save.countryStats.Nemo), null);
  assert.equal(statsBackendOf(save.countryStats.Nemo), null);
  assert.equal(stalled.length, 3);
  for (const project of stalled) {
    assert.equal(project.stallReason, "funds");
    assert.equal(project.progress, 0);
    assert.ok(project.plan.monthlyCost > 0);
  }
});

test("after the fix the stuck projects take up again at their planned pace, and nothing is booked against an unknown economy", () => {
  const result = tickProjects({ projects: save.projects, world, fromDate: save.game.gameDate, toDate: "2028-10-01", host, round: save.game.round + 1 });
  for (const before of stalled) {
    const after = result.projects.find((project) => project.id === before.id);
    assert.equal(after.status, "active", `${before.name} works again`);
    assert.ok(after.progress > 0, `${before.name} moved`);
    assert.equal(after.spent, 0, "no payment is made up");
    assert.ok(result.outcomes.some((outcome) => outcome.type === "resume" && outcome.projectId === before.id));
  }
  assert.ok(!result.outcomes.some((outcome) => outcome.type === "stall"));
  const means = ownerMeans(world, host, result.projects, host);
  assert.equal(means.assessed, false);
  assert.equal(means.covered, 1);
  assert.deepEqual(save.countryStats.Nemo.economy, undefined, "no GDP is invented on the sheet");
});

test("a backend of 0 people with an economy is kept, so a polity of no people has an economy the engine reads", () => {
  const written = { population: 0, gdp: 940000000, budgetBalance: 14, publicDebt: 0 };
  assert.deepEqual(readStatsBackend(written), { population: 0, gdp: 940000000, budgetBalance: 14, publicDebt: 0 });
  const sheet = mergeCountryStatPatch(save.countryStats.Nemo, statsBackendPatch(written));
  assert.equal(sheet.economy.gdp, 940000000);
  assert.deepEqual(sheet.customStats, save.countryStats.Nemo.customStats, "the scenario's own values are untouched");
  assert.ok(statsBackendOf(sheet), "it now has a backend, so it is not asked for one again");
  assert.ok(monthlyProjectBudget(sheet) > 0);
  // From then on it pays, like everyone else.
  const paying = tickProjects({ projects: stalled.map((project) => ({ ...project, status: "active", stallReason: "", starvedDays: 0 })), world: { ...world, countryStats: { ...world.countryStats, Nemo: sheet } }, fromDate: "2028-07-01", toDate: "2028-07-11", host, round: 15 });
  assert.ok(paying.projects.every((project) => project.spent > 0));
  // A whole backend still has to say how many people: one that leaves them out says nothing.
  assert.equal(readStatsBackend({ gdp: 5 }), null);
  assert.equal(readStatsBackend({ population: 0, gdp: 0 }), null);
});

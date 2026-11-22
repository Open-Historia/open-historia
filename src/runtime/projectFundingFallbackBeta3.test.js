import test from "node:test";
import assert from "node:assert/strict";
import { monthlyProjectBudget, ownerMeans, tickProjects } from "./projectEngine.js";

const owner = "Atlantis";
const plan = (monthlyCost) => ({ durationDays: 90, monthlyCost, milestones: [], effects: [] });
const project = (monthlyCost) => ({
  id: "atlantis-1", name: "Port", ownerCode: owner,
  status: "active", funding: "normal", progress: 0, spent: 0, starvedDays: 0,
  plan: plan(monthlyCost),
});
const jump = (world, projects, fromDate = "2041-05-01", toDate = "2041-05-31") =>
  tickProjects({ world, projects, host: owner, fromDate, toDate, round: 3 });

test("missing and explicit zero GDP stay unassessed and cannot mint project payments", () => {
  for (const stats of [null, {}, { economy: { gdp: 0 } }, { economy: { gdp: "unknown" } }]) {
    const world = { countryStats: { [owner]: stats } };
    const before = structuredClone(world);
    assert.equal(monthlyProjectBudget(stats), null);
    const result = jump(world, [project(120_000)]);
    assert.equal(result.projects[0].spent, 0);
    assert.equal(result.projects[0].progress, 0);
    assert.equal(result.projects[0].paidShare, 0);
    assert.deepEqual(world, before, "no invented or normalized economic data");
  }
});

test("a paid project stalls after an unassessed month, and resumes when native GDP is established", () => {
  const missing = { countryStats: {} };
  const starved = jump(missing, [project(12_000)]);
  assert.equal(starved.projects[0].status, "stalled");
  assert.equal(starved.projects[0].stallReason, "funds");
  assert.equal(starved.projects[0].spent, 0);
  const known = { countryStats: { [owner]: { economy: { gdp: 120_000_000, budgetBalance: 0, publicDebt: 0 } } } };
  const resumed = jump(known, starved.projects, "2041-05-31", "2041-06-10");
  assert.equal(resumed.projects[0].status, "active");
  assert.ok(resumed.projects[0].progress > 0);
  assert.ok(resumed.projects[0].spent > 0);
  assert.ok(resumed.outcomes.some((row) => row.type === "resume"));
});

test("a zero-cost/non-fiscal project may work with unknown GDP without pretending to pay", () => {
  const world = { countryStats: {} };
  const result = jump(world, [project(0)]);
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
  assert.equal(result.projects[0].paidShare, 1);
});

test("unassessed capacity is reported as zero coverage of positive commitments, not full funding", () => {
  const means = ownerMeans({ countryStats: {} }, owner, [project(12_000)]);
  assert.equal(means.budget, null);
  assert.equal(means.committed, 12_000);
  assert.equal(means.covered, 0);
});

test("custom stats named GDP do not silently authorize native project payments", () => {
  const world = { countryStats: { [owner]: { customStats: { gdp: 1_000_000_000 } } } };
  const result = jump(world, [project(12_000)]);
  assert.equal(result.projects[0].spent, 0);
  assert.equal(result.projects[0].progress, 0);
});

test("unassessed funded projects tick equally across one or multiple time skips", () => {
  const world = { countryStats: {} };
  const original = [project(12_000)];
  const single = jump(world, original, "2041-05-01", "2041-07-01");
  const a = jump(world, original, "2041-05-01", "2041-06-01");
  const b = jump(world, a.projects, "2041-06-01", "2041-07-01");
  assert.equal(b.projects[0].status, single.projects[0].status);
  assert.equal(b.projects[0].spent, single.projects[0].spent);
  assert.equal(b.projects[0].progress, single.projects[0].progress);
  assert.deepEqual([...a.outcomes, ...b.outcomes], single.outcomes);
});

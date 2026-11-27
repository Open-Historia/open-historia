import test from "node:test";
import assert from "node:assert/strict";
import { monthlyProjectBudget, ownerMeans, tickProjects } from "./projectEngine.js";

// An owner whose economy is not assessed works its projects at their planned
// pace and books nothing (projectEngine.js tickProjects): no payment is made up
// from an unknown economy, no GDP is invented, and the work does not stall for
// want of a budget nobody has read (a player's report, 2026-11-26: "No native
// GDP baseline: paid projects cannot receive funding until assessed").
const owner = "Atlantis";
const plan = (monthlyCost) => ({ durationDays: 90, monthlyCost, milestones: [], effects: [] });
const project = (monthlyCost) => ({
  id: "atlantis-1", name: "Port", ownerCode: owner,
  status: "active", funding: "normal", progress: 0, spent: 0, starvedDays: 0,
  plan: plan(monthlyCost),
});
const jump = (world, projects, fromDate = "2041-05-01", toDate = "2041-05-31") =>
  tickProjects({ world, projects, host: owner, fromDate, toDate, round: 3 });

test("missing and explicit zero GDP stay unassessed: the work moves at its planned pace and nothing is booked", () => {
  for (const stats of [null, {}, { economy: { gdp: 0 } }, { economy: { gdp: "unknown" } }]) {
    const world = { countryStats: { [owner]: stats } };
    const before = structuredClone(world);
    assert.equal(monthlyProjectBudget(stats), null);
    const result = jump(world, [project(120_000)]);
    assert.equal(result.projects[0].spent, 0, "no payment is made up from an unknown economy");
    assert.equal(result.projects[0].status, "active");
    assert.equal(result.projects[0].progress, jump({ countryStats: {} }, [project(0)]).projects[0].progress, "as fast as a project that costs nothing");
    assert.ok(result.projects[0].progress > 0);
    assert.equal(result.projects[0].paidShare, 1);
    assert.deepEqual(world, before, "no invented or normalized economic data");
  }
});

test("a paid project never stalls for want of an unassessed budget, and pays once the economy is read", () => {
  const missing = { countryStats: {} };
  const worked = jump(missing, [project(12_000)], "2041-05-01", "2041-07-01");
  assert.equal(worked.projects[0].status, "active");
  assert.ok(!worked.outcomes.some((row) => row.type === "stall"));
  const known = { countryStats: { [owner]: { economy: { gdp: 120_000_000, budgetBalance: 0, publicDebt: 0 } } } };
  const paying = jump(known, worked.projects, "2041-07-01", "2041-07-11");
  assert.ok(paying.projects[0].progress > worked.projects[0].progress);
  assert.ok(paying.projects[0].spent > 0, "an assessed economy pays");
});

test("a project stalled for funds under the old rule takes up again by itself once that rule is gone", () => {
  const stalled = { ...project(380_000), status: "stalled", stallReason: "funds", starvedDays: 30, paidShare: 0 };
  const result = jump({ countryStats: {} }, [stalled], "2028-07-01", "2028-07-11");
  assert.equal(result.projects[0].status, "active");
  assert.ok(result.outcomes.some((row) => row.type === "resume"));
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
});

test("a zero-cost/non-fiscal project may work with unknown GDP without pretending to pay", () => {
  const world = { countryStats: {} };
  const result = jump(world, [project(0)]);
  assert.ok(result.projects[0].progress > 0);
  assert.equal(result.projects[0].spent, 0);
  assert.equal(result.projects[0].paidShare, 1);
});

test("unassessed means are reported as not assessed and covered, with no budget figure", () => {
  const means = ownerMeans({ countryStats: {} }, owner, [project(12_000)]);
  assert.equal(means.budget, null);
  assert.equal(means.assessed, false);
  assert.equal(means.committed, 12_000);
  assert.equal(means.covered, 1);
  const assessed = ownerMeans({ countryStats: { [owner]: { economy: { gdp: 120_000_000 } } } }, owner, [project(12_000)]);
  assert.equal(assessed.assessed, true);
});

test("custom stats named GDP are never read as the native economy: nothing is booked against them", () => {
  const world = { countryStats: { [owner]: { customStats: { gdp: 1_000_000_000 } } } };
  assert.equal(monthlyProjectBudget(world.countryStats[owner]), null);
  const result = jump(world, [project(12_000)]);
  assert.equal(result.projects[0].spent, 0);
});

test("unassessed funded projects tick equally across one or multiple time skips", () => {
  const world = { countryStats: {} };
  const original = [project(12_000)];
  const single = jump(world, original, "2041-05-01", "2041-07-01");
  const a = jump(world, original, "2041-05-01", "2041-06-01");
  const b = jump(world, a.projects, "2041-06-01", "2041-07-01");
  assert.equal(b.projects[0].status, single.projects[0].status);
  assert.equal(b.projects[0].spent, single.projects[0].spent);
  // Progress is rounded to four places at the end of each period (roundProgress).
  assert.ok(Math.abs(b.projects[0].progress - single.projects[0].progress) <= 0.0002);
  assert.deepEqual([...a.outcomes, ...b.outcomes], single.outcomes);
});

/*! Open Historia — what a player's screen may ask of its own Projects board: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/seatProjects.test.js
//
// The review of 2026-11-18 (security S1, S9, S10): the host took a page's
// project as the page wrote it. Its probe (security-scratch/projectOnComplete.mjs)
// is the second test here, through the host's own door, the board's lending and
// the engine, as the probe ran it; every op is now made again by the host.
import test from "node:test";
import assert from "node:assert/strict";

import { PROJECT_REFUSALS, SEAT_OPEN_PROJECTS_MOST, seatPlanOf, seatProjectOps } from "./seatProjects.js";
import { lendBoards } from "./seatBoards.js";
import { advanceProjectsInWorld, applyProjectOpsToWorld, applyProjectOutcomesToWorld } from "../../runtime/gameState.js";
import { COST_SHARE_OF_BUDGET_MOST, monthlyProjectBudget } from "../../runtime/projectEngine.js";

const guest = "Ruritania";
const victim = "Freedonia";
const ids = () => {
  let n = 0;
  return () => `project-host-${(n += 1)}`;
};
const world = () => ({
  countryStats: {
    [guest]: { stability: 50, military: { land: 60 }, economy: { gdp: 1.2e12, gdpGrowth: 0, budgetBalance: 0, publicDebt: 40 } },
    [victim]: { stability: 60, military: { land: 70, sea: 50, air: 50, quality: 60, technology: 60, spending: 50 }, economy: { gdp: 1e9 } },
  },
  projects: [{ id: "host-secret-1", name: "Host programme", ownerCode: "", plan: { durationDays: 400, monthlyCost: 10 }, status: "active", progress: 40 }],
  seatBoards: {},
});

test("a page's create is made again by the host: its id, its dates, what it does and what it costs are the host's", () => {
  const sent = [{
    op: "create",
    project: {
      id: "host-secret-1",
      name: "Road repairs",
      ownerCode: "",
      established: true,
      startedAt: "1700-01-01",
      progress: 99,
      plan: {
        durationDays: 1,
        monthlyCost: 0,
        effects: [
          { type: "stat", stat: "military.land", change: -50, country: victim },
          { type: "stat", stat: "stability", change: 6 },
          { type: "relation", country: victim, change: -10 },
          { type: "territory", region: "Some AI region", country: guest },
          { type: "territory", region: "Their region", country: victim },
        ],
      },
      onComplete: { polityChanges: [{ code: victim, operation: "dissolve" }] },
    },
  }];
  const { ops, refusal } = seatProjectOps(sent, { board: [], world: world(), country: guest, mint: ids() });
  assert.equal(refusal, "");
  assert.equal(ops.length, 1);
  const [{ project }] = ops;
  assert.equal(project.id, "project-host-1", "the host makes the id: a page's could take another board's entry's place");
  assert.deepEqual(Object.keys(project).sort(), ["id", "name", "plan"], "nothing of what the engine records of one under way");
  assert.deepEqual(project.plan.effects, [
    { type: "stat", stat: "stability", change: 6 },
    { type: "relation", country: victim, change: -10 },
    { type: "territory", region: "Some AI region", country: guest, claim: true },
  ], "its own figures, its relations, and land it claims: what it does to another country is the world's to say");
  const budget = monthlyProjectBudget(world().countryStats[guest]);
  assert.ok(project.plan.monthlyCost > 0 && project.plan.monthlyCost <= budget * COST_SHARE_OF_BUDGET_MOST, `paid for: ${project.plan.monthlyCost}`);
  assert.ok(project.plan.monthlyCost * project.plan.durationDays / 30 >= (6 / 8 + 10 / 15 + 1) * budget - 1, "priced by what it does");
});

test("the probe: a guest's project no longer dissolves, cripples or takes from another country, through the door, the lending and the engine", () => {
  const sent = [{
    op: "create",
    project: {
      id: "host-secret-1",
      name: "Road repairs",
      plan: {
        durationDays: 1, monthlyCost: 0,
        effects: [
          { type: "stat", stat: "military.land", change: -50, country: victim },
          { type: "territory", region: "Some AI region", country: guest },
        ],
      },
      onComplete: {
        polityChanges: [
          { code: "Free State", operation: "create", name: "Free State" },
          { code: victim, operation: "dissolve" },
          { code: victim, stats: { stability: 0, population: { total: 1 } } },
        ],
        regionTransfers: [{ regionId: "region: Anything", toCode: guest }],
      },
    },
  }];
  const start = world();
  const door = seatProjectOps(sent, { board: [], world: start, country: guest, mint: ids() });
  const { world: next } = applyProjectOpsToWorld({ actor: "player", date: "1900-01-01", ops: door.ops, playerCountry: guest, round: 1, world: { ...start, projects: [] } });
  const created = next.projects[0];
  assert.notEqual(created.id, "host-secret-1");
  assert.equal(created.onComplete, null);
  assert.ok(created.plan.durationDays >= 60, "a fortnight for nothing is gone");
  // The skip's lending: the host's own programme stays on the game's board.
  const hosted = { ...start, seatBoards: { [guest]: next.projects } };
  const lent = lendBoards(hosted, { host: "Host", humans: ["Host", guest, victim] });
  assert.deepEqual(lent.projects.map((row) => row.name), ["Host programme", "Road repairs"]);
  // A round of thirty days: it is not done.
  const month = advanceProjectsInWorld({ baseWorld: lent, world: lent, fromDate: "1900-01-01", toDate: "1900-01-31", host: "Host", round: 2 });
  assert.equal(month.outcomes.some((outcome) => outcome.project === "Road repairs" && outcome.type === "complete"), false);
  // Done at last: the victim's army stands, and the only land is a claim.
  const done = advanceProjectsInWorld({ baseWorld: lent, world: lent, fromDate: "1900-01-01", toDate: "1901-01-01", host: "Host", round: 2 });
  const released = applyProjectOutcomesToWorld({ world: done.world, outcomes: done.outcomes, date: "1901-01-01", round: 2, host: "Host" });
  assert.equal(released.world.countryStats[victim].military.land, 70);
  assert.deepEqual(released.territory.map((entry) => [entry.regionTransfers.length, entry.regionClaims.map((claim) => claim.claimantCode), entry.polityChanges.length]), [[0, [guest], 0]]);
});

test("a page's update funds its own work and plans one still planning; what becomes of a project is the round's to tell", () => {
  const board = [
    { id: "p1", name: "Docks", status: "active", funding: "normal", plan: { durationDays: 100, monthlyCost: 1 } },
    { id: "p2", name: "Rails", status: "planning", plan: null },
    { id: "p3", name: "Blocked op", status: "stalled", stallReason: "blocked", verification: "doubted", plan: { durationDays: 100, monthlyCost: 1 } },
  ];
  const { ops, refusal } = seatProjectOps([
    { op: "update", name: "Docks", funding: "high", lastUpdate: "Finished early.", progress: 100 },
    { op: "update", name: "Rails", plan: { durationDays: 1, monthlyCost: 0, effects: [{ type: "stat", stat: "military.land", change: 8, country: victim }] } },
    { op: "update", name: "Blocked op", verification: "confirmed" },
    { op: "setback", name: "Docks", days: 100 },
    { op: "cancel", name: "Docks", note: "x".repeat(500) },
    { op: "remove", name: "Docks" },
  ], { board, world: world(), country: guest, mint: ids() });
  assert.deepEqual(ops.map((op) => [op.op, op.name, Object.keys(op.patch ?? {})]), [
    ["update", "Docks", ["funding"]],
    ["update", "Rails", ["plan"]],
    ["cancel", "Docks", []],
  ]);
  assert.deepEqual(ops[1].patch.plan.effects, [], "another country's army is not a plan's to move");
  assert.equal(ops[2].note.length, 240);
  assert.equal(refusal, PROJECT_REFUSALS.story, "the verdict that took up work the engine had stalled was the page's word (S10)");
  // By the game's own door, as the player's, whatever the page said wrote it: the stalled entry stays stalled.
  const { world: next } = applyProjectOpsToWorld({ actor: "player", date: "1900-01-01", ops: seatProjectOps([{ op: "update", name: "Blocked op", verification: "confirmed" }], { board, world: world(), country: guest }).ops, playerCountry: guest, world: { projects: board } });
  assert.equal(next.projects.find((row) => row.name === "Blocked op").status, "stalled");
});

test("a seat runs a bounded number of projects at once, and none of another country's", () => {
  const open = Array.from({ length: SEAT_OPEN_PROJECTS_MOST - 1 }, (_, index) => ({ id: `o${index}`, name: `Work ${index}`, status: "active", plan: { durationDays: 100, monthlyCost: 1 } }));
  const board = [...open, { id: "c1", name: "Done", status: "complete", plan: { durationDays: 100, monthlyCost: 1 } }, { id: "f1", name: "Theirs", ownerCode: victim, status: "active" }];
  const create = (name, extra = {}) => ({ op: "create", name, plan: { durationDays: 100, monthlyCost: 1 }, ...extra });
  const { ops, refusal } = seatProjectOps([create("One more"), create("Too many"), create("Work 0", { summary: "Restated." })], { board, world: world(), country: guest, mint: ids() });
  assert.deepEqual(ops.map((op) => [op.project.name, op.project.id]), [["One more", "project-host-1"], ["Work 0", "o0"]], "a restatement is the entry it names, and opens nothing");
  assert.equal(refusal, PROJECT_REFUSALS.most);
  const theirs = seatProjectOps([create("Latvian collapse", { ownerCode: victim }), { op: "create", project: { name: "Nested", ownerCode: victim } }], { board: [], world: world(), country: guest, mint: ids() });
  assert.deepEqual(theirs, { ops: [], refusal: PROJECT_REFUSALS.theirs });
  // A create named as another country's entry on the board was taken as its restatement: its summary was the page's.
  assert.deepEqual(seatProjectOps([create("Theirs", { summary: "Ours now." })], { board, world: world(), country: guest, mint: ids() }), { ops: [], refusal: PROJECT_REFUSALS.theirs });
});

test("a seat's plan holds to its own country and is priced, whatever wrote it", () => {
  assert.equal(seatPlanOf(null), null);
  assert.equal(seatPlanOf({ monthlyCost: 5 }), null, "a plan says how long it takes");
  const plan = seatPlanOf({ durationDays: 600, monthlyCost: 5e8, effects: [{ type: "stat", stat: "military.sea", change: 4, country: guest }], ongoing: true, yields: [{ type: "stat", stat: "stability", change: 0.2, country: victim }, { type: "relation", country: victim, change: 1 }] }, { owner: guest, world: world() });
  assert.deepEqual(plan.effects, [{ type: "stat", stat: "military.sea", change: 4 }]);
  assert.deepEqual(plan.yields, [{ type: "relation", country: victim, change: 1 }]);
  assert.equal(plan.durationDays, 600, "an honest plan's days stand");
  assert.equal(plan.monthlyCost, 5e8, "and its cost");
});

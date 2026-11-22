/*! Open Historia — what a project's create may carry, and a person's polity kept from another's project: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/projectCreateDoor.test.js
//
// The review of 2026-11-18 (security S1, S9): a create was read with the reader
// of the board's own saved entries, so whoever wrote it (a time skip, the
// advisor, a page in a shared game) could open a programme already set up, or
// one whose completion of its own dissolved another player's country. Its
// probes (security-scratch/projectEstablished.mjs, projectOnComplete.mjs) are
// these tests' first cases.
import test from "node:test";
import assert from "node:assert/strict";

import { advanceProjectsInWorld, applyProjectOpsToWorld, applyProjectOutcomesToWorld } from "./gameState.js";
import { cessionsPeopleKeep, polityChangesPeopleKeep } from "./projectCessions.js";

const guest = "Ruritania";
const victim = "Freedonia";

test("a create opens a new effort: never one set up already, nor one carrying a completion of its own", () => {
  // The probe: "a programme already set up (established), at no cost", backdated two hundred years.
  const world = { countryStats: { [guest]: { stability: 50, economy: { gdp: 1e9 } } }, projects: [] };
  const ops = [{
    op: "create",
    project: {
      name: "Standing subsidy",
      established: true,
      startedAt: "1700-01-01",
      completedAt: "1700-02-01",
      effectsAppliedAt: "1700-02-01",
      yieldCarry: { stability: 0.9 },
      known: true,
      onComplete: { polityChanges: [{ code: "Free State", operation: "create", name: "Free State" }, { code: victim, operation: "dissolve" }] },
      plan: { durationDays: 3650, monthlyCost: 0, ongoing: true, yields: [{ type: "stat", stat: "stability", change: 5 }] },
    },
  }];
  const { world: next } = applyProjectOpsToWorld({ actor: "player", date: "1900-01-01", ops, playerCountry: guest, round: 1, world });
  const row = next.projects[0];
  assert.equal(row.name, "Standing subsidy");
  assert.equal(row.established, false, "it is set up when its work is done, as the engine runs it");
  assert.equal(row.startedAt, "1900-01-01", "dated by the game, as it is applied");
  assert.equal(row.completedAt, "");
  assert.equal(row.effectsAppliedAt, "");
  assert.equal(row.yieldCarry, undefined);
  assert.equal(row.known, false);
  assert.equal(row.onComplete, null, "a completion of its own is a save's from before the engine, never a create's");
  // Two months on, the programme is still being set up: it yields nothing yet.
  const advanced = advanceProjectsInWorld({ baseWorld: next, world: next, fromDate: "1900-01-01", toDate: "1900-03-01", host: guest, round: 2 });
  assert.equal(advanced.outcomes.some((outcome) => outcome.type === "yield"), false);
  // What a create may say of itself is still taken: its name, summary, kind, secrecy, tags, focus and plan.
  const { world: plain } = applyProjectOpsToWorld({ actor: "player", date: "1900-01-01", ops: [{ op: "create", name: "Docks", summary: "New docks.", kind: "operation", secrecy: "covert", tags: ["naval"], focus: { lng: 10, lat: 50 }, plan: { durationDays: 100, monthlyCost: 1 } }], playerCountry: guest, world });
  const docks = plain.projects[0];
  assert.deepEqual([docks.summary, docks.kind, docks.secrecy, docks.tags, docks.focus, docks.plan.durationDays], ["New docks.", "operation", "covert", ["naval"], { lng: 10, lat: 50 }, 100]);
});

test("a completion's polity changes leave a country a person plays alone, unless the project is theirs", () => {
  const changes = [
    { code: "Free State", operation: "create", name: "Free State" },
    { code: victim, operation: "dissolve" },
    { code: victim, stats: { stability: 0, population: { total: 1 } } },
    { code: "Elbonia", operation: "update", name: "Elbonia" },
  ];
  const { kept, refused } = polityChangesPeopleKeep({ changes, owner: guest, people: [guest, victim] });
  assert.deepEqual(kept.map((change) => change.code), ["Free State", "Elbonia"], "the AI's countries are the story's to change");
  assert.deepEqual(refused.map((change) => change.holder), [victim, victim]);
  assert.equal(polityChangesPeopleKeep({ changes, owner: victim, people: [guest, victim] }).refused.length, 0, "its own project changes its own polity");
  assert.equal(polityChangesPeopleKeep({ changes, owner: guest, people: [] }).kept.length, 4, "with nobody playing, nothing is held back");
  // As a region of theirs is (the rule this one follows).
  assert.equal(cessionsPeopleKeep({ transfers: [{ regionId: "f-1", toCode: guest }], owner: guest, people: [guest, victim], world: { regionOwnershipOverrides: { "f-1": victim } } }).refused.length, 1);
});

test("a project from before the engine still releases what its completion says, for the turn to hold to its people", () => {
  // The game's own release is unchanged (gameplay.js runProjectsEngine applies the people guard to what comes out).
  const world = { countryStats: { [guest]: { stability: 50 } }, projects: [{ id: "old", name: "Old union", progress: 99.9, startedAt: "1899-01-01", targetDate: "1899-12-31", onComplete: { polityChanges: [{ code: victim, operation: "dissolve" }] } }] };
  const advanced = advanceProjectsInWorld({ baseWorld: world, world, fromDate: "1900-01-01", toDate: "1900-01-10", host: guest, round: 2 });
  const released = applyProjectOutcomesToWorld({ world: advanced.world, outcomes: advanced.outcomes, host: guest });
  assert.equal(released.territory[0].polityChanges.length, 1);
  assert.equal(polityChangesPeopleKeep({ changes: released.territory[0].polityChanges, owner: guest, people: [guest, victim] }).kept.length, 0);
});

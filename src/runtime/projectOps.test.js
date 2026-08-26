/*! Open Historia — portions (project op application tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// Run with `npm ci && node --test src/runtime/projectOps.test.js`. The pure
// derived-state helpers are tested separately in projects.test.js, which stays
// import-free and runs in a bare checkout.
import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, applyProjectOps, normalizeWorldState } from "./gameState.js";

const standingWatch = {
  op: "create",
  name: "Operation Standing Watch",
  summary: "Permanent North Sea patrol.",
  kind: "operation",
  ongoing: true,
  secrecy: "covert",
  tags: ["naval", "military"],
  progress: 35,
  status: "stalled",
  startedAt: "2030-01-01",
  milestones: [{ title: "Annual drill", date: "2034-06-01", repeat: "annual" }],
};

const open = (ops = [standingWatch], ctx = { date: "2033-01-01" }) => applyProjectOps([], ops, ctx);

// A jump that merely MENTIONS a running operation used to reset everything the
// model had not bothered to restate: ongoing back to false, progress to 0,
// status to active, secrecy to public, tags emptied, an operation demoted to a
// project. The create branch spread the whole normalized op over the existing
// entry instead of merging the fields it actually carried.
test("a passing restatement preserves everything it did not mention", () => {
  const before = open()[0];
  const after = applyProjectOps(
    [before],
    [{ op: "create", name: "Operation Standing Watch", summary: "The patrol continues." }],
    { date: "2034-01-01", round: 70 },
  )[0];

  assert.equal(after.ongoing, true, "ongoing was reset");
  assert.equal(after.progress, 35, "progress was reset");
  assert.equal(after.status, "stalled", "status was reset");
  assert.equal(after.secrecy, "covert", "secrecy was reset");
  assert.deepEqual(after.tags, ["naval", "military"], "tags were emptied");
  assert.equal(after.kind, "operation", "an operation was demoted to a project");
  assert.equal(after.startedAt, "2030-01-01");
  assert.equal(after.milestones.length, 1);
  assert.equal(after.milestones[0].repeat, "annual");

  // What it DID send is applied, and identity survives.
  assert.equal(after.summary, "The patrol continues.");
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.updatedRound, 70, "a mention still counts as being touched");
});

test("a restatement that means to change things still can", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "create", name: "Operation Standing Watch", summary: "s",
    ongoing: false, targetDate: "2040-01-01", progress: 60, status: "active", secrecy: "public",
  }], {})[0];

  assert.equal(after.ongoing, false);
  assert.equal(after.targetDate, "2040-01-01");
  assert.equal(after.progress, 60);
  assert.equal(after.status, "active");
  assert.equal(after.secrecy, "public");
});

test("an explicitly emptied list is still an instruction, not an omission", () => {
  const before = open()[0];
  assert.deepEqual(applyProjectOps([before], [{ op: "create", name: before.name, tags: [] }], {})[0].tags, []);
});

test("a genuinely new project still receives its defaults", () => {
  const fresh = applyProjectOps([], [{ op: "create", name: "Fresh", summary: "s" }], {})[0];
  assert.equal(fresh.status, "active");
  assert.equal(fresh.progress, 0);
  assert.equal(fresh.ongoing, false);
  assert.equal(fresh.secrecy, "public");
});

// The staged event reveal replays events straight out of events.json, so an op
// that has been normalized and JSON round-tripped must merge exactly as the
// original did. A Set of provided fields would have serialised to {} here and
// quietly restored the destructive behaviour.
test("a persisted, replayed op merges the same as a fresh one", () => {
  const world = normalizeWorldState({ projects: open() });
  const event = {
    id: "e1", date: "2034-01-01", title: "The patrol continues", description: "d",
    impacts: { projectOps: [{ op: "create", name: "Operation Standing Watch", summary: "A mention." }] },
  };

  const fresh = applyEventImpactsToWorld({ world, events: [event], round: 70 }).world.projects[0];
  const replayed = applyEventImpactsToWorld({
    world, events: JSON.parse(JSON.stringify([event])), round: 70,
  }).world.projects[0];

  assert.equal(fresh.ongoing, true);
  assert.equal(replayed.ongoing, true, "ongoing lost on replay");
  assert.equal(replayed.progress, 35, "progress lost on replay");
  assert.equal(replayed.kind, "operation");
});

test("every other op leaves ongoing alone", () => {
  const before = open()[0];
  for (const op of [
    { op: "update", name: before.name, progress: 50 },
    { op: "update", name: before.name, status: "active" },
    { op: "update", name: before.name, lastUpdate: "Something happened." },
    { op: "milestone", name: before.name, milestone: { title: "Review", date: "2035-01-01" } },
  ]) {
    assert.equal(applyProjectOps([before], [op], {})[0].ongoing, true, JSON.stringify(op));
  }
  // Only an explicit instruction undoes it: `ongoing` is deliberately sticky, so
  // a chatty simulation cannot quietly put an end date back on a standing effort.
  assert.equal(applyProjectOps([before], [{ op: "update", name: before.name, ongoing: false }], {})[0].ongoing, false);
});

test("marking a milestone done keeps its date and note", () => {
  // normalizeProjectMilestone fills every field, so spreading it over the entry
  // erased the date and note whenever the model marked something done the
  // natural way: {"title":"...","status":"done"}.
  const before = applyProjectOps([], [{
    op: "create", name: "P", summary: "s",
    milestones: [{ title: "Sea trials", date: "2033-11-04", note: "At Faslane." }],
  }], {})[0];
  const after = applyProjectOps([before], [{
    op: "milestone", name: "P", milestone: { title: "Sea trials", status: "done" },
  }], { date: "2033-11-06" })[0];

  assert.equal(after.milestones[0].status, "done");
  assert.equal(after.milestones[0].date, "2033-11-04", "the due date was erased");
  assert.equal(after.milestones[0].note, "At Faslane.", "the note was erased");
});

test("a recurring milestone rolls instead of retiring", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "milestone", name: before.name, milestone: { title: "Annual drill", status: "done" },
  }], { date: "2034-06-03" })[0];

  assert.equal(after.milestones[0].date, "2035-06-01", "did not roll to the next occurrence");
  assert.equal(after.milestones[0].status, "pending");
  assert.equal(after.milestones[0].completedCount, 1);
  assert.equal(after.milestones[0].lastCompletedAt, "2034-06-03");
});

test("ending a project keeps it on the board; only remove erases", () => {
  const before = open()[0];
  for (const [op, status] of [["complete", "complete"], ["cancel", "cancelled"], ["fail", "failed"]]) {
    const after = applyProjectOps([before], [{ op, name: before.name }], {});
    assert.equal(after.length, 1, `op "${op}" removed the entry`);
    assert.equal(after[0].status, status);
  }
  assert.equal(applyProjectOps([before], [{ op: "remove", name: before.name }], {}).length, 0);
});

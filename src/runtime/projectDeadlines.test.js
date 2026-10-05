// Run: node --test src/runtime/projectDeadlines.test.js
//
// The AI may not set a project's deadline in the past (2026-09-26): a target date
// or an outstanding milestone written earlier than the date the op lands on is
// not kept. What was already on the board stays.

import test from "node:test";
import assert from "node:assert/strict";
import { applyProjectOps } from "./gameState.js";

const TODAY = "1936-06-01";
const board = [{
  id: "p1",
  name: "Siegfried Line",
  status: "active",
  targetDate: "1936-05-01",
  milestones: [{ id: "m1", title: "First bunkers", date: "1936-05-15", status: "pending" }],
}];

test("a new project with a deadline in the past gets none", () => {
  const [project] = applyProjectOps([], [{ op: "create", name: "Kiel Canal widening", targetDate: "1936-03-01" }], { date: TODAY });
  assert.equal(project.targetDate, "");
});

test("a new project with a deadline ahead keeps it", () => {
  const [project] = applyProjectOps([], [{ op: "create", name: "Kiel Canal widening", targetDate: "1937-03-01" }], { date: TODAY });
  assert.equal(project.targetDate, "1937-03-01");
});

test("moving a deadline into the past keeps the one on file", () => {
  const [project] = applyProjectOps(board, [{ op: "update", projectId: "p1", patch: { targetDate: "1936-04-01" } }], { date: TODAY });
  assert.equal(project.targetDate, "1936-05-01");
});

test("a deadline the board already had stays, even though it has passed", () => {
  const [project] = applyProjectOps(board, [{ op: "update", projectId: "p1", patch: { progress: 40 } }], { date: TODAY });
  assert.equal(project.targetDate, "1936-05-01");
  assert.equal(project.milestones[0].date, "1936-05-15");
});

test("a new milestone dated in the past is undated; one ahead keeps its date", () => {
  const past = applyProjectOps(board, [{ op: "milestone", projectId: "p1", milestone: { title: "Second line", date: "1936-02-01" } }], { date: TODAY });
  assert.equal(past[0].milestones.find((m) => m.title === "Second line").date, "");
  const ahead = applyProjectOps(board, [{ op: "milestone", projectId: "p1", milestone: { title: "Second line", date: "1936-09-01" } }], { date: TODAY });
  assert.equal(ahead[0].milestones.find((m) => m.title === "Second line").date, "1936-09-01");
});

test("a milestone marked done keeps the date it happened", () => {
  const [project] = applyProjectOps(board, [{ op: "milestone", projectId: "p1", milestone: { title: "First bunkers", date: "1936-05-20", status: "done" } }], { date: TODAY });
  const milestone = project.milestones.find((m) => m.title === "First bunkers");
  assert.equal(milestone.status, "done");
  assert.equal(milestone.date, "1936-05-20");
});

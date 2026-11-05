/*! Open Historia — tests for the Projects board the time skip reads © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/projectsBoard.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectsSummaryText } from "./promptContext.js";

const project = (name, extra = {}) => ({
  id: `project-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  name,
  kind: "project",
  ownerCode: "",
  summary: `${name} summary.`,
  status: "active",
  progress: 20,
  tags: [],
  secrecy: "public",
  startedAt: "0299-01-04",
  targetDate: "0299-03-01",
  milestones: [{ id: "m1", title: `${name} first step`, date: "0299-02-01", status: "pending" }],
  updatedRound: 40,
  updatedAt: "2026-10-19T20:00:00.000Z",
  ...extra,
});

// The White Harbor fishing boats stalled in April and the skip still wrote "no
// keel laid" about them every few weeks: the board put a stalled project on its
// "Needs a decision this jump" list, so every skip was asked to report on it.
test("a stalled project is not on the skip's work list, and the skip is told to leave it alone", () => {
  const text = buildProjectsSummaryText(
    { projects: [project("Fishing boats", { status: "stalled" }), project("Catapults")] },
    { gameDate: "0299-05-30", round: 57, country: "House Stark" },
  );
  const workList = text.split("Needs a decision this jump:")[1] || "";
  assert.ok(!workList.includes("Fishing boats"), "the stalled project is not asked about");
  assert.ok(workList.includes("Catapults"), "a running project that has gone quiet still is");
  const stalled = text.split(/Stalled, waiting on the player/)[1] || "";
  assert.ok(stalled.includes("project-fishing-boats"), "the stalled project is listed with its id, so an order can still reach it");
  assert.match(text, /Stalled, waiting on the player[^\n]*leave/i);
  const running = text.split(/Stalled, waiting on the player/)[0];
  assert.ok(!running.includes("Fishing boats"), "and not among the running ones");
});

test("with nothing stalled the board has no stalled section", () => {
  const text = buildProjectsSummaryText({ projects: [project("Catapults")] }, { gameDate: "0299-05-30", round: 57 });
  assert.ok(!/Stalled, waiting on the player/.test(text));
});

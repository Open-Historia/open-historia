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

// A 130-round campaign had closed 110 entries, every one listed with its id on
// every skip. The newest fifteen are named; the rest are counted.
test("the board names the newest fifteen closed entries and counts the rest; every open one keeps its id", async () => {
  const { CLOSED_PROJECTS_LISTED } = await import("./promptContext.js");
  const closed = Array.from({ length: 40 }, (_, index) => project(`Old Work ${String(index).padStart(2, "0")}`, {
    id: `project-old-${index}`,
    status: "complete",
    progress: 100,
    updatedAt: `2026-10-${String(1 + (index % 28)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
  }));
  const open = Array.from({ length: 25 }, (_, index) => project(`Live Work ${index}`, { id: `project-live-${index}`, tags: ["research"] }));
  const text = buildProjectsSummaryText({ projects: [...closed, ...open] }, { gameDate: "0299-02-10", round: 41 }, { compact: true });
  for (const entry of open) assert.ok(text.includes(`[id ${entry.id}]`), `${entry.name} keeps its id`);
  const listed = closed.filter((entry) => text.includes(`[id ${entry.id}],`));
  assert.equal(listed.length, CLOSED_PROJECTS_LISTED);
  const newest = [...closed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, CLOSED_PROJECTS_LISTED);
  assert.deepEqual(new Set(listed), new Set(newest), "the newest are the ones named");
  assert.match(text, /\nand 25 more finished or abandoned \(older; do not start any of them again under a new name\)/);
  assert.doesNotMatch(text, /Tags: /, "a skip's board leaves the tags to the panel");
  assert.match(buildProjectsSummaryText({ projects: open.slice(0, 1) }, { gameDate: "0299-02-10", round: 41 }), /Tags: research\./, "other tasks keep them");
});

test("a skip's board points at its rules in the cached opening instead of repeating them", async () => {
  const { buildJumpProjectsDirective, buildJumpProjectsRules, JUMP_PROJECTS_RULES_HEADING } = await import("./projectsDirective.js");
  const board = buildProjectsSummaryText({ projects: [project("Live Work")] }, { gameDate: "0299-02-10", round: 41 });
  const inline = buildJumpProjectsDirective(board, { folded: true });
  const pointed = buildJumpProjectsDirective(board, { folded: true, rulesAbove: true, doubted: "- a doubted entry" });
  assert.ok(inline.includes(buildJumpProjectsRules({ folded: true })));
  assert.ok(!pointed.includes(buildJumpProjectsRules({ folded: true })));
  assert.ok(pointed.includes(`Kept as ${JUMP_PROJECTS_RULES_HEADING} above says.`));
  assert.match(pointed, /These doubted entries can now be settled/);
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.ok(source.includes("${JUMP_PROJECTS_RULES_HEADING}\\n${buildJumpProjectsRules({ folded: Boolean(variables?.foldedSkip) && variables?.foldedBoard !== false })}"), "the standing rules carry them, folded where the skip's function offers the board's ops");
});

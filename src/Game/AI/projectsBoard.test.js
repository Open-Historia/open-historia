/*! Open Historia — tests for the Projects board the time skip reads © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/projectsBoard.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectsSummaryText } from "./promptContext.js";

const plan = (extra = {}) => ({
  durationDays: 100,
  monthlyCost: 1.2e8,
  milestones: [{ id: "m1", title: "First step", atProgress: 30 }],
  effects: [{ type: "stat", stat: "military.sea", change: 4 }],
  ...extra,
});

const project = (name, extra = {}) => ({
  id: `project-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  name,
  kind: "project",
  ownerCode: "",
  summary: `${name} summary.`,
  status: "active",
  funding: "normal",
  progress: 20,
  tags: [],
  secrecy: "public",
  startedAt: "0299-01-04",
  targetDate: "0299-03-01",
  plan: plan(),
  updatedRound: 40,
  updatedAt: "2026-10-19T20:00:00.000Z",
  ...extra,
});

const GAME = { gameDate: "0299-02-10", round: 41, country: "House Stark" };

test("each entry is one row by name: owner, progress, expected finish, cost a month, funding, status", () => {
  const text = buildProjectsSummaryText({ projects: [project("Catapults", { funding: "high" })] }, GAME, { compact: true });
  assert.equal(text, '- "Catapults" · ours · 20% · done ~0299-03-01 · 120 million a month · funding high · active');
});

test("a stalled entry says why; a programme set up says it runs on; a paused one says so; none hides an id", () => {
  const text = buildProjectsSummaryText({
    projects: [
      project("Fishing boats", { status: "stalled", stallReason: "funds" }),
      project("Night's Watch Levy", { ongoing: true, established: true, plan: plan({ ongoing: true }) }),
      project("Catapults", { status: "paused", funding: "none" }),
      project("Ironborn Fleet", { ownerCode: "House Greyjoy", secrecy: "covert" }),
    ],
  }, GAME, { compact: true });
  assert.match(text, /"Fishing boats" · ours · 20% · .* · stalled: funds/);
  assert.match(text, /"Night's Watch Levy" · ours · 20% · runs on · .* · running/);
  assert.match(text, /"Catapults" · ours · 20% · .* · funding none · paused/);
  assert.match(text, /"Ironborn Fleet" · House Greyjoy · .* \[covert\]/);
  assert.doesNotMatch(text, /project-|\[id /);
});

test("the player's own come first; the advisor also reads what each is for, its next checkpoint and what it will do", () => {
  const text = buildProjectsSummaryText({ projects: [project("Ironborn Fleet", { ownerCode: "House Greyjoy", updatedAt: "2026-10-20T00:00:00.000Z" }), project("Catapults")] }, GAME);
  assert.ok(text.indexOf('"Catapults"') < text.indexOf('"Ironborn Fleet"'));
  assert.match(text, /Catapults summary\./);
  assert.match(text, /Next checkpoint: First step at 30%\./);
  assert.match(text, /When done: military\.sea \+4\./);
  const compact = buildProjectsSummaryText({ projects: [project("Catapults")] }, GAME, { compact: true });
  assert.doesNotMatch(compact, /Next checkpoint|When done/);
});

test("a project with no finish date yet is given one from its owner's budget, at the pace it would go", () => {
  const text = buildProjectsSummaryText({ projects: [project("Catapults", { targetDate: "", progress: 50 })], countryStats: {} }, GAME, { compact: true });
  assert.match(text, /done ~0299-04-01/);
});

// A 130-round campaign had closed 110 entries, every one listed on every skip.
// The newest fifteen are named; the rest are counted.
test("the board names the newest fifteen closed entries and counts the rest", async () => {
  const { CLOSED_PROJECTS_LISTED } = await import("./promptContext.js");
  const closed = Array.from({ length: 40 }, (_, index) => project(`Old Work ${String(index).padStart(2, "0")}`, {
    status: "complete",
    progress: 100,
    updatedAt: `2026-10-${String(1 + (index % 28)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
  }));
  const open = Array.from({ length: 25 }, (_, index) => project(`Live Work ${index}`));
  const text = buildProjectsSummaryText({ projects: [...closed, ...open] }, GAME, { compact: true });
  for (const entry of open) assert.ok(text.includes(`"${entry.name}" · ours`), entry.name);
  const listed = closed.filter((entry) => text.includes(`"${entry.name}" (ours, complete)`));
  assert.equal(listed.length, CLOSED_PROJECTS_LISTED);
  const newest = [...closed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, CLOSED_PROJECTS_LISTED);
  assert.deepEqual(new Set(listed), new Set(newest), "the newest are the ones named");
  assert.match(text, /; and 25 more\./);
  assert.match(text, /never open these again/);
});

test("an entry is its name as it is, whatever language the name is in, and a quoted copy of it still finds it", async () => {
  const lineOf = (name) => buildProjectsSummaryText({ projects: [project(name, { kind: "operation" })] }, GAME, { compact: true });
  for (const name of ["Kingfisher", "Operation Kingfisher", "Opération Kingfisher", "Операция Зимородок", "翠鸟行动"]) {
    assert.ok(lineOf(name).startsWith(`- "${name}" · ours · 20%`), lineOf(name));
  }
  const { applyProjectOps } = await import("../../runtime/gameState.js");
  const [entry] = applyProjectOps([], [{ op: "create", name: "Opération Kingfisher", kind: "operation", summary: "s", plan: plan() }], {});
  assert.equal(applyProjectOps([entry], [{ op: "update", name: '"Opération Kingfisher"', lastUpdate: "Found." }], {})[0].lastUpdate, "Found.");
});

test("a skip's standing rules carry the board's rules, always, folded where its function offers the board's ops", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.ok(source.includes("`${JUMP_PROJECTS_RULES_HEADING}\\n${buildJumpProjectsRules({ folded: Boolean(variables?.foldedSkip) && variables?.foldedBoard !== false })}`,"));
});

// A belief (runtime/projectEngine.js isBelief) is no country's work, only what the
// board's service was made to believe by material planted on its turned agent. The
// world is told so, so that it never tells it as happening; the player's own tasks
// (the advisor, the planner) see it as their service does.
test("the world's tasks are told which entries are beliefs; the player's own tasks never", () => {
  const board = { projects: [project("Dragon eggs", { ownerCode: "House Targaryen", secrecy: "covert", belief: true, linkedSpyIds: ["spy-1"] })] };
  assert.match(buildProjectsSummaryText(board, GAME, { compact: true, beliefsTold: true }), /"Dragon eggs" · House Targaryen · .* \[covert; NOT REAL: planted on House Stark's service, which believes it\]/);
  assert.doesNotMatch(buildProjectsSummaryText(board, GAME, { compact: true }), /NOT REAL|planted/);
  assert.doesNotMatch(buildProjectsSummaryText(board, GAME), /NOT REAL|planted/);
});

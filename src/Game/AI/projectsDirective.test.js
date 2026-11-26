// Run: node --test src/Game/AI/projectsDirective.test.js
//
// Runs without node_modules: projectsDirective.js imports only pure modules.
//
// The promise: the engine runs the board (runtime/projectEngine.js), and a time
// skip is told what it decided for the period, to tell on its dates; what is
// left to the model is planning a country's project, and the setbacks,
// breakthroughs and endings its events cause. Never progress, never "no ops is
// usually right", never a work list built from the calendar.
import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {
  JUMP_PROJECTS_DIRECTIVE_HEADER,
  JUMP_PROJECTS_RULES_HEADING,
  PROJECT_EFFECTS_RULE,
  buildJumpProjectsDirective,
  buildJumpProjectsRules,
} from "./projectsDirective.js";

const BOARD = [
  '- "Westbird" · ours · 40% · done ~2017-01-01 · 120 million a month · funding high · active',
  '- "Plan Z" · Germany · 12% · done ~2019-05-01 · 400 million a month · funding normal · stalled: funds',
].join("\n");
const FORECAST = [
  '- 2016-03-02: Russia · "Westbird" reaches "Three assets recruited".',
  '- 2016-04-10: Germany · "Plan Z" STALLS for want of funds.',
].join("\n");

test("a skip that keeps the board is shown it even when it is empty: that is where the first projects open", () => {
  const directive = buildJumpProjectsDirective("No projects or operations are being tracked yet.", { folded: true });
  assert.ok(directive.startsWith(`${JUMP_PROJECTS_DIRECTIVE_HEADER}\n`));
  assert.match(directive, /The board is empty\./);
  assert.match(directive, /Open a project for a country nobody plays/);
  assert.match(directive, /Nothing: no checkpoint, completion or stall falls in this period\./);
});

test("a skip that does not keep the board, with nothing on it and nothing decided, is told nothing", () => {
  assert.equal(buildJumpProjectsDirective(""), "");
  assert.equal(buildJumpProjectsDirective("No projects or operations are being tracked yet."), "");
});

test("the board and what the engine decided reach the skip whole, by name", () => {
  const directive = buildJumpProjectsDirective(BOARD, { folded: true, forecast: FORECAST });
  assert.ok(directive.includes(BOARD));
  assert.ok(directive.includes(FORECAST));
  assert.match(directive, /Decided this period \(the engine's; tell each on its date\)/);
  assert.doesNotMatch(directive, /\[id /);
});

test("the rules: the engine runs the clock; the model tells what was decided, plans a country's project, and gives setbacks within bounds", () => {
  const rules = buildJumpProjectsRules({ folded: true });
  assert.match(rules, /You never move a project's progress, and a project that simply goes on needs no op and no event/);
  assert.match(rules, /happens on its date, as written/);
  assert.match(rules, /"op":"create"[^\n]*"ownerCode":"<its full name>"[^\n]*"plan"/);
  assert.match(rules, /A country runs three at most/);
  assert.match(rules, /"op":"setback"[^\n]*<1-180>[^\n]*<0-50, per cent>/);
  assert.match(rules, /"op":"boost"[^\n]*<1-90>/);
  assert.match(rules, /It takes hold from the next period/);
  assert.match(rules, /Never a project decided as completing this period/);
  assert.match(rules, /never open one for them/);
  assert.ok(rules.includes(PROJECT_EFFECTS_RULE));
  assert.match(rules, /never as a storyline/i);
  // What the board used to be told, and must never be again.
  assert.doesNotMatch(rules, /no ops at all is a correct answer|leave these alone|Needs a decision|HIGH PRIORITY|progress figure/);
});

test("the effects are numbers on the game's own systems, every one of them named", () => {
  for (const system of ["stat", "relation", "structure", "unitType", "territory", "stability", "indices.<key>", "military.<quality|technology|land|sea|air|spending>", "population.total", "customStats.<key>", "yields"]) {
    assert.ok(PROJECT_EFFECTS_RULE.includes(system), system);
  }
});

test("a skip that does not keep the board is told the engine still runs it, and that it returns no ops", () => {
  const directive = buildJumpProjectsDirective(BOARD, { forecast: FORECAST });
  assert.match(directive, /You return no projectOps this time/);
  assert.match(directive, /every line happens on its date, as written/);
  assert.ok(directive.includes(FORECAST));
});

test("the people who play are named, so the skip opens nothing for them", () => {
  const directive = buildJumpProjectsDirective(BOARD, { folded: true, players: ["Russia", "Ukraine"] });
  assert.match(directive, /Played by people, so never opened by you: Russia, Ukraine\./);
});

test("the rules can stand in the cached opening, the live block pointing at them", () => {
  const pointed = buildJumpProjectsDirective(BOARD, { folded: true, rulesAbove: true });
  assert.ok(!pointed.includes(buildJumpProjectsRules({ folded: true })));
  assert.ok(pointed.includes(`Kept as ${JUMP_PROJECTS_RULES_HEADING} above says.`));
});

// A doubted entry is the engine's to settle, for every service (runtime/agentBoards.js):
// the model was told to refute one "and fail it", which ended an AI country's real work,
// and only the host's service was ever offered one.
test("the skip is never asked for a verdict on doubted intelligence, and a planted programme is a belief", () => {
  const rules = buildJumpProjectsRules({ folded: true });
  assert.doesNotMatch(rules, /settle[^.]*confirmed|refuted|fail it/);
  assert.doesNotMatch(buildJumpProjectsDirective(BOARD, { folded: true }), /can now be settled/);
  assert.match(rules, /"believedBy":"<that service's country>"/);
  assert.match(rules, /A doubted entry is the game's to settle/);
});

// The skip's answer is held to what was planted: a belief whose service had no
// turned agent in that country is left out (never opened as the country's real
// work, and never a second request), with a player's line that keeps the secret;
// the Game Master's word opens work, never a belief.
test("the skip's create of a belief is held to a turned agent of a person's service", () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const gameplay = fs.readFileSync(path.join(here, "gameplay.js"), "utf8").split("\r\n").join("\n");
  const at = gameplay.indexOf("if (normalizeString(project?.believedBy)) {");
  assert.ok(at > gameplay.indexOf("export const validateGeneratedWorldChanges") && at < gameplay.indexOf("const refusal = admitWorldCreate(project);"), "checked before the world's caps");
  const check = gameplay.slice(at, gameplay.indexOf("const refusal = admitWorldCreate(project);"));
  assert.match(check, /plantedOn\(named, \{ spies: world\?\.spies, players: players \?\? \[playerCountry\] \}\)/);
  assert.match(check, /drop\(path, [^\n]*"projectNotOpened"\);\n\s*continue;/);
  assert.doesNotMatch(check, /return\s/);
  assert.match(check, /else delete project\.believedBy;/);
});

test("the old must-move and HIGH PRIORITY rules are gone from the game master, the defaults and the advisor", () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  for (const file of ["gameplay.js", "defaultPrompts.json", "main.jsx"]) {
    const text = fs.readFileSync(path.join(here, file), "utf8");
    assert.ok(!/must not sit on that list two jumps running/.test(text), `${file} still demands movement`);
    assert.ok(!/HIGH PRIORITY gets an explicit assessment/.test(text), `${file} still asks for HIGH PRIORITY assessments`);
    assert.ok(!/Needs a decision this jump/.test(text), `${file} still carries the calendar's work list`);
  }
});

test("the planner has its own small template, filled at call time with the rules, the country and its projects", () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const tasks = JSON.parse(fs.readFileSync(path.join(here, "defaultPrompts.json"), "utf8")).tasks;
  for (const placeholder of ["${projectPlanRules}", "${projectMeans}", "${projectsSummary}", "${ORIGIN_ROUND_DATE}", "${language}"]) {
    assert.ok(tasks.projectPlan.includes(placeholder), placeholder);
  }
  assert.doesNotMatch(tasks.projects, /op milestone|op complete|op remove|progress moved/);
});

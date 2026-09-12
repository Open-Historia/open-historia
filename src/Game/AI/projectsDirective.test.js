// Run: node --test src/Game/AI/projectsDirective.test.js
//
// Runs without node_modules: projectsDirective.js is import-free.
//
// The promise: a jump that has a board sees the whole board and the rules for
// moving it in narrative, and a jump with nothing on the board pays for no
// directive at all.
import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {
  HIGH_PRIORITY_ASSESSMENT_MARKER,
  HIGH_PRIORITY_ASSESSMENT_RULE,
  JUMP_PROJECTS_DIRECTIVE_HEADER,
  buildBoardPassDirective,
  buildJumpProjectsDirective,
} from "./projectsDirective.js";

const BOARD = [
  '- Project "Westbird" [id proj-1] [HIGH PRIORITY], ours, active, 0% complete. Sustained SVR and GRU effort to expand '
    + "agent recruitment and cyber penetrations across NATO governments. 2016-01-01 -> 2017-01-01. "
    + "Next: Recruit 3 new assets in key NATO capitals (2016-06-01). [OVERDUE; a milestone has slipped]",
  "",
  "Needs a decision this jump:",
  "- [id proj-1] Westbird [HIGH PRIORITY] — target date passed 186 days ago, a milestone slipped.",
].join("\n");

test("an empty board adds nothing to the jump prompt", () => {
  assert.equal(buildJumpProjectsDirective(""), "");
  assert.equal(buildJumpProjectsDirective("   "), "");
  assert.equal(buildJumpProjectsDirective(undefined), "");
  assert.equal(buildJumpProjectsDirective("No projects or operations are being tracked yet."), "");
});

test("a board reaches the jump whole, with the narration rules and no output contract", () => {
  const directive = buildJumpProjectsDirective(BOARD);
  assert.ok(directive.startsWith(`${JUMP_PROJECTS_DIRECTIVE_HEADER}\n`));
  assert.ok(directive.includes(BOARD), "the board text is carried verbatim");
  assert.ok(directive.includes("You do not return projectOps"));
  assert.ok(directive.includes("Needs a decision this jump"));
  assert.ok(directive.includes("HIGH PRIORITY"));
  assert.ok(directive.includes("according to its summary"));
  assert.ok(directive.includes("THEIRS"));
  assert.ok(directive.includes("exactly as the board names it"));
});

test("the jump is told a Board entry is not a Storyline, and to write its routine progress as an event", () => {
  const directive = buildJumpProjectsDirective(BOARD);
  assert.match(directive, /never as a storyline/i);
  assert.match(directive, /however routine/i);
});

test("HIGH PRIORITY asks for an honest assessment every jump, never for movement", () => {
  const directive = buildJumpProjectsDirective(BOARD);
  const demand = directive.split(/(?<=\.) /).find((sentence) => sentence.includes("advances, stalls for a named reason"));
  assert.ok(demand, "the movement rule for ordered and overdue entries is still there");
  assert.ok(!demand.includes("HIGH PRIORITY"), "HIGH PRIORITY must not be in the must-move sentence");
  assert.ok(directive.includes(HIGH_PRIORITY_ASSESSMENT_RULE));
  assert.match(HIGH_PRIORITY_ASSESSMENT_RULE, /no material change this period, because/i);
});

test("the board pass gets the assessment rule at call time, superseding its frozen template", () => {
  const directive = buildBoardPassDirective();
  assert.ok(directive.includes(HIGH_PRIORITY_ASSESSMENT_RULE));
  assert.match(directive, /replaces any earlier instruction/i, "a campaign's frozen template still says the old rule");
});

test("the old must-move rule is gone from the game master's block and the default template", () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  for (const file of ["gameplay.js", "defaultPrompts.json"]) {
    const text = fs.readFileSync(path.join(here, file), "utf8");
    assert.ok(!/must not sit on that list two jumps running/.test(text), `${file} still demands movement for HIGH PRIORITY`);
  }
});

test("a campaign whose template already carries the assessment rule is not told it twice", () => {
  // gameplay.js skips the call-time directive when templateAlreadySays(marker):
  // the updated template must carry the marker, and so must the rule itself.
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const template = JSON.parse(fs.readFileSync(path.join(here, "defaultPrompts.json"), "utf8")).tasks.projects;
  assert.ok(template.includes(HIGH_PRIORITY_ASSESSMENT_MARKER), "the default template no longer carries the marker");
  assert.ok(HIGH_PRIORITY_ASSESSMENT_RULE.includes(HIGH_PRIORITY_ASSESSMENT_MARKER));
});

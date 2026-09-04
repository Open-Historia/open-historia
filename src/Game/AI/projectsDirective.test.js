// Run: node --test src/Game/AI/projectsDirective.test.js
//
// Runs without node_modules: projectsDirective.js is import-free.
//
// The promise: a jump that has a board sees the whole board and the rules for
// moving it in narrative, and a jump with nothing on the board pays for no
// directive at all.
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_PROJECTS_DIRECTIVE_HEADER, buildJumpProjectsDirective } from "./projectsDirective.js";

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

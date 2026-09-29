/*! Open Historia — what a task's prompt build is asked to construct © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/contextDemand.test.js
//
// Runs without node_modules: contextDiagnostics.js imports nothing.
//
// resolveTemplateVariableDemand decides what buildTemplateVariables builds for
// a task that names itself: the variables its template reaches, plus the ones
// gameplay.js reads OUTSIDE the template, in the directives appended at call
// time (LIVE_RUNTIME_VARIABLE_KEYS). A variable read there and missing from
// that list is silently never built, and the directive goes out empty.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { resolveTemplateVariableDemand } from "./contextDiagnostics.js";

const demanded = (taskKey, promptTemplate = "") =>
  new Set(resolveTemplateVariableDemand({ taskKey, promptTemplate }).requiredVariableKeys);

const here = path.dirname(url.fileURLToPath(import.meta.url));
const defaultPrompts = JSON.parse(fs.readFileSync(path.join(here, "defaultPrompts.json"), "utf8"));
const demandedByDefault = (taskKey) => new Set(resolveTemplateVariableDemand({
  taskKey,
  promptTemplate: defaultPrompts.tasks[taskKey],
  helperTemplates: defaultPrompts.helpers,
}).requiredVariableKeys);

test("a time skip does not build the force posture it never shows", () => {
  // Border proximity over every unit owner's territory is the most expensive
  // step of a prompt build. The jump template shows ${CURRENT_UNITS}, not
  // ${ALL_FORCES_POSTURE}, and its live records never read it.
  for (const taskKey of ["jumpForward", "autoJumpForward"]) {
    const keys = demandedByDefault(taskKey);
    assert.equal(keys.has("forcePosture"), false, taskKey);
    assert.ok(keys.has("unitsSummary"), `${taskKey} still gets its units`);
  }
});

test("the Game Master is built the Projects board its directive tells it to copy ids from", () => {
  // Whatever its template says: a campaign's frozen copy may reach nothing.
  assert.ok(demanded("gameMaster", "You are the Game Master.").has("projectsSummary"));
  assert.ok(demanded("gameMaster").has("territorialControlContext"));
});

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

import { resolveTemplateVariableDemand } from "./contextDiagnostics.js";

const demanded = (taskKey, promptTemplate = "") =>
  new Set(resolveTemplateVariableDemand({ taskKey, promptTemplate }).requiredVariableKeys);

test("the Game Master is built the Projects board its directive tells it to copy ids from", () => {
  // Whatever its template says: a campaign's frozen copy may reach nothing.
  assert.ok(demanded("gameMaster", "You are the Game Master.").has("projectsSummary"));
  assert.ok(demanded("gameMaster").has("territorialControlContext"));
});

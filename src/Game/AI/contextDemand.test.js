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

import { CONTEXT_PROFILE_KEYS, resolveContextProfileKey, resolveTemplateVariableDemand } from "./contextDiagnostics.js";

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

// --- Every variable a live directive reads is one the demand builds ----------
//
// Read as TEXT, like turnOrdering.test.js: buildTaskSystemPrompt and
// buildJumpLiveState are not exported, and what matters is a statement about
// the source — which variables each task's appended directives read. The check
// is limited to what can go missing: variables promptContext.js and
// buildTemplateVariables construct only on demand (behind wants("…")), for the
// tasks whose callers name themselves to buildTemplateVariables (a caller that
// does not gets the full build).

const gameplaySource = fs.readFileSync(path.join(here, "gameplay.js"), "utf8").replace(/\r\n/g, "\n");
const promptContextSource = fs.readFileSync(path.join(here, "promptContext.js"), "utf8").replace(/\r\n/g, "\n");
// A task set gameplay.js imports is read where it is declared.
const sharedGameDirectiveSource = fs.readFileSync(path.join(here, "sharedGameDirective.js"), "utf8").replace(/\r\n/g, "\n");

const functionBody = (name) => {
  const start = gameplaySource.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} is gone from gameplay.js; this guard needs updating`);
  return gameplaySource.slice(start, gameplaySource.indexOf("\n};", start) + 3);
};
const quotedWords = (text) => [...text.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
const setMembers = (name) => {
  for (const source of [gameplaySource, sharedGameDirectiveSource]) {
    const start = source.indexOf(`const ${name} = new Set([`);
    if (start !== -1) return quotedWords(source.slice(start, source.indexOf("]);", start)));
  }
  return assert.fail(`${name} is gone from gameplay.js; this guard needs updating`);
};

// The variables a piece of code reads, following a (variables) helper one level.
const variableReads = (text) => {
  const keys = new Set([...text.matchAll(/\bvariables\??\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
  for (const [, helper] of text.matchAll(/\b([A-Za-z0-9_]+)\(variables\)/g)) {
    if (gameplaySource.includes(`const ${helper} = (variables)`)) {
      for (const key of variableReads(functionBody(helper))) keys.add(key);
    }
  }
  return keys;
};

const builtOnDemand = new Set([
  ...[...promptContextSource.matchAll(/\bwants\(([^)]*)\)/g)].flatMap((match) => quotedWords(match[1])),
  ...[...functionBody("buildTemplateVariables").matchAll(/\bwants\(([^)]*)\)/g)].flatMap((match) => quotedWords(match[1])),
]);

const demandFilteredTasks = new Set(
  [...gameplaySource.matchAll(/buildTemplateVariables\([^)]*?taskKey: ([^,}]+)/g)].flatMap((match) => quotedWords(match[1])),
);

// Task -> the variables its appended directives read.
const directiveReads = (() => {
  const jumpTasks = setMembers("JUMP_TASK_KEYS");
  const byTask = new Map();
  const add = (task, keys) => byTask.set(task, new Set([...(byTask.get(task) ?? []), ...keys]));
  const lines = functionBody("buildTaskSystemPrompt").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^ {2}if \((.*)\) \{$/);
    if (!opening) continue;
    let end = index + 1;
    while (end < lines.length && !/^ {2}\}/.test(lines[end])) end += 1;
    const condition = opening[1];
    let tasks = [
      ...[...condition.matchAll(/taskKey === "([A-Za-z]+)"/g)].map((match) => match[1]),
      ...[...condition.matchAll(/\[([^\]]*)\]\.includes\(taskKey\)/g)].flatMap((match) => quotedWords(match[1])),
      ...[...condition.matchAll(/\b([A-Z_]+)\.has\(taskKey\)/g)].flatMap((match) => setMembers(match[1])),
    ];
    if (/!jumpTask\b/.test(condition)) tasks = tasks.filter((task) => !jumpTasks.includes(task));
    const keys = variableReads(lines.slice(index, end + 1).join("\n"));
    for (const task of tasks) add(task, keys);
  }
  // A time skip's directives are its live records.
  for (const task of jumpTasks) add(task, variableReads(functionBody("buildJumpLiveState")));
  return byTask;
})();

test("the source scan finds what it is meant to find", () => {
  // If these fail, the scan broke, not the demand.
  assert.ok(builtOnDemand.has("projectsSummary") && builtOnDemand.has("canonicalWarContext"));
  for (const task of ["gameMaster", "idleDiplomacy", "projects", "jumpForward", "autoJumpForward"]) {
    assert.ok(demandFilteredTasks.has(task), task);
  }
  assert.ok(directiveReads.get("gameMaster")?.has("projectsSummary"));
  assert.ok(directiveReads.get("idleDiplomacy")?.has("canonicalDiplomaticContext"));
  assert.ok(directiveReads.get("jumpForward")?.has("territorialControlContext"));
});

test("every variable a task's live directives read is one its demand builds", () => {
  const missing = [];
  for (const [task, keys] of directiveReads) {
    if (!demandFilteredTasks.has(task)) continue;
    const live = new Set(resolveTemplateVariableDemand({ taskKey: task }).liveRuntimeVariableKeys);
    for (const key of keys) {
      if (builtOnDemand.has(key) && !live.has(key)) missing.push(`${task}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], "add these to LIVE_RUNTIME_VARIABLE_KEYS in contextDiagnostics.js, or the directive goes out empty");
});

test("every task the diagnostics can see has its own context profile", () => {
  // The prompt pack's tasks plus the two jump repairs, which log under their
  // own names; a task missing from the profile map reads as General.
  const tasks = [...Object.keys(defaultPrompts.tasks), "worldMotionRepair", "worldBreadthRepair"];
  const general = tasks.filter((task) => resolveContextProfileKey(task) === CONTEXT_PROFILE_KEYS.GENERAL);
  assert.deepEqual(general, []);
});

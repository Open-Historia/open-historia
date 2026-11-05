/*! Open Historia — a prompt builds only the context it shows: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/promptDemand.test.js
//
// Demand gating (contextDiagnostics.js) only applies when a caller says what
// it needs. The advisor and every leader message (main.jsx) said nothing, nor
// did eleven gameplay.js call sites, so each built the whole context — the
// force posture's border geometry, the city catalog, the markers, the
// consolidation transcripts — and used a fraction of it. What has to hold:
//   - promptVariableDemand gives a conversation its template's variables,
//     the runner's own reads and its directives' keys, less what it overwrites;
//   - a leader's demand leaves out the posture, the cities and the markers,
//     and the advisor's keeps the posture its template shows;
//   - buildPromptContext builds exactly the demanded keys;
//   - the pregame bootstrap keeps the date its directive reads.
import test from "node:test";
import assert from "node:assert/strict";

import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { RUNNER_VARIABLE_KEYS, promptVariableDemand, resolveTemplateVariableDemand } from "./contextDiagnostics.js";
import { buildPromptContext } from "./promptContext.js";

const EXPENSIVE = ["forcePosture", "citiesSummary", "markersSummary", "chatsToConsolidate", "eventsToConsolidate"];

test("a leader's prompt demands what its template shows, and none of the expensive context it does not", () => {
  const demand = promptVariableDemand({
    helperTemplates: defaultPrompts.helpers,
    promptTemplate: defaultPrompts.leader,
    exclude: ["chatHistory", "chatParticipants"],
  });
  for (const key of EXPENSIVE) assert.ok(!demand.includes(key), key);
  for (const key of ["difficultyGuidanceChats", "recentEventsLong", "respondingPolityName", "worldSummaryNoCity", ...RUNNER_VARIABLE_KEYS]) {
    assert.ok(demand.includes(key), key);
  }
  assert.ok(!demand.includes("chatHistory"), "the thread rides as the turns");
});

test("the advisor keeps the force posture its template shows, and its directives' keys", () => {
  const demand = promptVariableDemand({
    helperTemplates: defaultPrompts.helpers,
    promptTemplate: defaultPrompts.advisor,
    extra: ["plannedActionsWithIds", "projectsSummary"],
    exclude: ["advisorMessages"],
  });
  for (const key of ["forcePosture", "plannedActionsWithIds", "projectsSummary", "playerPolityRegions", "worldSummary"]) assert.ok(demand.includes(key), key);
  for (const key of ["citiesSummary", "markersSummary", "advisorMessages"]) assert.ok(!demand.includes(key), key);
});

test("every task the audit named resolves to a bounded demand from the loaded pack", () => {
  for (const taskKey of ["projects", "actions", "spyIntercept", "descriptionToAction", "interactiveCreation", "interactiveExecutor", "interactiveSummary", "eventConsolidator", "pregameHistory", "idleDiplomacy"]) {
    const { requiredVariableKeys } = resolveTemplateVariableDemand({ helperTemplates: defaultPrompts.helpers, promptTemplate: defaultPrompts.tasks[taskKey], taskKey });
    assert.ok(requiredVariableKeys.length > 0, taskKey);
    assert.ok(!requiredVariableKeys.includes("forcePosture"), `${taskKey} never shows the force posture`);
  }
  const pregame = resolveTemplateVariableDemand({ helperTemplates: defaultPrompts.helpers, promptTemplate: defaultPrompts.tasks.pregameHistory, taskKey: "pregameHistory" });
  assert.ok(pregame.requiredVariableKeys.includes("date") && pregame.requiredVariableKeys.includes("dateReadable"), "the bootstrap directive is dated");
  const projects = resolveTemplateVariableDemand({ helperTemplates: defaultPrompts.helpers, promptTemplate: defaultPrompts.tasks.projects, taskKey: "projects" });
  assert.ok(!projects.requiredVariableKeys.includes("worldSummary"), "the board pass does not build the world summary");
});

test("a demanded build constructs exactly the demanded keys", async () => {
  const bundle = {
    game: { country: "French Republic", gameDate: "1914-06-01", round: 3, difficulty: "hard" },
    world: { simulationRules: "Rules.", startingTimelineText: "Briefing." },
    events: [],
    chats: [],
    actions: [],
  };
  const keys = ["date", "difficultyGuidanceChats", "playerPolity", ...RUNNER_VARIABLE_KEYS];
  const variables = await buildPromptContext(bundle, { requiredKeys: keys });
  assert.deepEqual(Object.keys(variables).sort(), [...keys].sort());
  assert.equal(variables.worldBeforeRoundOne, "Briefing.");
  assert.match(variables.difficultyGuidanceChats, /^The difficulty is Hard\./);
});

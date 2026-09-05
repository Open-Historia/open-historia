import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConsolidatedHistoryText,
  buildDetailedChatHistoryText,
  buildDiplomaticContinuityText,
  buildEventHistoryText,
  buildHistoricalAnchorText,
  buildPromptContext,
} from "../src/Game/AI/promptContext.js";
import { resolveTemplateVariableDemand } from "../src/Game/AI/contextDiagnostics.js";

// The save remembers everything; a task is shown a bounded, deterministic slice.

const event = (index, extra = {}) => ({
  id: `event-${index}`,
  date: `1900-01-${String(10 + index).padStart(2, "0")}`,
  title: `Event ${index}`,
  description: `Description of event ${index}.`,
  impacts: {},
  ...extra,
});

test("recent events are trimmed to a character budget from the oldest end, with an omission note", () => {
  const events = Array.from({ length: 6 }, (_, index) => event(index));
  const full = buildEventHistoryText(events, { limit: 10 });
  assert.equal(full.split("\n- ").length, 6);

  const bounded = buildEventHistoryText(events, { limit: 10, maxChars: 130 });
  assert.match(bounded, /earlier event record\(s\) omitted/);
  assert.match(bounded, /Event 5/, "the newest event survives");
  assert.doesNotMatch(bounded, /Event 0\n/, "the oldest event goes first");
});

test("consolidated history under a budget keeps the newest blocks, the foundation, and even coverage", () => {
  const consolidatedHistory = Array.from({ length: 12 }, (_, index) => ({
    throughDate: `19${String(index).padStart(2, "0")}-12-31`,
    summary: `Summary block ${index}: ${"x".repeat(300)}`,
  }));
  const world = { consolidatedHistory };

  const full = buildConsolidatedHistoryText(world);
  assert.equal(full.split("\n\n").length, 12);

  // Roughly half the history fits: the newest blocks, the foundation block and
  // evenly spread middle blocks survive, and every gap is declared.
  const coverage = buildConsolidatedHistoryText(world, { maxChars: 2000, selection: "coverage" });
  assert.match(coverage, /Summary block 11/, "the newest block is kept");
  assert.match(coverage, /Summary block 0/, "the campaign foundation is kept");
  assert.match(coverage, /consolidated-history block\(s\) omitted/, "omissions are declared, never silent");
  assert.ok(coverage.length < full.length);

  const tail = buildConsolidatedHistoryText(world, { maxChars: 800 });
  assert.match(tail, /older consolidated-history block\(s\) omitted/);
  assert.match(tail, /Summary block 11/);
});

test("historical anchors keep the origin of an active war and critical turning points from the consolidated past", () => {
  const events = [
    event(0),
    event(1, { importance: "critical", title: "The great divergence" }),
    event(2),
    event(3, {
      title: "War of the Two Rivers begins",
      impacts: { regionTransfers: [{ regionId: "r1", regionName: "Left Bank", fromCode: "Ruritania", toCode: "Borduria" }] },
    }),
    event(4),
    event(5, { title: "Recent minor note" }),
  ];
  const world = {
    consolidatedHistory: [{ throughDate: "1900-01-14", throughEventId: "event-4", summary: "Consolidated." }],
    wars: [{
      id: "war-1",
      title: "War of the Two Rivers",
      status: "active",
      sideA: ["Ruritania"],
      sideB: ["Borduria"],
      startedDate: "1900-01-13",
      sourceEventIds: ["event-3"],
    }],
  };

  const anchors = buildHistoricalAnchorText(events, world, { maxAnchors: 4, maxChars: 2000 });
  assert.match(anchors, /The great divergence/);
  assert.match(anchors, /War of the Two Rivers begins/);
  assert.doesNotMatch(anchors, /Recent minor note/, "events after the consolidation boundary are not anchors");
  assert.equal(buildHistoricalAnchorText(events, { consolidatedHistory: [] }), "", "no consolidated past means no anchors");
});

test("template demand follows helper chains and the task's live directives", () => {
  const demand = resolveTemplateVariableDemand({
    helperTemplates: { CURRENT_UNITS: "${unitsSummary}", NESTED: "${CURRENT_UNITS} ${date}" },
    promptTemplate: "Player ${playerPolity}. Units: ${NESTED}.",
    taskKey: "jumpForward",
    variables: { playerPolity: "x", unitsSummary: "y" },
  });
  assert.deepEqual(demand.helperKeys, ["CURRENT_UNITS", "NESTED"]);
  assert.ok(demand.requiredVariableKeys.includes("unitsSummary"));
  assert.ok(demand.requiredVariableKeys.includes("date"));
  assert.ok(demand.requiredVariableKeys.includes("canonicalWarContext"), "a jump's live directives are demanded too");
  assert.ok(demand.missingRequiredVariableKeys.includes("date"));
});

test("a demanded prompt context builds only what the task can see, with the beta unit and board variables available", async () => {
  const bundle = {
    game: { country: "Ruritania", gameDate: "1930-05-12", round: 4, startDate: "1930-01-01" },
    world: {
      units: [{ id: "u1", name: "1st Army", type: "infantry", ownerCode: "Ruritania", strength: 100, lng: 10, lat: 50 }],
      pendingUnitOrders: [],
      projects: [],
      language: "English",
    },
    events: [event(0)],
    actions: [],
    chats: [],
  };
  const context = await buildPromptContext(bundle, {
    requiredKeys: ["playerPolity", "date", "pendingUnitOrders", "projectsSummary", "unitsSummary"],
    taskKey: "jumpForward",
  });
  assert.deepEqual(Object.keys(context).sort(), ["date", "pendingUnitOrders", "playerPolity", "projectsSummary", "unitsSummary"]);
  assert.equal(context.playerPolity, "Ruritania");
  assert.match(context.unitsSummary, /1st Army/);
  assert.match(context.projectsSummary, /No projects/);
});

test("chat transcripts keep the privacy wording and carry durable diplomatic memory", () => {
  assert.equal(buildDetailedChatHistoryText([], { visibleTo: "France" }), "You have exchanged no messages with them in these rounds.");
  assert.equal(buildDetailedChatHistoryText([]), "No chats occurred in these rounds.");

  const chats = [{
    id: "chat-1",
    title: "Border talks",
    countries: [{ name: "Ruritania" }, { name: "Borduria" }],
    messages: [
      { role: "user", speaker: "Ruritania", text: "We will withdraw by May 20.", time: "1930-05-10" },
      { role: "leader", speaker: "Borduria", text: "Agreed; our forces stand down the same day.", time: "1930-05-11", memorySummary: "Both sides agreed to withdraw by 1930-05-20." },
    ],
  }];
  const detailed = buildDetailedChatHistoryText(chats);
  assert.match(detailed, /Durable diplomatic memory/);
  assert.match(detailed, /withdraw by May 20/);
  // The filter narrows a non-empty transcript, not only the empty wording.
  assert.match(buildDetailedChatHistoryText(chats, { visibleTo: "Borduria" }), /withdraw by May 20/);
  assert.equal(
    buildDetailedChatHistoryText(chats, { visibleTo: "France" }),
    "You have exchanged no messages with them in these rounds.",
  );

  const continuity = buildDiplomaticContinuityText(chats);
  assert.match(continuity, /Standing diplomatic memory: Both sides agreed/);
  assert.match(continuity, /Recent verbatim diplomatic evidence/);
  assert.equal(buildDiplomaticContinuityText([{ id: "c", countries: [], messages: [{ role: "user", text: "hi" }] }]), "", "no memory, no bridge");
});

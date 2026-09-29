/*! Open Historia — history consolidation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test server/historyConsolidation.test.js
//
// Consolidation never edits the event log: a pass only moves the boundary the
// AI reads from and maintains one living history document. These pin when a
// pass is due, what it folds, that the newest events always stay in full,
// that the boundary survives the deletion of its own event, and how the
// document is created, rewritten, appended to and rendered.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_CONSOLIDATION,
  applyHistoryDocumentUpdate,
  buildHistoryDocumentDirective,
  countWords,
  deferredConsolidationStillDue,
  describeHistoryConsolidation,
  planHistoryConsolidation,
  seedHistoryDocumentText,
} from "../src/Game/AI/historyConsolidation.js";
import { buildConsolidatedHistoryText, getUnconsolidatedEvents } from "../src/Game/AI/promptContext.js";
import { normalizeWorldState } from "../src/runtime/gameState.js";

const event = (index) => ({
  id: `event-${index}`,
  date: `2001-01-${String(1 + (index % 28)).padStart(2, "0")}`,
  title: `Event ${index}`,
  description: `What happened in event ${index}.`,
  impacts: {},
});
const events = (count) => Array.from({ length: count }, (_, index) => event(index));
const bundle = (over = {}) => ({
  events: [],
  chats: [],
  actions: [],
  game: { round: 2, gameDate: "2001-02-01", country: "France" },
  world: { consolidatedHistory: [] },
  ...over,
});
const { retainEvents, sizeThreshold, batchSize, documentWordBudget, documentWordCeiling } = HISTORY_CONSOLIDATION;

test("a young campaign is left alone", () => {
  const plan = planHistoryConsolidation(bundle({ events: events(20) }));
  assert.equal(plan.due, false);
  assert.deepEqual(plan.eventsToConsolidate, []);
  assert.equal(plan.unconsolidatedEvents.length, 20);
});

test("past the size threshold a turn folds everything but the retained tail", () => {
  const plan = planHistoryConsolidation(bundle({ events: events(sizeThreshold + 1) }));
  assert.equal(plan.reason, "size");
  assert.equal(plan.eventsToConsolidate.length, sizeThreshold + 1 - retainEvents);
  assert.equal(plan.throughEvent.id, `event-${sizeThreshold - retainEvents}`);
});

test("every fifth round folds once more than the retained tail has piled up, other rounds do not", () => {
  const thirty = events(30);
  assert.equal(planHistoryConsolidation(bundle({ events: thirty, game: { round: 5 } })).reason, "interval");
  assert.equal(planHistoryConsolidation(bundle({ events: thirty, game: { round: 5 } })).eventsToConsolidate.length, 30 - retainEvents);
  assert.equal(planHistoryConsolidation(bundle({ events: thirty, game: { round: 4 } })).due, false);
  assert.equal(planHistoryConsolidation(bundle({ events: events(retainEvents), game: { round: 5 } })).due, false, "the tail alone is never folded");
});

test("forcing (the Cheats tool) skips the thresholds but still keeps the newest events in full", () => {
  const plan = planHistoryConsolidation(bundle({ events: events(30), game: { round: 4 } }), { force: true });
  assert.equal(plan.reason, "forced");
  assert.equal(plan.eventsToConsolidate.length, 30 - retainEvents);
  assert.equal(planHistoryConsolidation(bundle({ events: events(retainEvents) }), { force: true }).due, false);
});

test("one pass folds at most a batch; the rest waits", () => {
  const plan = planHistoryConsolidation(bundle({ events: events(200) }));
  assert.equal(plan.eventsToConsolidate.length, batchSize);
  assert.equal(plan.throughEvent.id, `event-${batchSize - 1}`);
});

test("closed chats are folded even when no events are due, and never twice", () => {
  const chats = [
    { id: "chat-open", status: "open", countries: ["France"], messages: [] },
    { id: "chat-done", status: "closed", countries: ["France"], messages: [] },
    { id: "chat-old", status: "closed", countries: ["France"], messages: [] },
  ];
  const world = { consolidatedHistory: [{ summary: "Earlier.", chatIds: ["chat-old"], throughEventId: "", throughDate: "2000-12-01" }] };
  const plan = planHistoryConsolidation(bundle({ events: events(5), chats, world }));
  assert.equal(plan.due, true);
  assert.deepEqual(plan.closedChats.map((chat) => chat.id), ["chat-done"]);
  assert.deepEqual(plan.eventsToConsolidate, []);
});

test("resolved orders ride along once; planned ones and folded ones do not", () => {
  const actions = [
    { id: "order-planned", title: "Later", status: "planned" },
    { id: "order-done", title: "Done", status: "resolved" },
    { id: "order-folded", title: "Old", status: "resolved" },
  ];
  const world = { consolidatedHistory: [{ summary: "Earlier.", actionIds: ["order-folded"], throughEventId: "", throughDate: "2000-12-01" }] };
  const plan = planHistoryConsolidation(bundle({ events: events(sizeThreshold + 1), actions, world }));
  assert.deepEqual(plan.actionsToConsolidate.map((action) => action.id), ["order-done"]);
});

test("a batched pass that comes back later is dropped once another pass has folded its events", () => {
  const log = events(sizeThreshold + 1);
  const plan = planHistoryConsolidation(bundle({ events: log }));
  assert.equal(deferredConsolidationStillDue(plan, bundle({ events: log })), true, "nothing folded meanwhile");
  const folded = { consolidatedHistory: [{ summary: "Folded synchronously.", throughEventId: plan.throughEvent.id, throughDate: plan.throughEvent.date }] };
  assert.equal(deferredConsolidationStillDue(plan, bundle({ events: log, world: folded })), false);
});

test("a batched chats-only pass is dropped once its chats were folded, not applied twice", () => {
  // No events were due, so there is no boundary event to test against; the
  // chats it folds are what say whether it is still wanted.
  const chats = [{ id: "chat-done", status: "closed", countries: ["France"], messages: [] }];
  const plan = planHistoryConsolidation(bundle({ events: events(5), chats }));
  assert.equal(plan.throughEvent, null);
  assert.equal(deferredConsolidationStillDue(plan, bundle({ events: events(5), chats })), true);
  const folded = { consolidatedHistory: [{ summary: "Folded.", chatIds: ["chat-done"], throughEventId: "" }] };
  assert.equal(deferredConsolidationStillDue(plan, bundle({ events: events(5), chats, world: folded })), false);
});

test("the boundary is the last pass's event, and the log itself is untouched", () => {
  const log = events(40);
  const world = { consolidatedHistory: [{ summary: "Through 12.", throughEventId: "event-12", throughDate: log[12].date }] };
  const shown = getUnconsolidatedEvents(log, world);
  assert.deepEqual(shown.map((entry) => entry.id), log.slice(13).map((entry) => entry.id));
  assert.equal(log.length, 40, "getUnconsolidatedEvents reads; it never trims");
  assert.equal(log[3].description, "What happened in event 3.");
});

test("a deleted boundary event falls back to the pass's date instead of re-exposing the whole log", () => {
  const log = events(40).filter((entry) => entry.id !== "event-12");
  const world = { consolidatedHistory: [{ summary: "Through 12.", throughEventId: "event-12", throughDate: "2001-01-13" }] };
  const shown = getUnconsolidatedEvents(log, world);
  assert.ok(shown.length < log.length, "the summarised past is not shown again");
  assert.ok(shown.every((entry) => entry.date > "2001-01-13"), "only events dated after the pass's boundary are shown");
  assert.equal(getUnconsolidatedEvents(log, { consolidatedHistory: [{ summary: "x", throughEventId: "gone" }] }).length, log.length, "with no date either, everything stays visible");
});

test("the first pass writes the history document and every later pass rewrites it in place", () => {
  const first = applyHistoryDocumentUpdate({}, {
    document: "1990–1991: The union dissolved.",
    summary: "The union dissolved.",
    source: "ai",
    throughDate: "1991-12-26",
    throughEventId: "event-12",
    throughRound: 3,
    baseRevision: 0,
  });
  assert.equal(first.mode, "rewritten");
  assert.equal(first.historyDocument.revision, 1);
  assert.equal(first.historyDocument.text, "1990–1991: The union dissolved.");
  assert.equal(first.historyDocument.throughEventId, "event-12");

  const second = applyHistoryDocumentUpdate({ historyDocument: first.historyDocument }, {
    document: "1990–1993: The union dissolved; the successor states quarrelled over the fleet.",
    summary: "The successor states quarrelled over the fleet.",
    throughDate: "1993-06-01",
    throughEventId: "event-40",
    throughRound: 6,
    baseRevision: 1,
  });
  assert.equal(second.mode, "rewritten");
  assert.equal(second.historyDocument.revision, 2);
  assert.match(second.historyDocument.text, /quarrelled/);
  assert.doesNotMatch(second.historyDocument.text, /The union dissolved\.$/, "the previous version is replaced, not appended to");
  assert.equal(second.historyDocument.throughDate, "1993-06-01");
});

test("a pass that comes back without a document appends its summary under a dated heading, so nothing is lost", () => {
  const world = { historyDocument: { text: "1990: Start.", revision: 1, source: "ai", throughDate: "1990-12-31" } };
  const next = applyHistoryDocumentUpdate(world, { document: "", summary: "1991: A coup failed.", source: "fallback", throughDate: "1991-08-21", baseRevision: 1 });
  assert.equal(next.mode, "appended");
  assert.equal(next.historyDocument.text, "1990: Start.\n\nThrough 1991-08-21:\n1991: A coup failed.");
  assert.equal(next.historyDocument.revision, 2);
  assert.equal(next.historyDocument.source, "fallback");
  assert.equal(applyHistoryDocumentUpdate(world, { document: "", summary: "" }).mode, "unchanged");
});

test("a document edited by hand while the pass ran is not overwritten by the pass's rewrite", () => {
  const world = { historyDocument: { text: "Edited by hand.", revision: 3, source: "manual" } };
  const next = applyHistoryDocumentUpdate(world, { document: "The AI's rewrite of revision 2.", summary: "New period.", throughDate: "2002-01-01", baseRevision: 2 });
  assert.equal(next.mode, "appended");
  assert.match(next.historyDocument.text, /^Edited by hand\.\n\nThrough 2002-01-01:\nNew period\.$/);
});

test("the consolidator is told the current document and its budget; a campaign from before the document sees its pass summaries as the document", () => {
  const fresh = buildHistoryDocumentDirective({});
  assert.match(fresh, /no history document yet/);
  assert.match(fresh, new RegExp(`near ${documentWordBudget} words and never above ${documentWordCeiling}`));
  assert.match(fresh, /removing the LEAST important older material first/);

  const legacy = { consolidatedHistory: [
    { summary: "Old one.", throughDate: "2000-01-01" },
    { summary: "Old two.", throughDate: "2000-06-01" },
  ] };
  assert.equal(seedHistoryDocumentText(legacy), "Through 2000-01-01: Old one.\n\nThrough 2000-06-01: Old two.");
  const migrating = buildHistoryDocumentDirective(legacy);
  assert.match(migrating, /The current document \(\d+ words\) follows/);
  assert.match(migrating, /Through 2000-06-01: Old two\./);

  const live = { historyDocument: { text: "Live text.", revision: 2 }, consolidatedHistory: legacy.consolidatedHistory };
  assert.equal(seedHistoryDocumentText(live), "Live text.", "the live document wins over the ledger");
  assert.match(buildHistoryDocumentDirective({ historyDocument: { text: Array.from({ length: documentWordBudget + 1 }, () => "word").join(" ") } }), /over the .*-word budget, so condense it/);
  assert.equal(countWords("  one two\nthree  "), 3);
});

test("prompts render the document in place of the pass summaries, trimming its oldest paragraphs to a budget but never dropping it", () => {
  const paragraphs = Array.from({ length: 5 }, (_, index) => `Period ${index + 1}: ${"detail ".repeat(20).trim()}.`);
  const world = {
    historyDocument: { text: paragraphs.join("\n\n"), revision: 4, throughDate: "2005-01-01" },
    consolidatedHistory: [{ summary: "Legacy pass summary.", throughDate: "2001-01-01", throughEventId: "event-1" }],
  };
  const full = buildConsolidatedHistoryText(world);
  assert.match(full, /^History document \(maintained across consolidations, through 2005-01-01\):/);
  assert.match(full, /Period 5:/);
  assert.doesNotMatch(full, /Legacy pass summary/, "the ledger is not rendered twice beside the document");

  const trimmed = buildConsolidatedHistoryText(world, { maxChars: 400, selection: "coverage" });
  assert.match(trimmed, /older paragraph\(s\) of the history document omitted/);
  assert.match(trimmed, /Period 5:/, "the newest paragraph is always kept");
  assert.doesNotMatch(trimmed, /Period 1:/);
  assert.ok(trimmed.length <= 400 + 200, "the budget is soft only by the heading and the marker");

  assert.match(buildConsolidatedHistoryText({ consolidatedHistory: world.consolidatedHistory }), /Through 2001-01-01: Legacy pass summary\./, "a campaign without the document still gets its pass summaries");
});

test("world state keeps the document, defaults its bookkeeping and drops an empty one", () => {
  const kept = normalizeWorldState({ historyDocument: { text: " First.\n\nSecond. ", revision: "2", throughRound: "7" } }).historyDocument;
  assert.equal(kept.text, "First.\n\nSecond.", "paragraph breaks survive a read");
  assert.equal(kept.revision, 2);
  assert.equal(kept.throughRound, 7);
  assert.equal(kept.source, "ai");
  assert.ok(kept.updatedAt);
  assert.equal(normalizeWorldState({ historyDocument: { text: "   " } }).historyDocument, null);
  assert.equal(normalizeWorldState({}).historyDocument, null);
});

test("the status line says how many events are waiting, when a turn will fold them, and how big the document is", () => {
  const status = describeHistoryConsolidation(bundle({ events: events(30), world: { consolidatedHistory: [{ summary: "One.", throughEventId: "" }] } }));
  assert.equal(status.passes, 1);
  assert.equal(status.eventsSinceLastPass, 30);
  assert.equal(status.dueNow, false);
  assert.match(status.text, /30 events since the last pass/);
  assert.match(status.text, new RegExp(`newest ${retainEvents} always stay in full`));
  assert.match(status.text, /No history document yet: the AI is shown the 1 pass summary/);

  const withDocument = describeHistoryConsolidation(bundle({ world: { historyDocument: { text: "one two three", revision: 2, source: "manual", throughDate: "2001-01-01" } } }));
  assert.equal(withDocument.documentWords, 3);
  assert.match(withDocument.text, new RegExp(`3 words of a ${documentWordBudget}-word budget \\(revision 2, last edited by hand, through 2001-01-01\\)`));
});

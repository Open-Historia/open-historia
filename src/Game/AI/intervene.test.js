/*! Open Historia — Intervene tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/intervene.test.js
//
// Runs without node_modules: intervene.js imports nothing.

import test from "node:test";
import assert from "node:assert/strict";

import { closingDateAfterIntervene, describeIntervention, journalTurn, truncateTurn } from "./intervene.js";

const event = (id, date, title) => ({ id, date, title, description: `${title}.`, impacts: {} });
const turn = () => journalTurn({
    events: [
        event("event-ai-r0002-20140425-001", "2014-04-25", "Ultimatum delivered"),
        event("event-ai-r0002-20140503-002", "2014-05-03", "Columns cross the border"),
        event("event-ai-r0002-20140510-003", "2014-05-10", "Kharkiv falls"),
        event("event-ai-r0002-20140518-004", "2014-05-18", "Ceasefire talks open"),
        event("espionage-2-4", "2014-05-21", "An agent is exposed"),
    ],
    excludeEventIds: ["espionage-2-4"],
    warUpdates: [
        { id: "war-1", op: "start", eventIds: ["event-ai-r0002-20140503-002"] },
        { id: "war-1", op: "ceasefire", eventIds: ["event-ai-r0002-20140518-004"] },
        { id: "baseline", op: "note" },
    ],
    relationUpdates: [{ id: "rel-1", a: "A", b: "B", eventIndexes: [3] }],
    agreementUpdates: [],
    storylineUpdates: [{ id: "story-1", eventIds: ["event-ai-r0002-20140425-001", "event-ai-r0002-20140518-004"] }],
    stopDate: "2014-05-21",
    summary: "A month of war.",
    outreach: [{ title: "Mediation", countries: ["France"], speaker: "France", openingMessage: "Talk?" }],
    clearActions: true,
    mode: "jump",
});

test("the journal keeps the model's events in reveal order and leaves the engine's own out", () => {
    const journal = turn();
    assert.deepEqual(journal.events.map((entry) => entry.title), ["Ultimatum delivered", "Columns cross the border", "Kharkiv falls", "Ceasefire talks open"]);
    assert.equal(journal.stopDate, "2014-05-21");
    assert.equal(journal.mode, "jump");
    assert.deepEqual(journalTurn().events, []);
});

test("stopping after the second event keeps two, drops two, and closes on the second's date", () => {
    const { result, kept, dropped, closingDate } = truncateTurn(turn(), 2, { originDate: "2014-04-21", minimumDate: "2014-04-22" });
    assert.deepEqual(kept.map((entry) => entry.title), ["Ultimatum delivered", "Columns cross the border"]);
    assert.deepEqual(dropped.map((entry) => entry.title), ["Kharkiv falls", "Ceasefire talks open"]);
    assert.equal(closingDate, "2014-05-03");
    assert.equal(result.stopDate, "2014-05-03");
    assert.equal(result.events.length, 2);
});

test("ledger records bound only to discarded events go with them; baselines and records bound to kept ones stay", () => {
    const { result } = truncateTurn(turn(), 2, { originDate: "2014-04-21" });
    assert.deepEqual(result.warUpdates.map((update) => update.op), ["start", "note"], "the ceasefire was bound to a discarded event");
    assert.deepEqual(result.relationUpdates, [], "bound by index to the fourth event");
    assert.equal(result.storylineUpdates.length, 1, "bound to a kept event as well as a discarded one");
});

test("a stop keeps at least one event and never more than the round has", () => {
    assert.equal(truncateTurn(turn(), 99, {}).dropped.length, 0, "asking for more than there is keeps everything");
    assert.equal(truncateTurn(turn(), 0, {}).kept.length, 1, "at least one event is always kept");
});

test("the outreach and the summary ride along; the mode is the turn's", () => {
    const { result } = truncateTurn(turn(), 1, {});
    assert.equal(result.outreach.length, 1);
    assert.equal(result.summary, "A month of war.");
    assert.equal(result.clearActions, true);
    assert.equal(result.mode, "jump");
});

test("the closing date is the last kept event's, never before the day after the round began", () => {
    assert.equal(closingDateAfterIntervene({ keptEvents: [event("a", "2014-04-21", "same day")], originDate: "2014-04-21", minimumDate: "2014-04-22" }), "2014-04-22");
    assert.equal(closingDateAfterIntervene({ keptEvents: [event("a", "2014-04-30", "x"), event("b", "2014-04-25", "y")], originDate: "2014-04-21" }), "2014-04-30", "the latest date, whatever the order");
    assert.equal(closingDateAfterIntervene({ keptEvents: [], originDate: "2014-04-21" }), "2014-04-21");
});

test("the receipt names where the player stopped and what never happened", () => {
    const { kept, dropped, closingDate } = truncateTurn(turn(), 2, {});
    const text = describeIntervention({ kept, dropped, closingDate });
    assert.match(text, /stopped the round after "Columns cross the border" \(2014-05-03\)/);
    assert.match(text, /2 events you wrote after it were discarded/);
    assert.match(text, /"Kharkiv falls", "Ceasefire talks open"/);
    assert.match(text, /stands at 2014-05-03/);
    assert.equal(describeIntervention({ kept, dropped: [], closingDate }), "", "nothing to say when nothing was dropped");
});

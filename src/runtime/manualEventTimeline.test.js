/*! Open Historia — manual events on the turn timeline tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/manualEventTimeline.test.js
//
// The Event Editor runs this on every open and every save, and it writes
// world.simulationHistory, which is all the Events panel shows. The invariants:
// a manual event is linked to exactly one turn record — the one whose range
// holds its date, or a record of its own in date order — and nothing else in
// the history moves.

import test from "node:test";
import assert from "node:assert/strict";

import {
  historyEntryCoversDate,
  isManualTimelineEvent,
  syncManualEventTimelineHistory,
} from "./manualEventTimeline.js";

const turn = (fromDate, toDate, eventIds = [], extra = {}) => ({ fromDate, toDate, date: toDate, eventIds, mode: "jump", source: "ai", ...extra });
const manual = (id, date, title = "A manual event") => ({ id, date, title, source: "manual" });
const ai = (id, date) => ({ id, date, title: `AI ${id}`, source: "ai" });
const game = { round: 7 };

// Newest first, as the game writes it.
const baseHistory = () => [
  turn("1914-03-01", "1914-05-31", ["ai-3"]),
  turn("1914-01-01", "1914-02-28", ["ai-1", "ai-2"]),
];
const baseEvents = () => [ai("ai-1", "1914-01-10"), ai("ai-2", "1914-02-10"), ai("ai-3", "1914-04-10")];

test("a turn covers the dates in its range, BC ones included", () => {
  assert.equal(historyEntryCoversDate(turn("1914-01-01", "1914-02-28"), "1914-02-01"), true);
  assert.equal(historyEntryCoversDate(turn("1914-01-01", "1914-02-28"), "1914-03-01"), false);
  // As text "-0490" sorts after "-0500", which put Marathon outside a range
  // running from 500 BC to 480 BC.
  assert.equal(historyEntryCoversDate(turn("-0500-01-01", "-0480-12-31"), "-0490-09-12"), true);
  assert.equal(historyEntryCoversDate(turn("-0500-01-01", "-0480-12-31"), "-0510-01-01"), false);
  // A reversed range still covers what lies between.
  assert.equal(historyEntryCoversDate(turn("1914-02-28", "1914-01-01"), "1914-02-01"), true);
  assert.equal(historyEntryCoversDate(turn("1914-01-01", "1914-02-28"), ""), false);
});

test("a manual event is recognised by its source or its id", () => {
  assert.equal(isManualTimelineEvent({ source: "manual" }), true);
  assert.equal(isManualTimelineEvent({ id: "event-manual-abc" }), true);
  assert.equal(isManualTimelineEvent({ id: "event-12", source: "ai" }), false);
});

test("an event inside an existing turn joins that turn", () => {
  const events = [...baseEvents(), manual("event-manual-a", "1914-02-15")];
  const { changed, world } = syncManualEventTimelineHistory({ simulationHistory: baseHistory() }, events, game);
  assert.equal(changed, true);
  assert.equal(world.simulationHistory.length, 2);
  assert.deepEqual(world.simulationHistory[1].eventIds, ["ai-1", "ai-2", "event-manual-a"]);
  assert.deepEqual(world.simulationHistory[0].eventIds, ["ai-3"]);
});

test("an event after every turn gets a record of its own at the top", () => {
  const events = [...baseEvents(), manual("event-manual-late", "1914-07-01", "Late")];
  const { world } = syncManualEventTimelineHistory({ simulationHistory: baseHistory() }, events, game);
  assert.equal(world.simulationHistory.length, 3);
  const [first] = world.simulationHistory;
  assert.deepEqual(first.eventIds, ["event-manual-late"]);
  assert.equal(first.mode, "manual-event");
  assert.equal(first.source, "manual");
  assert.equal(first.round, 7);
  assert.equal(first.fromDate, "1914-07-01");
  assert.equal(first.summary, "Manual exact event: Late");
});

test("an event before every turn gets a record of its own at the bottom", () => {
  const events = [...baseEvents(), manual("event-manual-early", "1913-06-01")];
  const { world } = syncManualEventTimelineHistory({ simulationHistory: baseHistory() }, events, game);
  assert.equal(world.simulationHistory.length, 3);
  assert.deepEqual(world.simulationHistory[2].eventIds, ["event-manual-early"]);
});

test("a date edit moves the link from one turn to the other", () => {
  const first = syncManualEventTimelineHistory(
    { simulationHistory: baseHistory() },
    [...baseEvents(), manual("event-manual-a", "1914-02-15")],
    game,
  ).world;
  const moved = syncManualEventTimelineHistory(
    first,
    [...baseEvents(), manual("event-manual-a", "1914-04-20")],
    game,
  ).world;
  assert.deepEqual(moved.simulationHistory[0].eventIds, ["ai-3", "event-manual-a"]);
  assert.deepEqual(moved.simulationHistory[1].eventIds, ["ai-1", "ai-2"]);
});

test("deleting the last event of a manual or GM record removes the record", () => {
  const history = [
    turn("1914-07-01", "1914-07-01", ["event-manual-late"], { mode: "manual-event", source: "manual" }),
    turn("1914-06-15", "1914-06-15", ["event-manual-gm"], { mode: "game-master", source: "gm-console" }),
    ...baseHistory(),
  ];
  const { changed, world } = syncManualEventTimelineHistory({ simulationHistory: history }, baseEvents(), game);
  assert.equal(changed, true);
  assert.deepEqual(world.simulationHistory, baseHistory());
});

test("an AI turn keeps its record when its manual event is deleted", () => {
  const history = [turn("1914-03-01", "1914-05-31", ["event-manual-a"]), ...baseHistory().slice(1)];
  const { world } = syncManualEventTimelineHistory({ simulationHistory: history }, baseEvents().slice(0, 2), game);
  assert.equal(world.simulationHistory.length, 2);
  assert.deepEqual(world.simulationHistory[0].eventIds, []);
});

test("manual and GM records that were already empty are pruned; AI ones are not", () => {
  const history = [
    turn("1914-09-01", "1914-09-01", [], { mode: "game-master", source: "gm-console", summary: "Stats only" }),
    turn("1914-08-01", "1914-08-01", [], { mode: "manual-event", source: "manual" }),
    turn("1914-07-01", "1914-07-31", []),
    ...baseHistory(),
  ];
  const { changed, world } = syncManualEventTimelineHistory({ simulationHistory: history }, baseEvents(), game);
  assert.equal(changed, true);
  assert.deepEqual(world.simulationHistory, [turn("1914-07-01", "1914-07-31", []), ...baseHistory()]);
});

test("a second pass over its own result changes nothing", () => {
  const events = [
    ...baseEvents(),
    manual("event-manual-a", "1914-02-15"),
    manual("event-manual-b", "1914-07-01"),
    manual("event-manual-c", "1913-01-01"),
  ];
  const first = syncManualEventTimelineHistory({ simulationHistory: baseHistory() }, events, game);
  assert.equal(first.changed, true);
  // Opened again rounds later: the records keep the round they were written in.
  const second = syncManualEventTimelineHistory(first.world, events, { round: 12 });
  assert.equal(second.changed, false);
  assert.deepEqual(second.world.simulationHistory, first.world.simulationHistory);
});

test("a history with no manual events is left as it was", () => {
  const world = { simulationHistory: baseHistory(), other: 1 };
  const result = syncManualEventTimelineHistory(world, baseEvents(), game);
  assert.equal(result.changed, false);
  assert.deepEqual(result.world, world);
  assert.deepEqual(world.simulationHistory, baseHistory(), "the input is not mutated");
});

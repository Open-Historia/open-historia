/*! Open Historia — events written but not put on the timeline, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FILED_EVENTS_MAX,
  FILED_FATES,
  describeFiledRoute,
  filedFateLabel,
  normalizeFiledEvents,
  previewFiledMark,
  toFiledEvent,
} from "./filedEvents.js";

test("a routine event is off the timeline, a restatement of the record is not recorded", () => {
  assert.equal(describeFiledRoute("ROUTINE_MILITARY_PRECURATION").fate, FILED_FATES.offTimeline);
  assert.equal(describeFiledRoute("LOW_VALUE_INCREMENTAL_CHURN").fate, FILED_FATES.offTimeline);
  assert.equal(describeFiledRoute("EXACT_DUPLICATE").fate, FILED_FATES.notRecorded);
  assert.equal(describeFiledRoute("NON_BELLIGERENT_WARTIME_CAUSALITY").fate, FILED_FATES.notRecorded);
});

test("a route nobody has named yet is read as not recorded, the safe side", () => {
  const described = describeFiledRoute("SOME_FUTURE_ROUTE");
  assert.equal(described.fate, FILED_FATES.notRecorded);
  assert.ok(described.note);
  assert.equal(filedFateLabel(described.fate), "Not recorded");
  assert.equal(filedFateLabel(FILED_FATES.offTimeline), "Off the timeline");
});

test("a curator row with its event becomes a card; a row with only a title takes the event given", () => {
  const event = { title: "Omani Panel Reports Compliance", description: "Quiet month.", date: "2019-08-27" };
  const fromRow = toFiledEvent({ route: "ROUTINE_MILITARY_PRECURATION", reason: "x", event });
  assert.deepEqual(fromRow, {
    title: "Omani Panel Reports Compliance",
    description: "Quiet month.",
    date: "2019-08-27",
    route: "ROUTINE_MILITARY_PRECURATION",
    fate: FILED_FATES.offTimeline,
    note: describeFiledRoute("ROUTINE_MILITARY_PRECURATION").note,
  });
  const fromTitle = toFiledEvent({ title: "Omani Panel Reports Compliance", route: "EXACT_DUPLICATE" }, event);
  assert.equal(fromTitle.description, "Quiet month.");
  assert.equal(fromTitle.fate, FILED_FATES.notRecorded);
  assert.equal(toFiledEvent({ route: "EXACT_DUPLICATE" }), null);
});

test("stored cards are bounded, deduplicated by title and repaired", () => {
  const many = Array.from({ length: FILED_EVENTS_MAX + 5 }, (_, index) => ({ title: `Event ${index}`, route: "NATIVE_PROCESS_FILLER" }));
  assert.equal(normalizeFiledEvents(many).length, FILED_EVENTS_MAX);
  const cards = normalizeFiledEvents([
    { title: "Same", route: "EXACT_DUPLICATE", fate: "made-up" },
    { title: "same", route: "EXACT_DUPLICATE" },
    { route: "EXACT_DUPLICATE" },
    null,
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].fate, FILED_FATES.notRecorded);
  assert.ok(cards[0].note);
  assert.deepEqual(normalizeFiledEvents(undefined), []);
});

test("the live mark follows the screen's verdict", () => {
  assert.equal(previewFiledMark(null), null);
  assert.equal(previewFiledMark({ fate: "hide", route: "ROUTINE_ADMINISTRATIVE_PROCESS" }).fate, FILED_FATES.offTimeline);
  assert.equal(previewFiledMark({ fate: "reject", route: "NON_BELLIGERENT_WARTIME_CAUSALITY" }).fate, FILED_FATES.notRecorded);
});

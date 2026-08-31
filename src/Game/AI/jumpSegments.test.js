/*! Open Historia — segmented timeline jump tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/jumpSegments.test.js
//
// Runs without node_modules: jumpSegments.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENTED_JUMP_MIN_DAYS,
  buildSegmentBriefing,
  buildSegmentInstruction,
  eventCountRangeForDays,
  formatDurationLabel,
  mergeSegmentPayloads,
  planJumpSegments,
  segmentEventRange,
} from "./jumpSegments.js";

// ---------------------------------------------------------------------------
// Planning

// The reported jump: 270 days, which fell over as one request.
test("a nine-month jump splits into three whole quarters", () => {
  const spans = planJumpSegments(270);
  assert.equal(spans.length, 3);
  assert.equal(spans.reduce((sum, span) => sum + span, 0), 270);
  assert.deepEqual(spans, [90, 90, 90]);
});

// Every split has to add back up, or the round lands on the wrong date.
test("segments always sum to the requested days, for every length", () => {
  for (let days = 1; days <= 800; days += 1) {
    const spans = planJumpSegments(days);
    assert.equal(spans.reduce((sum, span) => sum + span, 0), days, `days=${days}`);
    assert.ok(spans.every((span) => span > 0), `days=${days} produced an empty segment`);
  }
});

// A stub segment would ask for a quarter's worth of events out of a few days.
test("no segment is left as a stub when the days do not divide evenly", () => {
  for (const days of [200, 271, 365, 400, 500, 733]) {
    const spans = planJumpSegments(days);
    const shortest = Math.min(...spans);
    const longest = Math.max(...spans);
    assert.ok(longest - shortest <= 1, `days=${days} produced uneven segments ${spans}`);
  }
});

test("a short jump stays a single segment", () => {
  assert.deepEqual(planJumpSegments(30), [30]);
  assert.deepEqual(planJumpSegments(92), [92]);
  assert.deepEqual(planJumpSegments(0), [0]);
});

// Three quarters should ask for about what one nine-month call asked for.
test("segmented event counts land near the single-call count", () => {
  const [wholeMin, wholeMax] = eventCountRangeForDays(270);
  const spans = planJumpSegments(270);
  const min = spans.reduce((sum, span) => sum + eventCountRangeForDays(span)[0], 0);
  const max = spans.reduce((sum, span) => sum + eventCountRangeForDays(span)[1], 0);

  assert.deepEqual([wholeMin, wholeMax], [29, 37]);
  assert.ok(min >= wholeMin - 2 && min <= wholeMin + 4, `segment floor ${min} vs ${wholeMin}`);
  assert.ok(max >= wholeMax - 2 && max <= wholeMax + 4, `segment ceiling ${max} vs ${wholeMax}`);
});

// Fourteen queued orders must raise the floor once across the jump, not once per
// segment — otherwise a split jump demands 42 events where one call wanted 37.
test("the queued-order floor is a per-segment share, not the whole queue", () => {
  const spans = planJumpSegments(270);
  const share = Math.ceil(14 / spans.length);
  const total = spans.reduce((sum, span) => sum + segmentEventRange(span, share)[0], 0);
  assert.ok(total <= 37, `a split jump demanded ${total} events`);
});

test("formatDurationLabel collapses even spans", () => {
  assert.equal(formatDurationLabel(365), "1 year");
  assert.equal(formatDurationLabel(90), "3 months");
  assert.equal(formatDurationLabel(14), "2 weeks");
  assert.equal(formatDurationLabel(5), "5 days");
  assert.equal(formatDurationLabel(0.25), "6 hours");
});

// ---------------------------------------------------------------------------
// Instructions

// A jump that does not need splitting must send the prompt it always sent.
test("a single-segment jump is worded exactly as before", () => {
  const message = buildSegmentInstruction({
    mode: "jump",
    segmentCount: 1,
    minEvents: 29,
    maxEvents: 37,
    durationLabel: "9 months",
  });

  assert.equal(
    message,
    'Simulate a standard jump forward to the requested target date. Return JSON only. The "events" array must '
    + "contain between 29 and 37 events (this jump covers 9 months), with their dates spread across the skipped period.",
  );
  assert.ok(!/segment/i.test(message));
});

test("an auto jump is never told about segments", () => {
  const message = buildSegmentInstruction({ mode: "auto", segmentCount: 1 });
  assert.match(message, /^Simulate an auto-jump/);
  assert.ok(!/segment/i.test(message));
});

test("the first segment is told it is one round, and given its own span", () => {
  const message = buildSegmentInstruction({
    segmentIndex: 0,
    segmentCount: 3,
    minEvents: 10,
    maxEvents: 13,
    segmentDurationLabel: "3 months",
    originDate: "2287-02-26",
    targetDate: "2287-11-23",
    segmentTargetDate: "2287-05-27",
  });

  assert.match(message, /SINGLE round covering 2287-02-26 to 2287-11-23/);
  assert.match(message, /segment 1 of 3/);
  assert.match(message, /"stopDate" to 2287-05-27/);
  assert.match(message, /between 10 and 13 events/);
  // Nothing has happened yet, so there is no briefing to guard.
  assert.ok(!/CRITICAL/.test(message));
});

// The requirement this whole mechanism exists to protect: the player cannot have
// answered a segment-one event, so segment two must not punish them for silence.
test("later segments forbid punishing the player for a silence they could not break", () => {
  const message = buildSegmentInstruction({
    segmentIndex: 1,
    segmentCount: 3,
    minEvents: 10,
    maxEvents: 13,
    segmentDurationLabel: "3 months",
    originDate: "2287-02-26",
    targetDate: "2287-11-23",
    segmentTargetDate: "2287-08-25",
    priorEvents: [{ date: "2287-04-01", title: "The Legion masses at Nogales", description: "Cohorts gather." }],
  });

  assert.match(message, /segment 2 of 3/);
  assert.match(message, /COULD NOT have\s+reacted/);
  assert.match(message, /Do NOT portray\s+them as passive/);
  assert.match(message, /do NOT let other powers\s+exploit, punish/);
  assert.match(message, /The Legion masses at Nogales/);
  assert.match(message, /do not restate, rephrase or re-narrate/);
});

test("the briefing lists prior events compactly and caps long descriptions", () => {
  const briefing = buildSegmentBriefing([
    { date: "2287-04-01", title: "A war begins", description: "x".repeat(400) },
    { date: "2287-05-02", title: "A treaty", description: "" },
  ]);

  const [first, second] = briefing.split("\n");
  assert.ok(first.startsWith("- 2287-04-01: A war begins — "));
  assert.ok(first.length < 260, `briefing line was ${first.length} chars`);
  assert.ok(first.endsWith("…"));
  assert.equal(second, "- 2287-05-02: A treaty");
});

test("an empty briefing is empty rather than a stray heading", () => {
  assert.equal(buildSegmentBriefing([]), "");
  assert.equal(buildSegmentBriefing(null), "");
});

// ---------------------------------------------------------------------------
// Merging

test("segments merge into one round's result", () => {
  const merged = mergeSegmentPayloads([
    {
      events: [{ date: "2287-04-01", title: "One" }],
      summary: "The spring.",
      diplomaticOutreach: [{ title: "A feeler" }],
      catalyst: { title: "An early scene" },
      stopDate: "2287-05-27",
    },
    {
      events: [{ date: "2287-09-01", title: "Two" }],
      summary: "The autumn.",
      diplomaticOutreach: [],
      catalyst: { title: "A closing scene" },
      stopDate: "2287-11-23",
    },
  ], { targetDate: "2287-11-23" });

  assert.deepEqual(merged.events.map((event) => event.title), ["One", "Two"]);
  assert.equal(merged.summary, "The spring.\n\nThe autumn.");
  assert.equal(merged.stopDate, "2287-11-23");
  assert.equal(merged.diplomaticOutreach.length, 1);
  // A catalyst is answered after the jump, so it must be the one from the END.
  assert.equal(merged.catalyst.title, "A closing scene");
  assert.equal(merged.clearActions, true);
});

test("a catalyst offered mid-jump survives when later segments offer none", () => {
  const merged = mergeSegmentPayloads([
    { events: [], catalyst: { title: "The only scene" } },
    { events: [] },
  ]);
  assert.equal(merged.catalyst.title, "The only scene");
});

test("the final segment has the last word on whether orders resolved", () => {
  assert.equal(mergeSegmentPayloads([{ clearActions: true }, { clearActions: false }]).clearActions, false);
  assert.equal(mergeSegmentPayloads([{ clearActions: false }, { clearActions: true }]).clearActions, true);
  // Absent still means resolved, as it always has.
  assert.equal(mergeSegmentPayloads([{ events: [] }]).clearActions, true);
});

// Auto jumps stop early on purpose, so the payload's own stopDate has to win.
test("a payload stopDate outranks the requested target", () => {
  const merged = mergeSegmentPayloads([{ stopDate: "2287-06-14" }], { targetDate: "2287-11-23" });
  assert.equal(merged.stopDate, "2287-06-14");
});

test("a missing stopDate falls back to the requested target", () => {
  const merged = mergeSegmentPayloads([{ events: [] }], { targetDate: "2287-11-23" });
  assert.equal(merged.stopDate, "2287-11-23");
});

test("the split threshold is above a quarter so ordinary skips stay single", () => {
  assert.ok(SEGMENTED_JUMP_MIN_DAYS > 92);
});

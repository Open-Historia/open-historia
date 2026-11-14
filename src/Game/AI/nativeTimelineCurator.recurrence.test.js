/*! Open Historia — what the timeline curator counts as a material recurrence © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTimelineCurator.recurrence.test.js
//
// Runs without node_modules: nativeTimelineCurator.js imports nothing.
//
// A repeat of a recent event survives the curator's low-value churn route when
// the repetition itself matters (real harm again, pressure building). That was
// read from English harm words with an English negation check ("no shortages"),
// which never fired in another language and misread English it did not expect.
// It is the analyst's own recurrenceMatters now, and nothing else: the same
// answer keeps or drops an event whatever language it is written in, and
// whatever words it uses.

import test from "node:test";
import assert from "node:assert/strict";

import { curateGeneratedEventsWithHidden } from "./nativeTimelineCurator.js";

const event = (id, title, description) => ({
  id,
  date: "1932-05-01",
  title,
  description,
  impacts: {},
});

// An analyst sure the event is another low-value step on a busy storyline;
// only recurrenceMatters changes between the runs.
const analyst = (recurrenceMatters) => async ({ candidates }) => ({
  payload: {
    judgments: candidates.map((candidate) => ({
      index: candidate.index,
      verdict: "KEEP",
      confidence: 0.95,
      materialStateChange: "",
      matchedPriorIndexes: [],
      materiallyNewDimensions: [],
      recurrenceMatters,
      newTriggerAfterPriorPosture: "",
      worthwhile: false,
      substantive: false,
      personalityTexture: false,
      storyline: "district supply",
      qualitativeAdvance: false,
      incrementalProcess: true,
      processFramePresent: false,
      observableOutcomeEvidence: "",
      pureProcessFiller: false,
      reason: "test",
    })),
    recentHistoryMechanical: false,
    storylineSaturation: [{ storyline: "District Supply", count: 3, priorIndexes: [], saturation: "busy", description: "" }],
    underrepresentedDomains: [],
  },
});

// Twins: the same event in English (with and without a negation the old check
// read) and in Russian and Chinese.
const TWINS = [
  event("en", "Shortages spread in the district", "Repeated shortages and transport disruption spread across the district."),
  event("en-negated", "Sowing ends in the district", "Spring sowing concludes without major domestic disruption."),
  event("ru", "Нехватка продовольствия в округе", "Повторяющаяся нехватка и перебои с транспортом распространяются по округу."),
  event("zh", "该地区粮食短缺", "反复出现的短缺和运输中断在该地区蔓延。"),
];

const curate = async (recurrenceMatters) => {
  // A storyline on record, so the analyst is asked (candidatesWorthJudging).
  const prior = [{ ...event("p0", "Supply trouble", "Trains run late."), date: "1932-04-01", storylineIds: ["supply"] }];
  const events = TWINS.map((twin) => ({ ...twin, storylineIds: ["supply"] }));
  return curateGeneratedEventsWithHidden({ events, priorEvents: prior, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: analyst(recurrenceMatters) });
};

test("a recurrence the analyst says matters keeps every twin, negation or none", async () => {
  const result = await curate(true);
  assert.deepEqual(result.events.map((entry) => entry.id), ["en", "en-negated", "ru", "zh"]);
  assert.deepEqual(result.dropped, []);
});

test("a recurrence the analyst says does not matter drops every twin alike", async () => {
  const result = await curate(false);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.dropped.map((row) => row.route), Array(4).fill("LOW_VALUE_INCREMENTAL_CHURN"));
});

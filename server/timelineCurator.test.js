import test from "node:test";
import assert from "node:assert/strict";

import { curateGeneratedEvents } from "../src/Game/AI/nativeTimelineCurator.js";

// The model may call a candidate redundant; these tests pin what the native
// gates let that opinion remove. The default is KEEP.

const priorEvents = [
  {
    id: "p0",
    date: "1930-04-01",
    title: "Ruritania rejects the Bordurian canal proposal",
    description: "The cabinet formally rejects Borduria's proposal for a joint canal authority, citing sovereignty concerns.",
  },
  {
    id: "p1",
    date: "1930-04-10",
    title: "Harvest festival opens in Strelsau",
    description: "The annual harvest festival opens with a parade through the old town.",
  },
];

const candidates = [
  {
    id: "c0",
    date: "1930-04-20",
    title: "Ruritania again rejects the Bordurian canal proposal",
    description: "The cabinet formally rejects Borduria's proposal for a joint canal authority once more, citing the same sovereignty concerns.",
    impacts: {},
  },
  {
    id: "c1",
    date: "1930-04-22",
    title: "Bordurian troops cross the frontier at Zenda",
    description: "Two divisions cross the frontier and occupy the Zenda valley.",
    impacts: { regionTransfers: [{ regionId: "zenda", toCode: "Borduria" }] },
  },
  {
    id: "c2",
    date: "1930-04-25",
    title: "Ruritania declares war on Borduria",
    description: "Parliament votes for war after the Zenda incursion.",
    warId: "war-zenda",
    impacts: {},
  },
  {
    id: "c3",
    date: "1930-04-10",
    title: "Harvest festival opens in Strelsau",
    description: "The annual harvest festival opens with a parade through the old town.",
    impacts: {},
  },
  {
    id: "c4",
    date: "1930-04-28",
    title: "New irrigation canal opens in the Zenda valley",
    description: "A 40 km irrigation canal enters service, doubling the irrigated area of the valley.",
    impacts: {},
  },
];

const judgment = (index, overrides = {}) => ({
  index,
  verdict: "KEEP",
  confidence: 0.9,
  materialStateChange: "x",
  matchedPriorIndexes: [],
  materiallyNewDimensions: ["something"],
  recurrenceMatters: false,
  newTriggerAfterPriorPosture: "none",
  worthwhile: true,
  substantive: true,
  personalityTexture: false,
  storyline: "canal",
  qualitativeAdvance: true,
  incrementalProcess: false,
  processFramePresent: false,
  observableOutcomeEvidence: "",
  pureProcessFiller: false,
  reason: "test",
  ...overrides,
});

const redundant = (index) => judgment(index, {
  verdict: "REDUNDANT",
  confidence: 0.95,
  matchedPriorIndexes: [0],
  materiallyNewDimensions: [],
  worthwhile: false,
  qualitativeAdvance: false,
  incrementalProcess: true,
});

const curate = (analyzeBatch, mode = "jump") => curateGeneratedEvents({
  events: candidates,
  priorEvents,
  game: { gameDate: "1930-04-28", round: 5 },
  world: {},
  actions: [],
  mode,
  analyzeBatch,
});

test("an evidenced redundancy and an exact duplicate are dropped; hard consequences and war transitions never are", async () => {
  let seen = null;
  const kept = await curate(async (batch) => {
    seen = batch;
    return {
      payload: {
        judgments: [redundant(0), redundant(1), redundant(2), judgment(3), judgment(4)],
        recentHistoryMechanical: false,
        storylineSaturation: [],
        underrepresentedDomains: [],
      },
    };
  });

  assert.equal(seen.candidates.length, 5);
  assert.deepEqual(seen.priorHistory.map((entry) => entry.priorIndex), [0, 1], "prior history carries absolute indexes");
  assert.deepEqual(kept.map((event) => event.id), ["c1", "c2", "c4"]);
});

test("the curator keeps everything when the analysis fails or the mode is not a turn", async () => {
  const failed = await curate(async () => { throw new Error("provider down"); });
  assert.deepEqual(failed.map((event) => event.id), ["c0", "c1", "c2", "c4"], "without an analysis only the deterministic exact-duplicate guard acts");

  let called = false;
  const skipped = await curate(async () => { called = true; return { payload: { judgments: [] } }; }, "catalyst");
  assert.equal(called, false, "only jump and auto turns are curated");
  assert.equal(skipped.length, 5);

  const silent = await curate(async () => ({ payload: { judgments: [], storylineSaturation: [] } }));
  assert.deepEqual(silent.map((event) => event.id), ["c0", "c1", "c2", "c4"], "no judgment means KEEP; only the exact duplicate goes");
});

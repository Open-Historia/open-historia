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

const curate = (analyzeBatch, mode = "jump", isSparedFromFiller = null) => curateGeneratedEvents({
  events: candidates,
  isSparedFromFiller,
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
  const skipped = await curate(async () => { called = true; return { payload: { judgments: [] } }; }, "interactive");
  assert.equal(called, false, "only jump and auto turns are curated");
  assert.equal(skipped.length, 5);

  const silent = await curate(async () => ({ payload: { judgments: [], storylineSaturation: [] } }));
  assert.deepEqual(silent.map((event) => event.id), ["c0", "c1", "c2", "c4"], "no judgment means KEEP; only the exact duplicate goes");
});

test("an event the player's focus spares survives a filler verdict", async () => {
  const analysis = async () => ({
    payload: {
      judgments: [redundant(0), redundant(1), redundant(2), judgment(3), judgment(4)],
      recentHistoryMechanical: false,
      storylineSaturation: [],
      underrepresentedDomains: [],
    },
  });
  const dropped = await curate(analysis);
  assert.equal(dropped.some((event) => event.id === "c0"), false);

  const spared = await curate(analysis, "jump", (event) => event.id === "c0");
  assert.equal(spared.some((event) => event.id === "c0"), true, "it answers an order or a due milestone, so the filler gates may not take it");
});

// The exact-duplicate guard compared two events with everything but a-z and
// 0-9 taken out. A game played in Russian or Chinese has neither in most of
// its events, so any two of them on one date compared equal and the later one
// was removed as a word-for-word repeat.
test("events in another script are exact duplicates only when they say the same thing", async () => {
  const prior = [
    { id: "p0", date: "2014-03-26", title: "Путин начал инспекцию военных баз", description: "Президент начал серию визитов в армейские гарнизоны." },
    { id: "p1", date: "2014-03-26", title: "中国宣布新的五年计划", description: "国务院公布了下一个五年计划的主要目标。" },
    { id: "p2", date: "2014-03-26", title: "Оборонный бюджет 2014 года", description: "Правительство внесло проект бюджета." },
    { id: "p3", date: "2014-03-26", title: "Budget of 2014 passes", description: "Parliament passes the budget." },
  ];
  const sameDay = [
    { id: "ru-new", date: "2014-03-26", title: "Создание десяти стратегических проектов", description: "Правительство утвердило десять ключевых проектов.", impacts: {} },
    { id: "ru-repeat", date: "2014-03-26", title: "Путин начал инспекцию военных баз!", description: "президент начал серию визитов в армейские гарнизоны", impacts: {} },
    { id: "zh-new", date: "2014-03-26", title: "中国宣布新的五年规划", description: "国务院公布了下一个五年计划的主要目标。", impacts: {} },
    { id: "zh-repeat", date: "2014-03-26", title: "中国宣布新的五年计划", description: "国务院公布了下一个五年计划的主要目标", impacts: {} },
    // An a-z0-9 key leaves "2014" of this one, as it does of p2.
    { id: "ru-year", date: "2014-03-26", title: "Парад 2014 года в Севастополе", description: "Флот прошёл парадом.", impacts: {} },
    { id: "en-repeat", date: "2014-03-26", title: "Budget of 2014 passes.", description: "Parliament passes the budget", impacts: {} },
    { id: "symbols", date: "2014-03-26", title: "—", description: "…", impacts: {} },
  ];
  const kept = await curateGeneratedEvents({ events: sameDay, priorEvents: prior, game: {}, world: {}, actions: [], mode: "jump", analyzeBatch: null });
  assert.deepEqual(kept.map((event) => event.id), ["ru-new", "zh-new", "ru-year", "symbols"]);
});

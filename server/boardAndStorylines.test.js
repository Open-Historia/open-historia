/*! Open Historia — portions (the Board and Storylines working together: world director tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Board and Storylines working together (world director side).
//
// The Board reads every Canonical event, so the cleanup can keep routine Board
// progress off the timeline without the Board losing it; and a major event whose
// only consequence is a Board entry passes the consequence check provisionally,
// to be proven by the board pass after the segments. These tests pin the
// director's half of that contract.
import test from "node:test";
import assert from "node:assert/strict";

import {
  boardProvisionalConsequenceIndexes,
  buildWorldInitiativeContext,
  validateWorldEventConsequencePayload,
} from "../src/Game/AI/nativeWorldDirector.js";
import { screenGeneratedWorldEvents } from "../src/Game/AI/nativeWorldIntegrity.js";
import { curateGeneratedEvents, curateGeneratedEventsWithHidden } from "../src/Game/AI/nativeTimelineCurator.js";

const baseImpacts = () => ({
  actionIds: [],
  createdChats: [],
  markerOps: [],
  polityChanges: [],
  regionTransfers: [],
  regionClaims: [],
  unitOps: [],
});

const boardEntry = (overrides = {}) => ({
  id: "kingfisher",
  name: "Operation Kingfisher",
  kind: "operation",
  ownerCode: "",
  summary: "Covert interceptor development.",
  status: "active",
  ...overrides,
});

const payloadWith = (event) => ({
  events: [{ date: "2019-11-01", impacts: baseImpacts(), storylineIds: [], ...event }],
  storylineUpdates: [],
  warUpdates: [],
  relationUpdates: [],
  agreementUpdates: [],
});

const majorBoardEvent = () => payloadWith({
  importance: "major",
  kind: "military",
  title: "Operation Kingfisher's prototype interceptor flies for the first time",
  description: "The covert interceptor completes its first full flight over the test range.",
});

test("a major event whose only consequence is a Board entry passes provisionally", () => {
  assert.equal(
    validateWorldEventConsequencePayload(majorBoardEvent(), { board: [boardEntry()], strict: true }),
    "",
  );
  assert.deepEqual(
    boardProvisionalConsequenceIndexes(majorBoardEvent(), { board: [boardEntry()] }),
    [0],
    "the pass is provisional: the turn must know which event the board pass has to back",
  );
});

test("without the Board, the same event is rejected exactly as before", () => {
  assert.match(
    validateWorldEventConsequencePayload(majorBoardEvent(), { strict: true }),
    /no canonical consequence/i,
  );
});

test("a closed Board entry earns no provisional pass", () => {
  assert.match(
    validateWorldEventConsequencePayload(majorBoardEvent(), { board: [boardEntry({ status: "complete" })], strict: true }),
    /no canonical consequence/i,
  );
});

test("an unresolved crisis still needs a Storyline, even when a Board entry caused it", () => {
  const crisis = payloadWith({
    importance: "major",
    kind: "military",
    title: "Operation Kingfisher's exposure triggers a standoff over the test range",
    description: "Both governments move forces towards the range and neither backs down.",
  });
  assert.match(
    validateWorldEventConsequencePayload(crisis, { board: [boardEntry()], strict: true }),
    /no persistent storyline consequence/i,
  );
});

test("an event with a consequence of its own is never provisional", () => {
  const withStats = majorBoardEvent();
  withStats.countryStatPatches = [{ eventIndexes: [0] }];
  assert.deepEqual(boardProvisionalConsequenceIndexes(withStats, { board: [boardEntry()] }), []);
});

// --- The cleanup keeps routine events off the timeline, not out of the world ---

const screenOne = (event, world = {}, game = { country: "Republic of Latvia" }) =>
  screenGeneratedWorldEvents({ events: [{ impacts: baseImpacts(), ...event }], world, game });

test("a routine event the screen keeps off the timeline is handed on whole, as a Hidden event", () => {
  const patrol = {
    id: "event-patrol",
    date: "2019-10-12",
    importance: "minor",
    title: "Operation Kingfisher patrols continue along the northern coast",
    description: "Reconnaissance flights maintain a heightened posture with continued surveillance.",
  };
  const screened = screenOne(patrol);
  assert.equal(screened.events.length, 0, "the timeline rule itself is unchanged");
  assert.equal(screened.hidden.length, 1);
  assert.equal(screened.hidden[0].route, "ROUTINE_MILITARY_PRECURATION");
  assert.equal(screened.hidden[0].event.title, patrol.title);
  assert.equal(screened.hidden[0].event.description, patrol.description);
});

test("a routine administrative event is a Hidden event too", () => {
  const screened = screenOne({
    id: "event-admin",
    date: "2019-10-12",
    importance: "minor",
    title: "Canada Finalizes Streamlined Agricultural Inspection Standards",
    description: "Officials finalize technical inspection standards and a compliance tracking protocol after a committee review.",
  });
  assert.deepEqual(screened.hidden.map((row) => row.route), ["ROUTINE_ADMINISTRATIVE_PROCESS"]);
});

test("an event judged untrue is rejected, never Hidden", () => {
  const screened = screenOne(
    {
      id: "event-false-war-economy",
      date: "2019-10-12",
      importance: "minor",
      title: "Latvia introduces wartime rationing",
      description: "The Latvian government imposes wartime rationing and war taxation across the country.",
    },
    {},
    { country: "Latvia" },
  );
  assert.equal(screened.dropped[0]?.route, "NON_BELLIGERENT_WARTIME_CAUSALITY");
  assert.deepEqual(screened.hidden, [], "it never happened, so the Board must never read it");
});

// --- The curator hides; only duplicates and contradictions are withheld ---

const priorCanal = [{
  id: "p0",
  date: "1930-04-01",
  title: "Ruritania rejects the Bordurian canal proposal",
  description: "The cabinet formally rejects Borduria's proposal for a joint canal authority, citing sovereignty concerns.",
}];

const curatorCandidates = [
  {
    id: "c0",
    date: "1930-04-20",
    title: "Ruritania again rejects the Bordurian canal proposal",
    description: "The cabinet formally rejects Borduria's proposal for a joint canal authority once more, citing the same sovereignty concerns.",
    impacts: {},
  },
  {
    id: "c1",
    date: "1930-04-01",
    title: "Ruritania rejects the Bordurian canal proposal",
    description: "The cabinet formally rejects Borduria's proposal for a joint canal authority, citing sovereignty concerns.",
    impacts: {},
  },
  {
    id: "c2",
    date: "1930-04-28",
    title: "New irrigation canal opens in the Zenda valley",
    description: "A 40 km irrigation canal enters service, doubling the irrigated area of the valley.",
    impacts: {},
  },
];

const curatorJudgment = (index, overrides = {}) => ({
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

const curateWith = (firstJudgment) => curateGeneratedEventsWithHidden({
  events: curatorCandidates,
  priorEvents: priorCanal,
  game: { gameDate: "1930-04-28", round: 5 },
  world: {},
  actions: [],
  mode: "jump",
  analyzeBatch: async () => ({
    payload: {
      judgments: [firstJudgment, curatorJudgment(1), curatorJudgment(2)],
      recentHistoryMechanical: false,
      storylineSaturation: [],
      underrepresentedDomains: [],
    },
  }),
});

test("an event the curator calls redundant is Hidden, and an exact duplicate is withheld", async () => {
  const { events, hidden } = await curateWith(curatorJudgment(0, {
    verdict: "REDUNDANT",
    confidence: 0.95,
    matchedPriorIndexes: [0],
    materiallyNewDimensions: [],
    worthwhile: false,
    qualitativeAdvance: false,
    incrementalProcess: true,
  }));
  assert.deepEqual(events.map((event) => event.id), ["c2"]);
  assert.deepEqual(hidden.map((row) => [row.event.id, row.route]), [["c0", "EVIDENCED_REDUNDANCY"]]);
});

test("an unsupported reversal is rejected, never Hidden", async () => {
  const { events, hidden } = await curateWith(curatorJudgment(0, {
    verdict: "UNSUPPORTED_REVERSAL",
    confidence: 0.99,
    matchedPriorIndexes: [0],
    newTriggerAfterPriorPosture: "none",
  }));
  assert.deepEqual(events.map((event) => event.id), ["c2"]);
  assert.deepEqual(hidden, [], "a contradiction never happened, so the Board must never read it");
});

test("the timeline the curator returns is unchanged by handing on Hidden events", async () => {
  const args = {
    events: curatorCandidates,
    priorEvents: priorCanal,
    game: { gameDate: "1930-04-28", round: 5 },
    world: {},
    actions: [],
    mode: "jump",
    analyzeBatch: async () => ({ payload: { judgments: [], storylineSaturation: [] } }),
  };
  const plain = await curateGeneratedEvents(args);
  const { events } = await curateGeneratedEventsWithHidden(args);
  assert.deepEqual(events.map((event) => event.id), plain.map((event) => event.id));
});

// --- What the jump is told ---------------------------------------------------

const directorText = () => buildWorldInitiativeContext({
  game: { country: "France", gameDate: "1914-09-01", round: 3 },
  events: [],
  chats: [],
  world: { polityOverrides: {}, countryStats: {}, regionOwnershipOverrides: {}, regionClaimants: {}, storylines: [], wars: [], relations: [], agreements: [], units: [], consolidatedHistory: [] },
}, { targetDate: "1914-10-01" }).text;

test("the director tells the jump that a polity's own Project is a Board entry, not a Storyline", () => {
  assert.match(directorText(), /own deliberate Project or Operation[^.]*Projects & Operations board, not in storylineUpdates/);
});

test("the director tells the jump that routine Board progress is still written as an event", () => {
  assert.match(directorText(), /Projects & Operations board[^.]*written as events naming the entry exactly as the board names it, however routine/);
});

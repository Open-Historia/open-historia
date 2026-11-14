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
import { buildJumpProjectsDirective } from "../src/Game/AI/projectsDirective.js";
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

// The Board entry an event moves is the one its own board op addresses
// (runtime/projects.js boardEntriesConcernedByEvent): its words used to be
// matched against the entry's name and summary, which a telling in another
// language, or a paraphrase, never matched.
const kingfisherOp = () => ({ projectOps: [{ op: "milestone", projectId: "kingfisher", milestone: { title: "First flight", status: "done" } }] });

const majorBoardEvent = ({ op = true } = {}) => payloadWith({
  importance: "major",
  kind: "military",
  title: "Operation Kingfisher's prototype interceptor flies for the first time",
  description: "The covert interceptor completes its first full flight over the test range.",
  impacts: { ...baseImpacts(), ...(op ? kingfisherOp() : {}) },
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
  // Naming the entry in its words, with no op on it, is no Board consequence.
  assert.match(
    validateWorldEventConsequencePayload(majorBoardEvent({ op: false }), { board: [boardEntry()], strict: true }),
    /no canonical consequence/i,
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

// A crisis owes a Storyline, and the skip is told to open one for every
// process that runs on (jumpSegments.js STORYLINE_INSTRUCTION). Which event
// was a crisis used to be read from English words ("standoff", "ultimatum"),
// so the same event in another language passed: now no event is judged by its
// words, and one tied to its storyline has a consequence of its own.
test("a crisis's words decide nothing: a major event on an open Board entry passes provisionally, in any language", () => {
  for (const [title, description] of [
    ["Operation Kingfisher's exposure triggers a standoff over the test range", "Both governments move forces towards the range and neither backs down."],
    ["La révélation de l'opération Kingfisher déclenche une crise autour du champ d'essai", "Les deux gouvernements déplacent des forces vers le champ d'essai et aucun ne recule."],
    ["Утечка об операции «Зимородок» вызывает противостояние у полигона", "Обе стороны стягивают силы к полигону."],
  ]) {
    const impacts = { ...baseImpacts(), ...kingfisherOp() };
    const crisis = payloadWith({ importance: "major", kind: "military", title, description, impacts });
    assert.equal(validateWorldEventConsequencePayload(crisis, { board: [boardEntry()], strict: true }), "", title);
    assert.deepEqual(boardProvisionalConsequenceIndexes(crisis, { board: [boardEntry()] }), [0], title);
    const told = payloadWith({ importance: "major", kind: "military", title, description, impacts, storylineIds: ["storyline-kingfisher"] });
    assert.deepEqual(boardProvisionalConsequenceIndexes(told, { board: [boardEntry()] }), [], `${title}: tied to its storyline`);
    // Without its op, every telling is judged alike: no Board consequence.
    const unmoved = payloadWith({ importance: "major", kind: "military", title, description });
    assert.deepEqual(boardProvisionalConsequenceIndexes(unmoved, { board: [boardEntry()] }), [], `${title}: no op`);
  }
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
  const admin = {
    id: "event-admin-whole",
    date: "2019-10-12",
    importance: "minor",
    title: "Canada Finalizes Streamlined Agricultural Inspection Standards",
    description: "Officials finalize technical inspection standards and a compliance tracking protocol after a committee review.",
  };
  const screened = screenOne(admin);
  assert.equal(screened.events.length, 0, "the timeline rule itself is unchanged");
  assert.equal(screened.hidden.length, 1);
  assert.equal(screened.hidden[0].event.title, admin.title);
  assert.equal(screened.hidden[0].event.description, admin.description);
});

// No word list reads an event for the war any more (nativeWorldIntegrity.js):
// a patrol was hidden, and a homefront under war conditions rejected, by
// English words only.
const patrolIn = (title, description) => ({ id: `event-patrol-${title.length}`, date: "2019-10-12", importance: "minor", title, description });
test("a patrol is kept as written, in English or not: no word hides it", () => {
  for (const patrol of [
    patrolIn("Operation Kingfisher patrols continue along the northern coast", "Reconnaissance flights maintain a heightened posture with continued surveillance."),
    patrolIn("Les patrouilles de l'opération Kingfisher se poursuivent le long de la côte nord", "Les vols de reconnaissance maintiennent une posture renforcée sous une surveillance continue."),
  ]) {
    const screened = screenOne(patrol);
    assert.deepEqual(screened.events.map((event) => event.id), [patrol.id], patrol.title);
    assert.deepEqual(screened.hidden, []);
  }
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

test("a homefront under war conditions is kept as written, in English or not: the skip is told who lives under them", () => {
  for (const [title, description] of [
    ["Latvia introduces wartime rationing", "The Latvian government imposes wartime rationing and war taxation across the country."],
    ["Latvija ievieš kara laika normēšanu", "Latvijas valdība visā valstī ievieš kara laika normēšanu un kara nodokli."],
  ]) {
    const screened = screenOne({ id: "event-war-economy", date: "2019-10-12", importance: "minor", title, description }, {}, { country: "Latvia" });
    assert.deepEqual(screened.events.map((event) => event.title), [title]);
    assert.deepEqual(screened.dropped, [], "nothing rejects it for its words");
    assert.deepEqual(screened.hidden, []);
  }
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
  assert.match(directorText(), /Open a new storyline[^.]*never for an effort on the Projects board/);
});

// The director used to say this too; the board's own block says it once now,
// beside the entries it is about.
test("the jump is told that routine Board progress is still written as an event", () => {
  const board = buildJumpProjectsDirective("- Operation \"Bridge at Remagen\" [id project-1], ours, active, 40% complete.");
  assert.match(board, /Write what happens to an entry as an event however routine it is/);
  assert.match(board, /Name each effort exactly as the board names it/);
});

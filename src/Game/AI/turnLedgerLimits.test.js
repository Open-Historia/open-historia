/*! Open Historia — per-answer ledger caps vs the merged turn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/turnLedgerLimits.test.js
//
// THE BUG. Each ledger decoder caps its records (16 storylines, 16 wars, 20
// relations, 16 agreements, 24 puppets): a bound on ONE model answer. The turn's
// apply re-ran the decoders on the merged turn — every segment's records
// together — so a year skipped in four segments kept only the first 16
// storyline and war records of the whole year. Later segments' crises were
// never opened, storylines ended the turn in their mid-year state, and paid
// motion repairs and puppet-loyalty seeds (appended last) were thrown away.
//
// The caps still hold for one answer; the merged turn's applies read it all
// (gameplay.js applySimulationResult passes { limit: Infinity }).

import test from "node:test";
import assert from "node:assert/strict";

import { mergeSegmentPayloads } from "./jumpSegments.js";
import { applyDiplomaticUpdates, decodeAgreementUpdates, decodePuppetUpdates, decodeRelationUpdates } from "./nativeDiplomaticDirector.js";
import { applyWarUpdates, bindWarUpdatesToEvents, decodeWarUpdates } from "./nativeWarLedger.js";
import {
  applyWorldStorylineUpdates,
  decodeWorldStorylineUpdates,
  findSkipStorylineMotionIssues,
} from "./nativeWorldDirector.js";

const range = (count) => Array.from({ length: count }, (_, index) => index);

test("one answer is still held to each decoder's cap; a merged turn asks for all of it", () => {
  const lines = (count, line) => range(count).map(line).join("\n");
  assert.equal(decodeWarUpdates(lines(20, (i) => `war-${i}~start~A${i}~B${i}~1~x`)).length, 16);
  assert.equal(decodeWarUpdates(lines(20, (i) => `war-${i}~start~A${i}~B${i}~1~x`), { limit: Infinity }).length, 20);
  assert.equal(decodeWorldStorylineUpdates(range(20).map((i) => ({ id: `story-${i}` }))).length, 16);
  assert.equal(decodeWorldStorylineUpdates(range(20).map((i) => ({ id: `story-${i}` })), { limit: Infinity }).length, 20);
  assert.equal(decodeRelationUpdates(range(30).map((i) => ({ id: `rel-${i}`, a: `A${i}`, b: `B${i}` }))).length, 20);
  assert.equal(decodeRelationUpdates(range(30).map((i) => ({ id: `rel-${i}`, a: `A${i}`, b: `B${i}` })), { limit: Infinity }).length, 30);
  assert.equal(decodeAgreementUpdates(range(20).map((i) => ({ id: `pact-${i}`, op: "start" }))).length, 16);
  assert.equal(decodeAgreementUpdates(range(20).map((i) => ({ id: `pact-${i}`, op: "start" })), { limit: Infinity }).length, 20);
  assert.equal(decodePuppetUpdates(range(30).map((i) => ({ op: "loyalty", overlord: "A", puppet: `P${i}` }))).length, 24);
  assert.equal(decodePuppetUpdates(range(30).map((i) => ({ op: "loyalty", overlord: "A", puppet: `P${i}` })), { limit: Infinity }).length, 30);
});

// Two segments of ten wars each: every answer within its cap, twenty in the turn.
const warSegment = (segment) => {
  const events = range(10).map((i) => ({
    id: `s${segment}-e${i}`,
    date: `1914-0${segment + 1}-${String(i + 10)}`,
    title: `Front ${segment}-${i} opens`,
    description: `War breaks out on front ${segment}-${i}.`,
    kind: "military",
    warId: `war-${segment}-${i}`,
  }));
  const records = range(10).map((i) => `war-${segment}-${i}~start~North${segment}x${i}~South${segment}x${i}~${i + 1}~Front opens`).join("\n");
  return { events, warUpdates: bindWarUpdatesToEvents(records, events) };
};

test("every war a segmented turn starts is applied, not just the first sixteen", () => {
  const merged = mergeSegmentPayloads([warSegment(1), warSegment(2)]);
  assert.equal(merged.warUpdates.length, 20);
  const apply = (options) => applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: merged.warUpdates,
    events: merged.events,
    stopDate: "1914-03-31",
    round: 2,
    ...options,
  });
  assert.equal(apply({}).appliedIds.length, 16, "the default is one answer's worth");
  const whole = apply({ limit: Infinity });
  assert.equal(whole.appliedIds.length, 20);
  assert.ok(whole.appliedIds.includes("war-2-9"), "the last segment's last war is in the ledger");
});

const storyline = (id, segment) => ({
  id,
  status: "active",
  pressure: 60,
  momentum: 40,
  startedDate: "1916-01-01",
  kind: "crisis",
  title: `Crisis ${id}`,
  participants: ["Italy", "Austria-Hungary"],
  state: `Crisis ${id} deepens in segment ${segment}.`,
  eventIndexes: [],
});

test("a storyline opened in a late segment is created, and the turn's last word on each stands", () => {
  // Four segments of five storylines each, all within one answer's cap. The
  // first storyline is carried to the end, as a four-segment year does.
  const segments = range(4).map((segment) => ({
    events: [],
    storylineUpdates: [
      storyline("story-carried", segment),
      ...range(4).map((i) => storyline(`story-${segment}-${i}`, segment)),
    ],
  }));
  const merged = mergeSegmentPayloads(segments);
  assert.equal(merged.storylineUpdates.length, 20);
  const { world } = applyWorldStorylineUpdates({
    world: { storylines: [] },
    updates: merged.storylineUpdates,
    events: [],
    stopDate: "1916-12-31",
    round: 5,
    limit: Infinity,
  });
  const byId = new Map(world.storylines.map((entry) => [entry.id, entry]));
  assert.ok(byId.has("story-3-3"), "the last segment's crisis exists");
  assert.equal(byId.get("story-carried").state, "Crisis story-carried deepens in segment 3.", "the storyline ends on its year-end state");
});

// A storyline the skip did move, in its seventeenth record, is not "omitted":
// judged on the first sixteen it drew a motion repair, a request of its own.
test("motion issues read every storyline record of the skip", () => {
  const due = { ...storyline("story-due", 0), accountedThroughDate: "1916-12-01" };
  const updates = [
    ...range(16).map((i) => storyline(`story-${i}`, 1)),
    { ...due, state: "Crisis story-due moves on in segment 4." },
  ];
  const issues = (storylineUpdates) => findSkipStorylineMotionIssues({
    events: [],
    storylineUpdates,
    existingStorylines: [due],
    selectedStorylines: [due],
    stopDate: "1916-12-31",
  });
  assert.deepEqual(issues(updates.slice(0, 16)).map((issue) => issue.kind), ["missing-update"], "the check this relies on");
  assert.deepEqual(issues(updates), [], "the seventeenth record counts");
});

test("the merged turn's diplomacy reads every segment's records", () => {
  const events = [{ id: "e1", date: "1950-01-02", title: "Talks", description: "Talks.", kind: "diplomacy" }];
  const relationUpdates = range(24).map((i) => ({ id: `rel-${i}`, a: `North${i}`, b: `South${i}`, score: 10, eventIds: ["e1"], summary: "Warmer." }));
  const merge = (options) => applyDiplomaticUpdates({
    world: {
      polityOverrides: Object.fromEntries(range(24).flatMap((i) => [`North${i}`, `South${i}`]).map((name) => [name, { code: name, name }])),
      relations: [],
      agreements: [],
      puppets: [],
    },
    relationUpdates,
    agreementUpdates: [],
    puppetUpdates: [],
    events,
    stopDate: "1950-01-31",
    round: 1,
    ...options,
  });
  assert.equal(merge({ limit: Infinity }).appliedRelationIds.length, merge({}).appliedRelationIds.length + 4);
});

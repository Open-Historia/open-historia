/*! Open Historia — a skip's ledger records, segment to world: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/skipLedgerPipeline.test.js
//
// gameplay.js cannot be imported without the whole app, so this walks the same
// steps it takes, in its order, with the pieces it calls: each segment is
// validated (which repairs an unbound line) and bound to its own temporary event
// ids, the segments are merged into one round, the round's events get their
// canonical ids and the records follow them, and the round is applied.
//
// A puppet line went missing in the merge: every Loyalty change, install and
// release a skip wrote was dropped there, after it had already moved the
// in-turn ledger the next segment reads.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDiplomaticUpdates,
  bindAgreementUpdatesToEvents,
  bindPuppetUpdatesToEvents,
  bindRelationUpdatesToEvents,
  decodeAgreementUpdates,
  decodePuppetUpdates,
  decodeRelationUpdates,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import { mergeSegmentPayloads } from "./jumpSegments.js";
import { allocateCanonicalTurnEventIds, remapLedgerEventIds } from "../../runtime/eventIdentity.js";

const world = {
  polityOverrides: {
    "House Stark": { code: "House Stark", name: "House Stark" },
    "House Bolton": { code: "House Bolton", name: "House Bolton" },
    "House Lannister": { code: "House Lannister", name: "House Lannister" },
    "House Tully": { code: "House Tully", name: "House Tully" },
  },
  regionOwnershipOverrides: { r1: "House Stark", r2: "House Bolton", r3: "House Lannister", r4: "House Tully" },
  relations: [],
  agreements: [],
  puppets: [{
    id: "puppet-stark-bolton",
    overlord: "House Stark",
    puppet: "House Bolton",
    kind: "client",
    loyalty: 60,
    secrecy: "open",
    knownTo: [],
    status: "active",
    startedDate: "0298-06-01",
    endedDate: "",
    lastUpdatedDate: "0298-06-01",
    sourceEventIds: [],
  }],
};

// What validateSegmentLedgers does to one accepted segment.
const acceptSegment = (candidate, segmentIndex) => {
  candidate.events.forEach((event, index) => {
    if (!event.id) event.id = `segment-${segmentIndex + 1}-event-${index + 1}`;
  });
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true }), "");
  candidate.relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), candidate.events);
  candidate.agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), candidate.events);
  candidate.puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(candidate.puppetUpdates), candidate.events);
  return candidate;
};

// What finishTimelineJump and applySimulationResult do with the segments.
const applyRound = (segments, { round = 8 } = {}) => {
  const merged = mergeSegmentPayloads(segments, { targetDate: "0299-01-27" });
  const identity = allocateCanonicalTurnEventIds({ existingEvents: [], newEvents: merged.events, round });
  return applyDiplomaticUpdates({
    world,
    relationUpdates: remapLedgerEventIds(merged.relationUpdates, identity.idMap),
    agreementUpdates: remapLedgerEventIds(merged.agreementUpdates, identity.idMap),
    puppetUpdates: remapLedgerEventIds(merged.puppetUpdates, identity.idMap),
    puppetStates: true,
    events: identity.events,
    stopDate: "0299-01-27",
    round,
  });
};

const quietSegment = () => ({
  events: [
    { date: "0298-12-04", kind: "world", title: "Daenerys Targaryen asserts authority over Viserys", description: "On the march to the Red Waste." },
    { date: "0298-12-10", kind: "world", title: "Lord Eddard Stark finds a royal bastard", description: "In a street of the capital." },
  ],
  relationUpdates: "",
  agreementUpdates: "",
  puppetUpdates: "",
});

// The playtest's turn: the model moved House Bolton's Loyalty without naming
// the event, and native binding tied it to the one event naming both houses.
const muster = () => ({
  events: [
    { date: "0298-12-13", kind: "world", title: "Lord Tywin's agent reaches the Dreadfort", description: "A Lannister envoy sizes up Roose Bolton." },
    {
      date: "0298-12-19",
      kind: "player",
      title: "House Stark demands the Dreadfort's levies from House Bolton",
      description: "Robb Stark sends a sharp raven to Roose Bolton: House Bolton has not sent its spearmen to the House Stark muster.",
    },
  ],
  relationUpdates: "",
  agreementUpdates: "",
  puppetUpdates: "loyalty~House Stark~House Bolton~~45~~~The Dreadfort holds back its levies",
});

test("a skip's unbound Loyalty change is tied to its event and reaches the world", () => {
  const second = acceptSegment(muster(), 1);
  assert.deepEqual(second.puppetUpdates[0].eventIds, ["segment-2-event-2"], "native binding found the muster");

  const merge = applyRound([acceptSegment(quietSegment(), 0), second]);
  assert.deepEqual(merge.droppedPuppetUpdates, []);
  const row = merge.world.puppets.find((entry) => entry.puppet === "House Bolton");
  assert.equal(row.loyalty, 45);
  assert.deepEqual(row.sourceEventIds, ["event-ai-r0008-02981219-004"]);
});

test("a single-segment skip keeps its puppet lines too", () => {
  const merge = applyRound([acceptSegment(muster(), 0)]);
  assert.equal(merge.world.puppets.find((entry) => entry.puppet === "House Bolton").loyalty, 45);
});

// An event number is the segment's own. One that names no event in its segment
// can name some other segment's event once the round is joined, so a line no
// event of its own segment could be tied to stays tied to nothing.
test("a puppet line naming an event its segment does not have binds to no other segment's event", () => {
  const second = quietSegment();
  second.puppetUpdates = "loyalty~House Stark~House Bolton~~45~~4~Cited an event the segment does not have";
  const first = { ...muster(), puppetUpdates: "" };
  const merge = applyRound([acceptSegment(first, 0), acceptSegment(second, 1)]);
  assert.equal(merge.world.puppets.find((entry) => entry.puppet === "House Bolton").loyalty, 60);
  assert.match(merge.droppedPuppetUpdates[0]?.reason ?? "", /tied to no event/);
});

test("relations and agreements naming an event their segment does not have bind to no other segment's event either", () => {
  const second = quietSegment();
  second.relationUpdates = "House Stark~House Bolton~-20~strained~4~Cited an event the segment does not have";
  second.agreementUpdates = "stark-bolton-levy~start~military_cooperation~House Stark,House Bolton~4~Levy Accord~Cited an event the segment does not have";
  const merge = applyRound([acceptSegment(muster(), 0), acceptSegment(second, 1)]);
  assert.deepEqual(merge.relations, []);
  assert.deepEqual(merge.agreements, []);
});

test("relations and agreements tied by native binding reach the world the same way", () => {
  const segment = muster();
  segment.puppetUpdates = "";
  segment.relationUpdates = "House Stark~House Bolton~-20~strained~~The levies are withheld";
  segment.agreementUpdates = "stark-bolton-levy~start~military_cooperation~House Stark,House Bolton~~Levy Accord~House Bolton owes House Stark spearmen";
  const merge = applyRound([acceptSegment(quietSegment(), 0), acceptSegment(segment, 1)]);
  assert.equal(merge.relations.length, 1);
  assert.equal(merge.relations[0].score, -20);
  assert.deepEqual(merge.relations[0].sourceEventIds ?? merge.relations[0].eventIds, ["event-ai-r0008-02981219-004"]);
  assert.equal(merge.agreements.length, 1);
  assert.equal(merge.agreements[0].id, "stark-bolton-levy");
});

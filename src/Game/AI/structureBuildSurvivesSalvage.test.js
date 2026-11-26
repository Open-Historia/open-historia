// Run: node --test src/Game/AI/structureBuildSurvivesSalvage.test.js
//
// A player's report, 2026-11-26, with a video: "on the map it seems buildings
// appear and then disappear. I don't know if this is a bug to my ruleset or a
// gamebug". It was the game's. A one-day skip wrote "Divine Marble Mansion
// Rises in Baldwin Hills" with a structure build, The Angel's Home. While the
// skip streamed, the live card and the staged map read the build through the
// engine's lenient normalizer, and the mansion stood on the map. The committed
// turn checked the same build against the answer's schema, where an op is an
// anyOf of its shapes, and one optional field written off the schema (a status
// in another case, a null note …) failed every branch at once: the error named
// the whole op, and schema salvage, which removes the smallest thing at the
// place an error names, removed the whole structure. Now an op that says which
// it is (its "op") is checked against its own shape and its fault reported where
// it sits, so salvage leaves out the one field and the structure is built.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { salvageTaskAnswer, settleMarkerOps } from "./answerImpactOps.js";
import { schemaRemovalNote } from "../../runtime/receiptPlayerNotes.js";

const mansion = (extra = {}) => ({ name: "The Angel's Home", kind: "mansion", ownerCode: "Zandar Zandarian", lng: -118.355, lat: 34.01, ...extra });
const answer = (marker) => ({
  clearActions: true,
  stopDate: "2016-01-10",
  summary: "A day passes.",
  events: [{
    date: "2016-01-09",
    title: "Divine Marble Mansion Rises in Baldwin Hills",
    description: "Zandar Zandarian summoned the twelve Muses to his estate in Baldwin Hills; in place of the previous structure a sprawling marble mansion materialized.",
    places: ["city: Los Angeles, country: United States"],
    impacts: { actionIds: [], createdChats: [], polityChanges: [], regionTransfers: [], unitOps: [], markerOps: [{ op: "build", marker }] },
  }],
});

// The committed path of a time skip: shape, settle the structure ops, check, salvage.
const commit = (raw) => {
  let parsed = normalizeGameplayPayload("jumpForward", structuredClone(raw));
  settleMarkerOps(parsed);
  const check = (candidate) => validateGameplayPayload("jumpForward", candidate);
  let removed = [];
  if (!check(parsed).valid) {
    const salvaged = salvageTaskAnswer("jumpForward", structuredClone(parsed), check);
    assert.ok(salvaged.valid, "the answer is kept");
    parsed = salvaged.value;
    removed = salvaged.removed;
  }
  return { ops: parsed.events[0].impacts.markerOps, removed };
};

const OFF_SCHEMA = {
  "a status in another case": { status: "Active" },
  "a status off the list": { status: "completed" },
  "a null status": { status: null },
  "a null note": { note: null },
  "a null founding date": { foundedAt: null },
  "a numeric id": { id: 1 },
  "strategic as a string": { strategic: "false" },
};

test("a well-written build is kept whole", () => {
  const { ops, removed } = commit(answer(mansion()));
  assert.equal(ops.length, 1);
  assert.equal(removed.length, 0);
});

for (const [label, extra] of Object.entries(OFF_SCHEMA)) {
  test(`a build with ${label} is built, without that one field`, () => {
    const { ops, removed } = commit(answer(mansion(extra)));
    assert.equal(ops.length, 1, "the structure survives the committed turn");
    assert.equal(ops[0].marker.name, "The Angel's Home");
    assert.deepEqual(removed.map((entry) => entry.kind), ["property"]);
    const field = Object.keys(extra)[0];
    assert.equal(removed[0].path, `$.events[0].impacts.markerOps[0].marker.${field}`);
    assert.equal(Object.prototype.hasOwnProperty.call(ops[0].marker, field), false);
  });
}

test("an operation left out whole is named to the player by its own name field", () => {
  const note = schemaRemovalNote({ kind: "item", name: "The Angel's Home", label: "\"Divine Marble Mansion Rises in Baldwin Hills\"" });
  assert.equal(note.text, "The Angel's Home was left out: part of how it was written could not be read.");
  assert.equal(note.event, "Divine Marble Mansion Rises in Baldwin Hills");
  assert.equal(schemaRemovalNote({ kind: "item" }).text, "A malformed part of the answer was left out.");
});

test("every op family told apart by its op word is checked against its own shape", () => {
  // An update with a field off the schema keeps the update.
  const raw = answer(mansion());
  raw.events[0].impacts.markerOps = [{ op: "update", name: "The Angel's Home", status: "active", note: null }];
  const { ops, removed } = commit(raw);
  assert.equal(ops.length, 1);
  assert.equal(removed[0].path, "$.events[0].impacts.markerOps[0].note");
});

/*! Open Historia - GM pending-preview revision tests (AGPL-3.0-or-later). */
import test from "node:test";
import assert from "node:assert/strict";
import { applyGameMasterPreviewEdits, validateGameMasterEditResponse } from "./gameMasterPreviewEdit.js";

const original = () => ({
  id: "gm-pending",
  mode: "direct",
  summary: "Newsom administration alignment",
  events: [{
    id: "event-manual-gm-pending-1",
    title: "Administrative Alignment of the US Government",
    date: "2029-01-26",
    description: "The cabinet and strategy are aligned after inauguration.",
    impacts: {
      politicalActorOps: [
        { op: "replace-leader", polityKey: "United States of America", argsJson: '{"office":"headOfGovernment","leader":{"name":"Gavin Newsom"}}' },
        { op: "form-coalition", polityKey: "United States of America", argsJson: '{"rulingPartyIds":["democratic"],"coalitionPartyIds":[]}' },
        { op: "set-strategy", polityKey: "United States of America", argsJson: '{"patch":{"goals":["NATO stability"]}}' },
      ],
    },
  }],
  relationUpdates: [],
  agreementUpdates: [],
  warUpdates: [],
  countryStatPatches: [],
  puppetUpdates: [],
  storylineUpdates: [],
  diplomaticOutreach: [],
});
const change = (op, path, value) => ({ op, path, valueJson: op === "remove" ? "" : JSON.stringify(value) });
const edit = (tx, ...edits) => applyGameMasterPreviewEdits(tx, { edits });

test("Newsom revision fixes headOfState while preserving coalition, strategy, event and metadata", () => {
  const before = original();
  const after = edit(before, change("replace", "/events/0/impacts/politicalActorOps/0/argsJson/office", "headOfState"));
  assert.equal(JSON.parse(after.events[0].impacts.politicalActorOps[0].argsJson).office, "headOfState");
  assert.deepEqual(after.events[0].impacts.politicalActorOps.slice(1), before.events[0].impacts.politicalActorOps.slice(1));
  assert.equal(after.events[0].title, before.events[0].title);
  assert.equal(after.events[0].date, "2029-01-26");
  assert.equal(after.id, before.id);
  assert.equal(JSON.parse(before.events[0].impacts.politicalActorOps[0].argsJson).office, "headOfGovernment");
});

test("append and remove individual operations, preserving unaddressed ledger rows", () => {
  const before = original();
  before.relationUpdates.push({ a: "France", b: "Germany", score: 60 });
  const after = edit(before,
    change("add", "/events/0/impacts/politicalActorOps/-",
      { op: "set-perceptions", polityKey: "United States of America", argsJson: "{}" }),
    change("replace", "/relationUpdates/0/score", 70),
    change("remove", "/events/0/impacts/politicalActorOps/0"),
  );
  assert.equal(after.events[0].impacts.politicalActorOps.length, 3);
  assert.equal(after.events[0].impacts.politicalActorOps[0].op, "form-coalition");
  assert.equal(after.events[0].impacts.politicalActorOps[1].op, "set-strategy");
  assert.equal(after.relationUpdates[0].score, 70);
  assert.equal(before.relationUpdates[0].score, 60);
});

test("invalid paths and malformed edits fail closed, never mutating pending preview", () => {
  const before = original();
  const snapshot = JSON.stringify(before);
  const attempts = [
    change("replace", "/events/0/id", "replaced-id"),
    change("replace", "/mode", "world-intervention"),
    change("replace", "/events/0", {}),
    change("remove", "/events/0"),
    change("replace", "/events/3/description", "absent"),
    change("replace", "/events/0/impacts/politicalActorOps/99/op", "update-party"),
    change("replace", "/events/0/impacts/politicalActorOps/0/argsJson/nonexistent", "x"),
    change("replace", "/__proto__/danger", "x"),
    change("replace", "/events/0/impacts/politicalActorOps/0/constructor", "x"),
    change("replace", "/summary", { unexpected: "object" }),
  ];
  for (const bad of attempts) assert.throws(() => edit(before, bad), Error, bad.path);
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(validateGameMasterEditResponse({ edits: [change("replace", "/summary", "text")] }), { valid: true, error: "" });
  assert.equal(validateGameMasterEditResponse({ edits: [{ op: "replace", path: "/summary", valueJson: "{invalid" }] }).valid, false);
  assert.equal(validateGameMasterEditResponse({ edits: [] }).valid, false);
  assert.throws(() => edit(before, change("replace", "/summary", before.summary)), /did not change/i);
});

test("all edits in a failed multi-edit are atomic and the previous preview stays intact", () => {
  const before = original();
  const snapshot = JSON.stringify(before);
  assert.throws(() => edit(before,
    change("replace", "/events/0/description", "Edited"),
    change("remove", "/events/0/impacts/politicalActorOps/500"),
  ));
  assert.equal(JSON.stringify(before), snapshot);
});

test("political argsJson retains unrelated nested leader and coalition keys", () => {
  const before = original();
  const after = edit(before, change("replace", "/events/0/impacts/politicalActorOps/0/argsJson/office", "headOfState"));
  assert.equal(JSON.parse(after.events[0].impacts.politicalActorOps[0].argsJson).leader.name, "Gavin Newsom");
  assert.equal(after.events[0].impacts.politicalActorOps[1].argsJson, before.events[0].impacts.politicalActorOps[1].argsJson);
});

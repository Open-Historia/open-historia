import assert from "node:assert/strict";
import test from "node:test";

import { normalizePoliticalActorRecord, normalizePoliticalActors } from "./politicalActors.js";

// The record normaliser copies by hand what is plain data and copies only the
// fields it does not build again (2026-10-24). These pin that the answer is
// the one structuredClone and a whole-record copy gave.

const record = () => ({
  polityKey: "Kingdom of Testland",
  name: "  Kingdom   of Testland ",
  extension: { notes: ["kept", { deep: [1, 2, { deeper: true }] }], empty: {}, missing: undefined },
  sparse: [1, , 3],
  government: { form: "absolute monarchy", headOfState: { name: "King Test", title: "King" } },
  parties: [
    { name: "Court Party", support: { percent: 41.27 }, goals: ["order", "order", "  more  order "], extra: { kept: 1 } },
    { name: "Court Party", support: { percent: 12 } },
  ],
  powerBlocs: [{ name: "The Army", kind: "military", influence: { percent: 30 } }],
  politicalSystem: "absolute_monarchy",
  goals: ["survive", "", "Survive"],
  traits: { boldness: 140 },
  ideology: "Old",
});

test("a political record comes out as it did, extension fields and their shape included", () => {
  const out = normalizePoliticalActorRecord(record(), "Kingdom of Testland");
  // Key order is the input's, the rebuilt fields in their places.
  assert.deepEqual(Object.keys(out).slice(0, 6), ["polityKey", "name", "extension", "sparse", "government", "parties"]);
  assert.equal(out.name, "Kingdom of Testland");
  assert.equal("ideology" in out, false);
  assert.deepEqual(out.extension.notes, ["kept", { deep: [1, 2, { deeper: true }] }]);
  assert.ok("missing" in out.extension, "a key holding undefined stays");
  assert.equal(1 in out.sparse, false, "a hole in an array stays a hole");
  assert.equal(out.parties.length, 2);
  assert.notEqual(out.parties[0].id, out.parties[1].id, "a repeated party id is told apart");
  assert.deepEqual(out.goals, ["survive"]);
});

test("the copy is a copy: changing it leaves the input as it was", () => {
  const input = record();
  const out = normalizePoliticalActorRecord(input, "Kingdom of Testland");
  out.extension.notes[1].deep[2].deeper = false;
  out.parties[0].extra.kept = 2;
  assert.equal(input.extension.notes[1].deep[2].deeper, true);
  assert.equal(input.parties[0].extra.kept, 1);
});

test("what is not plain data is still copied the way structuredClone copies it", () => {
  const when = new Date("1836-01-01T00:00:00Z");
  const out = normalizePoliticalActorRecord({ ...record(), founded: { at: when } }, "Kingdom of Testland");
  assert.ok(out.founded.at instanceof Date);
  assert.notEqual(out.founded.at, when);
  assert.equal(out.founded.at.getTime(), when.getTime());
});

test("normalising an already normalised ledger gives the same ledger", () => {
  const once = normalizePoliticalActors({ byPolity: { "Kingdom of Testland": record() } });
  const twice = normalizePoliticalActors(once);
  assert.deepEqual(twice, once);
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
});

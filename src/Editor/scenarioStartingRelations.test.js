import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STARTING_RELATIONS, applyStartingRelationEdits, planStartingRelationDraft,
  mergeStartingRelationEdit, rekeyStartingRelations, withoutStartingRelations, startingRelationRowsFor, settleStartingRelationEdits,
} from "./scenarioStartingRelations.js";
import { planMapPolityRename } from "./polityIdentityTransaction.js";
const keys = [{ key: "Latvia" }, { key: "Estonia" }, { key: "Lithuania" }];
test("authored zero is a real bilateral row, unlike an unset pair", () => {
  const original = [{ a: "Estonia", b: "Lithuania", score: 44, id: "keep", summary: "Original" }];
  const result = applyStartingRelationEdits(original, [{ a: "Latvia", b: "Estonia", score: "0" }], keys);
  assert.equal(result.ok, true);
  assert.equal(result.relations.length, 2);
  assert.deepEqual(result.relations[0], original[0]);
  assert.deepEqual(result.relations[1], { a: "Latvia", b: "Estonia", score: 0, status: "neutral", summary: "" });
  assert.equal(original.length, 1);
});
test("the bilateral pair is symmetric, change updates score/band and clearing deletes only that pair", () => {
  const seed = [{ id: "keep", a: "Estonia", b: "Latvia", score: 10, status: "neutral", summary: "Old" },
    { id: "other", a: "Estonia", b: "Lithuania", score: -20 }];
  const update = applyStartingRelationEdits(seed, [{ a: "Latvia", b: "Estonia", score: -100 }], keys);
  assert.equal(update.ok, true);
  assert.deepEqual(update.relations[0], { ...seed[0], a: "Latvia", b: "Estonia", score: -100, status: "rival" });
  assert.deepEqual(update.relations[1], seed[1]);
  const removed = applyStartingRelationEdits(update.relations, [{ a: "Estonia", b: "Latvia", score: null }], keys);
  assert.deepEqual(removed.relations, [seed[1]]);
});
test("malformed scores, unknown IDs, aliases, self-pairs and duplicates fail closed", () => {
  for (const score of [-101, 101, "1.25", "", "NaN", null, false, {}, undefined]) {
    const edit = { a: "Latvia", b: "Estonia", score };
    if (score === null) continue; // null is deliberate clear, not an authored zero
    assert.equal(applyStartingRelationEdits([], [edit], keys).ok, false, String(score));
  }
  for (const edit of [
    { a: "Latvia", b: "latvia", score: 0 },
    { a: "Latvia", b: "Unknown", score: 0 },
    { a: "LATVIA", b: "Estonia", score: 0 },
    { a: "Latvia", b: "Latvia", score: 0 },
  ]) assert.equal(applyStartingRelationEdits([], [edit], keys).ok, false);
  assert.equal(planStartingRelationDraft([{ other: "Estonia", score: 0 }, { other: "Estonia", score: 1 }], "Newland", keys).ok, false);
});
test("new-country draft resolves counterpart keys, retains zero and refuses overdrawn values", () => {
  const valid = planStartingRelationDraft([{ other: "Latvia", score: "0" }, { other: "Estonia", score: "-37" }], "Newland", keys);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.edits, [
    { a: "Newland", b: "Latvia", score: 0 },
    { a: "Newland", b: "Estonia", score: -37 },
  ]);
  assert.equal(planStartingRelationDraft([{ other: "Newland", score: 10 }], "Newland", keys).ok, false);
  assert.equal(planStartingRelationDraft([{ other: "LV", score: 10 }], "Newland", keys).ok, false);
});
test("maximum 256 distinct rows is enforced without dropping the source", () => {
  const full = Array.from({ length: MAX_STARTING_RELATIONS }, (_, i) => ({ a: "Latvia", b: `Other ${i}`, score: i % 10 }));
  const input = JSON.stringify(full);
  assert.equal(applyStartingRelationEdits(full, [{ a: "Latvia", b: "Estonia", score: 1 }], keys).ok, false);
  assert.equal(JSON.stringify(full), input);
  assert.equal(applyStartingRelationEdits(full, [{ a: "Latvia", b: "Estonia", score: null }], keys).ok, true);
});
test("updates in one edit queue supersede only the same unordered pair", () => {
  const old = [{ a: "Latvia", b: "Estonia", score: 5 }, { a: "Latvia", b: "Lithuania", score: -3 }];
  const newer = mergeStartingRelationEdit(old, { a: "Estonia", b: "Latvia", score: 0 });
  assert.equal(newer.length, 2);
  const actual = applyStartingRelationEdits([], newer, keys);
  assert.equal(actual.ok, true);
  assert.equal(actual.relations.find(x => x.b === "Latvia" || x.a === "Latvia" && x.b === "Estonia").score, 0);
});
test("polity rename and explicit removal preserve unrelated bilateral relationships", () => {
  const original = [{ a: "Latvia", b: "Estonia", score: -13 }, { a: "Lithuania", b: "Estonia", score: 70 }];
  const renamed = rekeyStartingRelations(original, "Latvia", "Livonia");
  assert.equal(renamed[0].a, "Livonia");
  assert.deepEqual(renamed[1], original[1]);
  assert.deepEqual(withoutStartingRelations(renamed, ["Livonia"]), [original[1]]);
  assert.deepEqual(original[0], { a: "Latvia", b: "Estonia", score: -13 });
});

test("legacy aliases resolve to one stable source pair without creating duplicate rows", () => {
  const identities = [
    { key: "Latvia", name: "Republic of Latvia", aliases: ["Latvian Republic"], formerNames: ["Independent Latvia"] },
    { key: "Estonia", name: "Republic of Estonia", aliases: ["Estonian State"] },
    { key: "Lithuania" },
  ];
  const old = [{ id: "historical-22", a: "Latvian Republic", b: "Estonia", score: 40, status: "cordial", sourceEventIds: ["e1"] }];
  const result = applyStartingRelationEdits(old, [{ a: "Latvia", b: "Estonia", score: -10 }], identities);
  assert.equal(result.ok, true);
  assert.equal(result.relations.length, 1);
  assert.deepEqual(result.relations[0], {
    id: "historical-22", a: "Latvia", b: "Estonia", score: -10, status: "neutral",
    sourceEventIds: ["e1"],
  });
  assert.deepEqual(startingRelationRowsFor(old, "Latvia", identities), [{ other: "Estonia", score: 40 }]);
  assert.deepEqual(withoutStartingRelations(old, ["Latvia"], identities), []);
  assert.equal(old[0].a, "Latvian Republic", "A preview must never mutate the old scenario");
});

test("ambiguous aliases and duplicated canonical pairs refuse mutation instead of silently losing a row", () => {
  const identities = [
    { key: "Latvia", aliases: ["Historical Dominion"] },
    { key: "Estonia", aliases: ["Historical Dominion"] },
    { key: "Lithuania" },
  ];
  const source = [{ a: "Historical Dominion", b: "Lithuania", score: 25 }];
  const denied = applyStartingRelationEdits(source, [{ a: "Latvia", b: "Lithuania", score: 12 }], identities);
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /ambiguous/i);
  const unrelated = applyStartingRelationEdits(source, [{ a: "Estonia", b: "Latvia", score: 12 }], identities);
  assert.equal(unrelated.ok, true);
  assert.deepEqual(unrelated.relations[0], source[0]);
  const duplicate = [
    { a: "Latvia", b: "Estonia", score: 23 },
    { a: "Estonia", b: "Latvia", score: 24 },
  ];
  assert.match(applyStartingRelationEdits(duplicate, [{ a: "Latvia", b: "Estonia", score: 0 }], identities).reason, /duplicate/i);
});

test("successful save settles only the exact edit objects it wrote, preserving newer same-pair edits", () => {
  const oldEdit = { a: "Latvia", b: "Estonia", score: 20 };
  const newerEdit = { a: "Latvia", b: "Estonia", score: -30 };
  const laterOtherPair = { a: "Latvia", b: "Lithuania", score: 0 };
  const document = {
    polities: { Latvia: { name: "Latvia" }, Estonia: { name: "Estonia" }, Lithuania: { name: "Lithuania" } },
    relations: [{ id: "existing", a: "Latvia", b: "Estonia", score: 10 }],
    relationEdits: [newerEdit, laterOtherPair],
  };
  const settled = settleStartingRelationEdits(document, [oldEdit]);
  assert.equal(settled.ok, true);
  assert.equal(settled.document.relations[0].score, 20, "Canonical snapshot reflects what was written in the completed save");
  assert.deepEqual(settled.document.relationEdits, [newerEdit, laterOtherPair], "Later edits stay pending");
  assert.deepEqual(document.relationEdits, [newerEdit, laterOtherPair], "Document is not mutated");
  const final = settleStartingRelationEdits(settled.document, [newerEdit, laterOtherPair]);
  assert.equal(final.ok, true);
  assert.equal(final.document.relations.find((row) => row.b === "Estonia").score, -30);
  assert.equal(final.document.relations.find((row) => row.b === "Lithuania").score, 0);
  assert.deepEqual(final.document.relationEdits, []);
});
test("a second identical-value edit is still distinct unsaved work after the first save", () => {
  const submitted = { a: "Latvia", b: "Estonia", score: 0 };
  const later = { a: "Latvia", b: "Estonia", score: 0 };
  const doc = { polities: { Latvia: {}, Estonia: {} }, relations: [], relationEdits: [later] };
  const done = settleStartingRelationEdits(doc, [submitted]);
  assert.equal(done.ok, true);
  assert.deepEqual(done.document.relationEdits, [later]);
  assert.equal(done.document.relations[0].score, 0);
});

test("editing a score preserves its scenario-authored narrative and provenance", () => {
  const before = [{
    id: "relation-scenario1-v12-01", a: "Kingdom of Serbia", b: "Kingdom of Bulgaria",
    score: 12, status: "neutral",
    summary: "Diplomacy explores cooperation; territorial disputes remain unresolved.",
    lastUpdatedDate: "1912-01-01", sourceEventIds: [], createdRound: 0, updatedRound: 0,
  }];
  const result = applyStartingRelationEdits(before, [{ a: "Kingdom of Bulgaria", b: "Kingdom of Serbia", score: 37 }], [
    { key: "Kingdom of Bulgaria" }, { key: "Kingdom of Serbia" },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.relations[0], { ...before[0], a: "Kingdom of Bulgaria", b: "Kingdom of Serbia", score: 37, status: "cordial" });
  assert.equal(before[0].score, 12);
});

test("settleStartingRelationEdits handles real in-flight Workshop renames (which strip formerNames) with or without _editId", () => {
  const initialDoc = {
    polities: {
      Latvia: { name: "Latvia", code: "Latvia", aliases: ["LV"] },
      Estonia: { name: "Estonia", code: "Estonia" },
    },
    relations: [],
    relationEdits: mergeStartingRelationEdit([], { a: "Latvia", b: "Estonia", score: 25 }),
    polityRenames: [],
  };
  const savedInFlight = [initialDoc.relationEdits[0]];
  const savedCloned = JSON.parse(JSON.stringify(savedInFlight));

  // Real Workshop rename strips formerNames/old aliases and records polityRenames.
  const renamedOnce = planMapPolityRename(initialDoc, "Latvia", "Republic of Latvia", ["Latvia", "Estonia"]);
  const renamedTwice = planMapPolityRename(renamedOnce, "Republic of Latvia", "Baltic Federation", ["Republic of Latvia", "Estonia"]);
  assert.equal(renamedTwice.polities["Baltic Federation"].formerNames, undefined);

  const settledWithId = settleStartingRelationEdits(renamedTwice, savedInFlight);
  assert.equal(settledWithId.ok, true);
  assert.equal(settledWithId.document.relations.length, 1);
  assert.equal(settledWithId.document.relations[0].a, "Baltic Federation");
  assert.equal(settledWithId.document.relations[0].score, 25);
  assert.deepEqual(settledWithId.document.relationEdits, []);

  // Even if savedEdits lost its non-enumerable _editId through cloning, polityRenames replays cleanly.
  const settledCloned = settleStartingRelationEdits(renamedTwice, savedCloned);
  assert.equal(settledCloned.ok, true);
  assert.equal(settledCloned.document.relations.length, 1);
  assert.equal(settledCloned.document.relations[0].a, "Baltic Federation");
  assert.equal(settledCloned.document.relations[0].score, 25);
});

test("settleStartingRelationEdits settles edits involving territory-only polities supplied via extraKeys", () => {
  const savedEdit = mergeStartingRelationEdit([], { a: "RegisteredPolity", b: "TerritoryOnlyPolity", score: -40 })[0];
  const document = {
    polities: { RegisteredPolity: { name: "RegisteredPolity" } },
    relations: [],
    relationEdits: [savedEdit],
  };

  // Without extraKeys, territory-only polity is rejected.
  assert.equal(settleStartingRelationEdits(document, [savedEdit]).ok, false);

  // With map-occupied extraKeys, the saved relation settles cleanly and leaves no stale pending edit.
  const settled = settleStartingRelationEdits(document, [savedEdit], ["TerritoryOnlyPolity"]);
  assert.equal(settled.ok, true);
  assert.equal(settled.document.relations.length, 1);
  assert.equal(settled.document.relations[0].a, "RegisteredPolity");
  assert.equal(settled.document.relations[0].b, "TerritoryOnlyPolity");
  assert.equal(settled.document.relations[0].score, -40);
  assert.deepEqual(settled.document.relationEdits, []);
});

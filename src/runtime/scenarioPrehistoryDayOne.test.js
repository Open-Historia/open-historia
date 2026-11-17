import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORABLE_DAY_ONE_KINDS, DAY_ONE_AGREEMENT_TYPES, MAX_SEMANTIC_DAY_ONE_FACTS,
  changeManualAccessReciprocal, changeManualAgreementType, dayOneEditorProblems,
  insertManualDayOneFact, updateDayOneFact,
} from "./scenarioPrehistoryDayOne.js";
import { normalizeScenarioPrehistory, prehistoryPayload } from "./scenarioPrehistory.js";

const WORLD = { ownerCodes: ["France", "Germany", "Belgium", "United Kingdom", "Italy"] };
const START = "1930-01-01";
const check = (draft, options = {}) => dayOneEditorProblems(draft, { world: WORLD, startDate: START, ...options });
const add = (draft, kind, fields) => {
  const inserted = insertManualDayOneFact(draft, kind);
  return updateDayOneFact(inserted, "canonicalUpdates", inserted.updates.canonicalUpdates.length - 1, fields);
};
const sampleRelation = { a: "France", b: "Germany", score: 30, summary: "A cooling rivalry." };
const sampleTreaty = { title: "Continental Pact", type: "alliance", parties: ["France", "Italy"], terms: "Consultations." };
const sampleCrisis = { title: "Border crisis", processKind: "crisis", status: "active",
  participants: ["Germany", "Belgium"], pressure: 45, momentum: 12, state: "Unresolved." };

test("manual fact creation uses stable candidate-local refs and does not create any event or lifecycle record", () => {
  let draft = normalizeScenarioPrehistory({}, { draft: true });
  assert.deepEqual(AUTHORABLE_DAY_ONE_KINDS, ["relation", "agreement", "storyline"]);
  draft = add(draft, "relation", sampleRelation);
  draft = add(draft, "agreement", sampleTreaty);
  draft = add(draft, "storyline", sampleCrisis);
  assert.deepEqual(draft.updates.canonicalUpdates.map((fact) => fact.ref), ["manual-f1", "manual-f2", "manual-f3"]);
  assert.deepEqual(draft.events, []);
  assert.deepEqual(draft.updates.relationUpdates, []);
  assert.deepEqual(draft.updates.agreementUpdates, []);
  assert.deepEqual(draft.updates.storylineUpdates, []);
  assert.deepEqual(check(draft), []);
  assert.deepEqual(check(draft, { verifyWorld: true }), []);
  const saved = normalizeScenarioPrehistory(draft);
  assert.equal(prehistoryPayload(saved, { startDate: START }).canonicalUpdates.length, 3);
  assert.equal(prehistoryPayload(saved, { startDate: START }).events.length, 0);
});

test("editing older records preserves their canonical ID, lifecycle op and event links without migrating formats", () => {
  const old = normalizeScenarioPrehistory({ updates: {
    relationUpdates: [{ id: "r1", a: "France", b: "Germany", score: -45.5, summary: "Previous", eventIds: ["event-a"] }],
    agreementUpdates: [{ id: "a1", op: "start", type: "alliance", title: "Old Pact", parties: ["France", "Italy"], terms: "Old", eventIndexes: [0], nativeExtension: { keeps: true } }],
    storylineUpdates: [{ id: "s1", title: "Old crisis", kind: "crisis", status: "active", pressure: 20,
      momentum: 10, participants: ["Germany"], state: "Still open", eventIds: ["event-s"] }],
  } }, { draft: true });
  let next = updateDayOneFact(old, "relationUpdates", 0, { score: -33, summary: "Updated" });
  next = updateDayOneFact(next, "agreementUpdates", 0, { title: "New Pact", terms: "New" });
  next = updateDayOneFact(next, "storylineUpdates", 0, { pressure: 35, state: "Growing" });
  assert.deepEqual(next.updates.relationUpdates[0].eventIds, ["event-a"]);
  assert.equal(next.updates.relationUpdates[0].score, -33);
  assert.equal(next.updates.agreementUpdates[0].op, "start");
  assert.equal(next.updates.agreementUpdates[0].nativeExtension.keeps, true);
  assert.deepEqual(next.updates.agreementUpdates[0].eventIndexes, [0]);
  assert.equal(next.updates.storylineUpdates[0].id, "s1");
  assert.deepEqual(next.updates.storylineUpdates[0].eventIds, ["event-s"]);
  assert.deepEqual(old.updates.relationUpdates[0].eventIds, ["event-a"], "original record unchanged");
  assert.equal(old.updates.agreementUpdates[0].title, "Old Pact");
  assert.deepEqual(normalizeScenarioPrehistory(next).updates.agreementUpdates, next.updates.agreementUpdates);
});

test("guarantee and reciprocal military access own only their permitted directional roles", () => {
  let draft = add({}, "agreement", sampleTreaty);
  assert.ok(DAY_ONE_AGREEMENT_TYPES.includes("guarantee"));
  draft = changeManualAgreementType(draft, 0, "guarantee");
  let fact = draft.updates.canonicalUpdates[0];
  assert.equal("parties" in fact, false);
  assert.equal(fact.title, "Continental Pact");
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { guarantor: "United Kingdom", beneficiary: "Belgium" });
  assert.deepEqual(check(draft, { verifyWorld: true }), []);
  draft = changeManualAgreementType(draft, 0, "military_access");
  fact = draft.updates.canonicalUpdates[0];
  assert.equal("guarantor" in fact, false);
  assert.equal("beneficiary" in fact, false);
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { grantor: "France", grantee: "Germany" });
  assert.deepEqual(check(draft, { verifyWorld: true }), []);
  draft = changeManualAccessReciprocal(draft, 0, true);
  fact = draft.updates.canonicalUpdates[0];
  assert.equal("grantor" in fact, false);
  assert.equal(fact.reciprocal, true);
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { parties: ["France", "Germany"] });
  assert.deepEqual(check(draft, { verifyWorld: true }), []);
  draft = changeManualAccessReciprocal(draft, 0, false);
  assert.equal("parties" in draft.updates.canonicalUpdates[0], false);
  assert.equal("reciprocal" in draft.updates.canonicalUpdates[0], false);
  assert.equal(check(draft).length > 0, true, "directional roles are required again");
});

test("incomplete drafts and malformed or duplicate semantic facts are fail-closed", () => {
  let draft = insertManualDayOneFact({}, "relation");
  assert.ok(check(draft).some((row) => /score/.test(row.problem)));
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { a: "France", b: "France", score: 0 });
  assert.ok(check(draft).some((row) => /different/.test(row.problem)));
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { b: "Germany", score: 101 });
  assert.ok(check(draft).some((row) => /-100 to 100/.test(row.problem)));
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { score: 0, startedDate: "1930-01-01" });
  assert.ok(check(draft).some((row) => /before/.test(row.problem)));
  draft = updateDayOneFact(draft, "canonicalUpdates", 0, { startedDate: undefined });
  assert.deepEqual(check(draft, { verifyWorld: true }), []);
  draft = add(draft, "relation", { ...sampleRelation, a: "France", b: "Italy" });
  draft = updateDayOneFact(draft, "canonicalUpdates", 1, { ref: draft.updates.canonicalUpdates[0].ref });
  assert.ok(check(draft).some((row) => /unique internal/.test(row.problem)));
});

test("native compiler rejects unknown polity identities instead of silently accepting an invalid treaty", () => {
  const unknown = add({}, "agreement", { ...sampleTreaty, parties: ["France", "Not-A-Real-Polity"] });
  assert.equal(check(unknown).length, 0, "basic form checks do not falsely claim to resolve polity identity");
  assert.ok(check(unknown, { verifyWorld: true }).some((row) => /unresolved/i.test(row.problem)));
});

test("semantic fact count honors native 32-fact cap without trimming old records", () => {
  let draft = normalizeScenarioPrehistory({}, { draft: true });
  for (let index = 0; index < MAX_SEMANTIC_DAY_ONE_FACTS; index++) draft = insertManualDayOneFact(draft, "relation");
  assert.equal(draft.updates.canonicalUpdates.length, 32);
  assert.throws(() => insertManualDayOneFact(draft, "relation"), /32/);
});

test("existing generated semantic facts retain their event provenance and accepted decimal scores", () => {
  const original = normalizeScenarioPrehistory({
    events: [{ id: "event-1", ref: "e1", title: "Previous event", date: "1920-01-01" }],
    updates: { canonicalUpdates: [{ ref: "f1", kind: "relation", a: "France", b: "Germany",
      score: -55.4, sourceEventRefs: ["e1"], summary: "Unfriendly." }] },
  }, { draft: true });
  const edited = updateDayOneFact(original, "canonicalUpdates", 0, { summary: "Still unfriendly." });
  assert.deepEqual(edited.updates.canonicalUpdates[0].sourceEventRefs, ["e1"]);
  assert.equal(edited.updates.canonicalUpdates[0].score, -55.4);
  assert.deepEqual(check(edited, { verifyWorld: true }), []);
});

test("an edited semantic fact survives removal of its original timeline source event", () => {
  const original = normalizeScenarioPrehistory({
    events: [{ id: "ev-1", ref: "e1", date: "1920-01-01", title: "Diplomatic event" }],
    updates: { canonicalUpdates: [{ ref: "f1", kind: "relation", a: "France", b: "Germany",
      score: -55, sourceEventRefs: ["e1"], summary: "Unfriendly" }] },
  }, { draft: true });
  const edited = { ...original, events: [] };
  assert.deepEqual(check(edited, { verifyWorld: true }), [], "game-start bootstrap drops the stale citation but keeps the relation");
  assert.deepEqual(edited.updates.canonicalUpdates[0].sourceEventRefs, ["e1"], "editing does not destroy saved provenance");
});

test("malformed edits to older lifecycle facts are blocked without altering the original", () => {
  const original = normalizeScenarioPrehistory({
    updates: {
      relationUpdates: [{ id: "r1", a: "France", b: "Germany", score: -20 }],
      agreementUpdates: [{ id: "a1", op: "start", type: "alliance", parties: ["France", "Italy"], title: "Pact" }],
      storylineUpdates: [{ id: "s1", kind: "crisis", status: "active", title: "Crisis", participants: ["France"] }],
    },
  }, { draft: true });
  let edited = updateDayOneFact(original, "relationUpdates", 0, { score: 900 });
  assert.ok(check(edited).some((item) => item.family === "relationUpdates"));
  edited = updateDayOneFact(original, "agreementUpdates", 0, { parties: ["France"] });
  assert.ok(check(edited).some((item) => item.family === "agreementUpdates"));
  edited = updateDayOneFact(original, "storylineUpdates", 0, { participants: [] });
  assert.ok(check(edited).some((item) => item.family === "storylineUpdates"));
  assert.equal(original.updates.relationUpdates[0].score, -20);
  assert.deepEqual(original.updates.agreementUpdates[0].parties, ["France", "Italy"]);
});

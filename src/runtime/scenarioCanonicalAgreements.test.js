import test from "node:test";
import assert from "node:assert/strict";
import {
  scenarioCanonicalAgreements,
  sameScenarioCanonicalAgreements,
  editScenarioCanonicalAgreement,
  changeScenarioCanonicalAgreementType,
  changeScenarioCanonicalAccessReciprocal,
  removeScenarioCanonicalAgreement,
  validateScenarioCanonicalAgreementEdits,
} from "./scenarioCanonicalAgreements.js";
import { normalizeScenarioPrehistory, prehistoryUpdateRows } from "./scenarioPrehistory.js";
import { normalizeWorldState } from "./gameState.js";

const WORLD = {
  ownerCodes: ["France", "Germany", "Belgium", "United Kingdom", "Italy"],
  politicalActors: { byPolity: {} },
  otherCanon: { keep: true },
};
const START = "1930-01-01";
const TREATY = {
  id: "treaty-good-neighbours",
  type: "friendship_consultation",
  title: "Treaty of Good-Neighbourliness and Friendly Cooperation",
  status: "active",
  parties: ["France", "Germany"],
  terms: "Consult annually.",
  startedDate: "1925-02-01",
  endedDate: "",
  lastUpdatedDate: "1930-01-01",
  sourceEventIds: ["historical-event-1"],
  createdRound: 0,
  updatedRound: 0,
  migratedLegacy: true,
  nativeExtra: { preserved: true },
};
const OTHER = { id: "other-agreement", title: "Other pact", type: "alliance", status: "active", parties: ["Belgium", "Italy"], terms: "", startedDate: "1920-01-01" };
const source = () => [structuredClone(TREATY), structuredClone(OTHER)];
const verify = (original, draft, options = {}) => validateScenarioCanonicalAgreementEdits({
  original, draft, world: WORLD, startDate: START, ...options,
});

test("bug reproduction: generated canonical treaties are not prehistory records, but can now be edited independently", () => {
  const world = { ...WORLD, agreements: source(), prehistory: normalizeScenarioPrehistory({}) };
  assert.equal(prehistoryUpdateRows(world.prehistory).length, 0, "no AI prehistory facts were generated");
  const original = scenarioCanonicalAgreements(world);
  let draft = editScenarioCanonicalAgreement(original, TREATY.id, { title: "Updated friendship treaty", terms: "Meet twice a year." });
  assert.equal(draft.length, 2);
  assert.equal(sameScenarioCanonicalAgreements(original, draft), false);
  const result = verify(original, draft, { world });
  assert.deepEqual(result.errors, []);
  const edited = result.agreements[0];
  assert.equal(edited.id, TREATY.id);
  assert.equal(edited.title, "Updated friendship treaty");
  assert.equal(edited.terms, "Meet twice a year.");
  for (const key of ["startedDate", "endedDate", "lastUpdatedDate", "sourceEventIds", "createdRound", "updatedRound", "nativeExtra", "migratedLegacy"]) {
    assert.deepEqual(edited[key], TREATY[key], "preserve existing " + key);
  }
  assert.deepEqual(result.agreements[1], OTHER);
  assert.deepEqual(world.agreements, source(), "original scenario ledger not mutated by editing");
  assert.deepEqual(world.prehistory, normalizeScenarioPrehistory({}), "do not duplicate or migrate to prehistory");
});

test("removing a canonical agreement removes exactly its ID and does not change unrelated records", () => {
  const original = source();
  const draft = removeScenarioCanonicalAgreement(original, TREATY.id);
  const result = verify(original, draft);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.agreements, [OTHER]);
  assert.deepEqual(original, source(), "source unchanged");
  assert.throws(() => removeScenarioCanonicalAgreement(original, ""), /unique canonical ID/);
  assert.throws(() => removeScenarioCanonicalAgreement(original, "missing"), /unique canonical ID/);
});

test("prehistory restitution forbids apparently deleting the same treaty from world.agreements alone", () => {
  const original = source();
  const draft = removeScenarioCanonicalAgreement(original, TREATY.id);
  const prehistory = normalizeScenarioPrehistory({ updates: {
    canonicalUpdates: [{ kind: "agreement", ref: "f1", type: TREATY.type, title: "Same treaty in another language", parties: TREATY.parties }],
  } });
  assert.match(verify(original, draft, { prehistory }).errors[0].problem, /also exists in Pre-history/);
  const old = normalizeScenarioPrehistory({ updates: {
    agreementUpdates: [{ id: TREATY.id, op: "start", type: TREATY.type, title: TREATY.title, parties: TREATY.parties }],
  } });
  assert.match(verify(original, draft, { prehistory: old }).errors[0].problem, /also exists in Pre-history/);
  assert.deepEqual(verify(original, draft).errors, []);
});

test("type and role edits preserve canonical identity while enforcing direction and parties", () => {
  const original = source();
  let draft = changeScenarioCanonicalAgreementType(original, TREATY.id, "guarantee");
  draft = editScenarioCanonicalAgreement(draft, TREATY.id, { guarantor: "United Kingdom", beneficiary: "Belgium" });
  let saved = verify(original, draft);
  assert.deepEqual(saved.errors, []);
  assert.deepEqual(saved.agreements[0].parties, ["United Kingdom", "Belgium"]);
  assert.equal(saved.agreements[0].guarantor, "United Kingdom");
  assert.equal(saved.agreements[0].beneficiary, "Belgium");
  assert.equal(saved.agreements[0].id, TREATY.id);
  draft = changeScenarioCanonicalAgreementType(draft, TREATY.id, "military_access");
  assert.match(verify(original, draft).errors.map((error) => error.problem).join(" "), /countries|different/);
  draft = editScenarioCanonicalAgreement(draft, TREATY.id, { grantor: "Germany", grantee: "France" });
  saved = verify(original, draft);
  assert.deepEqual(saved.errors, []);
  assert.deepEqual(saved.agreements[0].parties, ["Germany", "France"]);
  assert.equal(saved.agreements[0].reciprocalAccess, false);
  draft = changeScenarioCanonicalAccessReciprocal(draft, TREATY.id, true);
  draft = editScenarioCanonicalAgreement(draft, TREATY.id, { parties: ["Belgium", "Italy"] });
  saved = verify(original, draft);
  assert.deepEqual(saved.errors, []);
  assert.deepEqual(saved.agreements[0].parties, ["Belgium", "Italy"]);
  assert.equal(saved.agreements[0].reciprocalAccess, true);
  assert.equal("grantor" in saved.agreements[0], false);
});

test("editing existing canonical records refuses bad parties, dates, duplicate identity and protected metadata", () => {
  const original = source();
  for (const patch of [
    { parties: ["France", "Fictional Intruder"] },
    { parties: ["France", "France"] },
    { title: " " },
    { type: "unrecognized_treaty" },
    { startedDate: "1931-01-01" },
    { startedDate: "not-a-date" },
    { terms: "x".repeat(601) },
  ]) {
    assert.ok(verify(original, editScenarioCanonicalAgreement(original, TREATY.id, patch)).errors.length, JSON.stringify(patch));
  }
  assert.throws(() => editScenarioCanonicalAgreement(original, TREATY.id, { id: "changed" }), /unsupported/);
  assert.throws(() => editScenarioCanonicalAgreement(original, TREATY.id, { sourceEventIds: [] }), /unsupported/);
  assert.throws(() => changeScenarioCanonicalAgreementType(original, TREATY.id, "invented"), /Unknown/);
  const clone = source();
  clone[0] = { ...clone[0], id: "fake-new-id" };
  assert.ok(verify(original, clone).errors.length);
  const collision = editScenarioCanonicalAgreement(original, TREATY.id, {
    type: OTHER.type, parties: OTHER.parties, title: OTHER.title,
  });
  assert.match(verify(original, collision).errors.map((x) => x.problem).join(" "), /same type, roles and title/);
});

test("legacy records with incomplete IDs are retained unchanged when another valid agreement is edited", () => {
  const original = [...source(), { title: "Old mystery", type: "other", parties: ["France", "Italy"] }];
  const draft = editScenarioCanonicalAgreement(original, TREATY.id, { terms: "Revised" });
  const result = verify(original, draft);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.agreements.at(-1), original.at(-1));
  assert.throws(() => editScenarioCanonicalAgreement(original, "", { title: "No" }), /unique canonical ID/);
});

test("ended agreements retain their status and expiry metadata during an authored terms change", () => {
  const ended = { ...TREATY, status: "ended", endedDate: "1928-01-01", lastUpdatedDate: "1928-01-01" };
  const original = [ended];
  const draft = editScenarioCanonicalAgreement(original, ended.id, { terms: "Archived treaty" });
  const result = verify(original, draft);
  assert.deepEqual(result.errors, []);
  assert.equal(result.agreements[0].status, "ended");
  assert.equal(result.agreements[0].endedDate, "1928-01-01");
  assert.deepEqual(result.agreements[0].sourceEventIds, ["historical-event-1"]);
});


test("legacy military access without recorded direction remains undirected on text edits", () => {
  const sourceAccess = { ...TREATY, id: "access-legacy", type: "military_access" };
  const original = [sourceAccess];
  const draft = editScenarioCanonicalAgreement(original, sourceAccess.id, { terms: "Access as previously agreed." });
  let result = verify(original, draft);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.agreements[0].parties, ["France", "Germany"]);
  assert.equal("grantor" in result.agreements[0], false, "no fabricated grant direction");
  assert.equal("reciprocalAccess" in result.agreements[0], false, "no fabricated reciprocity");
  const reciprocal = changeScenarioCanonicalAccessReciprocal(draft, sourceAccess.id, true);
  result = verify(original, reciprocal);
  assert.deepEqual(result.errors, []);
  assert.equal(result.agreements[0].reciprocalAccess, true);
});

test("malformed legacy records cannot be removed by omitting them from a candidate patch", () => {
  const original = [...source(), { type: "other", title: "No ID", parties: ["France", "Italy"] }];
  const tampered = original.slice(0, -1);
  assert.match(verify(original, tampered).errors[0].problem, /without unique IDs/);
});

test("edited canonical scenario agreements remain valid in native world-state normalization", () => {
  const original = source();
  const edited = editScenarioCanonicalAgreement(original, TREATY.id, { title: "Revised treaty" });
  const validated = verify(original, edited);
  assert.deepEqual(validated.errors, []);
  const world = normalizeWorldState({ ...WORLD, agreements: validated.agreements });
  const treaty = world.agreements.find((row) => row.id === TREATY.id);
  assert.ok(treaty, "the native ledger retains the edited treaty");
  assert.equal(treaty.title, "Revised treaty");
  assert.equal(treaty.status, "active");
  assert.deepEqual(treaty.parties, ["France", "Germany"]);
  assert.deepEqual(treaty.sourceEventIds, ["historical-event-1"]);
});

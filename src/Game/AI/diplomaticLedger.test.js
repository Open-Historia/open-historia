/*! Open Historia — canonical diplomacy ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/diplomaticLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDiplomaticUpdates,
  buildBoundedDiplomaticContext,
  decodeAgreementUpdates,
  decodeRelationUpdates,
  migrateLegacyDiplomaticState,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";

// The agreement records a validated candidate is left holding (the validator
// hands them back event-bound, as objects rather than transport text).
const agreementIds = (candidate) => decodeAgreementUpdates(candidate.agreementUpdates).map((update) => update.id);

// The relation and agreement ledgers ride the same compact line transport as
// wars: a record must resolve both polities and bind to a real causal event
// before it can persist, and the prompt only ever sees a bounded slice.

const world = {
  polityOverrides: {
    France: { code: "France", name: "France" },
    Russia: { code: "Russia", name: "Russia" },
    Germany: { code: "Germany", name: "Germany" },
  },
  regionOwnershipOverrides: { r1: "France", r2: "Russia", r3: "Germany" },
  relations: [],
  agreements: [],
};

const alliance = () => [{
  id: "e1",
  date: "1894-01-04",
  title: "Franco-Russian Alliance ratified",
  description: "France and Russia conclude a military convention aimed at Germany.",
  kind: "diplomacy",
}];

test("relation and agreement lines bind to their event and merge into the world", () => {
  const events = alliance();
  const candidate = {
    events,
    relationUpdates: "France~Russia~70~friendly~1~Alliance concluded",
    agreementUpdates: "franco-russian-alliance~start~alliance~France,Russia~1~Franco-Russian Alliance~Mutual military assistance against Germany",
  };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true }), "");

  const merge = applyDiplomaticUpdates({
    world,
    relationUpdates: candidate.relationUpdates,
    agreementUpdates: candidate.agreementUpdates,
    events,
    stopDate: "1894-01-31",
    round: 2,
  });
  assert.equal(merge.relations.length, 1);
  assert.equal(merge.relations[0].score, 70);
  assert.equal(merge.relations[0].status, "friendly");
  assert.deepEqual(merge.relations[0].sourceEventIds, ["e1"]);
  assert.equal(merge.agreements.length, 1);
  assert.equal(merge.agreements[0].type, "alliance");
  assert.equal(merge.agreements[0].status, "active");
  assert.equal(merge.agreements[0].startedDate, "1894-01-04");
  assert.deepEqual(merge.agreements[0].parties, ["France", "Russia"]);

  const { text } = buildBoundedDiplomaticContext(merge.world, { playerPolity: "France", maxActors: 4 });
  assert.match(text, /France ↔ Russia \| friendly \+70/);
  assert.match(text, /franco-russian-alliance \| ACTIVE \| alliance \| Franco-Russian Alliance/);
});

test("a lifecycle change on an agreement that does not exist is refused for the GM and dropped in simulation", () => {
  const row = "phantom-pact~end~alliance~France,Russia~1~Phantom Pact~gone";
  const strict = { events: alliance(), relationUpdates: "", agreementUpdates: row };
  assert.match(validateDiplomaticLedgerPayload(strict, { world }), /Agreement phantom-pact does not exist/);

  const simulated = { events: alliance(), relationUpdates: "", agreementUpdates: row };
  assert.equal(validateDiplomaticLedgerPayload(simulated, { world, allowNativeBinding: true }), "");
  assert.deepEqual(agreementIds(simulated), [], "there is nothing to end, so the row goes and the turn stays");
});

// The rows below are transcribed from a player's debug report (round 53 of an
// Iran game): the model evicted the United States from Bahrain, then "ended" a
// pact no turn had ever recorded, and the whole jump fell back to canned events.
test("ending an unrecorded pact drops the row and keeps the turn (field report)", () => {
  const gulf = {
    polityOverrides: {
      Iran: { code: "Iran", name: "Iran" },
      "United States": { code: "United States", name: "United States" },
      Bahrain: { code: "Bahrain", name: "Bahrain" },
    },
    regionOwnershipOverrides: { r1: "Iran", r2: "United States", r3: "Bahrain" },
    relations: [],
    agreements: [],
  };
  const candidate = {
    events: [{
      id: "segment-1-event-7",
      date: "2026-02-25",
      kind: "military",
      title: "United States Completes Evacuation of Naval Assets from Bahrain Following Transition Directive",
      description: "United States naval and military commands complete the withdrawal and relocation of personnel and assets from naval installations in Bahrain, complying with the transitional government's eviction decree and ending long-standing basing rights.",
    }],
    relationUpdates: "United States~Bahrain~-65~hostile~1~Complete military withdrawal and termination of bilateral defense arrangements following transitional government eviction decree.",
    agreementUpdates: "us-bahrain-security-pact-2026~end~military_cooperation~United States, Bahrain~~Termination of Bilateral Security Cooperation~Bilateral security arrangements and status-of-forces agreements are formally terminated following the transitional government's eviction decree.",
  };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world: gulf, allowNativeBinding: true }), "");
  assert.deepEqual(agreementIds(candidate), []);
  const relations = decodeRelationUpdates(candidate.relationUpdates);
  assert.equal(relations.length, 1, "the rupture is still recorded as a relation change");
  assert.equal(relations[0].score, -65);
});

// A recorded ledger for the re-aim cases: one active Franco-Russian alliance.
const allied = (agreements = [{
  id: "franco-russian-alliance",
  title: "Franco-Russian Alliance",
  type: "alliance",
  status: "active",
  parties: ["France", "Russia"],
  startedDate: "1894-01-04",
  terms: "Mutual military assistance against Germany",
}]) => ({ ...world, agreements });

const breach = () => [{
  id: "e9",
  date: "1896-05-01",
  title: "Russia repudiates the alliance with France",
  description: "St Petersburg formally renounces its military convention with Paris.",
  kind: "diplomacy",
}];

const endRow = (id, type, parties) => `${id}~end~${type}~${parties}~1~Termination~The alliance is renounced.`;

test("an unknown id is re-aimed only at the one agreement with the same parties and type", () => {
  const ledger = allied();
  const candidate = { events: breach(), relationUpdates: "", agreementUpdates: endRow("dual-alliance-pact", "alliance", "Russia,France") };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, allowNativeBinding: true }), "");
  assert.deepEqual(agreementIds(candidate), ["franco-russian-alliance"]);

  const merge = applyDiplomaticUpdates({
    world: ledger,
    relationUpdates: "",
    agreementUpdates: candidate.agreementUpdates,
    events: candidate.events,
    stopDate: "1896-05-31",
    round: 4,
  });
  assert.equal(merge.agreements.length, 1);
  assert.equal(merge.agreements[0].id, "franco-russian-alliance");
  assert.equal(merge.agreements[0].status, "ended");
});

test("any doubt about which agreement is meant drops the row instead of guessing", () => {
  const dropped = (label, ledger, agreementUpdates) => {
    const candidate = { events: breach(), relationUpdates: "", agreementUpdates };
    assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, allowNativeBinding: true }), "", label);
    assert.deepEqual(agreementIds(candidate), [], `${label}: the row is dropped, not re-aimed`);
  };

  dropped("type left blank", allied(), endRow("x", "", "France,Russia"));
  dropped("type other", allied(), endRow("x", "other", "France,Russia"));
  dropped("a different type", allied(), endRow("x", "trade_economic", "France,Russia"));
  dropped("an extra party", allied(), endRow("x", "alliance", "France,Russia,Germany"));
  dropped("a party that does not resolve", allied(), endRow("x", "alliance", "France,Russia,Atlantis"));
  dropped("a single party", allied(), endRow("x", "alliance", "Russia"));
  dropped("two agreements fit equally", allied([
    { id: "a1", title: "First", type: "alliance", status: "active", parties: ["France", "Russia"] },
    { id: "a2", title: "Second", type: "alliance", status: "suspended", parties: ["Russia", "France"] },
  ]), endRow("x", "alliance", "France,Russia"));
  dropped("the only match has already ended", allied([
    { id: "a1", title: "First", type: "alliance", status: "ended", parties: ["France", "Russia"] },
  ]), endRow("x", "alliance", "France,Russia"));
  dropped("resume of an agreement that is not suspended", allied(), "x~resume~alliance~France,Russia~1~Resumed~");
});

test("a guarantee is re-aimed only in its own direction", () => {
  const ledger = allied([{
    id: "french-guarantee-of-russia",
    title: "French Guarantee",
    type: "guarantee",
    status: "active",
    parties: ["France", "Russia"],
    guarantor: "France",
    beneficiary: "Russia",
  }]);
  const reversed = { events: breach(), relationUpdates: "", agreementUpdates: endRow("x", "guarantee", "Russia,France") };
  assert.equal(validateDiplomaticLedgerPayload(reversed, { world: ledger, allowNativeBinding: true }), "");
  assert.deepEqual(agreementIds(reversed), [], "Russia guaranteeing France is a different instrument");

  const same = { events: breach(), relationUpdates: "", agreementUpdates: endRow("x", "guarantee", "France,Russia") };
  assert.equal(validateDiplomaticLedgerPayload(same, { world: ledger, allowNativeBinding: true }), "");
  assert.deepEqual(agreementIds(same), ["french-guarantee-of-russia"]);
});

test("an id started in the same response is never re-aimed at an older agreement", () => {
  const candidate = {
    events: breach(),
    relationUpdates: "",
    agreementUpdates: [
      "new-pact~start~alliance~France,Russia~1~New Pact~Renewed terms",
      endRow("new-pact", "alliance", "France,Russia"),
    ].join("\n"),
  };
  const error = validateDiplomaticLedgerPayload(candidate, { world: allied(), allowNativeBinding: true });
  assert.deepEqual(agreementIds(candidate), ["new-pact", "new-pact"]);
  assert.match(error, /new-pact/);
});

test("a relation update that names an unresolvable polity is rejected", () => {
  const candidate = { events: alliance(), relationUpdates: "France~Atlantis~-40~strained~1~Dispute", agreementUpdates: "" };
  assert.match(validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true }), /could not resolve both polities/);
});

test("a later record on the same pair replaces the score; an unbound record is dropped on apply", () => {
  const events = alliance();
  const seeded = applyDiplomaticUpdates({
    world,
    relationUpdates: "France~Russia~70~friendly~1~Alliance concluded",
    agreementUpdates: "",
    events,
    stopDate: "1894-01-31",
    round: 2,
  });
  const later = applyDiplomaticUpdates({
    world: seeded.world,
    relationUpdates: [
      { a: "Russia", b: "France", score: 40, status: "cordial", eventIndexes: [], eventIds: ["e1"], summary: "Cooler" },
      { a: "Germany", b: "France", score: -60, status: "strained", eventIndexes: [], eventIds: ["nope"], summary: "Unbound" },
    ],
    agreementUpdates: "",
    events,
    stopDate: "1895-01-31",
    round: 3,
  });
  assert.equal(later.relations.length, 1);
  assert.equal(later.relations[0].score, 40);
  assert.equal(later.relations[0].status, "cordial");
});

test("legacy treaty events seed the ledgers exactly once", () => {
  const legacyEvents = [
    ...alliance(),
    { id: "e2", date: "1904-04-08", title: "Entente Cordiale signed", description: "France and the United Kingdom settle their colonial disputes.", kind: "diplomacy" },
  ];
  const first = migrateLegacyDiplomaticState({ world, events: legacyEvents, chats: [], game: { gameDate: "1905-01-01" } });
  assert.equal(first.migrated, true);
  assert.equal(first.scannedEvents, 2);
  assert.equal(first.world.diplomaticLedgerVersion, 1);
  assert.ok(first.agreementsAdded >= 1, "an explicit alliance event becomes an agreement");
  assert.ok(first.world.agreements.every((agreement) => agreement.migratedLegacy === true));

  const second = migrateLegacyDiplomaticState({ world: first.world, events: legacyEvents, chats: [], game: {} });
  assert.equal(second.migrated, false);
});

test("a declared status that contradicts the absolute score is reconciled in simulation and refused for the GM", () => {
  const events = [{
    id: "event-1",
    date: "2014-04-01",
    title: "NATO suspends cooperation with Russia",
    description: "The alliance suspends practical cooperation with Russia over Crimea.",
  }];
  const candidate = {
    events,
    relationUpdates: ["Russia~France~35~strained~1~Cooperation suspended over Crimea."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true }), "");
  assert.equal(candidate.relationUpdates[0].score, -35, "a magnitude beside a negative band flips sign");
  assert.equal(candidate.relationUpdates[0].status, "strained");

  const strict = validateDiplomaticLedgerPayload({
    events,
    relationUpdates: ["Russia~France~35~strained~1~Cooperation suspended."],
    agreementUpdates: [],
  }, { world });
  assert.match(strict, /ABSOLUTE new value/);

  const consistent = {
    events,
    relationUpdates: ["Russia~France~-35~strained~1~Cooperation suspended."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(consistent, { world, allowNativeBinding: true }), "");
  assert.equal(consistent.relationUpdates[0].score, -35);

  const oneBandOff = {
    events,
    relationUpdates: ["Russia~France~-25~strained~1~Cooling."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(oneBandOff, { world, allowNativeBinding: true }), "");
  assert.equal(oneBandOff.relationUpdates[0].score, -25, "an adjacent band is the model's call, not a contradiction");

  const midpoint = {
    events,
    relationUpdates: ["Russia~France~10~hostile~1~Expulsions."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(midpoint, { world, allowNativeBinding: true }), "");
  assert.equal(midpoint.relationUpdates[0].score, -75, "when a sign flip does not explain it, the declared band's midpoint does");
  assert.equal(midpoint.relationUpdates[0].status, "hostile");
});

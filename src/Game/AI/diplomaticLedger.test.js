/*! Open Historia — canonical diplomacy ledger tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/diplomaticLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDiplomaticUpdates,
  buildBoundedDiplomaticContext,
  migrateLegacyDiplomaticState,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";

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

test("a lifecycle change on an agreement that does not exist is a validation error", () => {
  const candidate = { events: alliance(), relationUpdates: "", agreementUpdates: "phantom-pact~end~alliance~France,Russia~1~Phantom Pact~gone" };
  assert.match(validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true }), /Agreement phantom-pact does not exist/);
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

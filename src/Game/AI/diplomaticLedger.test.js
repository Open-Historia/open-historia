/*! Open Historia — canonical diplomacy ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/diplomaticLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldState } from "../../runtime/gameState.js";
import {
  applyDiplomaticUpdates,
  buildBoundedDiplomaticContext,
  buildPregameRelationBaselineRecord,
  decodeAgreementUpdates,
  decodeRelationUpdates,
  salvageDiplomaticLedgerPayload,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import * as director from "./nativeDiplomaticDirector.js";

// The agreement records a validated candidate is left holding.
const agreementIds = (candidate) => decodeAgreementUpdates(candidate.agreementUpdates).map((update) => update.id);

// The relation and agreement ledgers ride the same compact line transport as
// wars: a record must resolve both polities, it is tied to the events it names
// by their numbers, and the prompt only ever sees a bounded slice. A skip's
// record that names no event is still the skip's: it is applied, dated by the
// skip. Nothing ties a record to an event by its words.

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
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), "");

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

test("a collapsed multi-relation payload cannot become one pair's canonical summary", () => {
  // Android Beta #42, round 133: the Peru summary swallowed other countries'
  // compact relation rows, and a later event was incorrectly treated as causal.
  // The rule is generic: a relation summary is prose, never packed ledger data.
  const corrupted = "France~Russia~70~friendly~1~Germany~85~friendly~,France~Germany~40~cordial~";
  const valid = "France~Germany~40~cordial~1~Trade contacts resumed";
  const original = {
    events: alliance(),
    relationUpdates: corrupted + "\n" + valid,
    agreementUpdates: "",
  };

  const decoded = decodeRelationUpdates(corrupted);
  assert.equal(decoded[0].summary, "Germany~85~friendly~,France~Germany~40~cordial~");

  const strict = structuredClone(original);
  assert.match(validateDiplomaticLedgerPayload(strict, { world, authority: "skip" }),
    /relation update.*summary.*separator/i, "strict validation refuses packed relationship data");

  const structured = {
    events: alliance(),
    relationUpdates: [{
      a: "France", b: "Russia", score: 70, status: "friendly", eventIndexes: [0],
      summary: "Germany~85~friendly~,France~Germany~40~cordial~",
    }],
    agreementUpdates: [],
  };
  assert.match(validateDiplomaticLedgerPayload(structured, { world, authority: "skip" }),
    /relation update.*summary.*separator/i, "structured records have the same invariant");

  const salvaged = structuredClone(original);
  const playerNotes = [];
  const notes = salvageDiplomaticLedgerPayload(salvaged, { world, playerNotes });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /summary.*separator/i);
  assert.equal(playerNotes.length, 1, "the player is told why the relation was dropped");
  assert.match(playerNotes[0].text, /was incomplete/i, "the existing localized relation receipt is reused");
  assert.deepEqual(decodeRelationUpdates(salvaged.relationUpdates).map((entry) => [entry.a, entry.b]),
    [["France", "Germany"]], "unrelated valid updates survive");
  assert.equal(validateDiplomaticLedgerPayload(salvaged, { world, authority: "skip" }), "");

  const direct = applyDiplomaticUpdates({
    world,
    relationUpdates: original.relationUpdates,
    agreementUpdates: "",
    events: alliance(),
    stopDate: "1894-01-31",
    round: 2,
  });
  assert.deepEqual(direct.relations.map((entry) => [entry.a, entry.b]),
    [["France", "Germany"]], "direct merge cannot bypass the canonical guard");

  const persisted = { ...world, relations: [{
    id: "legacy-relation", a: "France", b: "Russia", score: 70, status: "friendly",
    summary: "Germany~85~friendly~,France~Germany~40~cordial~",
    sourceEventIds: ["e1"],
  }] };
  const restored = normalizeWorldState(persisted);
  assert.equal(restored.relations.length, 1, "keep the old relationship itself");
  assert.equal(restored.relations[0].score, 70, "keep its canonical score");
  assert.equal(restored.relations[0].summary, "", "quarantine invalid historical explanation");
  assert.deepEqual(restored.relations[0].sourceEventIds, ["e1"], "do not fabricate or rewrite event provenance");
  assert.match(persisted.relations[0].summary, /Germany~85/, "normalization never mutates the raw source");

  const baseline = buildPregameRelationBaselineRecord({
    a: "France", b: "Russia", score: 70, summary: "Germany~85~friendly~",
    world, observedDate: "1894-01-01",
  });
  assert.equal(baseline.record, null, "round-zero baseline cannot bypass the guard");
  assert.match(baseline.error, /summary.*separator/i);
});

test("bounded diplomatic context pulls a seed actor's active Puppet counterpart into attention", () => {
  const puppetWorld = {
    ...world,
    puppets: [{
      id: "german-russian-client",
      overlord: "Germany",
      puppet: "Russia",
      kind: "client",
      loyalty: 58,
      secrecy: "covert",
      status: "active",
      startedDate: "1893-01-01",
      knownTo: [],
    }],
  };

  const active = buildBoundedDiplomaticContext(puppetWorld, { playerPolity: "Germany", maxActors: 2 });
  assert.deepEqual(active.actors, ["Germany", "Russia"]);
  assert.equal(active.puppets.length, 1);
  assert.match(active.text, /Germany directs Russia/);
});

test("bounded diplomatic context shows every standing subordination, the attention actors' first", () => {
  const row = (id, overlord, puppet, status = "active") => ({
    id, overlord, puppet, kind: "client", loyalty: 40, secrecy: "covert", status, startedDate: "1890-01-01", knownTo: [],
  });
  const puppetWorld = {
    ...world,
    puppets: [
      row("far", "Britain", "Egypt"),
      row("gone", "Britain", "Portugal", "released"),
      row("near", "France", "Morocco"),
    ],
  };
  const context = buildBoundedDiplomaticContext(puppetWorld, { playerPolity: "France", maxActors: 2 });
  // Outside the attention slice, a covert client is still a client: the simulator
  // must not narrate Egypt as independent.
  assert.deepEqual(context.puppets.map((entry) => entry.id), ["near", "far"]);
  assert.match(context.text, /France directs Morocco[^]*Britain directs Egypt/);
  assert.doesNotMatch(context.text, /Portugal/);
});

test("a lifecycle change on an agreement that does not exist is refused for the GM and dropped in simulation", () => {
  const row = "phantom-pact~end~alliance~France,Russia~1~Phantom Pact~gone";
  const strict = { events: alliance(), relationUpdates: "", agreementUpdates: row };
  assert.match(validateDiplomaticLedgerPayload(strict, { world }), /Agreement phantom-pact does not exist/);

  const simulated = { events: alliance(), relationUpdates: "", agreementUpdates: row };
  assert.equal(validateDiplomaticLedgerPayload(simulated, { world, authority: "skip" }), "");
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
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world: gulf, authority: "skip" }), "");
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
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, authority: "skip" }), "");
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
    assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, authority: "skip" }), "", label);
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
  assert.equal(validateDiplomaticLedgerPayload(reversed, { world: ledger, authority: "skip" }), "");
  assert.deepEqual(agreementIds(reversed), [], "Russia guaranteeing France is a different instrument");

  const same = { events: breach(), relationUpdates: "", agreementUpdates: endRow("x", "guarantee", "France,Russia") };
  assert.equal(validateDiplomaticLedgerPayload(same, { world: ledger, authority: "skip" }), "");
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
  const error = validateDiplomaticLedgerPayload(candidate, { world: allied(), authority: "skip" });
  assert.deepEqual(agreementIds(candidate), ["new-pact", "new-pact"]);
  assert.match(error, /new-pact/);
});

test("a relation update that names an unresolvable polity is rejected", () => {
  const candidate = { events: alliance(), relationUpdates: "France~Atlantis~-40~strained~1~Dispute", agreementUpdates: "" };
  assert.match(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), /could not resolve both polities/);
});

// A model restating a pact it already recorded writes `start` again, often
// under another title: in the game's language, in its own words. The pact is
// the one recorded under that id, with those parties and of that type, whatever
// the title says: titles used to be matched by the words they shared, and two
// wordings of one treaty in Chinese, or one translated, shared none, and the
// answer was refused.
test("a pact started again is repaired by its id, parties and type, whatever its title, in every language alike", () => {
  for (const [recorded, restated] of [
    ["Franco-Russian Alliance", "Grain Trade Treaty"],
    ["Франко-русский союз", "Торговое соглашение о зерне"],
    ["Γαλλορωσική συμμαχία", "Εμπορική συμφωνία σιτηρών"],
    ["法俄同盟", "粮食贸易协定"],
    ["Franco-Russian Alliance", "Франко-русский союз"],
  ]) {
    const allied = {
      ...world,
      agreements: [{
        id: "franco-russian-alliance", title: recorded, type: "alliance", status: "active", parties: ["France", "Russia"],
        startedDate: "1894-01-04", terms: "Mutual military assistance against Germany", sourceEventIds: ["e0"],
      }],
    };
    const again = (title, { type = "alliance", parties = "France,Russia" } = {}) => ({
      events: alliance(),
      relationUpdates: "",
      agreementUpdates: `franco-russian-alliance~start~${type}~${parties}~1~${title}~Mutual military assistance against Germany`,
    });
    const repaired = again(restated);
    assert.equal(validateDiplomaticLedgerPayload(repaired, { world: allied, authority: "skip" }), "", restated);
    assert.deepEqual(agreementIds(repaired), [], `${restated}: the redundant start is dropped; the pact stands as it was`);
    // Another type, or other parties, under the same id is still a collision.
    assert.match(validateDiplomaticLedgerPayload(again(restated, { type: "trade_economic" }), { world: allied, authority: "skip" }), /franco-russian-alliance/, `${restated}: another type`);
    assert.match(validateDiplomaticLedgerPayload(again(restated, { parties: "France,Germany" }), { world: allied, authority: "skip" }), /franco-russian-alliance/, `${restated}: other parties`);
  }
});

test("a later record on the same pair replaces the score; a record tied to no event of the answer is applied, dated by the skip", () => {
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
  const pair = (a, b) => later.relations.find((relation) => [relation.a, relation.b].sort().join("|") === [a, b].sort().join("|"));
  assert.equal(later.relations.length, 2);
  assert.deepEqual([pair("France", "Russia").score, pair("France", "Russia").status], [40, "cordial"]);
  assert.deepEqual(pair("France", "Russia").sourceEventIds, ["e1"]);
  assert.deepEqual([pair("France", "Germany").score, pair("France", "Germany").lastUpdatedDate], [-60, "1895-01-31"], "the answer said it: applied, on the skip's date");
  assert.deepEqual(pair("France", "Germany").sourceEventIds, [], "and it cites no event, least of all one that is not there");
});

// "Old saves keep the relations and agreements their records hold; nothing is
// invented from prose" (2026-11-13). A save from before the ledgers had them
// seeded once from its treaty events and chats, by English words for signing
// and alliances and a table of demonyms: in any other language nothing, and in
// English an alliance read into "our alliance remains" in any letter.
test("a save's ledgers are what its records hold: nothing is read into them from its events or chats", async () => {
  assert.equal("migrateLegacyDiplomaticState" in director, false);
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.equal(gameplay.includes("withDiplomaticLedgerMigration"), false);
  assert.equal(gameplay.includes("migrateLegacyDiplomaticState"), false);
  assert.ok(gameplay.includes("const bundle = await readGameStateBundle({ force: true });"), "the skip reads the save as it is");
  // An old save's world, its ledgers empty: they stay empty until a record says otherwise.
  const old = normalizeWorldState({ ...world, diplomaticLedgerVersion: 0 });
  assert.deepEqual([old.relations, old.agreements], [[], []]);
  const { text } = buildBoundedDiplomaticContext(old, { playerPolity: "France" });
  assert.match(text, /No tracked bilateral relation among these attention actors\./);
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
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), "");
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
  assert.equal(validateDiplomaticLedgerPayload(consistent, { world, authority: "skip" }), "");
  assert.equal(decodeRelationUpdates(consistent.relationUpdates)[0].score, -35);

  const oneBandOff = {
    events,
    relationUpdates: ["Russia~France~-25~strained~1~Cooling."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(oneBandOff, { world, authority: "skip" }), "");
  assert.equal(decodeRelationUpdates(oneBandOff.relationUpdates)[0].score, -25, "an adjacent band is the model's call, not a contradiction");

  const midpoint = {
    events,
    relationUpdates: ["Russia~France~10~hostile~1~Expulsions."],
    agreementUpdates: [],
  };
  assert.equal(validateDiplomaticLedgerPayload(midpoint, { world, authority: "skip" }), "");
  assert.equal(midpoint.relationUpdates[0].score, -75, "when a sign flip does not explain it, the declared band's midpoint does");
  assert.equal(midpoint.relationUpdates[0].status, "hostile");
});

// The salvage pass, from a beta jump on 2026-09-21: twenty events and one
// agreement start whose second party was not on the map. The strict validator
// rejects the whole answer (and legacy mode's one retry earns its keep there);
// under salvage-first the row goes, the month stays, and the receipt says so.
test("on the salvage pass a malformed ledger row is dropped and said, not fatal", () => {
  const events = alliance();
  const candidate = {
    events,
    relationUpdates: "France~Russia~70~friendly~1~Alliance concluded\nFrance~Atlantis~-40~hostile~1~A quarrel with nobody",
    agreementUpdates: "franco-russian-alliance~start~alliance~France,Russia~1~Franco-Russian Alliance~Mutual assistance\n"
      + "eu-turkey-statement~start~treaty~Turkey,European Union~1~EU-Turkey Statement~Migration\n"
      + "phantom-pact~end~treaty~France,Germany~1~Phantom Pact~",
  };
  const strict = JSON.parse(JSON.stringify(candidate));
  assert.match(validateDiplomaticLedgerPayload(strict, { world, authority: "skip" }), /could not resolve both polities/, "strict: still fatal, naming the row");

  const playerNotes = [];
  const notes = salvageDiplomaticLedgerPayload(candidate, { world, playerNotes });
  assert.deepEqual(notes, [
    "Relation update France ↔ Atlantis was dropped: \"Atlantis\" is not a polity on this map.",
    "Agreement phantom-pact end was dropped: no agreement \"phantom-pact\" exists to end.",
    "Agreement eu-turkey-statement start was dropped: fewer than two of its parties are polities on this map.",
  ]);
  // The player's sentence for each, at the same index (I278).
  assert.deepEqual(playerNotes.map((note) => note.text), [
    "The change in relations between France and Atlantis was not recorded: Atlantis is not a country on this map.",
    "A change to the agreement \"Phantom Pact\" was not recorded: no such agreement exists.",
    "The agreement \"EU-Turkey Statement\" was not recorded: fewer than two of its parties are countries on this map.",
  ]);
  assert.equal(typeof candidate.relationUpdates, "string", "rewritten in the form it arrived");
  assert.equal(candidate.relationUpdates.split("\n").length, 1, "the good relation stays");
  assert.equal(candidate.agreementUpdates.split("\n").length, 1, "the good agreement stays");
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), "", "and what is left validates without a retry");
});

test("on the salvage pass a relation with a blank side is told to the player without a name", () => {
  const candidate = { events: alliance(), relationUpdates: [{ a: "France", b: "", score: 10, status: "friendly" }], agreementUpdates: "" };
  const playerNotes = [];
  const notes = salvageDiplomaticLedgerPayload(candidate, { world, playerNotes });
  assert.equal(notes.length, 1);
  assert.deepEqual(playerNotes.map((note) => note.text), [
    "A change in relations was not recorded: it did not name both of its sides.",
  ]);
});

// Salvage runs BEFORE the validator on the final attempt (the only attempt
// while requests are saved), and it used to drop exactly the rows the
// validator's lifecycle repairs exist to fix: the pact the story ended stayed
// active, and a re-signed or re-negotiated one lost its change.
test("on the salvage pass the lifecycle repairs run before anything is dropped", () => {
  const salvaged = (ledger, agreementUpdates) => {
    const candidate = { events: breach(), relationUpdates: "", agreementUpdates };
    assert.deepEqual(salvageDiplomaticLedgerPayload(candidate, { world: ledger }), [], "nothing dropped");
    assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, authority: "skip" }), "");
    return decodeAgreementUpdates(candidate.agreementUpdates);
  };

  const reaimed = salvaged(allied(), endRow("dual-alliance-pact", "alliance", "Russia,France"));
  assert.deepEqual(reaimed.map((update) => [update.id, update.op]), [["franco-russian-alliance", "end"]], "an end on an invented id is re-aimed");

  const suspended = allied([{ ...allied().agreements[0], status: "suspended" }]);
  const resumed = salvaged(suspended, "franco-russian-alliance~start~alliance~France,Russia~1~Franco-Russian Alliance~Mutual military assistance against Germany");
  assert.deepEqual(resumed.map((update) => update.op), ["resume"], "re-signing a suspended pact resumes it");

  const updated = salvaged(allied(), "franco-russian-alliance~start~alliance~France,Russia~1~Franco-Russian Alliance~Mutual assistance extended to Austria-Hungary");
  assert.deepEqual(updated.map((update) => update.op), ["update"], "restating an active pact with new terms updates it");
});

test("the salvage pass leaves a clean answer exactly as it was", () => {
  const candidate = {
    events: alliance(),
    relationUpdates: [{ a: "France", b: "Russia", score: 70, status: "friendly", eventIndexes: [0], summary: "Alliance" }],
    agreementUpdates: [{ id: "franco-russian-alliance", op: "start", type: "alliance", parties: ["France", "Russia"], eventIndexes: [0], title: "Franco-Russian Alliance", terms: "" }],
  };
  const before = JSON.stringify(candidate);
  assert.deepEqual(salvageDiplomaticLedgerPayload(candidate, { world }), []);
  assert.equal(JSON.stringify(candidate), before, "objects stay objects, untouched");
});

// What a small model writes where it has nothing to report: a heading and a
// sentence, in its own language, where the prompt asks for an empty string (a
// player's log has the war ledger's: "### Обновления войн:" and "Нет
// изменений. …"). A line with no ~ in it is not a record. Read as one, it was
// a relation between that sentence and nobody.
test("a line with no separator is prose, not a relation or an agreement", () => {
  const heading = "### Обновления отношений:";
  const nothing = "Нет изменений. В этом периоде отношения не изменились.";
  const prose = `${heading}\n${nothing}`;
  assert.deepEqual(decodeRelationUpdates(prose), []);
  assert.deepEqual(decodeRelationUpdates([heading, nothing]), [], "nor as members of a list");
  assert.deepEqual(decodeAgreementUpdates(prose), []);
  assert.deepEqual(decodeAgreementUpdates([heading, nothing]), []);

  // Refused the whole answer on a strict pass: 'could not resolve both
  // polities: "### Обновления отношений:" / ""'.
  const strict = { events: alliance(), relationUpdates: prose, agreementUpdates: prose };
  assert.equal(validateDiplomaticLedgerPayload(strict, { world, authority: "skip" }), "");
  // And on the salvage pass was dropped by name, into the next prompt.
  const salvaged = { events: alliance(), relationUpdates: prose, agreementUpdates: prose };
  assert.deepEqual(salvageDiplomaticLedgerPayload(salvaged, { world }), []);

  // Around real records it costs them nothing.
  const mixed = {
    events: alliance(),
    relationUpdates: `${heading}\nFrance~Russia~70~friendly~1~Alliance concluded\n${nothing}`,
    agreementUpdates: "",
  };
  assert.equal(validateDiplomaticLedgerPayload(mixed, { world, authority: "skip" }), "");
  assert.deepEqual(decodeRelationUpdates(mixed.relationUpdates).map((update) => [update.a, update.b, update.score]), [["France", "Russia", 70]]);

  // A line that has the separator and names nobody is still a record, and refused.
  const bad = { events: alliance(), relationUpdates: "France~Atlantis~-40~strained~1~Dispute", agreementUpdates: "" };
  assert.match(validateDiplomaticLedgerPayload(bad, { world, authority: "skip" }), /could not resolve both polities/);
});

// A game played in another language: the map's polities keep their names and
// carry the player's as aliases, and every title, summary and event is written
// in that language. The words these checks compare were cut to a-z and 0-9, so
// such text had none.
const russianWorld = {
  ...world,
  polityOverrides: {
    France: { code: "France", name: "France", aliases: ["Франция"] },
    Russia: { code: "Russia", name: "Russia", aliases: ["Россия"] },
    Germany: { code: "Germany", name: "Germany", aliases: ["Германия"] },
  },
};
const russianEvents = () => [
  { id: "e1", date: "1894-01-03", title: "Германия спустила на воду новый броненосец", description: "В Киле спущен на воду броненосец.", kind: "military" },
  { id: "e2", date: "1894-01-04", title: "Франция и Россия заключили военную конвенцию", description: "Париж и Петербург подписали конвенцию о взаимной военной помощи.", kind: "diplomacy" },
];

// The English twin of the same month.
const englishEvents = () => [
  { id: "e1", date: "1894-01-03", title: "Germany launches a new battleship", description: "A battleship is launched at Kiel.", kind: "military" },
  { id: "e2", date: "1894-01-04", title: "France and Russia conclude a military convention", description: "Paris and St Petersburg sign a convention of mutual military assistance.", kind: "diplomacy" },
];

// What a skip's relation and agreement lines come to, from its answer to the world.
const skipOutcome = (ledger, events, { relationUpdates = "", agreementUpdates = "", puppetUpdates = "" } = {}) => {
  const candidate = { events, relationUpdates, agreementUpdates, puppetUpdates };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world: ledger, authority: "skip" }), "");
  const merge = applyDiplomaticUpdates({
    world: ledger,
    relationUpdates: candidate.relationUpdates,
    agreementUpdates: candidate.agreementUpdates,
    puppetUpdates: candidate.puppetUpdates,
    events,
    stopDate: "1894-01-31",
    round: 5,
  });
  return {
    relations: merge.relations.map((relation) => [relation.a, relation.b, relation.score, relation.lastUpdatedDate, relation.sourceEventIds]),
    agreements: merge.agreements.map((agreement) => [agreement.id, agreement.status, agreement.startedDate, agreement.sourceEventIds]),
  };
};

// A record with no event number was tied to the one event whose words shared
// most with its own, and dropped when none did: in Russian, with names the
// event never spelled the map's way, nearly always. It is the skip's record,
// tied to no event: applied, on the skip's date.
test("a relation or agreement record with no event number is applied, dated by the skip, in every language alike", () => {
  const lines = {
    relationUpdates: "France~Russia~70~friendly~~Военная конвенция подписана",
    agreementUpdates: "franco-russian-convention~start~military_cooperation~France,Russia~~Франко-русская военная конвенция~Взаимная военная помощь",
  };
  const english = {
    relationUpdates: "France~Russia~70~friendly~~Military convention signed",
    agreementUpdates: "franco-russian-convention~start~military_cooperation~France,Russia~~Franco-Russian Military Convention~Mutual military assistance",
  };
  const russian = skipOutcome(russianWorld, russianEvents(), lines);
  assert.deepEqual(russian, {
    relations: [["France", "Russia", 70, "1894-01-31", []]],
    agreements: [["franco-russian-convention", "active", "1894-01-31", []]],
  });
  assert.deepEqual(skipOutcome(world, englishEvents(), english), russian, "the English twin, exactly the same");
});

// The events a record names are the authority (ledgerPins.js pins them while
// the numbers still mean what the model meant). The words of another event
// never move it there.
test("a skip's record keeps the event it named, whatever another event's words say", () => {
  const named = (ledger, events) => skipOutcome(ledger, events, {
    // Named: the battleship (1). The convention (2) is the event its words match.
    relationUpdates: "France~Russia~70~friendly~1~Военная конвенция подписана",
    agreementUpdates: "franco-russian-convention~start~military_cooperation~France,Russia~1~Франко-русская военная конвенция~Взаимная военная помощь",
  });
  const russian = named(russianWorld, russianEvents());
  assert.deepEqual(russian.relations.map((row) => row[4]), [["e1"]]);
  assert.deepEqual(russian.agreements.map((row) => [row[2], row[3]]), [["1894-01-03", ["e1"]]], "and is dated by it");
  assert.deepEqual(named(world, englishEvents()), russian);
});

// The title is not what makes an agreement the one on record: its id, its
// parties and its type are, the same in every language.
test("an agreement started again under its id is an update whatever language its title is in, and another instrument is not", () => {
  const signed = (title) => ({
    ...russianWorld,
    agreements: [{ id: "franco-russian-alliance", title, type: "alliance", status: "active", parties: ["France", "Russia"], startedDate: "1894-01-04", terms: "Взаимная военная помощь против Германии" }],
  });
  const restated = (title, ledger, type = "alliance") => {
    const candidate = {
      events: russianEvents(),
      relationUpdates: "",
      agreementUpdates: `franco-russian-alliance~start~${type}~France,Russia~2~${title}~Взаимная помощь распространена на Австро-Венгрию`,
    };
    const error = validateDiplomaticLedgerPayload(candidate, { world: ledger, authority: "skip" });
    return error || decodeAgreementUpdates(candidate.agreementUpdates).map((update) => update.op).join(",");
  };

  for (const [recorded, title] of [
    ["Франко-русский союз", "Франко-русский военный союз 1894 года"],
    ["Франко-русский союз", "Договор о торговле зерном"],
    ["法俄同盟", "粮食贸易协定"],
    ["Franco-Russian Alliance", "Grain Trade Treaty"],
    ["Franco-Russian Alliance", "Франко-русский союз"],
  ]) {
    assert.equal(restated(title, signed(recorded)), "update", `${recorded} / ${title}`);
    assert.match(restated(title, signed(recorded), "trade_economic"), /already exists; use update/, `${recorded} / ${title}: another type`);
  }
});

test("chat deals become agreements, and an agreement's due terms are carried out (#798)", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  // The rules, stated once in the skip's static part (buildJumpStaticRules), and the directive that points at them.
  const directive = gameplay.slice(gameplay.indexOf("const diplomaticLedgerRules"), gameplay.indexOf("const IDLE_RELATION_DECISION_MODEL"));
  assert.match(directive, /\$\{rulesAbove \? `Relations, agreements and client states are recorded as \$\{DIPLOMATIC_LEDGER_RULES_HEADING\} above says\.` : diplomaticLedgerRules\(playerName\)\}/);
  assert.match(directive, /A deal both sides accepted in a chat is an agreement from the moment it is made/);
  assert.match(directive, /The terms of an active agreement are commitments/);
  assert.match(directive, /an impacts\.regionTransfers entry for land/);
  assert.match(directive, /an agreementUpdates start records it, naming by number the event that reports it/);
  const { buildBoundedDiplomaticContext } = await import("./nativeDiplomaticDirector.js");
  const terms = `Timor-Leste joins the Indonesian Federation on 1 March 2027 after a referendum. ${"Detail. ".repeat(100)}`;
  const text = buildBoundedDiplomaticContext({
    agreements: [{ id: "idn-tls-federation", title: "Federation Treaty", type: "other", status: "active", parties: ["Indonesia", "Timor-Leste"], terms }],
  }, { playerPolity: "Indonesia" }).text;
  assert.match(text, /terms: Timor-Leste joins the Indonesian Federation on 1 March 2027/);
  assert.ok(text.includes(terms.slice(0, 600).trim()) && !text.includes(terms.slice(0, 640)), "terms are shown up to 600 characters");
});

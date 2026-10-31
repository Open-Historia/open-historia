/*! Open Historia — political parties tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/politics.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  IDEOLOGIES,
  MAX_PARTIES,
  applyPartyOps,
  describePoliticsForPrompt,
  electionDue,
  leadersAfterGovernmentChange,
  findIdeology,
  isListedSubideology,
  normalizePartyOp,
  normalizePoliticalLandscape,
  normalizePolitics,
} from "./politics.js";
import { getGameplayTool, validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";
import { normalizeWorldState } from "./gameState.js";

const defaults = JSON.parse(fs.readFileSync(new URL("../Game/AI/defaultPrompts.json", import.meta.url), "utf8"));

const party = (overrides = {}) => ({
  nameEn: "Croatian Democratic Union",
  nameNative: "Hrvatska demokratska zajednica",
  abbrEn: "CDU",
  abbrNative: "HDZ",
  ideology: "Social Conservatism",
  subideology: "Christian Democracy",
  leader: "Ivan Horvat",
  role: "governing",
  seats: 66,
  support: 34,
  ...overrides,
});

test("the ten KX ideologies, each with its own subideology list", () => {
  assert.equal(IDEOLOGIES.length, 10);
  for (const ideology of IDEOLOGIES) {
    assert.match(ideology.colour, /^#[0-9a-f]{6}$/);
    assert.ok(ideology.subideologies.length > 50, `${ideology.name} has its list`);
    assert.ok(!ideology.subideologies.some((name) => /removed ideologies/i.test(name)));
  }
  assert.equal(findIdeology("Paternal Autocracy")?.id, "paternalAutocracy");
  assert.equal(findIdeology("paternalautocracy")?.id, "paternalAutocracy");
});

test("a subideology counts only under its own ideology", () => {
  assert.ok(isListedSubideology("Authoritarian Democracy", "Ustaše"));
  assert.ok(!isListedSubideology("Paternal Autocracy", "Ustaše"));
  assert.ok(isListedSubideology("totalism", "bordigism"), "case does not matter");
});

test("parties are cleaned, coloured by ideology when they carry no colour, and sorted by role then size", () => {
  const entry = normalizePoliticalLandscape({
    government: "Constitutional monarchy",
    headOfState: "King Tomislav III",
    legislatureSeats: 151,
    parties: [
      party({ nameEn: "Small Opposition", role: "opposition", seats: 10, colour: "nope" }),
      party({ nameEn: "Banned Party", role: "banned", seats: 0 }),
      party({ nameEn: "Big Opposition", role: "opposition", seats: 40 }),
      party(),
      party({ nameEn: "", nameNative: "" }),
      party({ nameEn: "Odd Role", role: "kingmaker", ideology: "Monarchism", seats: 5 }),
    ],
  });
  assert.deepEqual(entry.parties.map((p) => p.nameEn), ["Croatian Democratic Union", "Big Opposition", "Small Opposition", "Odd Role", "Banned Party"]);
  assert.equal(entry.parties[2].colour, findIdeology("Social Conservatism").colour);
  assert.equal(entry.parties[3].role, "opposition");
  assert.equal(entry.parties[3].ideology, "", "an ideology outside the ten is left unclassified");
  assert.equal(entry.kind, "parties");
  assert.equal(entry.legislatureSeats, 151);
});

test("empty readings are dropped, and the party count is capped", () => {
  assert.equal(normalizePoliticalLandscape({ parties: [] }), null);
  const many = normalizePoliticalLandscape({ government: "Republic", parties: Array.from({ length: 30 }, (_, i) => party({ nameEn: `P${i}` })) });
  assert.equal(many.parties.length, MAX_PARTIES);
  assert.deepEqual(normalizePolitics({ "": { government: "x" }, Illyria: { parties: [] }, Ruritania: { government: "Duchy" } }), {
    Ruritania: normalizePoliticalLandscape({ government: "Duchy" }),
  });
});

test("the world keeps world.politics through normalization", () => {
  const world = normalizeWorldState({ politics: { Illyria: { government: "Kingdom", parties: [party()] } } });
  assert.equal(world.politics.Illyria.parties[0].abbrNative, "HDZ");
  assert.deepEqual(normalizeWorldState({}).politics, {});
});

test("the task has a default prompt and a tool, and its schema takes a full answer", () => {
  assert.match(defaults.tasks.politicalLandscape, /\$\{targetPolity\}/);
  assert.match(defaults.tasks.politicalLandscape, /factions/);
  assert.equal(getGameplayTool("politicalLandscape")?.name, "submit_political_landscape");
  const answer = {
    government: "Constitutional monarchy",
    headOfState: "King Tomislav III",
    kind: "parties",
    parties: [{ ...party(), colour: "", founded: "1989", description: "" }],
  };
  assert.equal(validateGameplayPayload("politicalLandscape", answer).valid, true);
  assert.equal(validateGameplayPayload("politicalLandscape", { ...answer, parties: [{ ...party(), ideology: "Monarchism" }] }).valid, false);
});

test("a turn's party ops move only compiled lists, by name or abbreviation", () => {
  const politics = normalizePolitics({ Illyria: { government: "Kingdom", headOfGovernment: "PM A", legislatureSeats: 151, parties: [party(), party({ nameEn: "Social Democrats", nameNative: "Socijaldemokrati", abbrNative: "SDP", abbrEn: "SDP", role: "opposition", seats: 56 })] } });
  const { politics: next, applied, rejected } = applyPartyOps(politics, [
    { polity: "illyria", op: "update", party: "HDZ", changes: { role: "opposition", seats: 40, leader: "New Leader" } },
    { polity: "Illyria", op: "update", party: "Social Democrats", changes: { role: "governing", seats: 80 } },
    { polity: "Illyria", op: "government", changes: { headOfGovernment: "PM B", nextElection: "1940" } },
    { polity: "Illyria", op: "add", changes: { nameEn: "Peasant Party", nameNative: "Seljačka stranka", ideology: "Social Liberalism", subideology: "Agrarianism", leader: "C", role: "opposition", seats: 10, support: 8 } },
    { polity: "Illyria", op: "add", changes: { nameEn: "Peasant Party" } },
    { polity: "Illyria", op: "remove", party: "Nobody" },
    { polity: "Ruritania", op: "update", party: "X", changes: { leader: "Y" } },
    { polity: "Illyria", op: "explode" },
  ], { date: "1936-05-01" });
  assert.equal(applied.length, 4);
  assert.equal(rejected.length, 4);
  const entry = next.Illyria;
  assert.deepEqual(entry.parties.map((p) => p.nameEn), ["Social Democrats", "Croatian Democratic Union", "Peasant Party"]);
  assert.equal(entry.parties[1].leader, "New Leader");
  assert.equal(entry.headOfGovernment, "PM B");
  assert.equal(entry.nextElection, "1940");
  assert.equal(entry.asOf, "1936-05-01");
  assert.equal(politics.Illyria.parties[0].nameEn, "Croatian Democratic Union", "the input is not mutated");

  const removed = applyPartyOps(next, [{ polity: "Illyria", op: "remove", party: "Peasant Party" }]).politics;
  assert.equal(removed.Illyria.parties.length, 2);
});

test("party ops survive event normalization, and the turn prompt lists only compiled polities", () => {
  assert.equal(normalizePartyOp({ polity: "Illyria", op: "update", party: "HDZ", changes: { leader: "X", bogus: 1 } }).changes.bogus, undefined);
  assert.equal(normalizePartyOp({ polity: "Illyria", op: "update", changes: { leader: "X" } }), null, "an update names its party");
  assert.equal(describePoliticsForPrompt({}), "");
  const block = describePoliticsForPrompt(normalizePolitics({ Illyria: { government: "Kingdom", parties: [party()] } }));
  assert.match(block, /^\[Political Parties\]/);
  assert.match(block, /Croatian Democratic Union \/ Hrvatska demokratska zajednica \(CDU \/ HDZ\): Governing, Social Conservatism \/ Christian Democracy/);
  assert.match(block, /renamed party .* all four new names/);
  const renamed = applyPartyOps(normalizePolitics({ Illyria: { government: "Kingdom", parties: [party()] } }), [
    { polity: "Illyria", op: "update", party: "HDZ", changes: { nameEn: "Croatian Union", nameNative: "Hrvatska zajednica", abbrEn: "CU", abbrNative: "HZ" } },
  ]).politics.Illyria.parties[0];
  assert.deepEqual([renamed.nameEn, renamed.nameNative, renamed.abbrEn, renamed.abbrNative], ["Croatian Union", "Hrvatska zajednica", "CU", "HZ"]);
  const answer = { events: [] };
  assert.equal(validateGameplayPayload("politicalLandscape", answer).valid, false);
});

test("an election is due when its date has come, read from free text", () => {
  assert.equal(electionDue("2028", "2026-01-05"), "");
  assert.equal(electionDue("2026", "2026-01-05"), "this year");
  assert.equal(electionDue("by September 2025", "2026-01-05"), "overdue");
  assert.equal(electionDue("2026-03-15", "2026-01-05"), "this year");
  assert.equal(electionDue("2026-01-05", "2026-01-05"), "overdue");
  assert.equal(electionDue("1940-11", "1940-12-01"), "overdue");
  assert.equal(electionDue("none scheduled", "2026-01-05"), "");
  const block = describePoliticsForPrompt(normalizePolitics({ Illyria: { government: "Kingdom", nextElection: "1935", parties: [party()] } }), { date: "1936-05-01" });
  assert.match(block, /Illyria: Kingdom; next election 1935 — ELECTION DUE NOW: hold it in this turn/);
  assert.match(block, /An election whose date falls in the period you write is held in it/);
});

test("the stat sheet's leader follows a change of government, and only the one replaced", () => {
  const before = { Illyria: { headOfGovernment: "Ivan Horvat, Prime Minister", headOfState: "King Tomislav III" } };
  const after = { Illyria: { headOfGovernment: "Ana Kovač, Prime Minister", headOfState: "King Tomislav III" } };
  const plain = leadersAfterGovernmentChange(before, after, { Illyria: { leader: "Ivan Horvát", stability: 60 } });
  assert.deepEqual(plain.countryStats.Illyria, { leader: "Ana Kovač", stability: 60 });
  assert.deepEqual(plain.changed, [{ polity: "Illyria", from: "Ivan Horvát", to: "Ana Kovač" }]);
  const titled = leadersAfterGovernmentChange(before, after, { Illyria: { leader: "Ivan Horvat, Prime Minister" } });
  assert.equal(titled.countryStats.Illyria.leader, "Ana Kovač, Prime Minister");
  const monarch = leadersAfterGovernmentChange(before, after, { Illyria: { leader: "King Tomislav III" } });
  assert.deepEqual(monarch.changed, [], "a sheet naming the king is left alone");
  const custom = leadersAfterGovernmentChange(before, after, { Illyria: { customStats: { stability: 60 } } });
  assert.deepEqual(custom.changed, [], "a custom sheet has no leader");
});

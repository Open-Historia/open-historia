/*! Open Historia — political parties tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/politics.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  IDEOLOGIES,
  MAX_PARTIES,
  describeElectionsDue,
  electionDue,
  findIdeology,
  isListedSubideology,
  normalizePoliticalLandscape,
  normalizePolitics,
} from "./politics.js";
import { GAMEPLAY_TOOLS, getGameplayTool, normalizeGameplayPayload, validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";
import { normalizeWorldState } from "./gameState.js";
import { applyPoliticalActorOperation } from "./politicalActorOps.js";
import { foldLandscapeIntoActor } from "./politicalLandscapeFold.js";
import { buildPublicPoliticalView } from "./politicalKnowledge.js";

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

// "add the new politics thing into the political world and just make it an enhancement of that ... make sure to
// fully integrate it" (the owner, 2026-11-03): one record of a polity's parties, the Political World's.
test("an old save's world.politics is folded into its Political World once, and is gone", () => {
  const world = normalizeWorldState({
    politicalActors: { byPolity: { Illyria: { polityKey: "Illyria", government: { form: "Kingdom" }, parties: [{ id: "hdz", name: "Croatian Democratic Union", shortName: "CDU", publicDescription: "The old party of government." }] } } },
    politics: { illyria: { government: "Kingdom", legislature: "Sabor", legislatureSeats: 151, nextElection: "1938", parties: [party(), party({ nameEn: "Social Democrats", nameNative: "Socijaldemokrati", abbrEn: "SDP", abbrNative: "SDP", role: "opposition", seats: 56, support: 25 })] } },
  });
  assert.equal("politics" in world, false);
  const actor = world.politicalActors.byPolity.Illyria;
  // The party the record had keeps its id and what it said, and takes the compiled figures.
  const hdz = actor.parties.find((entry) => entry.id === "hdz");
  assert.deepEqual([hdz.nameNative, hdz.shortNameNative, hdz.ideologyFamily, hdz.subideology, hdz.seats, hdz.support.percent, hdz.publicDescription], ["Hrvatska demokratska zajednica", "HDZ", findIdeology("Social Conservatism").id, "Christian Democracy", 66, 34, "The old party of government."]);
  assert.equal(hdz.ruling, true, "the governing party governs");
  // One it did not have is added.
  assert.equal(actor.parties.find((entry) => entry.name === "Social Democrats")?.seats, 56);
  assert.deepEqual([actor.government.form, actor.government.legislature, actor.government.legislatureSeats, actor.government.nextElection], ["Kingdom", "Sabor", 151, "1938"]);
  // Read again, nothing changes.
  assert.deepEqual(normalizeWorldState(world).politicalActors, world.politicalActors);
  assert.equal("politics" in normalizeWorldState({}), false);
  // And the public view carries it all, as the Politics view and other players read it.
  const view = buildPublicPoliticalView(world, "Illyria");
  const shown = view.parties.find((entry) => entry.name === "Croatian Democratic Union");
  assert.deepEqual([shown.nameNative, shown.shortNameNative, shown.subideology, shown.seats], ["Hrvatska demokratska zajednica", "HDZ", "Christian Democracy", 66]);
  assert.deepEqual([view.government.legislature, view.government.legislatureSeats, view.government.nextElection], ["Sabor", 151, "1938"]);
});

test("a compiled reading of one polity fills in its Political World record, or makes one", () => {
  const made = foldLandscapeIntoActor(null, { government: "Kingdom", headOfState: "King Tomislav III", parties: [party()] }, { polityKey: "Illyria" });
  assert.equal(made.polityKey, "Illyria");
  assert.equal(made.government.headOfState, "King Tomislav III");
  assert.deepEqual(made.government.rulingParties, ["Croatian Democratic Union"]);
  assert.equal(foldLandscapeIntoActor(null, null), null, "nothing read, nothing made");
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

test("a turn moves the parties with the Political World's own ops: seats, roles, native names, a party dissolved", () => {
  const world = normalizeWorldState({ politicalActors: { byPolity: { Illyria: { polityKey: "Illyria", government: { rulingPartyIds: ["hdz"] }, parties: [{ id: "hdz", name: "Croatian Democratic Union" }, { id: "sdp", name: "Social Democrats" }] } } } });
  const updated = applyPoliticalActorOperation(world, { op: "update-party", polityKey: "Illyria", partyId: "sdp", patch: { seats: 80, nameNative: "Socijaldemokrati", role: "opposition" } });
  assert.equal(updated.applied, true);
  assert.deepEqual(["seats", "nameNative", "role"].map((key) => updated.actor.parties.find((entry) => entry.id === "sdp")[key]), [80, "Socijaldemokrati", "opposition"]);
  const government = applyPoliticalActorOperation(world, { op: "set-government", polityKey: "Illyria", patch: { legislature: "Sabor", legislatureSeats: 151, nextElection: "1940" } });
  assert.deepEqual([government.actor.government.legislature, government.actor.government.legislatureSeats, government.actor.government.nextElection], ["Sabor", 151, "1940"]);
  const dissolved = applyPoliticalActorOperation(world, { op: "dissolve-party", polityKey: "Illyria", partyId: "hdz" });
  assert.deepEqual(dissolved.actor.parties.map((entry) => entry.id), ["sdp"]);
  assert.deepEqual(dissolved.actor.government.rulingPartyIds, [], "and it governs no more");
  assert.match(applyPoliticalActorOperation(world, { op: "dissolve-party", polityKey: "Illyria" }).error, /requires partyId/);
});

test("no tool asks for the Politics tab's own party ops, and an answer that still carries them is not refused", () => {
  for (const [key, tool] of Object.entries(GAMEPLAY_TOOLS)) assert.ok(!JSON.stringify(tool.schema).includes("partyOps"), key);
  const event = { date: "1936-01-02", title: "An election", description: "The vote is held.", impacts: { partyOps: [{ polity: "France", op: "update", party: "SFIO", changes: { seats: 149 } }] } };
  const shaped = normalizeGameplayPayload("jumpForward", { events: [event], summary: "x", stopDate: "1936-01-08" });
  assert.equal("partyOps" in shaped.events[0].impacts, false);
  assert.ok(!/partyOps/.test(String(validateGameplayPayload("jumpForward", shaped).error ?? "")));
});

test("an election is due when its date has come, read from free text, and the time skip is told the Political World's", () => {
  assert.equal(electionDue("2028", "2026-01-05"), "");
  assert.equal(electionDue("2026", "2026-01-05"), "this year");
  assert.equal(electionDue("by September 2025", "2026-01-05"), "overdue");
  assert.equal(electionDue("2026-03-15", "2026-01-05"), "this year");
  assert.equal(electionDue("2026-01-05", "2026-01-05"), "overdue");
  assert.equal(electionDue("1940-11", "1940-12-01"), "overdue");
  assert.equal(electionDue("none scheduled", "2026-01-05"), "");
  const actors = { byPolity: { Illyria: { government: { legislature: "Sabor", legislatureSeats: 151, nextElection: "1935" } }, Ruritania: { government: { nextElection: "1940" } } } };
  const block = describeElectionsDue(actors, { date: "1936-05-01" });
  assert.match(block, /^\[Elections Due\]/);
  assert.match(block, /- Illyria: Sabor \(151 seats\), next election 1935: due now, hold it in this answer/);
  assert.doesNotMatch(block, /Ruritania/);
  assert.match(block, /update-party with each party's new seats/);
  assert.equal(describeElectionsDue({ byPolity: {} }, { date: "1936-05-01" }), "");
});

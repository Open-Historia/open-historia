/*! Open Historia — puppet visibility tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/puppets.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { describePuppetBriefing, livePuppetsFor, loyaltyBand, puppetBriefingFor, visiblePuppetsFor } from "./puppets.js";

// One field, different rows per viewer - the same problem chatVisibility.js
// solves for transcripts. What separates the two: a chat filters on
// PARTICIPATION, answerable from data already present, while a puppet filters
// on ACQUIRED KNOWLEDGE, which accumulates over time and can go stale.

const world = (rows) => ({ puppets: rows });

const openSatellite = {
  id: "p1",
  overlord: "USSR",
  puppet: "Poland",
  kind: "satellite",
  loyalty: 40,
  secrecy: "open",
  knownTo: [],
  status: "active",
  startedDate: "1945-06-28",
};

const covertClient = {
  id: "p2",
  overlord: "USSR",
  puppet: "Finland",
  kind: "client",
  loyalty: 70,
  secrecy: "covert",
  knownTo: [{ polity: "United Kingdom", learnedDate: "1948-03-02" }],
  status: "active",
  startedDate: "1947-11-01",
};

test("an Overlord sees its own Puppet with a Loyalty band", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "USSR");
  assert.equal(row.role, "overlord");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyaltyBand, "Restless");
  assert.equal(row.loyalty, 40);
});

test("a Puppet sees who its Overlord is, but never its own Loyalty", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "Poland");
  assert.equal(row.role, "puppet");
  assert.equal(row.overlord, "USSR");
  assert.equal(row.loyalty, null);
  assert.equal(row.loyaltyBand, null);
});

test("an open Puppet is visible to a third party, without Loyalty", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "United Kingdom");
  assert.equal(row.role, "foreign");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, null);
  assert.equal(row.loyaltyBand, null);
  assert.equal(row.fromIntelligence, false);
});

test("a covert Puppet is invisible to a third party that has not learned it", () => {
  assert.deepEqual(visiblePuppetsFor(world([covertClient]), "France"), []);
});

test("a covert Puppet learned by a third party carries the date it was learned", () => {
  const [row] = visiblePuppetsFor(world([covertClient]), "United Kingdom");
  assert.equal(row.puppet, "Finland");
  assert.equal(row.fromIntelligence, true);
  assert.equal(row.asOf, "1948-03-02");
  assert.equal(row.loyalty, null);
});

test("Loyalty is withheld even on an open Puppet, from everyone but the Overlord", () => {
  const rows = ["Poland", "United Kingdom", "France"]
    .map((viewer) => visiblePuppetsFor(world([openSatellite]), viewer)[0])
    .filter(Boolean);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.loyalty, null);
});

test("a covert relationship that ended still reads as live to whoever learned it", () => {
  const ended = { ...covertClient, status: "released", endedDate: "1953-04-10" };
  const [stale] = visiblePuppetsFor(world([ended]), "United Kingdom");
  assert.equal(stale.status, "active", "the believed state, not the true one");
  assert.equal(stale.asOf, "1948-03-02");

  const [truth] = visiblePuppetsFor(world([ended]), "USSR");
  assert.equal(truth.status, "released", "the Overlord knows what it did");
});

test("an open relationship that ended is ended for everyone", () => {
  const ended = { ...openSatellite, status: "revolted", endedDate: "1956-10-23" };
  for (const viewer of ["USSR", "Poland", "United Kingdom"]) {
    assert.equal(visiblePuppetsFor(world([ended]), viewer)[0].status, "revolted");
  }
});

test("livePuppetsFor drops what is over, and keeps what a viewer wrongly believes", () => {
  const rows = [
    { ...openSatellite, status: "revolted" },
    { ...covertClient, status: "released" },
  ];
  assert.deepEqual(livePuppetsFor(world(rows), "USSR"), []);
  assert.deepEqual(livePuppetsFor(world(rows), "United Kingdom").map((row) => row.puppet), ["Finland"]);
});

test("viewer matching ignores case and surrounding space", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "  ussr  ");
  assert.equal(row.role, "overlord");
});

test("a knownTo entry written as a bare name still grants sight", () => {
  const legacy = { ...covertClient, knownTo: ["United Kingdom"] };
  const [row] = visiblePuppetsFor(world([legacy]), "United Kingdom");
  assert.equal(row.fromIntelligence, true);
  assert.equal(row.asOf, "");
});

test("no viewer, no rows - an unknown viewer is not a licence to see secrets", () => {
  assert.deepEqual(visiblePuppetsFor(world([covertClient]), ""), []);
  assert.deepEqual(visiblePuppetsFor(world([openSatellite]), "").map((row) => row.role), ["foreign"]);
});

test("a world with no ledger answers with no rows rather than throwing", () => {
  assert.deepEqual(visiblePuppetsFor({}, "USSR"), []);
  assert.deepEqual(visiblePuppetsFor(null, "USSR"), []);
});

test("Loyalty bands run Loyal, Content, Restless, Seething", () => {
  assert.equal(loyaltyBand(100), "Loyal");
  assert.equal(loyaltyBand(75), "Loyal");
  assert.equal(loyaltyBand(74), "Content");
  assert.equal(loyaltyBand(50), "Content");
  assert.equal(loyaltyBand(49), "Restless");
  assert.equal(loyaltyBand(25), "Restless");
  assert.equal(loyaltyBand(24), "Seething");
  assert.equal(loyaltyBand(0), "Seething");
});

test("an Overlord row whose Loyalty is missing still gets a word, not a crash", () => {
  // Callers interpolate the band straight into prose, and the advisor reads
  // world.json raw — so a row that never got a loyalty must not hand back null.
  const raw = { overlord: "USSR", puppet: "Poland", secrecy: "open", status: "active" };
  const [row] = visiblePuppetsFor(world([raw]), "USSR");
  assert.equal(typeof row.loyaltyBand, "string");
  assert.doesNotThrow(() => row.loyaltyBand.toLowerCase());
});

test("a band is still withheld from everyone but the Overlord", () => {
  const raw = { overlord: "USSR", puppet: "Poland", secrecy: "open", status: "active" };
  for (const viewer of ["Poland", "France"]) {
    assert.equal(visiblePuppetsFor(world([raw]), viewer)[0].loyaltyBand, null);
  }
});

// A LEADER speaks as one polity, so it is briefed on what that polity knows —
// the same rule chatVisibility.js applies to transcripts — and not on the whole
// ledger: handing every leader every covert arrangement would let France's
// leader "know" a deal France never discovered. For its OWN covert arrangements
// it is also told who in the room does not know, because that is the thing it
// needs to know which way to lie.

test("a Puppet is briefed on its own subordination, and on who in the room must not learn it", () => {
  const briefing = puppetBriefingFor(world([covertClient]), "Finland", { present: ["Finland", "France", "United Kingdom"] });
  assert.equal(briefing.own.length, 1);
  const [own] = briefing.own;
  assert.equal(own.role, "puppet");
  assert.equal(own.counterpart, "USSR");
  assert.equal(own.secrecy, "covert");
  assert.deepEqual(own.unawareHere, ["France"], "the UK has found out; France has not");
  assert.equal(own.loyaltyBand, null, "a Puppet is not told its own Loyalty");
});

test("an Overlord is briefed on its Puppet's mood", () => {
  const [own] = puppetBriefingFor(world([openSatellite]), "USSR", { present: ["USSR", "Poland"] }).own;
  assert.equal(own.role, "overlord");
  assert.equal(own.counterpart, "Poland");
  assert.equal(own.loyaltyBand, "Restless");
  assert.deepEqual(own.unawareHere, [], "an open arrangement has nobody to hide it from");
});

test("a leader is not briefed on a covert arrangement its country never discovered", () => {
  const briefing = puppetBriefingFor(world([covertClient]), "France", { present: ["France", "Finland"] });
  assert.deepEqual(briefing.own, []);
  assert.deepEqual(briefing.learned, []);
});

test("a leader IS briefed on one its services uncovered, with when", () => {
  const { learned } = puppetBriefingFor(world([covertClient]), "United Kingdom", { present: [] });
  assert.equal(learned.length, 1);
  assert.equal(learned[0].puppet, "Finland");
  assert.equal(learned[0].asOf, "1948-03-02");
});

test("the briefing renders a line the model can act on, and nothing when there is nothing", () => {
  const text = describePuppetBriefing(puppetBriefingFor(world([covertClient]), "Finland", { present: ["Finland", "France"] }), "Finland");
  assert.match(text, /client of USSR/i);
  assert.match(text, /France does not know/);
  assert.match(text, /independent/i);
  assert.equal(describePuppetBriefing(puppetBriefingFor(world([]), "France"), "France"), "");
});

test("the room may be given as chat country entries, and the player counts as present", () => {
  // A chat's countries are { name, code } entries and list only its NON-player
  // members, so the caller adds the player — who is exactly who a covert Puppet
  // most needs to deceive.
  const [own] = puppetBriefingFor(world([covertClient]), "Finland", {
    present: [{ name: "Finland", code: "FIN" }, "France", "France", null],
  }).own;
  assert.deepEqual(own.unawareHere, ["France"]);
});

test("a viewer sees an arrangement as they last saw it, ended or not", () => {
  // knownTo records what each polity last saw. An agent still in place brings it
  // up to date; without one, the old belief stands.
  const ended = { ...covertClient, status: "released", endedDate: "1953-04-10" };
  const refreshed = { ...ended, knownTo: [{ polity: "United Kingdom", learnedDate: "1953-06-01", seenStatus: "released" }] };
  const stale = { ...ended, knownTo: [{ polity: "United Kingdom", learnedDate: "1948-03-02", seenStatus: "active" }] };
  assert.equal(visiblePuppetsFor(world([refreshed]), "United Kingdom")[0].status, "released");
  assert.equal(visiblePuppetsFor(world([stale]), "United Kingdom")[0].status, "active");
});

// What the country panel and the map popup both print for a clicked country.
// One function, so the two can never disagree - and each kind says what it
// MEANS, because "Our satellite" alone told a player nothing about what they
// had.
test("a clicked country's subordination is summarised the same way everywhere, and says what the kind means", async () => {
  const { puppetSummaryFor } = await import("./puppets.js");
  const world = {
    puppets: [
      { id: "p1", overlord: "British Empire", puppet: "United States", kind: "satellite", loyalty: 85, secrecy: "open", knownTo: [], status: "active", startedDate: "2016-01-10" },
      { id: "p2", overlord: "British Empire", puppet: "Australia", kind: "client", loyalty: 75, secrecy: "covert", knownTo: [{ polity: "British Empire" }, { polity: "Australia" }], status: "active", startedDate: "2016-01-10" },
      { id: "p3", overlord: "France", puppet: "Monaco", kind: "protectorate", loyalty: 50, secrecy: "open", knownTo: [], status: "active" },
    ],
  };

  // The player's own puppet: what it is, what that means, and the few facts
  // worth showing — as chips, not a run-on line.
  const ours = puppetSummaryFor(world, "British Empire", "United States");
  assert.equal(ours.headline, "Our puppet state");
  assert.match(ours.meaning, /We control its government/);
  assert.deepEqual(ours.facts, ["Loyal", "Since 10 January 2016", "Openly known"]);

  const client = puppetSummaryFor(world, "British Empire", "Australia");
  assert.equal(client.headline, "Our client state");
  assert.match(client.meaning, /depends on our backing/);
  assert.ok(client.facts.includes("Covert"), "a secret arrangement says so");

  // Seen from the Puppet itself, and from a stranger.
  const fromBelow = puppetSummaryFor(world, "United States", "United States");
  assert.equal(fromBelow.headline, "British Empire's puppet state");
  assert.match(fromBelow.meaning, /British Empire controls our government/);
  assert.ok(!fromBelow.facts.some((fact) => /loyal/i.test(fact)), "a puppet is never shown its own Loyalty");

  const stranger = puppetSummaryFor(world, "Germany", "Monaco");
  assert.equal(stranger.headline, "Protectorate of France");
  assert.match(stranger.meaning, /France runs its foreign policy and defence/);

  // A covert arrangement the viewer never uncovered says nothing at all.
  assert.equal(puppetSummaryFor(world, "Germany", "Australia"), null);
  assert.equal(puppetSummaryFor(world, "Germany", "Germany"), null);
});

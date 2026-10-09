/*! Open Historia — world ledger normalisation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.ledgers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEventEntry, normalizeWorldState } from "./gameState.js";

// world.wars / relations / agreements are written by the ledgers (AI/) and read
// back through normalizeWorldState like every other world field - a field the
// normalizer does not know is a field the next round trip loses.

test("wars, relations and agreements survive a normalizeWorldState round trip", () => {
  const world = normalizeWorldState({
    polityOverrides: { France: { code: "France" }, Germany: { code: "Germany" } },
    wars: [
      { id: "w1", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03", sourceEventIds: ["e1"] },
      // One-sided: not a war.
      { id: "w2", status: "active", sideA: ["Germany"], sideB: [] },
      // Same id twice: the later record wins.
      { id: "w1", status: "ceasefire", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" },
    ],
    relations: [
      { a: "Germany", b: "France", score: -85 },
      { a: "France", b: "Germany", score: 12, summary: "later" },
    ],
    agreements: [
      { id: "pact", type: "Mutual Defense", parties: ["France", "Germany"], startedDate: "1900-01-01" },
      { id: "solo", type: "alliance", parties: ["France"] },
    ],
    diplomaticLedgerVersion: "1",
  });

  assert.equal(world.wars.length, 1);
  assert.equal(world.wars[0].status, "ceasefire");
  assert.equal(world.wars[0].title, "Germany–France War");

  assert.equal(world.relations.length, 1, "a pair is one relation whichever way round it is written");
  assert.equal(world.relations[0].score, 12);
  assert.equal(world.relations[0].status, "neutral", "status derives from the score when not given");
  assert.deepEqual([world.relations[0].a, world.relations[0].b], ["France", "Germany"]);

  assert.equal(world.agreements.length, 1);
  assert.equal(world.agreements[0].type, "mutual_defense");
  assert.equal(world.agreements[0].status, "active");
  assert.equal(world.diplomaticLedgerVersion, 1);

  const again = normalizeWorldState(world);
  assert.deepEqual(again.wars, world.wars);
  assert.deepEqual(again.relations, world.relations);
  assert.deepEqual(again.agreements, world.agreements);
});

test("an empty world has empty ledgers", () => {
  const world = normalizeWorldState({});
  assert.deepEqual(world.wars, []);
  assert.deepEqual(world.relations, []);
  assert.deepEqual(world.agreements, []);
  assert.equal(world.diplomaticLedgerVersion, 0);
});

test("an event keeps its war metadata", () => {
  const event = normalizeEventEntry({
    title: "Battle of the Marne",
    date: "1914-09-06",
    warId: "w1",
    combatants: ["France", "Germany", "France", ""],
  });
  assert.equal(event.warId, "w1");
  assert.deepEqual(event.combatants, ["France", "Germany"]);

  const plain = normalizeEventEntry({ title: "A quiet day" });
  assert.equal(plain.warId, "");
  assert.deepEqual(plain.combatants, []);
});

// world.puppets is the fourth ledger and rides the same read/write path. A
// field the normalizer does not know is a field the next round trip loses.

test("puppets survive a normalizeWorldState round trip", () => {
  const world = normalizeWorldState({
    polityOverrides: { USSR: { code: "USSR" }, Poland: { code: "Poland" } },
    puppets: [{
      id: "p1",
      overlord: "USSR",
      puppet: "Poland",
      kind: "satellite",
      loyalty: 42,
      secrecy: "open",
      knownTo: [{ polity: "United Kingdom", learnedDate: "1948-03-02" }, "France", ""],
      status: "active",
      startedDate: "1945-06-28",
      sourceEventIds: ["e1"],
      createdRound: 2,
      updatedRound: 3,
    }],
  });

  assert.equal(world.puppets.length, 1);
  const [row] = world.puppets;
  assert.equal(row.overlord, "USSR");
  assert.equal(row.puppet, "Poland");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, 42);
  assert.equal(row.secrecy, "open");
  assert.equal(row.status, "active");
  assert.deepEqual(row.knownTo, [
    { polity: "United Kingdom", learnedDate: "1948-03-02" },
    { polity: "France", learnedDate: "" },
  ]);
  assert.deepEqual(row.sourceEventIds, ["e1"]);
});

test("a puppet row with a nonsense kind, secrecy or status falls back rather than vanishing", () => {
  const [row] = normalizeWorldState({
    puppets: [{ overlord: "USSR", puppet: "Poland", kind: "vassal", secrecy: "sort of", status: "wobbly", loyalty: 900 }],
  }).puppets;
  assert.equal(row.kind, "client");
  assert.equal(row.secrecy, "open");
  assert.equal(row.status, "active");
  assert.equal(row.loyalty, 100);
});

test("a puppet of itself, or of nobody, is dropped", () => {
  const world = normalizeWorldState({
    puppets: [
      { overlord: "USSR", puppet: "USSR" },
      { overlord: "", puppet: "Poland" },
      { overlord: "USSR", puppet: "" },
      "not an object",
    ],
  });
  assert.deepEqual(world.puppets, []);
});

test("one Overlord per Puppet - a second row for the same Puppet is dropped", () => {
  const world = normalizeWorldState({
    puppets: [
      { id: "p1", overlord: "USSR", puppet: "Poland", status: "active" },
      { id: "p2", overlord: "Germany", puppet: "Poland", status: "active" },
    ],
  });
  assert.equal(world.puppets.length, 1);
  assert.equal(world.puppets[0].overlord, "USSR");
});

test("an ended row does not block a new Overlord for the same Puppet", () => {
  const world = normalizeWorldState({
    puppets: [
      { id: "p1", overlord: "Germany", puppet: "Poland", status: "revolted" },
      { id: "p2", overlord: "USSR", puppet: "Poland", status: "active" },
    ],
  });
  assert.equal(world.puppets.length, 2);
  assert.equal(world.puppets.find((row) => row.status === "active").overlord, "USSR");
});

test("the puppet ledger caps at 64, evicting what is over before what is live", () => {
  const ended = Array.from({ length: 60 }, (_, index) => ({
    id: `done-${index}`,
    overlord: "USSR",
    puppet: `Gone ${index}`,
    status: "released",
    lastUpdatedDate: `19${String(10 + index).padStart(2, "0")}-01-01`,
  }));
  const live = Array.from({ length: 20 }, (_, index) => ({
    id: `live-${index}`,
    overlord: "USSR",
    puppet: `Held ${index}`,
    status: "active",
  }));

  const world = normalizeWorldState({ puppets: [...ended, ...live] });
  assert.equal(world.puppets.length, 64);
  assert.equal(world.puppets.filter((row) => row.status === "active").length, 20, "no live row is ever evicted");
  const kept = world.puppets.filter((row) => row.status === "released").map((row) => row.id);
  assert.equal(kept.length, 44);
  assert.ok(!kept.includes("done-0"), "the oldest finished row goes first");
  assert.ok(kept.includes("done-59"), "the most recently touched finished row stays");
});

test("an empty world has an empty puppet ledger", () => {
  assert.deepEqual(normalizeWorldState({}).puppets, []);
});

/*! Open Historia — world ledger normalisation tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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

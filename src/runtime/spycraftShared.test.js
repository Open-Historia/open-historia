/*! Open Historia — a round's espionage with several players: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/spycraftShared.test.js
//
// What single player does for the player, a shared game does for every country
// a person plays: an agent caught there waits for that person's decision, a
// person's own turned agent may come under suspicion, others may plant agents
// in any of them, and what one government alone found out is marked for it
// alone. With one player nothing changes, word for word and roll for roll.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveEspionage } from "./spycraft.js";

const FRANCE = "France"; // the player (the host's seat)
const GERMANY = "Germany"; // a second person
const ITALY = "Italy"; // the AI's
const spy = (id, owner, target, status = "active", extra = {}) => ({ id, owner, target, status, deployedAt: "1938-01-01", turnedAt: "", exposedAt: "", coverStory: "", suspected: false, ...extra });
// Ratings that make detection near certain and suspicion likely.
const world = (spies) => ({ spies, intelligence: { [FRANCE]: 95, [GERMANY]: 95, [ITALY]: 95 } });
const rounds = Array.from({ length: 40 }, (_, n) => n + 1);

test("single player is untouched: same agents, same events, nothing marked for anyone", () => {
  for (const round of rounds) {
    const base = world([spy("s1", ITALY, FRANCE), spy("s2", FRANCE, ITALY, "turned"), spy("s3", ITALY, GERMANY)]);
    const options = { round, date: "1938-05-01", playerPolity: FRANCE, candidates: [{ polity: ITALY, hostile: true }] };
    const solo = resolveEspionage(base, options);
    assert.deepEqual(resolveEspionage(base, { ...options, playerPolities: [FRANCE] }), solo);
    assert.equal(solo.events.some((event) => "audience" in event), false);
  }
});

test("an agent caught in a second person's country waits for that person, and only they are told", () => {
  let caught = 0;
  for (const round of rounds) {
    const base = world([spy("s-in-de", ITALY, GERMANY)]);
    const solo = resolveEspionage(base, { round, date: "d", playerPolity: FRANCE });
    const shared = resolveEspionage(base, { round, date: "d", playerPolity: FRANCE, playerPolities: [FRANCE, GERMANY] });
    // The same roll decides whether it is caught at all.
    assert.equal(solo.spies[0].status !== "active", shared.spies[0].status !== "active");
    if (shared.spies[0].status === "active") continue;
    caught += 1;
    // Single player: Germany is the AI's and settles it on the spot. Shared: Germany's player decides.
    assert.notEqual(solo.spies[0].status, "discovered");
    assert.equal(shared.spies[0].status, "discovered");
    assert.deepEqual(shared.events.map((event) => [event.title, event.audience]), [[`Counter-intelligence uncovers a ${ITALY} agent`, [GERMANY]]]);
    assert.match(shared.events[0].description, /^Germany's security service .* is Germany's decision\.$/);
  }
  assert.ok(caught > 5, "the rolls catch it often enough for the test to mean something");
});

test("the host's own caught agents are still the host's to decide, and marked for the host alone in a shared game", () => {
  const round = rounds.find((number) => resolveEspionage(world([spy("s", ITALY, FRANCE)]), { round: number, date: "d", playerPolity: FRANCE }).spies[0].status === "discovered");
  assert.ok(round, "some round catches it");
  const shared = resolveEspionage(world([spy("s", ITALY, FRANCE)]), { round, date: "d", playerPolity: FRANCE, playerPolities: [FRANCE, GERMANY] });
  assert.equal(shared.spies[0].status, "discovered");
  assert.deepEqual(shared.events[0].audience, [FRANCE]);
});

test("a second person's turned agent may come under suspicion, which only its owner hears of", () => {
  let suspected = 0;
  for (const round of rounds) {
    const base = world([spy("s-de", GERMANY, ITALY, "turned")]);
    assert.equal(resolveEspionage(base, { round, date: "d", playerPolity: FRANCE }).spies[0].suspected, false, "the AI's agents are never suspected");
    const shared = resolveEspionage(base, { round, date: "d", playerPolity: FRANCE, playerPolities: [FRANCE, GERMANY] });
    if (!shared.spies[0].suspected) continue;
    suspected += 1;
    assert.deepEqual(shared.events.map((event) => event.audience), [[GERMANY]]);
    assert.match(shared.events[0].description, /^Germany's analysts suspect/);
  }
  assert.ok(suspected > 0);
});

test("others plant agents in each person's country, from that person's own candidates, and no person is planted on another", () => {
  let planted = 0;
  for (const round of rounds) {
    const shared = resolveEspionage(world([]), {
      round,
      date: "d",
      playerPolity: FRANCE,
      playerPolities: [FRANCE, GERMANY],
      candidates: [{ polity: GERMANY, hostile: true }],
      candidatesFor: (person) => (person === GERMANY ? [{ polity: ITALY, hostile: true }, { polity: FRANCE, hostile: true }] : []),
    });
    for (const agent of shared.spies) {
      assert.deepEqual([agent.owner, agent.target], [ITALY, GERMANY], "only the AI is planted, and only where it is a candidate");
      planted += 1;
    }
  }
  assert.ok(planted > 0);
});

test("a public exposure stays public", () => {
  // An agent of a person's, caught in an AI country that expels it openly.
  for (const round of rounds) {
    const shared = resolveEspionage(world([spy("s", GERMANY, ITALY)]), { round, date: "d", playerPolity: FRANCE, playerPolities: [FRANCE, GERMANY] });
    for (const event of shared.events) {
      if (/rolled up/.test(event.title)) assert.equal("audience" in event, false);
    }
  }
});

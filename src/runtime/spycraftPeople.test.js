/*! Open Historia — what the simulator is told of a person's service: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/spycraftPeople.test.js
//
// The review of 2026-11-18, simulation 3 and 8: every player's service is
// briefed in a shared skip, so one player's agent sits inside another player's
// country, and the brief told the model that a person's government "may act on
// what it knows" (the skip wrote it confronting the other with stolen plans its
// player never ordered); and each service's part repeated the world's last
// public expulsions.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { espionageBrief, publicExpulsionLines } from "./spycraft.js";
import { covertOperationsBlock } from "../Game/AI/covertOperationsDirective.js";

const FRANCE = "France";
const SPAIN = "Spain";
const world = {
  spies: [
    { id: "a", owner: FRANCE, target: SPAIN, status: "active", deployedAt: "1914-01-01" },
    { id: "b", owner: "Italy", target: SPAIN, status: "turned", deployedAt: "1914-01-01", coverStory: "All quiet." },
    { id: "c", owner: SPAIN, target: FRANCE, status: "turned", deployedAt: "1914-01-01" },
    { id: "d", owner: "Germany", target: FRANCE, status: "exposed", deployedAt: "1914-01-01", exposedAt: "1914-02-01" },
  ],
};

test("a person's agent inside another country is told with what it knows, and that its player decides what is done with it", () => {
  const spain = espionageBrief(world, {}, { playerPolity: SPAIN, people: [FRANCE, SPAIN] });
  assert.match(spain, /France has a live agent in Spain and knows Spain's private diplomacy and plans\. France is played by a person: only its player's own orders decide what it does with what it knows\./);
  assert.doesNotMatch(spain, /France may act on what it knows/);
  assert.match(spain, /Italy should act on that belief\./, "an AI power still acts on what it believes");
  const france = espionageBrief(world, {}, { playerPolity: FRANCE, people: [FRANCE, SPAIN] });
  assert.match(france, /Spain's agent in France has been turned by France\. Spain believes the agent is loyal\. Spain is played by a person: only its player's own orders decide what it does with that belief\./);
  assert.doesNotMatch(france, /Spain should act/);
});

test("one player's brief is as it always was: an agent's owner inside the player is never the player", () => {
  const one = espionageBrief(world, {}, { playerPolity: SPAIN, people: [SPAIN] });
  assert.equal(one, espionageBrief(world, {}, { playerPolity: SPAIN }));
  assert.match(one, /France has a live agent in Spain and knows Spain's private diplomacy and plans\. France may act on what it knows\./);
});

test("the world's public expulsions are told once, not in every service's part", () => {
  assert.deepEqual(publicExpulsionLines(world), ["France publicly expelled a Germany agent on 1914-02-01."]);
  assert.match(espionageBrief(world, {}, { playerPolity: FRANCE }), /France publicly expelled a Germany agent/);
  assert.doesNotMatch(espionageBrief(world, {}, { playerPolity: FRANCE, expulsions: false }), /publicly expelled/);
  // The skip's [Espionage] block: one brief per service without them, and the expulsions once.
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /people: spymasters,\n\s+\/\/ The world's public expulsions are every service's: told once, below\.\n\s+expulsions: spymasters\.length === 1,/);
  assert.match(gameplay, /const expelled = spymasters\.length > 1 \? publicExpulsionLines\(world\) : \[\];/);
  assert.match(gameplay, /A player's government acts only by its own player's orders, whatever its service knows\./);
});

const op = (fields) => ({ owner: FRANCE, target: SPAIN, kind: "sabotage", instructions: "the port", outcome: "success", caught: false, identified: false, ...fields });

test("a covert operation a person's government learned of is that person's to answer, where several people play", () => {
  const foiled = covertOperationsBlock([op({ outcome: "foiled" })], { people: [FRANCE, SPAIN] });
  assert.match(foiled, /Nothing visible happens unless Spain acts on what it knows\. Spain is played by a person: only its player's own orders decide whether it acts on this\./);
  const caught = covertOperationsBlock([op({ caught: true, identified: true })], { people: [FRANCE, SPAIN] });
  assert.match(caught, /Spain and France are each played by a person: only each one's own player's orders decide whether it acts on this\./);
  const ai = covertOperationsBlock([op({ target: "Morocco", caught: true, identified: true })], { people: [FRANCE, SPAIN] });
  assert.match(ai, /France is played by a person/);
  assert.doesNotMatch(ai, /Morocco is played/);
});

test("with one person every covert line is as it always was", () => {
  for (const fields of [{ outcome: "foiled" }, { caught: true, identified: true }, { target: FRANCE, outcome: "foiled" }]) {
    assert.equal(covertOperationsBlock([op(fields)], { people: [FRANCE] }), covertOperationsBlock([op(fields)]));
  }
  assert.match(covertOperationsBlock([op({ outcome: "foiled" })], { people: [FRANCE] }), /Nothing visible happens unless Spain chooses to act on what it knows\.$/);
});

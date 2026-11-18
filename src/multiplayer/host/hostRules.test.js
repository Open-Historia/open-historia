/*! Open Historia — what decides a shared game's rounds beyond its lobby settings: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/hostRules.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { roundRulesOf } from "./hostRules.js";
import { HOST_MESSAGES } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { JUMP_REQUEST_CAP, UNLIMITED_JUMP_REQUEST_CAP } from "../../Game/AI/requestBudget.js";

// The gap audit of 2026-11-18: the host's device AI settings decided every round's cost and how long it waited, and
// no guest could see them; difficulty was nowhere in the lobby.
test("the rules a round is played by are the host's game's difficulty and the host's AI settings, as the time panel reads them", () => {
  assert.deepEqual(roundRulesOf({}), { difficulty: "medium", requests: 1, most: 1, stallMinutes: 0, quietMinutes: 0 });
  assert.equal(roundRulesOf({ difficulty: "standard" }).difficulty, "medium", "an old game's level");
  assert.equal(roundRulesOf({ difficulty: "impossible" }).difficulty, "impossible");
  // Lookups add requests only with "My key has no request limit" on, as the time panel says.
  assert.equal(roundRulesOf({ lookups: true, noRequestLimit: false }).most, 1);
  assert.equal(roundRulesOf({ lookups: true, noRequestLimit: true }).most, UNLIMITED_JUMP_REQUEST_CAP);
  assert.equal(roundRulesOf({ lookups: false, noRequestLimit: true }).most, 1);
  // A long round in segments asks once a segment; a month never splits.
  assert.equal(roundRulesOf({ segmented: true, daysPerRound: 30 }).requests, 1);
  const year = roundRulesOf({ segmented: true, daysPerRound: 365 });
  assert.ok(year.requests > 1 && year.most === year.requests, "one request a segment");
  assert.equal(roundRulesOf({ segmented: false, daysPerRound: 365 }).requests, 1);
  assert.equal(roundRulesOf({ limitGeneration: true }).stallMinutes, 15);
  // Both of "Limit AI generation"'s windows (idleDeadline.js): an answer not begun, and one stopped part-way.
  assert.equal(roundRulesOf({ limitGeneration: true }).quietMinutes, 5);
  assert.ok(JUMP_REQUEST_CAP >= 1);
});

test("the rules ride in the lobby the players read", () => {
  const lobby = {
    t: "lobby",
    settings: { v: 1, name: "Friday", seats: 8, roundMinutes: 20, readyThreshold: 2 / 3, countdownSeconds: 60, minPlanningSeconds: 0, afkSeconds: 0, daysPerRound: 30, leaverGraceMinutes: 5, allowMidGameJoin: true, cheats: "off", payment: "host", replies: "host", language: "" },
    scenario: { id: "modern", name: "Modern Day", hash: "" },
    countries: ["France"],
    seats: [],
    started: false,
    rules: roundRulesOf({ difficulty: "hard", noRequestLimit: true }),
  };
  assert.equal(validate(HOST_MESSAGES.lobby, lobby).ok, true);
  assert.equal(validate(HOST_MESSAGES.lobby, { ...lobby, rules: { ...lobby.rules, difficulty: "godlike" } }).ok, false);
  const { rules: _rules, ...older } = lobby;
  assert.equal(validate(HOST_MESSAGES.lobby, older).ok, true, "a lobby may state none");
});

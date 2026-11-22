/*! Open Historia — multiplayer settings tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/settings.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, HOST_ANSWERS_MAX, PAYMENT_MODES, REPLY_MODES, SEATS_AVAILABLE_NOW, SETTINGS_SCHEMA, gameMasterAllowed, normalizeSettings, roundSettingsOf, settingsProblems } from "./settings.js";
import { validate } from "../protocol/validate.js";

test("the defaults are the user's: 8 seats, a 2/3 share, cheats off, the host pays", () => {
  const { ok, settings } = normalizeSettings({});
  assert.equal(ok, true);
  assert.equal(settings.seats, 8);
  assert.equal(settings.readyThreshold, 2 / 3);
  assert.equal(settings.cheats, "off");
  assert.equal(settings.payment, "host");
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS });
});

test("what the host sets is kept; nonsense and unknown keys are not", () => {
  const { settings } = normalizeSettings({ name: "  Cold War  ", seats: 4, roundMinutes: 60, cheats: "vote", admin: true });
  assert.equal(settings.name, "Cold War");
  assert.equal(settings.seats, 4);
  assert.equal(settings.cheats, "vote");
  assert.equal("admin" in settings, false);
  assert.equal(normalizeSettings({ roundMinutes: 0 }).key, "roundMinutes");
  assert.equal(normalizeSettings({ cheats: "always" }).key, "cheats");
  assert.equal(normalizeSettings({ payment: "lend" }).key, "payment", "a key is never lent: the host pays, or each player in turn on their own");
  assert.equal(normalizeSettings({ name: "bad\nname" }).key, "name");
});

test("who answers for the AI's governments is the host's choice: its own AI unless it says each player's own", () => {
  assert.deepEqual(REPLY_MODES, ["host", "own"]);
  assert.equal(normalizeSettings({}).settings.replies, "host", "as it was before there was a choice");
  assert.equal(normalizeSettings({ replies: "own" }).settings.replies, "own");
  assert.equal(normalizeSettings({ replies: "lend" }).key, "replies", "a key is never lent: there is no such way to answer");
  assert.equal(normalizeSettings({ replies: "" }).key, "replies");
});

test("the slider runs to 64, but above 8 is coming later", () => {
  assert.equal(SEATS_AVAILABLE_NOW, 8);
  assert.match(normalizeSettings({ seats: 12 }).error, /coming later/);
  assert.equal(normalizeSettings({ seats: 65 }).key, "seats");
  assert.equal(normalizeSettings({ seats: 2 }).ok, true);
});

test("the round machine gets its part", () => {
  const { settings } = normalizeSettings({ countdownSeconds: 90 });
  assert.deepEqual(Object.keys(roundSettingsOf(settings)).sort(), ["afkSeconds", "countdownSeconds", "minPlanningSeconds", "readyThreshold", "roundMinutes"]);
});

// Taking turns to pay (decision 14), the host's answers a round with each player's own AI, and the Game Master
// (decision 8): each a rule of the game the host sets, off or the host's unless it says.
test("who pays, how much of the host's AI each player has a round, and the Game Master are the host's to set, and off unless it says", () => {
  assert.deepEqual(PAYMENT_MODES, ["host", "cycle"]);
  const { settings } = normalizeSettings({});
  assert.equal(settings.payment, "host");
  assert.equal(settings.hostAnswers, 0, "rule 3: what the host's key answers beyond the round is a number it sets, none unless it says");
  assert.equal(gameMasterAllowed(settings), false);
  assert.equal(normalizeSettings({ payment: "cycle" }).settings.payment, "cycle");
  assert.equal(normalizeSettings({ hostAnswers: 5 }).settings.hostAnswers, 5);
  assert.equal(normalizeSettings({ hostAnswers: HOST_ANSWERS_MAX + 1 }).key, "hostAnswers");
  assert.equal(normalizeSettings({ hostAnswers: 1.5 }).key, "hostAnswers");
  assert.equal(gameMasterAllowed(normalizeSettings({ cheats: "host" }).settings), true);
  assert.equal(gameMasterAllowed(normalizeSettings({ cheats: "vote" }).settings), false, "a vote is not built: it allows nothing");
  // A lobby or a kept record from before the answers a round were a setting still reads, as none.
  const { hostAnswers: _none, ...older } = settings;
  assert.equal(validate(SETTINGS_SCHEMA, older).ok, true);
  assert.equal(normalizeSettings(older).settings.hostAnswers, 0);
});

// A host who cleared or mistyped a number in Host a lobby was refused in the schema's own code
// ("$.roundMinutes: outside 1..10080"; the review of 2026-11-18, ui 12): every problem is a sentence naming
// its setting, its bounds read from the schema, said under its field, and the engine refuses in the same words.
test("what the game would refuse is said in words naming the setting, never in the schema's code", () => {
  assert.deepEqual(settingsProblems({}), [], "the defaults are all fine");
  assert.deepEqual(settingsProblems({ roundMinutes: 0 }), [{ key: "roundMinutes", text: "Round length must be a whole number of minutes from 1 to 10080." }]);
  assert.deepEqual(settingsProblems({ roundMinutes: "" }).map((problem) => problem.key), ["roundMinutes"], "a cleared field");
  assert.match(settingsProblems({ daysPerRound: 1.5 })[0].text, /^Game time per round must be a whole number of days from 1 to 3650\.$/);
  // Every problem at once, in the form's order, for every field to say its own.
  assert.deepEqual(settingsProblems({ countdownSeconds: -1, leaverGraceMinutes: 99999, postsPerRound: 0 }).map((problem) => problem.key), ["countdownSeconds", "leaverGraceMinutes", "postsPerRound"]);
  assert.equal(settingsProblems({ seats: 12 })[0].text, "More than 8 players is coming later.");
  // The engine refuses with the first, in the same words.
  const refused = normalizeSettings({ roundMinutes: 0, daysPerRound: 0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "Round length must be a whole number of minutes from 1 to 10080.");
  // No setting is ever refused in the schema's own words.
  for (const input of [{ roundMinutes: 0 }, { cheats: "always" }, { name: "bad\nname" }, { readyThreshold: 7 }, { language: "klingon" }, { hostAnswers: 1.5 }, { v: 2 }]) {
    const { error } = normalizeSettings(input);
    assert.ok(error && !/\$\.|outside|expected|not an allowed value/.test(error), `${JSON.stringify(input)}: ${error}`);
  }
});

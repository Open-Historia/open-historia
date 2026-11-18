/*! Open Historia — multiplayer settings tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/settings.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, HOST_ANSWERS_MAX, PAYMENT_MODES, REPLY_MODES, SEATS_AVAILABLE_NOW, SETTINGS_SCHEMA, gameMasterAllowed, normalizeSettings, roundSettingsOf } from "./settings.js";
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
  assert.match(normalizeSettings({ roundMinutes: 0 }).error, /roundMinutes/);
  assert.match(normalizeSettings({ cheats: "always" }).error, /cheats/);
  assert.match(normalizeSettings({ payment: "lend" }).error, /payment/, "a key is never lent: the host pays, or each player in turn on their own");
  assert.match(normalizeSettings({ name: "bad\nname" }).error, /name/);
});

test("who answers for the AI's governments is the host's choice: its own AI unless it says each player's own", () => {
  assert.deepEqual(REPLY_MODES, ["host", "own"]);
  assert.equal(normalizeSettings({}).settings.replies, "host", "as it was before there was a choice");
  assert.equal(normalizeSettings({ replies: "own" }).settings.replies, "own");
  assert.match(normalizeSettings({ replies: "lend" }).error, /replies/, "a key is never lent: there is no such way to answer");
  assert.match(normalizeSettings({ replies: "" }).error, /replies/);
});

test("the slider runs to 64, but above 8 is coming later", () => {
  assert.equal(SEATS_AVAILABLE_NOW, 8);
  assert.match(normalizeSettings({ seats: 12 }).error, /coming later/);
  assert.match(normalizeSettings({ seats: 65 }).error, /seats/);
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
  assert.match(normalizeSettings({ hostAnswers: HOST_ANSWERS_MAX + 1 }).error, /hostAnswers/);
  assert.match(normalizeSettings({ hostAnswers: 1.5 }).error, /hostAnswers/);
  assert.equal(gameMasterAllowed(normalizeSettings({ cheats: "host" }).settings), true);
  assert.equal(gameMasterAllowed(normalizeSettings({ cheats: "vote" }).settings), false, "a vote is not built: it allows nothing");
  // A lobby or a kept record from before the answers a round were a setting still reads, as none.
  const { hostAnswers: _none, ...older } = settings;
  assert.equal(validate(SETTINGS_SCHEMA, older).ok, true);
  assert.equal(normalizeSettings(older).settings.hostAnswers, 0);
});

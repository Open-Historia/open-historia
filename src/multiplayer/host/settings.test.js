/*! Open Historia — multiplayer settings tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/settings.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, SEATS_AVAILABLE_NOW, normalizeSettings, roundSettingsOf } from "./settings.js";

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
  assert.match(normalizeSettings({ payment: "cycle" }).error, /payment/);
  assert.match(normalizeSettings({ name: "bad\nname" }).error, /name/);
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

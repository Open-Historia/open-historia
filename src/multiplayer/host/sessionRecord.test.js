/*! Open Historia — a shared game's session, kept with the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/sessionRecord.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { sessionFromRecord, sessionRecordOf } from "./sessionRecord.js";
// A game taken up again another day ran on whatever the host typed: "replies" back on the host's key, the world's
// language back to the host's own (the gap audit of 2026-11-18). The record keeps the settings as they stood, and the
// host's Host a lobby starts from them.
test("the record keeps the game's settings, changes made during the game included, and gives them back for that game alone", async () => {
  const { keptSettingsOf } = await import("./sessionRecord.js");
  const { normalizeSettings } = await import("./settings.js");
  const settings = { ...normalizeSettings({ name: "Baltic league", replies: "own", language: "de", roundMinutes: 45 }).settings };
  const record = sessionRecordOf({ campaign: "game-baltic", started: true, round: 4, hostDevice: "device-host", seats: [], settings });
  assert.deepEqual(record.settings, settings);
  assert.deepEqual(sessionFromRecord(record, { campaign: "game-baltic", hostDevice: "device-host" }).settings, settings);
  assert.deepEqual(keptSettingsOf(record, { campaign: "game-baltic" }), settings);
  assert.equal(keptSettingsOf(record, { campaign: "another-game" }), null);
  // A record kept before settings were: none, and the form keeps its defaults.
  const { settings: _none, ...older } = record;
  assert.equal(keptSettingsOf(older, { campaign: "game-baltic" }), null);
  assert.ok(sessionFromRecord(older, { campaign: "game-baltic", hostDevice: "device-host" }));
  const lobby = (await import("node:fs")).readFileSync(new URL("../ui/LobbiesTab.jsx", import.meta.url), "utf8");
  assert.match(lobby, /keptSettingsOf\(record, \{ campaign \}\)/);
});

// Taking turns to pay goes on where it was, and what the Game Master changed stays listed; and a record kept before
// the host's answers a round were a setting still reads, seats and all (a record whose settings did not read was
// dropped whole).
test("the record keeps who paid last and what the Game Master changed; one from before the newer settings still reads", async () => {
  const { normalizeSettings } = await import("./settings.js");
  const settings = normalizeSettings({ payment: "cycle", replies: "own", hostAnswers: 3, cheats: "host" }).settings;
  const record = sessionRecordOf({
    campaign: "game-baltic", started: true, round: 4, hostDevice: "device-host", seats: [], settings,
    lastPayer: "device-russia",
    gameMaster: [{ round: 3, date: "2014-06-01", summary: "The Narva treaty is signed." }, { round: 3, summary: "" }],
  });
  assert.equal(record.lastPayer, "device-russia");
  assert.deepEqual(record.gameMaster, [{ round: 3, date: "2014-06-01", summary: "The Narva treaty is signed." }]);
  const taken = sessionFromRecord(record, { campaign: "game-baltic", hostDevice: "device-host" });
  assert.equal(taken.lastPayer, "device-russia");
  assert.deepEqual(taken.gameMaster, record.gameMaster);
  assert.deepEqual(taken.settings, settings);
  const { hostAnswers: _none, ...olderSettings } = settings;
  const { lastPayer: _gone, gameMaster: _log, ...older } = { ...record, settings: olderSettings };
  const olderTaken = sessionFromRecord(older, { campaign: "game-baltic", hostDevice: "device-host" });
  assert.ok(olderTaken, "an older record is taken up");
  assert.equal(olderTaken.lastPayer, "");
  assert.deepEqual(olderTaken.gameMaster, []);
  assert.equal(normalizeSettings(olderTaken.settings).settings.hostAnswers, 0);
});

test("the record keeps who the host released from which country; one kept before that still reads", () => {
  const record = sessionRecordOf({ campaign: "game-baltic", started: true, round: 4, hostDevice: "device-host", seats: [], released: [{ device: "device-ana", country: "France" }, { device: "", country: "Spain" }] });
  assert.deepEqual(record.released, [{ device: "device-ana", country: "France" }]);
  assert.deepEqual(sessionFromRecord(record, { campaign: "game-baltic", hostDevice: "device-host" }).released, [{ device: "device-ana", country: "France" }]);
  const { released: _none, ...older } = record;
  assert.deepEqual(sessionFromRecord(older, { campaign: "game-baltic", hostDevice: "device-host" }).released, []);
});

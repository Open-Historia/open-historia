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

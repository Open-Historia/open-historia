/*! Open Historia — the Game Master in a shared game, and what it changed: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/gameMaster.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { gameMasterEntryOf, gameMasterNotice, keptGameMasterLog, withGameMasterEntry } from "./gameMaster.js";
import { GAME_MASTER_LOG_MAX, GAME_MASTER_SUMMARY_MAX, HOST_MESSAGES } from "../game/messages.js";
import { validate } from "../protocol/validate.js";

test("what the console applied becomes one line every player reads: its own words, and what it touched, counted", () => {
  const entry = gameMasterEntryOf({
    summary: "  The Narva treaty is signed.  ",
    eventIds: ["event-1", "event-2", "event-1"],
    warIds: ["war-1"],
    relationIds: [],
    agreementIds: ["agreement-1"],
    statCountries: ["Republic of Estonia", "Russian Federation"],
  }, { round: 4, date: "2014-07-01" });
  assert.deepEqual(entry, {
    round: 4,
    date: "2014-07-01",
    summary: "The Narva treaty is signed. (2 events written; 1 war changed; 1 agreement changed; figures set for Republic of Estonia, Russian Federation)",
  });
  assert.equal(gameMasterNotice(entry), `The host used the Game Master: ${entry.summary}`);
  assert.equal(gameMasterEntryOf({}, {}).summary, "It changed the world.", "never an empty line");
  assert.ok(gameMasterEntryOf({ summary: "x".repeat(2000) }).summary.length <= GAME_MASTER_SUMMARY_MAX);
  assert.ok(gameMasterNotice({ summary: "x".repeat(2000) }).length <= 500, "a notice's length");
});

test("the log keeps the newest lines, each checked, and fits the lobby", () => {
  let log = keptGameMasterLog([{ round: "2", date: "2014-05-01", summary: "A change." }, { summary: "" }, null, { round: -3, summary: "Another." }]);
  assert.deepEqual(log, [{ round: 2, date: "2014-05-01", summary: "A change." }, { round: 0, date: "", summary: "Another." }]);
  for (let index = 0; index < GAME_MASTER_LOG_MAX + 5; index += 1) log = withGameMasterEntry(log, { round: index, date: "", summary: `Change ${index}.` });
  assert.equal(log.length, GAME_MASTER_LOG_MAX);
  assert.equal(log.at(-1).summary, `Change ${GAME_MASTER_LOG_MAX + 4}.`, "newest last");
  assert.equal(validate(HOST_MESSAGES.lobby.props.gameMaster, log).ok, true, "every lobby carries it as it is kept");
});

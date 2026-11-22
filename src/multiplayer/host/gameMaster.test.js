/*! Open Historia — the Game Master in a shared game, and what it changed: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/gameMaster.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { gameMasterChangeLines, gameMasterEntryOf, gameMasterNotice, keptGameMasterLog, withGameMasterEntry } from "./gameMaster.js";
import { GAME_MASTER_LOG_MAX, GAME_MASTER_SUMMARY_MAX, HOST_MESSAGES } from "../game/messages.js";
import { validate } from "../protocol/validate.js";

// The counts were English pieces glued onto the AI's summary on the host ("(2 events written; 1 war changed;
// figures set for A, B and others)"), kept so and sent so to every player (the review of 2026-11-18, ui 8): now
// they are fields of the entry, and each screen says them in whole sentences of its own language.
test("what the console applied becomes one line every player reads: its own words, and what it touched, as fields", () => {
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
    summary: "The Narva treaty is signed.",
    changed: { events: 2, wars: 1, relations: 0, agreements: 1, figures: ["Republic of Estonia", "Russian Federation"], moreFigures: 0 },
  });
  assert.deepEqual(gameMasterChangeLines(entry), [
    "It wrote 2 events.",
    "It changed 1 war.",
    "It changed 1 agreement.",
    "It set the figures of Republic of Estonia, Russian Federation.",
  ], "each a whole sentence, its count in it");
  assert.equal(gameMasterNotice(entry), "The host used the Game Master: The Narva treaty is signed.");
  assert.equal(gameMasterEntryOf({}, {}).summary, "It changed the world.", "never an empty line");
  assert.equal(gameMasterEntryOf({}, {}).changed, undefined, "and nothing counted when nothing was touched");
  assert.ok(gameMasterEntryOf({ summary: "x".repeat(2000) }).summary.length <= GAME_MASTER_SUMMARY_MAX);
  assert.ok(gameMasterNotice({ summary: "x".repeat(2000) }).length <= 500, "a notice's length");
  // Many countries' figures: four are named, the rest counted.
  const many = gameMasterEntryOf({ statCountries: ["A", "B", "C", "D", "E", "F"], relationIds: ["r1"] });
  assert.deepEqual(many.changed.figures, ["A", "B", "C", "D"]);
  assert.equal(many.changed.moreFigures, 2);
  assert.deepEqual(gameMasterChangeLines(many), ["It changed 1 relation between countries.", "It set the figures of A, B, C, D and 2 other countries."]);
  assert.equal(validate(HOST_MESSAGES.lobby.props.gameMaster, [entry, many]).ok, true, "every lobby carries it");
  // A line kept before the counts were fields says them as it was said.
  assert.deepEqual(gameMasterChangeLines({ summary: "Old. (1 war changed)" }), []);
});

test("the log keeps the newest lines, each checked, and fits the lobby", () => {
  let log = keptGameMasterLog([
    { round: "2", date: "2014-05-01", summary: "A change." }, { summary: "" }, null, { round: -3, summary: "Another." },
    { round: 3, summary: "Counted.", changed: { events: "2", wars: -1, figures: ["A", "", 7], moreFigures: 1, admin: true } },
  ]);
  assert.deepEqual(log, [
    { round: 2, date: "2014-05-01", summary: "A change." }, { round: 0, date: "", summary: "Another." },
    { round: 3, date: "", summary: "Counted.", changed: { events: 2, wars: 0, relations: 0, agreements: 0, figures: ["A", "7"], moreFigures: 1 } },
  ]);
  for (let index = 0; index < GAME_MASTER_LOG_MAX + 5; index += 1) log = withGameMasterEntry(log, { round: index, date: "", summary: `Change ${index}.` });
  assert.equal(log.length, GAME_MASTER_LOG_MAX);
  assert.equal(log.at(-1).summary, `Change ${GAME_MASTER_LOG_MAX + 4}.`, "newest last");
  assert.equal(validate(HOST_MESSAGES.lobby.props.gameMaster, log).ok, true, "every lobby carries it as it is kept");
});

/*! Open Historia — the host's words about a conversation, shown in it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/threadNotes.test.js
//
// What the host said about a player's line reached them as a word on the round
// bar for 8 seconds, away from the conversation (the review of 2026-11-18, ui 2):
// a notice that answers a line names it, and that conversation shows it under
// the line while the line is still the newest there.

import test from "node:test";
import assert from "node:assert/strict";

import { THREAD_NOTES_SHOWN, latestNoticeAbout, threadNotesFor, unreadNotices } from "./threadNotes.js";
import { HOST_MESSAGES } from "../game/messages.js";
import { validate } from "../protocol/validate.js";

const note = (fields) => ({ t: "notice", level: "info", text: "", at: 1, ...fields });

test("a conversation shows the host's words about its newest line, and only those", () => {
  const notices = [
    note({ text: "Tallinn's player is away, and will read it on coming back.", about: "thread", thread: "chat-1", line: "m-2", at: 2 }),
    note({ level: "warn", text: "The host's AI could not be reached: Republic of Estonia did not answer. Write again to ask once more.", about: "thread", thread: "chat-1", line: "m-2", at: 3 }),
    note({ text: "About an older line.", about: "thread", thread: "chat-1", line: "m-1", at: 4 }),
    note({ text: "About another conversation.", about: "thread", thread: "chat-2", line: "m-2", at: 5 }),
    note({ text: "About the round.", at: 6 }),
    note({ text: "Tallinn's player is away, and will read it on coming back.", about: "thread", thread: "chat-1", line: "m-2", at: 7 }),
  ];
  for (const entry of notices) assert.equal(validate(HOST_MESSAGES.notice, { t: entry.t, level: entry.level, text: entry.text, ...(entry.about ? { about: entry.about, thread: entry.thread, line: entry.line } : {}) }).ok, true);
  assert.deepEqual(threadNotesFor(notices, { thread: "chat-1", lastLine: "m-2" }), [
    { level: "info", text: "Tallinn's player is away, and will read it on coming back." },
    { level: "warn", text: "The host's AI could not be reached: Republic of Estonia did not answer. Write again to ask once more." },
  ], "each once, in the order said");
  // Once the conversation has moved on, they are no longer its newest line's.
  assert.deepEqual(threadNotesFor(notices, { thread: "chat-1", lastLine: "m-3" }), []);
  assert.deepEqual(threadNotesFor(notices, { thread: "", lastLine: "m-2" }), []);
  assert.deepEqual(threadNotesFor(null, { thread: "chat-1", lastLine: "m-2" }), []);
  const many = Array.from({ length: 6 }, (_, index) => note({ text: `Note ${index}.`, about: "thread", thread: "c", line: "l" }));
  assert.equal(threadNotesFor(many, { thread: "c", lastLine: "l" }).length, THREAD_NOTES_SHOWN);
});

test("the screen where the player acted finds the newest word about it since, and the list counts what is new", () => {
  const notices = [
    note({ text: "The Game Master is off in this game.", about: "gm", level: "warn", at: 10 }),
    note({ text: "The host keeps you as Russian Federation.", about: "seat", at: 20 }),
    note({ text: "The Game Master changed nothing: it did not answer.", about: "gm", level: "warn", at: 30 }),
  ];
  assert.deepEqual(latestNoticeAbout(notices, "gm", 15), { level: "warn", text: "The Game Master changed nothing: it did not answer." });
  assert.equal(latestNoticeAbout(notices, "gm", 31), null, "nothing since the command");
  assert.deepEqual(latestNoticeAbout(notices, "seat", 0), { level: "info", text: "The host keeps you as Russian Federation." });
  assert.equal(unreadNotices(notices, 0), 3);
  assert.equal(unreadNotices(notices, 20), 1);
  assert.equal(unreadNotices(notices, 30), 0);
});

/*! Open Historia — a player's diplomatic threads in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/sharedThreads.test.js
//
// A guest could not do diplomacy: every thread it began from a country's panel,
// the map, the advisor or the War Room was made up and saved on its own screen,
// where nothing is saved, and the host refused its first line ("You are not in
// that conversation"). The host had threads of its own to fall back on.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PLAYER_REQUESTS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { isPendingSharedThread, openedThreadOf, pendingSharedThread, sayRequestFor, SAY_RECIPIENTS_MAX } from "./sharedThreads.js";

const say = (fields) => validate(PLAYER_REQUESTS.say, { t: "say", id: "0123456789abcdef", ...fields });

test("a thread begun on a player's screen waits there, and its first line asks the host to open it", () => {
  const pending = pendingSharedThread([{ name: "Republic of Estonia", code: "EST" }, { name: "" }, null], { now: () => 42 });
  assert.deepEqual(pending, { id: "pending-42", countries: [{ name: "Republic of Estonia", code: "EST" }], messages: [], status: "open", pendingShared: true });
  assert.equal(isPendingSharedThread(pending), true);
  const asked = sayRequestFor(pending, "Moscow to Tallinn.");
  assert.deepEqual(asked, { thread: null, to: ["Republic of Estonia"], text: "Moscow to Tallinn." });
  assert.equal(say(asked).ok, true);
});

test("a thread the host keeps is written into by its id, never opened again", () => {
  const stored = { id: "thread-abc-1", countries: [{ name: "Republic of Estonia" }], messages: [] };
  assert.equal(isPendingSharedThread(stored), false);
  const asked = sayRequestFor(stored, "And Riga?");
  assert.deepEqual(asked, { thread: "thread-abc-1", to: [], text: "And Riga?" });
  assert.equal(say(asked).ok, true);
});

test("a line opens a thread with no more countries than the host takes", () => {
  const many = Array.from({ length: SAY_RECIPIENTS_MAX + 3 }, (_, index) => ({ name: `Country ${index}` }));
  const asked = sayRequestFor(pendingSharedThread(many), "A conference.");
  assert.equal(asked.to.length, SAY_RECIPIENTS_MAX);
  assert.equal(say(asked).ok, true);
});

test("the thread the host opened is read from its answer, or is nobody's when it does not say", () => {
  assert.equal(openedThreadOf({ ok: true, result: { chatId: "thread-abc-1" } }), "thread-abc-1");
  assert.equal(openedThreadOf({ ok: true }), "");
  assert.equal(openedThreadOf(null), "");
});

test("every way the diplomacy panel begins a thread in a shared game leaves it pending until the host opens it", () => {
  const chat = readFileSync(new URL("../../Game/GameUI/chat.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // The list's "Start New Chat", and a country's panel, the map, the advisor or the War Room (consumePending).
  const start = chat.slice(chat.indexOf("const handleStartChat = "), chat.indexOf("const handleDeleteChat = "));
  assert.match(start, /if \(inSharedGame\(\)\) \{[\s\S]*?setActiveChat\(pendingSharedThread\(selected\)\);\s*return;/);
  const consume = chat.slice(chat.indexOf("const consumePending = "), chat.indexOf("// Waits for the initial load."));
  const shared = consume.indexOf("if (inSharedGame()) {");
  const local = consume.indexOf("const newChat = { id: newChatId()");
  assert.ok(shared > 0 && local > shared, "the shared game's branch comes before a thread is made up and saved");
  assert.match(consume.slice(shared, local), /pendingSharedThread\(\[\{ name: country\.name, code \}\]\)[\s\S]*?return prev;/);
  // A line is sent as the thread asks, and a thread the host opened is followed.
  assert.match(chat, /requestFromHost\("say", sayRequestFor\(chat, text\)\)/);
  assert.match(chat, /onSharedThreadOpened=\{setFollowThreadId\}/);
});

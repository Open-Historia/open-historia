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
import {
  afterSharedSay,
  followSharedThread,
  isPendingSharedThread,
  openedThreadOf,
  pendingSharedThread,
  sayRequestFor,
  SAY_RECIPIENTS_MAX,
  SHARED_THREAD_FOLLOW_MS,
  sharedFollowStep,
} from "./sharedThreads.js";

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
  assert.match(chat, /requestFromHost\("say", sayRequestFor\(target, text\)\)/);
  assert.match(chat, /onSharedThreadOpened=\{followThreadFromAck\}/);
});

test("the host's answer to a line decides whether the composer opens again, the thread is followed, or the player goes back", () => {
  const pending = pendingSharedThread([{ name: "Republic of Estonia" }]);
  const stored = { id: "thread-abc-1", countries: [{ name: "Republic of Estonia" }] };
  assert.deepEqual(afterSharedSay(pending, { ok: false, error: " You are not in that conversation. " }), { kind: "refused", error: "You are not in that conversation." });
  assert.deepEqual(afterSharedSay(stored, null), { kind: "refused", error: "" });
  assert.deepEqual(afterSharedSay(stored, { ok: true }), { kind: "said" });
  assert.deepEqual(afterSharedSay(stored, { ok: true, result: { chatId: "thread-other" } }), { kind: "said" }, "only a pending thread follows");
  assert.deepEqual(afterSharedSay(pending, { ok: true, result: { chatId: "thread-new-1" } }), { kind: "follow", thread: "thread-new-1" });
  assert.deepEqual(afterSharedSay(pending, { ok: true }), { kind: "leave" });
});

test("a pending thread follows the one the host opened while the player stays on it, and gives up in time", () => {
  let clock = 1000;
  const now = () => clock;
  const pending = pendingSharedThread([{ name: "Republic of Estonia" }], { now });
  const follow = followSharedThread("thread-new-1", { now });
  assert.deepEqual(follow, { thread: "thread-new-1", until: 1000 + SHARED_THREAD_FOLLOW_MS });
  assert.equal(followSharedThread("  ", { now }), null);
  assert.deepEqual(sharedFollowStep(null, { activeChat: pending, chats: [], now }), { kind: "none" });
  // Not in the view yet: wait, no longer than what is left.
  assert.deepEqual(sharedFollowStep(follow, { activeChat: pending, chats: [{ id: "thread-old" }], now }), { kind: "wait", delayMs: SHARED_THREAD_FOLLOW_MS });
  clock += SHARED_THREAD_FOLLOW_MS - 300;
  assert.deepEqual(sharedFollowStep(follow, { activeChat: pending, chats: [], now }), { kind: "wait", delayMs: 300 });
  // The view brings it: open it.
  const opened = { id: "thread-new-1", countries: [{ name: "Republic of Estonia" }] };
  assert.deepEqual(sharedFollowStep(follow, { activeChat: pending, chats: [null, opened], now }), { kind: "open", chat: opened });
  // The player left the pending thread: nothing to follow.
  assert.deepEqual(sharedFollowStep(follow, { activeChat: null, chats: [], now }), { kind: "drop" });
  assert.deepEqual(sharedFollowStep(follow, { activeChat: opened, chats: [], now }), { kind: "drop" });
  // It never came.
  clock += 300;
  assert.deepEqual(sharedFollowStep(follow, { activeChat: pending, chats: [], now }), { kind: "late" });
});

test("both shared-game sends shut the composer until the ack and follow a thread the host opened", () => {
  const chat = readFileSync(new URL("../../Game/GameUI/chat.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const helper = chat.slice(chat.indexOf("const sayToHost = async "), chat.indexOf("const runGroupTurn = async "));
  assert.ok(helper.length > 0);
  // Loading (which hides the composer) goes on before the request, and stays on while a thread is followed.
  assert.ok(helper.indexOf("setIsLoading(true)") < helper.indexOf('requestFromHost("say"'));
  assert.match(helper, /afterSharedSay\(target, answer\)/);
  assert.match(helper, /onSharedThreadOpened\(outcome\.thread\)/);
  assert.match(helper, /if \(!waiting\) setIsLoading\(false\)/);
  // The typed line and a line from runGroupTurn (a vote called in a pending thread) both go through it.
  const group = chat.slice(chat.indexOf("const runGroupTurn = async "), chat.indexOf("setIsLoading(true);\n            // The player's line"));
  assert.match(group, /await sayToHost\(chatOverride \|\| chat, text, nextMessages\);/);
  const submit = chat.slice(chat.indexOf("const submitPlayerText = async "), chat.indexOf("const moment = await readSeenChatMoment(gameDate);"));
  assert.match(submit, /if \(inSharedGame\(\)\) \{\s*await sayToHost\(chat, text, messagesRef\.current\);\s*return;/);
  assert.equal((chat.match(/requestFromHost\("say"/g) ?? []).length, 1, "no other path says a line to the host");
  // The composer is only drawn while nothing is loading.
  assert.match(chat, /\) : !isLoading \? \(\s*<div data-diplomacy-composer="modern"/);
  // The list says why the player is back there.
  assert.match(chat, /sharedFollowStep\(followThread, \{ activeChat, chats \}\)/);
  assert.match(chat, /data-shared-thread-late="true"/);
});

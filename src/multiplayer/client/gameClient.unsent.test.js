/*! Open Historia — a request the page cannot send is refused in words: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/gameClient.unsent.test.js
//
// The follow-ups of 2026-11-18, C4. The page's own check of a request is the
// host's whole check: the schema, and the size the host's session reads a
// player's message to. One the schema took and the session did not was sent,
// dropped there with a strike, and never answered; one the connection could
// not carry said the codec's English. Each is now refused before it goes, in
// words, with what refused it in the diagnostics log.
//
// Its own file, apart from gameClient.test.js, whose loopback tests can hang a
// run: these use no channel and no real timer.

import test from "node:test";
import assert from "node:assert/strict";

import { TOO_LARGE_WORDS, createGameClient, tooLongWords } from "./gameClient.js";
import { PLAYER_MESSAGE_MAX_CHARS, encodeMessage } from "../protocol/codec.js";
import { ORDER_MAX_CHARS } from "../game/messages.js";

const quietTimers = { setTimeout: () => 0, clearTimeout: () => {} };

const client = (options = {}) => {
  const sent = [];
  const logged = [];
  const made = createGameClient({ send: (message) => sent.push(message), timers: quietTimers, log: (line) => logged.push(line), ...options });
  return { made, sent, logged };
};

test("a request the schema refuses is said in words, and the schema's own words go to the log", async () => {
  const { made, sent, logged } = client();
  const long = await made.request("order", { text: "x".repeat(ORDER_MAX_CHARS + 1) });
  assert.deepEqual([long.ok, long.error], [false, tooLongWords(ORDER_MAX_CHARS)]);
  assert.match(long.detail, /\$\.text: longer than/);
  const odd = await made.request("order", {});
  assert.equal(odd.error, "This could not be sent to the host.");
  assert.doesNotMatch(odd.error, /\$\./, "no schema path reaches the player");
  assert.equal(sent.length, 0, "nothing was sent");
  assert.equal(logged.length, 2, "both are in the log, in the schema's terms");
  assert.match(logged[0], /"order" request was not sent to the host: \$\.text: longer than/);
});

test("a request larger than the host's session reads is refused before it goes, never dropped there unanswered", async () => {
  const { made, sent, logged } = client({ maxMessageChars: PLAYER_MESSAGE_MAX_CHARS });
  // The largest a player sends, under its schema: a paying device's answer, text and a function call's input.
  const answer = { text: "\"".repeat(1_000_000), toolJson: "\"".repeat(1_000_000), asText: false };
  const big = await made.request("paid", { job: "pay-1-a", answer, statuses: [] });
  assert.deepEqual([big.ok, big.error], [false, TOO_LARGE_WORDS]);
  assert.equal(sent.length, 0);
  assert.match(logged.at(-1), /"paid" request was not sent to the host: its text is \d+ characters, over the 3145728/);
  // What fits is sent as ever.
  const fits = made.request("order", { text: "Hold Narva." });
  assert.equal(sent.length, 1);
  made.receive({ t: "ack", id: sent[0].id, ok: true, error: null });
  assert.deepEqual(await fits, { ok: true, error: "" });
  // The host's own screen talks to its engine, which reads no such limit.
  const own = client();
  void own.made.request("paid", { job: "pay-1-a", answer, statuses: [] });
  assert.equal(own.sent.length, 1);
});

test("a request the connection cannot carry says so in words, its own words kept for the log", async () => {
  const { made, logged } = client({ send: (message) => encodeMessage({ ...message, pad: "x".repeat(40 * 1024 * 1024) }) });
  const answer = await made.request("order", { text: "Hold Narva." });
  assert.deepEqual([answer.ok, answer.error], [false, "This could not be sent to the host."]);
  assert.match(answer.detail, /-character message is over the/);
  assert.match(logged.at(-1), /-character message is over the/);
});

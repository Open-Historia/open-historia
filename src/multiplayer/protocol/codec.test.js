/*! Open Historia — multiplayer framing tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/protocol/codec.test.js
//
// Messages cross a data channel as frames of at most 60 KiB. A small message is
// one frame; a large one (a player's view of the world) is split and put back
// together, under caps a hostile peer cannot talk its way past.

import test from "node:test";
import assert from "node:assert/strict";
import { FRAME_LIMIT, createDecoder, encodeMessage } from "./codec.js";

const roundTrip = (message, decoder = createDecoder()) => {
  let out = null;
  for (const frame of encodeMessage(message)) {
    const result = decoder.feed(frame);
    assert.equal(result.error, undefined, result.error);
    if (result.message !== undefined) out = result.message;
  }
  return out;
};

test("a small message is one frame and arrives as it left", () => {
  const message = { t: "ping", n: 7 };
  assert.equal(encodeMessage(message).length, 1);
  assert.deepEqual(roundTrip(message), message);
});

test("a large message is split under the frame limit and reassembled, in any order", () => {
  // Quotes and backslashes double when a part is escaped into its frame; the
  // parts are sized by what they take up there.
  const quoted = { t: "chat", text: "\"\\".repeat(90_000) };
  const quotedFrames = encodeMessage(quoted);
  assert.ok(quotedFrames.every((frame) => frame.length <= FRAME_LIMIT));
  assert.deepEqual(roundTrip(quoted), quoted);

  const world = { t: "snapshot", body: "x".repeat(400_000), list: Array.from({ length: 2000 }, (_, i) => ({ i, name: `unit ${i}` })) };
  const frames = encodeMessage(world);
  assert.ok(frames.length > 5);
  assert.ok(frames.every((frame) => frame.length <= FRAME_LIMIT));
  const decoder = createDecoder();
  const shuffled = [...frames].reverse();
  let out;
  for (const frame of shuffled) {
    const result = decoder.feed(frame);
    assert.equal(result.error, undefined);
    if (result.message) out = result.message;
  }
  assert.deepEqual(out, world);
  assert.equal(decoder.pending(), 0);
});

test("hostile frames are dropped with a reason and never throw", () => {
  const decoder = createDecoder();
  for (const frame of [
    42,
    "not json",
    "x".repeat(FRAME_LIMIT + 1),
    '{"f":"m","d":{},"extra":1}',
    '{"f":"p","id":"abcdefabcdef","i":0,"n":2}',
    '{"f":"p","id":"abcdefabcdef","i":5,"n":2,"s":"x"}',
    '{"f":"p","id":"ABC","i":0,"n":2,"s":"x"}',
    '{"f":"m","d":{"__proto__":{"admin":true}}}',
    `${"[".repeat(50)}${"]".repeat(50)}`,
  ]) {
    let result;
    assert.doesNotThrow(() => { result = decoder.feed(frame); });
    assert.ok(result.error, String(frame).slice(0, 60));
  }
  assert.equal({}.admin, undefined);
});

test("reassembly is capped: announced size, parts that disagree, and how many messages may be half-arrived", () => {
  const decoder = createDecoder({ maxAssemblies: 2, maxMessageLength: 200_000 });
  const part = (id, i, n, s = "x") => JSON.stringify({ f: "p", id, i, n, s });
  assert.match(decoder.feed(part("aaaaaaaaaaaa", 0, 500)).error, /over the size limit/);
  assert.equal(decoder.feed(part("bbbbbbbbbbbb", 0, 3)).pending, true);
  assert.equal(decoder.feed(part("cccccccccccc", 0, 3)).pending, true);
  assert.match(decoder.feed(part("dddddddddddd", 0, 3)).error, /too many messages/);
  // A second copy of a part, or a part claiming another total, kills the message.
  assert.match(decoder.feed(part("bbbbbbbbbbbb", 0, 3)).error, /does not fit/);
  assert.match(decoder.feed(part("cccccccccccc", 1, 4)).error, /does not fit/);
  assert.equal(decoder.pending(), 0);
});

test("a message that never finishes is forgotten after its timeout", () => {
  let clock = 0;
  const decoder = createDecoder({ partTimeoutMs: 1000, now: () => clock });
  const part = (id, i) => JSON.stringify({ f: "p", id, i, n: 2, s: "x" });
  assert.equal(decoder.feed(part("aaaaaaaaaaaa", 0)).pending, true);
  clock = 5000;
  assert.equal(decoder.feed(part("bbbbbbbbbbbb", 0)).pending, true);
  assert.equal(decoder.pending(), 1);
});

test("the reassembled text is parsed as safely as a single frame", () => {
  const decoder = createDecoder();
  const text = `{"__proto__":{"admin":true},"pad":"${"y".repeat(70_000)}"}`;
  const size = 40 * 1024;
  const n = Math.ceil(text.length / size);
  let last;
  for (let i = 0; i < n; i += 1) {
    last = decoder.feed(JSON.stringify({ f: "p", id: "eeeeeeeeeeee", i, n, s: text.slice(i * size, (i + 1) * size) }));
  }
  assert.match(last.error, /forbidden key/);
});

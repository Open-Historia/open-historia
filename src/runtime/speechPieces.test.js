/*! Open Historia — a spoken turn read in pieces © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/speechPieces.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LEAD_IN_BLOCKS, LONGEST_PIECE_BLOCKS, PAUSE_BLOCKS, TAIL_BLOCKS, createPieceCutter, createPieceReader } from "./speechPieces.js";

const BLOCK = 1600;
// A block whose samples all hold its number, so a piece shows which blocks it is.
const block = (n) => new Float32Array(BLOCK).fill(n);
const blocksIn = (audio) => {
  const list = [];
  for (let i = 0; i < audio.length; i += BLOCK) list.push(audio[i]);
  return list;
};
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

// Feeds a pattern: "s" speech, "." silence, one character per block.
const feed = (cutter, pattern, start = 0) => {
  [...pattern].forEach((c, i) => cutter.hear(block(start + i), c === "s"));
  return start + pattern.length;
};

test("a pause cuts a piece, with its lead-in and a short tail", () => {
  const pieces = [];
  const cutter = createPieceCutter({ onPiece: (audio) => pieces.push(blocksIn(audio)) });
  // 15 blocks of quiet, 20 of speech, then a pause.
  feed(cutter, `${".".repeat(15)}${"s".repeat(20)}${".".repeat(PAUSE_BLOCKS)}`);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0], range(15 - LEAD_IN_BLOCKS, 35 + TAIL_BLOCKS));
});

test("a short gap between words does not cut; nothing is cut before a word", () => {
  const pieces = [];
  const cutter = createPieceCutter({ onPiece: (audio) => pieces.push(audio) });
  feed(cutter, `${".".repeat(40)}sss${".".repeat(PAUSE_BLOCKS - 2)}sss`);
  assert.equal(pieces.length, 0);
  cutter.flush();
  assert.equal(pieces.length, 1);
  cutter.flush();
  assert.equal(pieces.length, 1);
});

test("speech with no pause in it is cut before Whisper's 30-second window", () => {
  const pieces = [];
  const cutter = createPieceCutter({ onPiece: (audio) => pieces.push(audio) });
  feed(cutter, "s".repeat(LONGEST_PIECE_BLOCKS * 2 + 5));
  cutter.flush();
  assert.equal(pieces.length, 3);
  for (const audio of pieces) assert.ok(audio.length <= LONGEST_PIECE_BLOCKS * BLOCK);
  assert.equal(pieces.reduce((sum, audio) => sum + audio.length, 0), (LONGEST_PIECE_BLOCKS * 2 + 5) * BLOCK);
});

// A read function the test answers by hand.
const manualRead = () => {
  const calls = [];
  const read = (audio) => new Promise((resolve) => calls.push({ audio, resolve }));
  return { calls, read };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("pieces cut while the model is busy are read together in one call, in order", async () => {
  const { calls, read } = manualRead();
  const shown = [];
  const reader = createPieceReader({ read, onText: (text) => shown.push(text) });
  reader.add(new Float32Array(3).fill(1));
  await tick();
  reader.add(new Float32Array(2).fill(2));
  reader.add(new Float32Array(2).fill(3));
  await tick();
  assert.equal(calls.length, 1, "one reading at a time");
  calls[0].resolve("Move the army");
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[1].audio], [2, 2, 3, 3]);
  const done = reader.done();
  calls[1].resolve(" to the border. ");
  assert.equal(await done, "Move the army to the border.");
  assert.deepEqual(shown, ["Move the army", "Move the army to the border."]);
});

test("readings put together stay within the window", async () => {
  const { calls, read } = manualRead();
  const reader = createPieceReader({ read, longest: 5 });
  reader.add(new Float32Array(1));
  await tick();
  for (const length of [3, 2, 4]) reader.add(new Float32Array(length));
  calls[0].resolve("a");
  await tick();
  assert.equal(calls[1].audio.length, 5);
  calls[1].resolve("b");
  await tick();
  assert.equal(calls[2].audio.length, 4);
  calls[2].resolve("c");
  assert.equal(await reader.done(), "a b c");
});

test("a turn with nothing left to read is done at once; a failed reading is skipped", async () => {
  assert.equal(await createPieceReader({ read: () => "x" }).done(), "");
  const reader = createPieceReader({ read: (audio) => (audio[0] === 1 ? Promise.reject(new Error("no")) : "kept") });
  reader.add(new Float32Array(1).fill(1));
  reader.add(new Float32Array(1).fill(2));
  assert.equal(await reader.done(), "kept");
});

/*! Open Historia — saving what each leader has been shown © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.chatCursors.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// After every diplomatic reply the panel saves the cross-chat cursors
// (AI/crossChatKnowledge.js) into world state. That used to be a forced read
// and a full echoed world write per reply, with a world-updated event waking
// the map and every panel. mergeChatKnowledgeCursors merges into the saved
// world, joins calls made while one is waiting, and writes nothing when the
// cursors already stand where they are asked to.

import test from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "./assets.js";
import { mergeChatKnowledgeCursors } from "./gameState.js";

const store = new Map();
const puts = [];
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  const key = match[1];
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    puts.push({ key, prefer: init.headers?.Prefer || "" });
    store.set(key, String(init.body));
    return new Response(null, { status: 204 });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const savedCursors = () => JSON.parse(store.get("world")).chatKnowledgeCursors;

test("cursors are merged into the saved world, keeping what other threads showed", async () => {
  setRuntimeAssetEndpoints({ token: "chat-cursors-merge" });
  store.set("world", JSON.stringify({ chatKnowledgeCursors: { "t1|France": "m3" } }));
  puts.length = 0;
  assert.equal(await mergeChatKnowledgeCursors({ "t2|France": "m9" }), true);
  assert.deepEqual(savedCursors(), { "t1|France": "m3", "t2|France": "m9" });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].prefer, "return=minimal", "the write asks for no echo");
});

test("calls made while one waits are joined into one write, the later value winning", async () => {
  setRuntimeAssetEndpoints({ token: "chat-cursors-join" });
  store.set("world", JSON.stringify({ chatKnowledgeCursors: {} }));
  puts.length = 0;
  const first = mergeChatKnowledgeCursors({ "t1|Prussia": "m1" });
  const second = mergeChatKnowledgeCursors({ "t1|Prussia": "m2", "t3|Prussia": "m5" });
  await Promise.all([first, second]);
  assert.equal(puts.filter((put) => put.key === "world").length, 1);
  assert.deepEqual(savedCursors(), { "t1|Prussia": "m2", "t3|Prussia": "m5" });
});

test("nothing is written when every cursor already stands there, or when there are none", async () => {
  setRuntimeAssetEndpoints({ token: "chat-cursors-still" });
  store.set("world", JSON.stringify({ chatKnowledgeCursors: { "t1|France": "m3" } }));
  puts.length = 0;
  assert.equal(await mergeChatKnowledgeCursors({ "t1|France": "m3" }), false);
  assert.equal(await mergeChatKnowledgeCursors({}), false);
  assert.equal(await mergeChatKnowledgeCursors(null), false);
  assert.equal(puts.length, 0);
});

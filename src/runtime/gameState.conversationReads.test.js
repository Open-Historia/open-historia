/*! Open Historia — a conversation that could not be read is never taken for an empty one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.conversationReads.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// readChatsState and the advisor's read used readJson with defaultValue: [],
// which turns every failure into []. The Diplomacy panel, the advisor and the
// turn's read-modify-write then saved that short list over every
// conversation. A failed read now throws; only a missing document is empty.

import test from "node:test";
import assert from "node:assert/strict";
import { JSON_URLS, readJson, setRuntimeAssetEndpoints } from "./assets.js";
import { readAdvisorMessages, readChatsState } from "./gameState.js";

// key -> { status, body }; anything unlisted is a 404.
const answers = new Map();
globalThis.fetch = async (url) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  const answer = match ? answers.get(match[1]) : null;
  if (!answer) return new Response("missing", { status: 404 });
  // A tick of latency, so reads started together share one request.
  await new Promise((resolve) => setTimeout(resolve, 5));
  return new Response(answer.body, { status: answer.status, headers: { "Content-Type": "application/json" } });
};

const thread = { id: "chat-1", countries: [{ name: "France", code: "FRA" }], messages: [{ id: "m1", role: "leader", speaker: "France", text: "Bonjour." }] };

test("the stored conversations are read as they are", async () => {
  setRuntimeAssetEndpoints({ token: "conversation-reads-ok" });
  answers.set("chat", { status: 200, body: JSON.stringify([thread]) });
  answers.set("advisor", { status: 200, body: JSON.stringify([{ role: "advisor", text: "Sire." }]) });
  const chats = await readChatsState({ force: true });
  assert.deepEqual(chats.map((chat) => chat.id), ["chat-1"]);
  assert.deepEqual(await readAdvisorMessages({ force: true }), [{ role: "advisor", text: "Sire." }]);
});

test("a failed read throws instead of passing for an empty list", async () => {
  setRuntimeAssetEndpoints({ token: "conversation-reads-fail" });
  answers.set("chat", { status: 500, body: "{\"error\":\"disk\"}" });
  answers.set("advisor", { status: 503, body: "" });
  await assert.rejects(readChatsState({ force: true }), /HTTP 500/);
  await assert.rejects(readAdvisorMessages({ force: true }), /HTTP 503/);
  answers.set("chat", { status: 200, body: "[{\"id\": \"chat-1\", \"countries\": [" });
  await assert.rejects(readChatsState({ force: true }), SyntaxError, "a truncated file is a failure too");
});

test("a conversation that does not exist yet is empty", async () => {
  setRuntimeAssetEndpoints({ token: "conversation-reads-missing" });
  answers.delete("chat");
  answers.delete("advisor");
  assert.deepEqual(await readChatsState({ force: true }), []);
  assert.deepEqual(await readAdvisorMessages({ force: true }), []);
});

test("a read that asked for no default is not handed another caller's default", async () => {
  setRuntimeAssetEndpoints({ token: "conversation-reads-shared" });
  answers.set("chat", { status: 500, body: "" });
  // The toolbar's badge (and others) read the same document with a default,
  // at the same moment; the request is shared, the fallback is not.
  const [withDefault, strict] = await Promise.allSettled([
    readJson(JSON_URLS.chat, { defaultValue: [], force: true }),
    readChatsState({ force: true }),
  ]);
  assert.equal(withDefault.status, "fulfilled");
  assert.deepEqual(withDefault.value, []);
  assert.equal(strict.status, "rejected");
});

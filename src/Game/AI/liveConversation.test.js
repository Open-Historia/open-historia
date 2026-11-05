/*! Open Historia — which conversation a reply belongs to, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/liveConversation.test.js
//
// The player wrote to France, pressed Back while France was typing and opened
// Germany. France's reply was pushed onto Germany's history, and a failed call
// popped Germany's own last message.

import assert from "node:assert/strict";
import test from "node:test";

import { createConversationGeneration, removeEntry } from "./liveConversation.js";

test("a reply may write back while its conversation is still the one open", () => {
  const conversation = createConversationGeneration();
  const held = conversation.current();
  assert.equal(conversation.isCurrent(held), true);
});

test("opening another thread, clearing or reloading retires every reply in flight", () => {
  const conversation = createConversationGeneration();
  const france = conversation.current();
  conversation.replace(); // Germany's thread is opened
  assert.equal(conversation.isCurrent(france), false);
  const germany = conversation.current();
  assert.equal(conversation.isCurrent(germany), true);
  conversation.replace(); // back to France: a new load, not the old one
  assert.equal(conversation.isCurrent(france), false, "reopening the same thread still reloads its history");
});

test("the advisor and the diplomatic thread are counted apart", () => {
  const advisor = createConversationGeneration();
  const diplomacy = createConversationGeneration();
  const asked = advisor.current();
  diplomacy.replace();
  assert.equal(advisor.isCurrent(asked), true);
});

test("a failed call takes back its own question, not whatever is last", () => {
  const asked = { role: "user", parts: [{ text: "Will you sign?" }] };
  const later = { role: "user", parts: [{ text: "Germany's own line" }] };
  const history = [{ role: "model", parts: [{ text: "Earlier." }] }, asked, later];
  assert.equal(removeEntry(history, asked), true);
  assert.deepEqual(history, [{ role: "model", parts: [{ text: "Earlier." }] }, later]);
});

test("an entry that is no longer there removes nothing", () => {
  const history = [{ role: "user", parts: [{ text: "Germany" }] }];
  assert.equal(removeEntry(history, { role: "user", parts: [{ text: "Germany" }] }), false, "matched by identity, never by text");
  assert.equal(history.length, 1);
  assert.equal(removeEntry(null, {}), false);
});

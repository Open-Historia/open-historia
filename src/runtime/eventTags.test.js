// Run: node --test src/runtime/eventTags.test.js
//
// Runs without node_modules: eventTags.js is import-free.
import test from "node:test";
import assert from "node:assert/strict";

import { EVENT_TAG_ENUM, MAX_EVENT_TAGS, normalizeEventTags } from "./eventTags.js";

test("tags normalize case-insensitively to the enum, drop strangers and cap at three", () => {
  assert.deepEqual(normalizeEventTags(["military", " Diplomacy ", "MILITARY", "Weather", 7, "economy", "Politics"]), ["Military", "Diplomacy", "Economy"]);
  assert.equal(MAX_EVENT_TAGS, 3);
  assert.deepEqual(normalizeEventTags(undefined), []);
  assert.deepEqual(normalizeEventTags("Military"), []);
  assert.deepEqual(normalizeEventTags([]), []);
});

test("the vocabulary is the six timeline categories, frozen", () => {
  assert.deepEqual([...EVENT_TAG_ENUM], ["Military", "Diplomacy", "Economy", "Politics", "Culture", "Disaster"]);
  assert.ok(Object.isFrozen(EVENT_TAG_ENUM));
});

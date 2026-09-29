import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EMPTY_RESPONSE_BODY_NOTE,
  NO_RESPONSE_BODY_NOTE,
  isChatGenerationLikely,
  isResponseBodyNote,
  setChatGenerationInFlight,
  subscribeChatGeneration,
} from "./simulationStatus.js";

test("the chat is told when a generation starts and stops, once per change", () => {
  const seen = [];
  const unsubscribe = subscribeChatGeneration((value) => seen.push(value));
  setChatGenerationInFlight(true);
  setChatGenerationInFlight(true);
  assert.equal(isChatGenerationLikely(), true);
  setChatGenerationInFlight(false);
  setChatGenerationInFlight(undefined);
  assert.deepEqual(seen, [true, false]);

  unsubscribe();
  setChatGenerationInFlight(true);
  assert.deepEqual(seen, [true, false]);
  setChatGenerationInFlight(false);
});

test("a listener that throws does not stop the others or the flag", () => {
  const seen = [];
  const dropBroken = subscribeChatGeneration(() => {
    throw new Error("broken listener");
  });
  const dropGood = subscribeChatGeneration((value) => seen.push(value));
  setChatGenerationInFlight(true);
  assert.equal(isChatGenerationLikely(), true);
  assert.deepEqual(seen, [true]);
  setChatGenerationInFlight(false);
  dropBroken();
  dropGood();
});

test("the chat panel subscribes instead of polling the flag on a timer", () => {
  const chat = fs.readFileSync(new URL("../GameUI/chat.jsx", import.meta.url), "utf8");
  assert.match(chat, /subscribeChatGeneration\(setIsGenerating\)/);
  assert.doesNotMatch(chat, /setInterval\(\(\) => setIsGenerating/);
});

test("both response-body notes are told apart from rejected model text", () => {
  assert.equal(isResponseBodyNote(NO_RESPONSE_BODY_NOTE), true);
  assert.equal(isResponseBodyNote(EMPTY_RESPONSE_BODY_NOTE), true);
  assert.notEqual(NO_RESPONSE_BODY_NOTE, EMPTY_RESPONSE_BODY_NOTE);
  assert.equal(isResponseBodyNote("{\"events\": ["), false);
  assert.equal(isResponseBodyNote(""), false);
  assert.equal(isResponseBodyNote(undefined), false);
});

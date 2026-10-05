// Run: node --test src/Game/AI/toolTurns.test.js
//
// Lookup rounds carried from one attempt to the next: a retry, or the next
// Fallback entry, starts with the rounds already answered, as text where they
// were first asked, and with only the rest of the round budget.
import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicMessagesFromHistory,
  carriedRoundCount,
  carryLookupRound,
  createLookupCarry,
  geminiContentsFromHistory,
  withCarriedRounds,
} from "./toolTurns.js";

const prompt = { role: "user", parts: [{ text: "Simulate the next month." }] };
const calls = [{ id: "call_1", name: "list_powers", args: {}, thoughtSignature: "SIG-FROM-MODEL-A" }];
const results = [{ id: "call_1", name: "list_powers", response: { powers: ["France", "Russian Federation"] } }];

test("a fresh carry changes nothing", () => {
  const carry = createLookupCarry();
  assert.equal(carriedRoundCount(carry), 0);
  assert.deepEqual(withCarriedRounds([prompt], carry), [prompt]);
  assert.deepEqual(withCarriedRounds([prompt], null), [prompt]);
});

test("an answered round goes back in as text, where it was asked", () => {
  const carry = createLookupCarry();
  carryLookupRound(carry, 1, calls, results);
  assert.equal(carriedRoundCount(carry), 1);

  // The next Fallback entry: the same conversation.
  const next = withCarriedRounds([prompt], carry);
  assert.equal(next.length, 3);
  assert.deepEqual(next[0], prompt);
  assert.equal(next[1].role, "model");
  assert.match(next[1].parts[0].text, /Looked up list_powers\(\)/);
  assert.equal(next[2].role, "user");
  assert.match(next[2].parts[0].text, /Russian Federation/);
  assert.ok(next.every((entry) => entry.parts.every((part) => !part.functionCall && !part.functionResponse)), "no function-call parts");

  // The task's retry: the rejected answer and the correction follow the rounds.
  const rejected = { role: "model", parts: [{ text: "{\"events\":[]}" }] };
  const correction = { role: "user", parts: [{ text: "Your previous structured answer failed validation." }] };
  const retry = withCarriedRounds([prompt, rejected, correction], carry);
  assert.deepEqual(retry.map((entry) => entry.role), ["user", "model", "user", "model", "user"]);
  assert.deepEqual(retry[3], rejected);
  assert.deepEqual(retry[4], correction);
});

test("a carried round carries no thought signature to another model", () => {
  const carry = createLookupCarry();
  carryLookupRound(carry, 1, calls, results);
  const contents = geminiContentsFromHistory(withCarriedRounds([prompt], carry));
  assert.ok(!JSON.stringify(contents).includes("SIG-FROM-MODEL-A"));
  const anthropic = anthropicMessagesFromHistory(withCarriedRounds([prompt], carry));
  assert.ok(anthropic.every((message) => message.content.every((block) => block.type === "text")));
});

test("rounds add up across attempts and keep the place of the first", () => {
  const carry = createLookupCarry();
  carryLookupRound(carry, 1, calls, results);
  carryLookupRound(carry, 3, [{ id: "call_2", name: "war_ledger", args: {} }], [{ id: "call_2", name: "war_ledger", response: { wars: [] } }]);
  assert.equal(carriedRoundCount(carry), 2);
  assert.equal(carry.at, 1);
  const next = withCarriedRounds([prompt], carry);
  assert.equal(next.length, 5);
  assert.match(next[3].parts[0].text, /war_ledger/);
});

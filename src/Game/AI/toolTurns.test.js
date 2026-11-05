// Run: node --test src/Game/AI/toolTurns.test.js
//
// Lookup rounds carried from one attempt to the next: a retry, or the next
// Fallback entry, starts with the rounds already answered, as text where they
// were first asked, and with only the rest of the round budget.
import assert from "node:assert/strict";
import test from "node:test";

import {
  answerLookupCalls,
  answeredLookupKeys,
  anthropicMessagesFromHistory,
  appendLookupRound,
  carriedRoundCount,
  carryLookupRound,
  createLookupCarry,
  geminiContentsFromHistory,
  lookupCallKey,
  repeatedLookupResponse,
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

// ---------------------------------------------------------------------------
// A lookup asked a second time. From a player's log: list_projects(owner=
// "Russia", status="all") three rounds running, each round a whole request, and
// the task then out of rounds without having called the output function.

// An executor that counts what it is asked, the way the campaign's would answer.
const countingExecutor = () => {
  const asked = [];
  return {
    asked,
    execute: async (name, args) => {
      asked.push(lookupCallKey({ name, args }));
      return { answer: `${name} for ${JSON.stringify(args)}` };
    },
  };
};

test("the same function with the same arguments is the same call, whatever order the keys came in", () => {
  const first = { id: "a", name: "list_projects", args: { owner: "Russia", status: "all" } };
  const again = { id: "b", name: "list_projects", args: { status: "all", owner: "Russia" } };
  assert.equal(lookupCallKey(first), lookupCallKey(again));
  assert.equal(lookupCallKey({ name: "map_around", args: { at: { lat: 1, lng: 2 }, radius: 3 } }), lookupCallKey({ name: "map_around", args: { radius: 3, at: { lng: 2, lat: 1 } } }));
  // Nothing looser than that: another value, another function, an argument more.
  assert.notEqual(lookupCallKey(first), lookupCallKey({ name: "list_projects", args: { owner: "Russian Federation", status: "all" } }));
  assert.notEqual(lookupCallKey(first), lookupCallKey({ name: "list_powers", args: { owner: "Russia", status: "all" } }));
  assert.notEqual(lookupCallKey({ name: "list_regions", args: { owner: "X" } }), lookupCallKey({ name: "list_regions", args: { owner: "X", limit: 200 } }));
  assert.equal(lookupCallKey({ name: "list_powers" }), lookupCallKey({ name: "list_powers", args: {} }));
});

test("a call already answered in the task is told so, and is not run again", async () => {
  const { asked, execute } = countingExecutor();
  const answeredKeys = new Set();
  const call = { id: "call_1", name: "list_projects", args: { owner: "Russia", status: "all" } };

  const first = await answerLookupCalls([call], { execute, answeredKeys, outputToolName: "submit_project_ops" });
  assert.equal(first.repeated, false);
  assert.equal(first.results[0].response.answer, 'list_projects for {"owner":"Russia","status":"all"}');
  assert.equal(first.answered[0].repeated, false);
  answeredKeys.add(lookupCallKey(call));

  // The next round: the same question, the keys the other way round.
  const second = await answerLookupCalls(
    [{ id: "call_2", name: "list_projects", args: { status: "all", owner: "Russia" } }],
    { execute, answeredKeys, outputToolName: "submit_project_ops" },
  );
  assert.equal(second.repeated, true);
  assert.equal(asked.length, 1, "the campaign was read once");
  assert.deepEqual(second.results, [{ id: "call_2", name: "list_projects", response: repeatedLookupResponse("submit_project_ops") }]);
  assert.equal(second.results[0].response.alreadyAnswered, true);
  assert.match(second.results[0].response.note, /already called this function with exactly these arguments/);
  assert.match(second.results[0].response.note, /call submit_project_ops now/);
  assert.equal(second.answered[0].repeated, true);
  assert.equal(second.answered[0].error, false);
  assert.equal(second.answered[0].label, 'list_projects(status="all", owner="Russia")');
});

test("a round that mixes a repeat with a new question answers the new one and still counts as a repeat", async () => {
  const { asked, execute } = countingExecutor();
  const answeredKeys = new Set([lookupCallKey({ name: "list_powers", args: { query: "" } })]);
  const round = await answerLookupCalls([
    { id: "a", name: "list_powers", args: { query: "" } },
    { id: "b", name: "region_info", args: { regionId: "2476" } },
  ], { execute, answeredKeys, outputToolName: "submit_jump_result" });
  assert.equal(round.repeated, true);
  assert.deepEqual(asked, [lookupCallKey({ name: "region_info", args: { regionId: "2476" } })]);
  assert.equal(round.results[0].response.alreadyAnswered, true);
  assert.equal(round.results[1].response.answer, 'region_info for {"regionId":"2476"}');
  // Every call still gets an answer, in order: a provider refuses a round with one missing.
  assert.deepEqual(round.results.map((result) => result.id), ["a", "b"]);
});

test("the same call twice inside one round is carelessness, not a loop: both are run", async () => {
  const { asked, execute } = countingExecutor();
  const twice = [
    { id: "a", name: "list_powers", args: {} },
    { id: "b", name: "list_powers", args: {} },
  ];
  const round = await answerLookupCalls(twice, { execute, answeredKeys: new Set(), outputToolName: "submit_jump_result" });
  assert.equal(round.repeated, false);
  assert.equal(asked.length, 2);
});

test("what an earlier attempt had answered counts: the carry's rounds are read", async () => {
  const carry = createLookupCarry();
  assert.equal(carry.outputOnly, false);
  carryLookupRound(carry, 1, calls, results);
  const answeredKeys = answeredLookupKeys(carry.rounds);
  assert.deepEqual([...answeredKeys], [lookupCallKey({ name: "list_powers", args: {} })]);
  // The same from a conversation's own rounds.
  assert.deepEqual([...answeredLookupKeys(appendLookupRound([prompt], calls, results))], [...answeredKeys]);
  assert.equal(answeredLookupKeys(null).size, 0);

  const { asked, execute } = countingExecutor();
  const retry = await answerLookupCalls([{ id: "call_9", name: "list_powers", args: {} }], { execute, answeredKeys, outputToolName: "submit_jump_result" });
  assert.equal(retry.repeated, true);
  assert.equal(asked.length, 0);
});

test("a chat that repeats a lookup is told to answer, and a lookup that throws or returns a bare value is still answered", async () => {
  assert.match(repeatedLookupResponse().note, /answer now with what you have\.$/);
  assert.match(repeatedLookupResponse("  ").note, /answer now/);

  const round = await answerLookupCalls([
    { id: "a", name: "broken", args: {} },
    { id: "b", name: "bare", args: {} },
    { id: "c", name: "nothing", args: {} },
  ], {
    execute: async (name) => {
      if (name === "broken") throw new Error("no such region");
      return name === "bare" ? 42 : null;
    },
  });
  assert.deepEqual(round.results.map((result) => result.response), [{ error: "no such region" }, { result: 42 }, { result: null }]);
  assert.deepEqual(round.answered.map((entry) => entry.error), [true, false, false]);
  assert.equal(round.repeated, false);
  assert.deepEqual(await answerLookupCalls(null, { execute: async () => ({}) }), { results: [], answered: [], repeated: false });
});

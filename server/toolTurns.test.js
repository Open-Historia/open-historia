// Run: node --test server/toolTurns.test.js
//
// A lookup round is stored once, in Gemini's part shape, and rendered per
// provider. These tests pin the three renderings and the three readers, so a
// call the model makes on one provider is answered the same way on the others.
import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicMessagesFromHistory,
  appendLookupRound,
  geminiContentsFromHistory,
  lookupCallsFromAnthropic,
  lookupCallsFromGemini,
  lookupCallsFromOpenAI,
  lookupRoundCount,
  openAiMessagesFromHistory,
} from "../src/Game/AI/toolTurns.js";

const OUTPUT = "submit_jump_result";

const round = () => appendLookupRound(
  [{ role: "user", parts: [{ text: "Simulate the week." }] }],
  [
    { id: "call_a", name: "list_powers", args: {} },
    { id: "call_b", name: "find_region", args: { name: "Kharkiv Oblast", owner: "Ukraine" } },
  ],
  [
    { id: "call_b", name: "find_region", response: { matches: [{ id: "ukr-kharkiv", name: "Kharkiv" }] } },
    { id: "call_a", name: "list_powers", response: { powers: [{ name: "Ukraine", regions: 3 }] } },
  ],
);

test("appendLookupRound adds the model's calls and our answers, paired by id", () => {
  const history = round();
  assert.equal(history.length, 3);
  assert.equal(history[1].role, "model");
  assert.deepEqual(history[1].parts.map((part) => part.functionCall.name), ["list_powers", "find_region"]);
  assert.equal(history[2].role, "user");
  // Answers come back in CALL order, whatever order the executor produced them.
  assert.deepEqual(history[2].parts.map((part) => part.functionResponse.name), ["list_powers", "find_region"]);
  assert.deepEqual(history[2].parts[1].functionResponse.response, { matches: [{ id: "ukr-kharkiv", name: "Kharkiv" }] });
  assert.equal(lookupRoundCount(history), 1);
});

test("a call without a result is answered with an error, never silently dropped", () => {
  const history = appendLookupRound([], [{ id: "x", name: "war_ledger", args: {} }], []);
  assert.deepEqual(history[1].parts[0].functionResponse.response, { error: "no result" });
});

test("gemini: contents carry the parts without our ids and wrap a non-object answer", () => {
  const history = appendLookupRound(
    [{ role: "user", parts: [{ text: "hi" }] }],
    [{ id: "c1", name: "list_units", args: { owner: "Ukraine" } }],
    [{ id: "c1", name: "list_units", response: "twelve" }],
  );
  const contents = geminiContentsFromHistory(history);
  assert.deepEqual(contents[0], { role: "user", parts: [{ text: "hi" }] });
  assert.deepEqual(contents[1], { role: "model", parts: [{ functionCall: { name: "list_units", args: { owner: "Ukraine" } } }] });
  assert.deepEqual(contents[2], { role: "user", parts: [{ functionResponse: { name: "list_units", response: { result: "twelve" } } }] });
});

test("gemini: the reader keeps every call except the output function", () => {
  const data = { candidates: [{ content: { parts: [
    { functionCall: { name: "list_powers", args: {} } },
    { functionCall: { name: OUTPUT, args: { events: [] } } },
    { functionCall: { name: "find_city", args: { name: "Kharkiv" } } },
  ] } }] };
  const calls = lookupCallsFromGemini(data, OUTPUT);
  assert.deepEqual(calls.map((call) => call.name), ["list_powers", "find_city"]);
  assert.ok(calls.every((call) => call.id.startsWith("call_")));
  assert.deepEqual(calls[1].args, { name: "Kharkiv" });
});

test("openai: a round renders as an assistant tool_calls turn and one tool message per call", () => {
  const messages = openAiMessagesFromHistory("SYSTEM", round());
  assert.deepEqual(messages[0], { role: "system", content: "SYSTEM" });
  assert.deepEqual(messages[1], { role: "user", content: "Simulate the week." });
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, null);
  assert.deepEqual(messages[2].tool_calls.map((call) => [call.id, call.type, call.function.name]), [
    ["call_a", "function", "list_powers"],
    ["call_b", "function", "find_region"],
  ]);
  assert.equal(messages[2].tool_calls[1].function.arguments, JSON.stringify({ name: "Kharkiv Oblast", owner: "Ukraine" }));
  assert.deepEqual(messages.slice(3).map((message) => [message.role, message.tool_call_id]), [["tool", "call_a"], ["tool", "call_b"]]);
  assert.deepEqual(JSON.parse(messages[4].content), { matches: [{ id: "ukr-kharkiv", name: "Kharkiv" }] });
});

test("openai: plain text turns render exactly as before", () => {
  const messages = openAiMessagesFromHistory("S", [
    { role: "user", parts: [{ text: "one" }] },
    { role: "model", parts: [{ text: "two" }] },
  ]);
  assert.deepEqual(messages.slice(1), [{ role: "user", content: "one" }, { role: "assistant", content: "two" }]);
});

test("openai: the reader parses string arguments and keeps the provider's ids", () => {
  const data = { choices: [{ message: { tool_calls: [
    { id: "call_9", type: "function", function: { name: "find_region", arguments: "{\"name\":\"Crimea\"}" } },
    { id: "call_10", type: "function", function: { name: OUTPUT, arguments: "{}" } },
    { id: "call_11", type: "function", function: { name: "list_powers", arguments: "not json" } },
  ] } }] };
  const calls = lookupCallsFromOpenAI(data, OUTPUT);
  assert.deepEqual(calls, [
    { id: "call_9", name: "find_region", args: { name: "Crimea" } },
    { id: "call_11", name: "list_powers", args: {} },
  ]);
});

test("anthropic: a round renders as tool_use and tool_result blocks", () => {
  const messages = anthropicMessagesFromHistory(round());
  assert.deepEqual(messages[0], { role: "user", content: [{ type: "text", text: "Simulate the week." }] });
  assert.equal(messages[1].role, "assistant");
  assert.deepEqual(messages[1].content.map((block) => [block.type, block.id, block.name]), [
    ["tool_use", "call_a", "list_powers"],
    ["tool_use", "call_b", "find_region"],
  ]);
  assert.deepEqual(messages[1].content[1].input, { name: "Kharkiv Oblast", owner: "Ukraine" });
  assert.equal(messages[2].role, "user");
  assert.deepEqual(messages[2].content.map((block) => [block.type, block.tool_use_id]), [["tool_result", "call_a"], ["tool_result", "call_b"]]);
  assert.deepEqual(JSON.parse(messages[2].content[0].content), { powers: [{ name: "Ukraine", regions: 3 }] });
});

test("anthropic: the reader keeps tool_use blocks except the output function", () => {
  const data = { content: [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: "toolu_1", name: "region_info", input: { regionId: "ukr-kharkiv" } },
    { type: "tool_use", id: "toolu_2", name: OUTPUT, input: {} },
  ] };
  assert.deepEqual(lookupCallsFromAnthropic(data, OUTPUT), [{ id: "toolu_1", name: "region_info", args: { regionId: "ukr-kharkiv" } }]);
});

test("a second round appends after the first, and the count follows", () => {
  const history = appendLookupRound(round(), [{ id: "c", name: "war_ledger", args: {} }], [{ id: "c", name: "war_ledger", response: { wars: [] } }]);
  assert.equal(history.length, 5);
  assert.equal(lookupRoundCount(history), 2);
  assert.equal(openAiMessagesFromHistory("S", history).length, 1 + 1 + 1 + 2 + 1 + 1);
});

test("a call is described on one line, long strings cut", async () => {
  const { describeLookupCall } = await import("../src/Game/AI/toolTurns.js");
  assert.equal(describeLookupCall({ name: "list_powers", args: {} }), "list_powers()");
  assert.equal(describeLookupCall({ name: "find_region", args: { name: "Kharkiv Oblast", owner: "Ukraine" } }), "find_region(name=\"Kharkiv Oblast\", owner=\"Ukraine\")");
  assert.equal(describeLookupCall({ name: "list_regions", args: { owner: "Ukraine", limit: 5, nested: { a: 1 } } }), "list_regions(owner=\"Ukraine\", limit=5, nested={\"a\":1})");
  assert.equal(describeLookupCall({ name: "recent_events", args: { about: "x".repeat(80) } }, { maxValue: 10 }), "recent_events(about=\"xxxxxxxxxx…\")");
  assert.equal(describeLookupCall({}), "?()");
});

test("gemini: a thoughtSignature travels from the answer, through the round, back into contents", () => {
  const data = { candidates: [{ content: { parts: [
    { functionCall: { name: "list_powers", args: {} }, thoughtSignature: "sig-one" },
    { functionCall: { name: "find_region", args: { name: "Kharkiv" } } },
  ] } }] };
  const calls = lookupCallsFromGemini(data, OUTPUT);
  assert.equal(calls[0].thoughtSignature, "sig-one");
  assert.equal("thoughtSignature" in calls[1], false);
  const history = appendLookupRound([{ role: "user", parts: [{ text: "go" }] }], calls, calls.map((call) => ({ id: call.id, name: call.name, response: { ok: true } })));
  assert.equal(history[1].parts[0].thoughtSignature, "sig-one");
  assert.equal("thoughtSignature" in history[1].parts[1], false);
  const contents = geminiContentsFromHistory(history);
  assert.deepEqual(contents[1].parts[0], { functionCall: { name: "list_powers", args: {} }, thoughtSignature: "sig-one" });
  assert.deepEqual(contents[1].parts[1], { functionCall: { name: "find_region", args: { name: "Kharkiv" } } });
  // The other providers never see it.
  assert.equal(JSON.stringify(openAiMessagesFromHistory("S", history)).includes("sig-one"), false);
  assert.equal(JSON.stringify(anthropicMessagesFromHistory(history)).includes("sig-one"), false);
});

/*! Open Historia — a shared round's request, carried to the device that pays for it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/roundCarrier.test.js
//
// Both ends of a request carried to the paying player's device (the owner's
// decision 14): the host's callAI hands the request it built to the round's
// carrier, only for the round's own calls; the paying device asks its own AI
// with it exactly as built, adding nothing; and the answer goes back in the
// shape the host's task runner reads a provider's answer in.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { answerOf, carriedCall, carriedRequestOf, installRoundCarrier, payerCallOf, roundCarried } from "./roundCarrier.js";
import { createRoundPayers } from "../../multiplayer/host/roundPayers.js";
import { HOST_MESSAGES, PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";
import { withDifficultyPriority } from "../../runtime/difficulty.js";

const PROMPT = "[Difficulty]\n\nThe world, every player's orders and secrets.\n\nWrite in German.";
const HISTORY = [{ role: "user", parts: [{ text: "Simulate the next 30 days." }] }];
const TOOL = { name: "submit_jump", description: "The period.", schema: { type: "object", properties: { events: { type: "array" } } } };

test("what crosses is the request as built, in plain JSON, and nothing of the host's own machinery", () => {
  const call = carriedRequestOf({
    systemPrompt: PROMPT,
    history: HISTORY,
    opts: { tool: TOOL, taskKey: "jumpForward", staticPrefixEnd: 14, sharedPrefixEnd: 9, promptCacheKey: "campaign-1:jump", signal: new AbortController().signal, onActivity: () => {}, deadline: 5 },
    lookups: { tools: [{ name: "look_up_region", description: "A region.", schema: { type: "object" }, execute: () => {} }, { name: "" }], maxRounds: 3, execute: () => {}, onRound: () => {} },
  });
  assert.deepEqual(call, {
    systemPrompt: PROMPT,
    history: HISTORY,
    tool: TOOL,
    lookupTools: [{ name: "look_up_region", description: "A region.", schema: { type: "object" } }],
    maxRounds: 3,
    taskKey: "jumpForward",
    staticPrefixEnd: 14,
    sharedPrefixEnd: 9,
    promptCacheKey: "campaign-1:jump",
    maxTokens: null,
  });
  assert.equal(validate(HOST_MESSAGES.pay, { t: "pay", job: "pay-2-1", round: 2, call }).ok, true);
  assert.equal(validate(HOST_MESSAGES.pay, { t: "pay", job: "pay-2-1", round: 2, call: { ...call, apiKey: "sk-anything" } }).ok, false, "a key has nowhere to go");
});

test("only the round's own calls are carried, and only while a round is paid by another device", async () => {
  assert.equal(roundCarried(), false);
  assert.equal(carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL }, spender: "jump" }), null, "no round is being paid elsewhere");
  const seen = [];
  const uninstall = installRoundCarrier(async (call, options) => {
    seen.push({ call, options });
    return { rawText: "", toolInput: { events: [] } };
  });
  assert.equal(roundCarried(), true);
  assert.equal(carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL } }), null, "a call with no spender is not the round's: a table's answer, a stat sheet");
  const execute = async () => ({ ok: true });
  const onActivity = () => {};
  const onRequest = () => {};
  const answer = await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL, taskKey: "jumpForward", onActivity }, lookups: { tools: [{ name: "look_up_region", schema: {} }], execute }, spender: "jump", onRequest });
  assert.deepEqual(answer, { rawText: "", toolInput: { events: [] } });
  assert.equal(seen[0].call.systemPrompt, PROMPT);
  assert.equal(seen[0].options.execute, execute, "a lookup is answered by the host's own game");
  assert.equal(seen[0].options.onActivity, onActivity);
  assert.equal(seen[0].options.onRequest, onRequest, "what the device's provider said is heard as the host's own would be");
  // No lookups declared: nothing to answer.
  await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: {}, lookups: { tools: [], execute }, spender: "jumpRetry" });
  assert.equal(seen[1].options.execute, null);
  // Another round's carrier is not taken away by this one's undoing.
  const second = installRoundCarrier(async () => "");
  uninstall();
  assert.equal(roundCarried(), true);
  second();
  assert.equal(roundCarried(), false);
});

test("the paying device asks its own AI with the request as built, adding no language and no difficulty of its own", async () => {
  const call = carriedRequestOf({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL, taskKey: "jumpForward", staticPrefixEnd: 14 }, lookups: { tools: [{ name: "look_up_region", schema: { type: "object" } }], maxRounds: 2 } });
  const signal = new AbortController().signal;
  const execute = async () => ({});
  const { systemPrompt, history, opts } = payerCallOf(call, { execute, signal });
  assert.equal(systemPrompt, PROMPT);
  assert.deepEqual(history, HISTORY);
  assert.equal(opts.languageMode, "none", "the host's callAI wrote the world's language into the prompt already");
  assert.equal(opts.taskKey, "jumpForward", "the device's own choice of model for the task");
  assert.deepEqual(opts.tool, TOOL);
  assert.equal(opts.staticPrefixEnd, 14);
  assert.equal(opts.signal, signal);
  assert.deepEqual(opts.lookups, { tools: [{ name: "look_up_region", schema: { type: "object" } }], execute, maxRounds: 2 });
  const heard = () => {};
  assert.equal(payerCallOf(call, { onRequest: heard }).opts.onRequest, heard);
  assert.equal(payerCallOf(call, {}).opts.lookups, undefined, "with nobody to answer them, no lookups are offered");
  assert.equal("spender" in opts || "agentKind" in opts, false, "nothing that would let another of the device's entries answer for it");
  // The difficulty's line the host's callAI led the prompt with is kept, and the
  // device's callAI, reading its own view's level, adds none of its own.
  const led = withDifficultyPriority({ systemPrompt: "The world.", taskKey: "jumpForward", difficulty: "hard" }).systemPrompt;
  assert.equal(withDifficultyPriority({ systemPrompt: payerCallOf({ ...call, systemPrompt: led }).systemPrompt, taskKey: "jumpForward", difficulty: "easy" }).systemPrompt, led);
});

test("the answer goes back as it came, and the host reads it as a provider's", async () => {
  assert.deepEqual(answerOf("Plain words."), { text: "Plain words.", toolJson: "", asText: false });
  assert.deepEqual(answerOf({ rawText: "", toolInput: { events: [{ title: "Talks" }] } }), { text: "", toolJson: "{\"events\":[{\"title\":\"Talks\"}]}", asText: false });
  assert.deepEqual(answerOf({ rawText: "{\"events\":[]}", answeredAsText: true }), { text: "{\"events\":[]}", toolJson: "", asText: true });
  for (const result of ["Plain words.", { rawText: "", toolInput: { events: [] } }]) {
    assert.equal(validate(PLAYER_REQUESTS.paid, { t: "paid", id: "0".repeat(16), job: "pay-2-1", answer: answerOf(result) }).ok, true);
  }
  // Through the host's book of payers, the round trip ends where a provider's answer would.
  const sent = [];
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} } });
  const carry = payers.carry({ device: "device-guest", country: "Russian Federation", round: 2 });
  const waiting = carry(carriedRequestOf({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL } }), {});
  const job = sent[0].message.job;
  assert.equal(payers.answered("device-guest", { job, answer: answerOf({ rawText: "", toolInput: { events: [{ title: "Talks" }] } }) }), "");
  assert.deepEqual(await waiting, { rawText: "", toolInput: { events: [{ title: "Talks" }] } });
});

// The wiring, read from the source: callAI hands the round's calls over once
// the prompt is whole and before any provider is chosen, and the engine
// installs the carrier only around the round's own skip.
test("callAI carries the round's calls once its prompt is whole, and the engine installs the carrier around the skip alone", () => {
  const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const directive = main.indexOf("systemPrompt = `${systemPrompt}\\n\\n${directive}`;");
  const carried = main.indexOf("const carried = carriedCall({ systemPrompt, history, opts: providerOpts, lookups, spender, onRequest: observeRequest });");
  const providers = main.indexOf("const { entries, preferredEntryId } = resolveTaskFallbackEntries(providerOpts.taskKey);", directive);
  assert.ok(directive > 0 && carried > directive && providers > carried, "after the language directive, before the Fallback list");
  assert.match(main, /export async function carryRoundRequest\(call, \{ execute = null, signal = null, onRequest = null \} = \{\}\) \{\s+const \{ systemPrompt, history, opts \} = payerCallOf\(call, \{ execute, signal, onRequest \}\);\s+return answerOf\(await callAI\(systemPrompt, history, opts\)\);/);
  const engine = fs.readFileSync(new URL("../../multiplayer/host/engineMain.js", import.meta.url), "utf8");
  assert.match(engine, /const uncarry = carry \? installRoundCarrier\(carry\) : \(\) => \{\};\s+try \{[\s\S]*?await simulateTimelineJump\(\{ days: daysPerRound, signal, cannedTurn: false \}\);[\s\S]*?\} finally \{\s+uncarry\(\);/);
});

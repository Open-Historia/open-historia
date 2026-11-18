/*! Open Historia — a shared round's request, carried to the device that pays for it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/roundCarrier.test.js
//
// Both ends of a request carried to the paying player's device (the owner's
// decision 14), and the whole of callAI's contract with the task runner across
// it (the review of 2026-11-18, cost 3): the host's callAI hands the request it
// built to the round's carrier, only for the round's own calls; the paying
// device asks its own AI with it, adding nothing, held to its own settings;
// every lookup round its model begins is counted into the host's budget, and
// every round answered is kept for the task's next attempt, which starts with
// them; an answer cut at the output limit, and one written only in the
// reasoning, reach the task runner as they would from its own provider; and a
// failure comes back as its kind, raised again with the marks the task runner
// reads. A test reads runJsonTask's own call and fails on any option the
// contract does not say what becomes of.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CALL_CONTRACT, PAY_FAILURE_KINDS, answerOf, callErrorOf, carriedCall, carriedRequestOf, carriedSkipRules, failureOf,
  installRoundCarrier, payProfileOf, payerCallOf, roundCarried, skipRulesOf,
} from "./roundCarrier.js";
import { carriedRoundCount, createLookupCarry, withCarriedRounds } from "./toolTurns.js";
import { connectionClosedError, couldNotBeReached, isUnreachableError, toolStreamRefusalError } from "./providerErrors.js";
import { createRoundPayers } from "../../multiplayer/host/roundPayers.js";
import { createRoundPayer } from "../../multiplayer/client/roundPayer.js";
import { HOST_MESSAGES, PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";
import { withDifficultyPriority } from "../../runtime/difficulty.js";

const PROMPT = "[Difficulty]\n\nThe world, every player's orders and secrets.\n\nWrite in German.";
const HISTORY = [{ role: "user", parts: [{ text: "Simulate the next 30 days." }] }];
const TOOL = { name: "submit_jump", description: "The period.", schema: { type: "object", properties: { events: { type: "array" } } } };
const LOOKUP = { name: "look_up_region", description: "A region.", schema: { type: "object" } };
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

test("what crosses is the request as built, in plain JSON, with the rounds already answered and how long the host still waits", () => {
  const carry = createLookupCarry();
  carry.rounds = [
    { role: "model", parts: [{ functionCall: { id: "c1", name: "look_up_region", args: { name: "Narva" } } }] },
    { role: "user", parts: [{ functionResponse: { id: "c1", name: "look_up_region", response: { holder: { name: "Estonia", since: { year: 1991 } } } } }] },
  ];
  carry.at = 1;
  const call = carriedRequestOf({
    systemPrompt: PROMPT,
    history: HISTORY,
    opts: { tool: TOOL, taskKey: "jumpForward", staticPrefixEnd: 14, sharedPrefixEnd: 9, promptCacheKey: "campaign-1:jump", signal: new AbortController().signal, onActivity: () => {}, deadline: 900_000 },
    lookups: { tools: [{ ...LOOKUP, execute: () => {} }, { name: "" }], maxRounds: 3, execute: () => {}, onRound: () => {}, carry },
    now: () => 100_000,
  });
  assert.deepEqual(call, {
    systemPrompt: PROMPT,
    history: HISTORY,
    tool: TOOL,
    lookupTools: [LOOKUP],
    maxRounds: 3,
    taskKey: "jumpForward",
    staticPrefixEnd: 14,
    sharedPrefixEnd: 9,
    promptCacheKey: "campaign-1:jump",
    maxTokens: null,
    carried: JSON.stringify({ rounds: carry.rounds, at: 1, outputOnly: false }),
    waitMs: 800_000,
  });
  assert.equal(validate(HOST_MESSAGES.pay, { t: "pay", job: "pay-2-1", round: 2, call }).ok, true, "a lookup's answer of any depth crosses as text");
  assert.equal(validate(HOST_MESSAGES.pay, { t: "pay", job: "pay-2-1", round: 2, call: { ...call, apiKey: "sk-anything" } }).ok, false, "a key has nowhere to go");
  // Nothing answered yet, no deadline: nothing more than before.
  const bare = carriedRequestOf({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL } });
  assert.equal("carried" in bare || "waitMs" in bare, false);
});

test("only the round's own calls are carried, only while a round is paid by another device, and the skip reads the payer's own rules", async () => {
  assert.equal(roundCarried(), false);
  assert.equal(carriedSkipRules(), null);
  assert.equal(carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL }, spender: "jump" }), null, "no round is being paid elsewhere");
  const seen = [];
  const uninstall = installRoundCarrier(async (call, hooks) => {
    seen.push({ call, hooks });
    return { text: "", toolInput: { events: [] }, asText: false };
  }, { rules: { ready: true, noRequestLimit: false, lookups: true, segmented: true, declares: true }, who: "device-guest" });
  assert.equal(roundCarried(), true);
  assert.deepEqual(carriedSkipRules(), { unlimited: false, lookups: false, segmented: true, declares: true, who: "device-guest" }, "no lookups on a key with a request limit, as on the device itself");
  assert.equal(carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL } }), null, "a call with no spender is not the round's: a table's answer, a stat sheet");
  const onRequest = () => {};
  const signal = new AbortController().signal;
  const answer = await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL, taskKey: "jumpForward", signal }, lookups: { tools: [LOOKUP], execute: async () => ({}) }, spender: "jump", onRequest });
  assert.deepEqual(answer, { rawText: "", toolInput: { events: [] } });
  assert.equal(seen[0].call.systemPrompt, PROMPT);
  assert.equal(typeof seen[0].hooks.execute, "function", "a lookup is answered by the host's own game");
  assert.equal(typeof seen[0].hooks.alive, "function");
  assert.equal(seen[0].hooks.onRequest, onRequest, "what the device's provider said is heard as the host's own would be");
  assert.equal(seen[0].hooks.signal, signal);
  // No lookups declared: nothing to answer.
  await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: {}, lookups: { tools: [], execute: async () => ({}) }, spender: "jumpRetry" });
  assert.equal(seen[1].hooks.execute, null);
  // Another round's carrier is not taken away by this one's undoing.
  const second = installRoundCarrier(async () => ({ text: "" }));
  uninstall();
  assert.equal(roundCarried(), true);
  assert.equal(carriedSkipRules(), null, "a carrier installed with no rules: the host's own");
  second();
  assert.equal(roundCarried(), false);
  assert.deepEqual(skipRulesOf(payProfileOf({ noRequestLimit: true, lookups: true })), { unlimited: true, lookups: true, segmented: false, declares: false, who: "" });
  assert.deepEqual(payProfileOf({ ready: "yes", apiKey: "sk-x", lookups: true }), { ready: false, noRequestLimit: false, lookups: true, segmented: false, declares: false }, "booleans only, and nothing else");
});

test("the paying device asks its own AI with the request as built, adding no language and no difficulty, held to its own settings", () => {
  const call = carriedRequestOf({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL, taskKey: "jumpForward", staticPrefixEnd: 14 }, lookups: { tools: [LOOKUP], maxRounds: 6 } });
  const signal = new AbortController().signal;
  const execute = async () => ({});
  const { systemPrompt, history, opts, sink } = payerCallOf({ ...call, waitMs: 5000 }, { execute, signal, now: () => 1000 });
  assert.equal(systemPrompt, PROMPT);
  assert.deepEqual(history, HISTORY);
  assert.equal(opts.languageMode, "none", "the host's callAI wrote the world's language into the prompt already");
  assert.equal(opts.taskKey, "jumpForward", "the device's own choice of model for the task");
  assert.deepEqual(opts.tool, TOOL);
  assert.equal(opts.staticPrefixEnd, 14);
  assert.equal(opts.signal, signal);
  assert.equal(opts.deadline, 6000, "the host's wait, on this device's clock");
  assert.equal(opts.__debugSink, sink, "what callAI tells of the answer comes back");
  assert.deepEqual(opts.lookups.tools, [LOOKUP]);
  assert.equal(opts.lookups.maxRounds, 6);
  assert.deepEqual(opts.lookups.carry, { rounds: [], at: null, outputOnly: false });
  // Its own settings hold it, whatever it was sent.
  assert.equal(payerCallOf(call, { execute, limits: { lookups: true, rounds: 3 } }).opts.lookups.maxRounds, 3, "no more rounds than its own allow");
  assert.equal(payerCallOf(call, { execute, limits: { lookups: false, rounds: 6 } }).opts.lookups, undefined, "no lookups where its own are off");
  const heard = () => {};
  assert.equal(payerCallOf(call, { onRequest: heard }).opts.onRequest, heard);
  assert.equal(payerCallOf(call, {}).opts.lookups, undefined, "with nobody to answer them, no lookups are offered");
  assert.equal("spender" in opts || "agentKind" in opts, false, "nothing that would let another of the device's entries answer for it");
  // The difficulty's line the host's callAI led the prompt with is kept, and the
  // device's callAI, reading its own view's level, adds none of its own.
  const led = withDifficultyPriority({ systemPrompt: "The world.", taskKey: "jumpForward", difficulty: "hard" }).systemPrompt;
  assert.equal(withDifficultyPriority({ systemPrompt: payerCallOf({ ...call, systemPrompt: led }).systemPrompt, taskKey: "jumpForward", difficulty: "easy" }).systemPrompt, led);
});

test("a failure crosses as its kind, never the provider's words, and is raised again with the marks the task runner reads", () => {
  const refusal = toolStreamRefusalError("OpenAI", { message: "Service temporarily overloaded", type: "service_unavailable", code: 503 }, true);
  assert.deepEqual(failureOf(refusal), { kind: "refused", busy: true });
  assert.deepEqual(failureOf(connectionClosedError()), { kind: "closed", busy: false });
  assert.deepEqual(failureOf(Object.assign(new Error("x"), { providerFailure: couldNotBeReached() })), { kind: "unreachable", busy: false });
  assert.deepEqual(failureOf(Object.assign(new Error("Incorrect API key provided: sk-****"), { providerFailure: { kind: "unusable", reason: "401" } })), { kind: "unusable", busy: false });
  assert.deepEqual(failureOf(Object.assign(new Error("x"), { providerFailure: { kind: "tooBig", reason: "y" } })), { kind: "tooBig", busy: false });
  assert.deepEqual(failureOf(Object.assign(new Error("x"), { fallbackUnavailable: { nextResetAt: null } })), { kind: "none", busy: false });
  assert.deepEqual(failureOf(new DOMException("stopped", "AbortError")), { kind: "cancelled", busy: false });
  assert.deepEqual(failureOf(new Error("anything")), { kind: "other", busy: false });
  for (const kind of ["refused", "closed", "unreachable", "unusable", "tooBig", "none", "cancelled", "other"]) assert.ok(PAY_FAILURE_KINDS.includes(kind), kind);
  // On the host: a busy refusal is asked again after a pause; a request too big is asked the lean way; a connection is no refusal.
  const mark = (kind, busy = false) => callErrorOf(Object.assign(new Error("Russian Federation's device could not make the round's request."), { payFailure: { kind, busy } }));
  assert.deepEqual(mark("refused", true).providerRefusal, { busy: true, detail: "Russian Federation's device could not make the round's request." });
  assert.equal(mark("tooBig").providerFailure.kind, "tooBig");
  assert.equal(isUnreachableError(mark("unreachable")), true);
  assert.equal(mark("closed").connectionClosed, true);
  assert.equal(mark("spent").providerFailure, undefined, "nothing on the host's Fallback list to mark");
  const stop = new Error("The host cancelled the round.");
  assert.equal(callErrorOf(stop), stop, "a stop is the round's own, left as it is");
});

// Both ends together: the host's callAI end and book of payers, the paying
// device's end and its callAI, as main.jsx carryRoundRequest joins them.
const pairOf = ({ callAI, limits = null }) => {
  const host = { sent: [] };
  const guest = "device-guest";
  const payers = createRoundPayers({
    send: (device, message) => {
      host.sent.push(message);
      if (device === guest) payer.receive(message);
    },
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const ack = (outcome) => (typeof outcome === "string" ? { ok: !outcome, error: outcome } : { ok: true, error: "", result: outcome.result });
  const payer = createRoundPayer({
    ask: async (call, hooks) => {
      const { systemPrompt, history, opts, sink, carry } = payerCallOf(call, { ...hooks, limits });
      try {
        return answerOf(await callAI(systemPrompt, history, opts), { sink, carry });
      } catch (error) {
        throw Object.assign(error, { payFailure: failureOf(error) });
      }
    },
    answer: async (fields) => ack(payers.answered(guest, fields)),
    lookup: async (fields) => ack(await payers.lookup(guest, fields)),
    alive: (message) => payers.alive(guest, message),
  });
  payers.begin({ device: guest, country: "Russian Federation", round: 2 });
  const uninstall = installRoundCarrier(payers.carry({ device: guest, country: "Russian Federation", round: 2 }), { rules: { ready: true, noRequestLimit: true, lookups: true }, who: guest });
  return { host, payers, uninstall };
};

// A model on the paying device that looks things up over two rounds, as
// main.jsx runWithLookups drives one: each round's calls answered, then
// onRound(n) before the request that follows it.
const lookingModel = ({ answer, cut = false, reasoning = "", asks = [["look_up_region", { name: "Narva" }], ["look_up_region", { name: "Tartu" }]] }) => async (systemPrompt, history, opts) => {
  opts.onActivity?.();
  let round = 0;
  for (const [name, args] of asks) {
    if (round >= (opts.lookups?.maxRounds ?? 0)) break;
    await opts.lookups.execute(name, args);
    round += 1;
    opts.lookups.onRound(round);
  }
  if (cut) opts.__debugSink.stoppedAtOutputLimit = true;
  opts.onRequest?.(200);
  return { rawText: answer, ...(reasoning ? { reasoningText: reasoning } : {}) };
};

test("a carried skip's lookup rounds are counted into the host's budget and kept for its next attempt, which starts with them", async () => {
  const { payers, uninstall, host } = pairOf({ callAI: lookingModel({ answer: "{\"events\":[" }) });
  try {
    const counted = [];
    const looked = [];
    const carry = createLookupCarry();
    const sink = {};
    const lookups = {
      tools: [LOOKUP],
      maxRounds: 2,
      carry,
      onRound: (round) => counted.push(round),
      execute: async (name, args) => {
        looked.push(args.name);
        return { region: args.name, holder: "Republic of Estonia" };
      },
    };
    const first = await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL, taskKey: "jumpForward" }, lookups, spender: "jump", debugSink: sink });
    assert.deepEqual(first, { rawText: "{\"events\":[" });
    assert.deepEqual(looked, ["Narva", "Tartu"], "answered from the host's own game");
    assert.deepEqual(counted, [1, 2], "each lookup round the payer's model began is one of the skip's requests (runJsonTask's budget.take)");
    assert.equal(carriedRoundCount(carry), 2, "kept for the task's next attempt");
    assert.equal(carry.at, HISTORY.length);
    // The task asks again (its first answer was cut short): the next request carries those rounds,
    // so the payer's model starts with what it already looked up, and the budget has none of them to give again.
    const retry = [...HISTORY, { role: "model", parts: [{ text: "{\"events\":[" }] }, { role: "user", parts: [{ text: "Your previous structured answer failed validation." }] }];
    const call = carriedRequestOf({ systemPrompt: PROMPT, history: retry, opts: { tool: TOOL }, lookups: { ...lookups, maxRounds: 2 } });
    const { opts } = payerCallOf(call, { execute: async () => ({}) });
    assert.equal(carriedRoundCount(opts.lookups.carry), 2);
    const resumed = withCarriedRounds(retry, opts.lookups.carry);
    assert.match(JSON.stringify(resumed), /look_up_region\(name=\\"Narva\\"\)/, "the rounds go back where they were asked, as text");
    assert.equal(resumed.length, retry.length + 4);
    for (const message of host.sent.filter((entry) => entry.t === "pay")) assert.equal(validate(HOST_MESSAGES.pay, message).ok, true);
  } finally {
    uninstall();
    payers.stop();
  }
});

test("an answer cut at the payer model's limit, and one written only in its reasoning, reach the task runner as its own provider's would", async () => {
  const { payers, uninstall } = pairOf({ callAI: lookingModel({ answer: "", cut: true, reasoning: "{\"events\":[{\"title\":\"Talks\"}]}", asks: [] }) });
  try {
    const sink = {};
    const answer = await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL }, spender: "jump", debugSink: sink });
    assert.equal(sink.stoppedAtOutputLimit, true, "runJsonTask does not ask the same thing again under the same limit");
    assert.equal(answer.reasoningText, "{\"events\":[{\"title\":\"Talks\"}]}", "runJsonTask's rescue can read the answer written there");
  } finally {
    uninstall();
    payers.stop();
  }
});

test("the payer's own settings hold its request: no more lookup rounds than its own allow, whatever the host's budget", async () => {
  const { payers, uninstall } = pairOf({ callAI: lookingModel({ answer: "{}" }), limits: { lookups: true, rounds: 1 } });
  try {
    const counted = [];
    await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL }, lookups: { tools: [LOOKUP], maxRounds: 6, carry: createLookupCarry(), onRound: (round) => counted.push(round), execute: async () => ({}) }, spender: "jump" });
    assert.deepEqual(counted, [1]);
  } finally {
    uninstall();
    payers.stop();
  }
});

test("a payer's failure reaches the task runner as its kind, in the host's words, with its marks", async () => {
  for (const [thrown, check] of [
    [toolStreamRefusalError("OpenAI", { message: "Service temporarily overloaded sk-****", code: 503 }, true), (error) => assert.equal(error.providerRefusal.busy, true, "asked once more after a pause")],
    [Object.assign(new Error("context length exceeded"), { providerFailure: { kind: "tooBig", reason: "x" } }), (error) => assert.equal(error.providerFailure.kind, "tooBig", "the folded skip is asked again the lean way")],
    [connectionClosedError(), (error) => assert.equal(error.connectionClosed, true, "no refusal of the contract")],
  ]) {
    const { payers, uninstall } = pairOf({ callAI: async () => { throw thrown; } });
    try {
      const error = await carriedCall({ systemPrompt: PROMPT, history: HISTORY, opts: { tool: TOOL }, spender: "jump" }).catch((failure) => failure);
      assert.match(error.message, /^Russian Federation's device could not make the round's request: /);
      assert.doesNotMatch(error.message, /sk-|overloaded|context length/, "the provider's words stay on the paying device");
      check(error);
    } finally {
      uninstall();
      payers.stop();
    }
  }
  assert.equal(validate(PLAYER_REQUESTS.paid, { t: "paid", id: "0".repeat(16), job: "pay-2-1", failure: { kind: "refused", busy: true } }).ok, true);
  assert.equal(validate(PLAYER_REQUESTS.paid, { t: "paid", id: "0".repeat(16), job: "pay-2-1", failure: { kind: "Incorrect API key sk-1" } }).ok, false, "a kind, never words");
});

// ---- The contract, read from the source -------------------------------------

// The options runJsonTask hands callAI, read off its call: every one must be
// carried, answered, or kept by the host with a reason (CALL_CONTRACT). The
// lookups' own options are the lookups'.
const LOOKUPS_OWN = ["tools", "execute", "maxRounds", "carry", "onRound"];
const optionsOfTaskCall = () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const start = gameplay.indexOf("response = await callAI(systemPrompt, history, {");
  assert.ok(start > 0, "runJsonTask's call to callAI");
  let depth = 0;
  let end = start + "response = await callAI(systemPrompt, history, ".length;
  for (; end < gameplay.length; end += 1) {
    const char = gameplay[end];
    if (char === "{" || char === "(") depth += 1;
    if (char === "}" || char === ")") depth -= 1;
    if (depth === 0) break;
  }
  const body = gameplay.slice(start, end).split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  const keys = new Set();
  for (const match of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(match[1]);
  for (const match of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,\s*$/gm)) keys.add(match[1]);
  for (const match of body.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*[:}]/g)) keys.add(match[1]);
  return keys;
};

test("every option runJsonTask hands callAI is carried, answered, or the host's own with a reason", () => {
  const keys = optionsOfTaskCall();
  for (const key of ["tool", "lookups", "__debugSink", "onActivity", "deadline", "onRequest", "spender"]) assert.ok(keys.has(key), `${key} read off the call: ${[...keys].join(", ")}`);
  const covered = new Set([...CALL_CONTRACT.carried, ...CALL_CONTRACT.answered, ...Object.keys(CALL_CONTRACT.kept), ...LOOKUPS_OWN]);
  const unsaid = [...keys].filter((key) => !covered.has(key));
  assert.deepEqual(unsaid, [], `runJsonTask hands callAI ${unsaid.join(", ")}, and the carrier does not say what becomes of it (roundCarrier.js CALL_CONTRACT)`);
  for (const reason of Object.values(CALL_CONTRACT.kept)) assert.ok(reason.length > 20);
});

// The wiring, read from the source: callAI hands the round's calls over once
// the prompt is whole and before any provider is chosen, with the task's sink;
// the paying device joins both ends; the engine installs the carrier, with the
// payer's own rules, only around the round's own skip; and the skip reads
// those rules at each of its own decisions.
test("callAI carries the round's calls once its prompt is whole, the engine installs the carrier with the payer's rules, and the skip spends by them", () => {
  const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const directive = main.indexOf("systemPrompt = `${systemPrompt}\\n\\n${directive}`;");
  const carried = main.indexOf("const carried = carriedCall({ systemPrompt, history, opts: providerOpts, lookups, spender, onRequest: observeRequest, debugSink });");
  const providers = main.indexOf("const { entries, preferredEntryId } = resolveTaskFallbackEntries(providerOpts.taskKey);", directive);
  assert.ok(directive > 0 && carried > directive && providers > carried, "after the language directive, before the Fallback list");
  assert.match(main, /export async function carryRoundRequest\(call, \{ execute = null, signal = null, onRequest = null, onActivity = null, onRound = null \} = \{\}\) \{[\s\S]*?payerCallOf\(call, \{ execute, signal, onRequest, onActivity, onRound, limits \}\);[\s\S]*?return answerOf\(result, \{ sink, carry \}\);[\s\S]*?failed\.payFailure = failureOf\(error\);/);
  const engine = fs.readFileSync(new URL("../../multiplayer/host/engineMain.js", import.meta.url), "utf8");
  assert.match(engine, /const uncarry = carry \? installRoundCarrier\(carry, \{ rules: payer\?\.rules \?\? null, who: payer\?\.device \?\? "" \}\) : \(\) => \{\};\s+try \{[\s\S]*?await simulateTimelineJump\(\{ days: daysPerRound, signal, cannedTurn: false, onProgress \}\);[\s\S]*?\} finally \{\s+uncarry\(\);/);
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const requests = gameplay.slice(gameplay.indexOf("const createJumpRequests = "), gameplay.indexOf("const jumpTaskOptions = "));
  assert.match(requests, /const \{ unlimited \} = skipRules\(\);/);
  assert.doesNotMatch(requests, /unlimitedRequests\(\)|savingRequests\(\)/, "the budget's cap is the payer's");
  assert.equal(gameplay.match(/getMapSetting\(MAP_SETTING_KEYS\.chunkLongJumps\)/g)?.length, 1, "segments read once, in skipRules");
  assert.match(gameplay, /lookupRoundLimit\(\{ unlimited: skipRules\(\)\.unlimited \}\)/);
  assert.match(gameplay, /buildTaskLookups\(segmentBundle, \{ enabled: skipRules\(\)\.lookups \}\)/);
  assert.match(gameplay, /spending\.declares \?\? geminiDeclaresTaskFunction\(/);
  assert.match(gameplay, /spending: skipRules\(\),\s+relatedEvents,/);
  assert.match(gameplay, /if \(!roundCarried\(\)\) requestLedger\.noteJump\(/, "the host's ledger is not told a payer's requests were its own");
});

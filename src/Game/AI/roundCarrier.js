/*! Open Historia — a shared round's request, carried to the player whose device pays for it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Taking turns to pay (multiplayer/host/settings.js payment "cycle", the
// owner's decision 14): each round's AI request is made by each player's device
// in turn, on its own key, and no key is ever sent. The host's engine builds the
// round's request. Where it would send it to its own provider, callAI (main.jsx)
// hands it instead to the carrier installed for that round
// (multiplayer/host/roundPayers.js `carry`), which sends it to the paying
// device and resolves with that device's answer. runJsonTask then reads it,
// salvages it and applies it exactly as its own: the host is still the one game,
// and only the request changed hands.
//
// Where the cut is, and why there. The task runner (gameplay.js runJsonTask)
// parses, validates, salvages and decides whether to ask again, and all of that
// reads the host's own game: it cannot run on another device. What it hands
// callAI, and what it reads back from callAI besides the answer, is callAI's
// CONTRACT, and the paying device runs callAI itself (its own Fallback list,
// model, key and provider retries). So the whole of that contract crosses, both
// ways, and this file is the one place that says how (CALL_CONTRACT):
//
//   to the device     the prompt, its history, the output function, the lookup
//                     functions and how many rounds of them, the rounds an
//                     earlier attempt already had answered (`carried`), the cache
//                     fields, the output limit, and how long the host still waits;
//   from the device   each lookup the model asks for (answered by the host's own
//                     game, and kept for the task's next attempt), each lookup
//                     ROUND it begins (counted into the skip's request budget as
//                     the host's own are, lookups.onRound), that its model is
//                     still writing (the host's own silence deadline, onActivity),
//                     the status of every provider response (onRequest), and then
//                     the answer, its reasoning, whether it stopped at the model's
//                     output limit (__debugSink.stoppedAtOutputLimit), or what
//                     kind of failure it was, which the host raises again with
//                     the marks the task runner reads (a busy refusal is asked
//                     once more, a request too big is asked the lean way, a
//                     connection is no refusal).
//
// Before, the carried call was cut at callAI's return value, and everything
// else of the contract was lost: lookup rounds were never counted, a retry
// asked them all again, an answer cut at the payer's limit was asked again under
// the same limit, an answer written in the reasoning was paid for twice, and a
// failure came back as a string (the review of 2026-11-18, cost 3).
//
// Whose settings decide what the skip spends: on the payer's key, the payer's
// (the owner's rule: a time skip is one request, at most what SKIP_SPENDERS and
// the payer's own "My key has no request limit" allow). The paying device states
// them with no key (`payProfileOf`, sent on joining and when they change); the
// carrier is installed with them (`installRoundCarrier(carry, { rules })`) and
// the skip reads them in place of the host's own (`carriedSkipRules`). And the
// paying device holds every request to its own settings again (`limits` below),
// whatever it was sent.
//
// Import-free but for two import-free modules, so both ends are tested under bare node.

import { carryLookupRound } from "./toolTurns.js";
import { couldNotBeReached, isUnreachableError } from "./providerErrors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Plain JSON, as it will cross: a function or an undefined is left out.
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const offset = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const MAX_ROUNDS = 16;
// The most of the model's reasoning that goes back with an answer: enough for
// the task runner to find a whole answer written there (runJsonTask's rescue).
export const REASONING_SENT_MAX = 200_000;

// Every option runJsonTask hands callAI, and what becomes of it when the call
// is carried. A test reads runJsonTask's call (roundCarrier.test.js) and fails
// on any option that is in none of these, so a new part of the contract cannot
// be dropped without a word, which is how the first carrier lost five of them.
export const CALL_CONTRACT = Object.freeze({
  // Crosses to the paying device with the request (carriedRequestOf).
  carried: Object.freeze(["tool", "lookups", "taskKey", "staticPrefixEnd", "sharedPrefixEnd", "promptCacheKey", "maxTokens", "deadline", "signal"]),
  // Comes back from it (carriedCall's hooks and answer).
  answered: Object.freeze(["onActivity", "onRequest", "__debugSink"]),
  // The host's own, with why.
  kept: Object.freeze({
    logLabel: "names the call in the host's own log; the device's log names it as a request it paid",
    __debug: "the host keeps no telemetry record of a request its own key did not make",
    requestKind: "a skip is a player's request on whichever device pays it",
    spender: "decides only that the call is carried: on the paying device no Agent entry answers it",
    agentKind: "nothing a player started on the host's screen is carried",
    onToolStream: "no screen watches a shared round as it is written",
  }),
});

// What a device states about paying for a round, with no key: whether its AI
// list can answer a round now, and the settings that decide what a round
// spends on its key ("My key has no request limit", the AI lookup functions,
// long skips in segments), and whether its first entry asks for a skip as a
// call of the output function with the lookup functions declared beside it
// (main.jsx geminiDeclaresTaskFunction: the request whose declarations Gemini
// can refuse for their size).
export const payProfileOf = (value = {}) => ({
  ready: value?.ready === true,
  noRequestLimit: value?.noRequestLimit === true,
  lookups: value?.lookups === true,
  segmented: value?.segmented === true,
  declares: value?.declares === true,
});

// A profile as the skip reads it (gameplay.js skipRules): looking things up
// at all needs the key to have no request limit, as on the device itself
// (gameplay.js lookupFunctionsEnabled). `who` names the payer, for what the
// skip learns about its provider (the folded skip's ceiling).
export const skipRulesOf = (profile = {}, who = "") => {
  const stated = payProfileOf(profile);
  return Object.freeze({
    unlimited: stated.noRequestLimit,
    lookups: stated.noRequestLimit && stated.lookups,
    segmented: stated.segmented,
    declares: stated.declares,
    who: clean(who).slice(0, 80),
  });
};

let carrier = null;
let rules = null;

// Installed for the round a player's device pays, and taken away after it:
// returns what takes it away (and leaves another round's carrier in place).
// `rules`: the paying device's stated profile (payProfileOf), or null.
export const installRoundCarrier = (carry, { rules: stated = null, who = "" } = {}) => {
  carrier = typeof carry === "function" ? carry : null;
  rules = carrier && stated && typeof stated === "object" ? skipRulesOf(stated, who) : null;
  const installed = carrier;
  return () => {
    if (carrier === installed) {
      carrier = null;
      rules = null;
    }
  };
};
export const roundCarried = () => carrier !== null;
// The paying device's rules while a round it pays is being resolved; null otherwise.
export const carriedSkipRules = () => (carrier ? rules : null);

// The rounds an earlier attempt had answered, as they cross: JSON text, so a
// lookup's answer of any depth fits a message whose JSON is held to a depth.
const carriedRoundsText = (carry) => {
  const rounds = list(carry?.rounds);
  if (!rounds.length && carry?.outputOnly !== true) return "";
  try {
    return JSON.stringify({ rounds, at: offset(carry?.at), outputOnly: carry?.outputOnly === true });
  } catch {
    return "";
  }
};
const carriedRoundsOf = (text) => {
  if (!clean(text)) return null;
  try {
    const value = JSON.parse(String(text));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { rounds: list(value.rounds), at: offset(value.at), outputOnly: value.outputOnly === true };
  } catch {
    return null;
  }
};

// What of a call crosses to the paying device (game/messages.js "pay" `call`).
// `now`: the host's clock, for how long it still waits (`waitMs`, from the
// task's own deadline; null while it has none).
export const carriedRequestOf = ({ systemPrompt = "", history = [], opts = {}, lookups = null, now = Date.now } = {}) => {
  const tools = list(lookups?.tools).filter((entry) => clean(entry?.name) && entry?.schema).map((entry) => plain(entry));
  const maxRounds = Number.isInteger(lookups?.maxRounds) && lookups.maxRounds >= 0 ? Math.min(MAX_ROUNDS, lookups.maxRounds) : null;
  const maxTokens = Number(opts?.maxTokens) > 0 ? Math.min(1_000_000, Math.trunc(Number(opts.maxTokens))) : null;
  const carried = tools.length ? carriedRoundsText(lookups?.carry) : "";
  const deadline = Number(opts?.deadline);
  return {
    systemPrompt: String(systemPrompt ?? ""),
    history: plain(list(history)),
    tool: opts?.tool ? plain(opts.tool) : null,
    lookupTools: tools.slice(0, 32),
    maxRounds,
    taskKey: clean(opts?.taskKey).slice(0, 60),
    staticPrefixEnd: offset(opts?.staticPrefixEnd),
    sharedPrefixEnd: offset(opts?.sharedPrefixEnd),
    promptCacheKey: clean(opts?.promptCacheKey).slice(0, 200),
    maxTokens,
    ...(carried ? { carried } : {}),
    ...(Number.isFinite(deadline) && deadline > 0 ? { waitMs: Math.max(0, Math.min(86_400_000, Math.round(deadline - now()))) } : {}),
  };
};

// The kinds of failure a paying device reports (game/messages.js "paid"
// `failure`): kinds, never the provider's words, which can carry what a key's
// owner would not show everyone (the review of 2026-11-18, cost 9). The host
// says each in its own words (roundPayers.js).
export const PAY_FAILURE_KINDS = Object.freeze([
  "none", "spent", "unusable", "rateLimited", "busy", "unreachable", "closed", "tooBig", "refused", "cancelled", "unsent", "declined", "other",
]);
const PROVIDER_KINDS = new Set(["spent", "unusable", "rateLimited", "tooBig", "busy"]);

// The paying device's end: what kind of failure an error of its callAI is.
export const failureOf = (error) => {
  if (error?.providerRefusal) return { kind: "refused", busy: error.providerRefusal.busy === true };
  if (error?.connectionClosed === true) return { kind: "closed", busy: false };
  if (isUnreachableError(error)) return { kind: "unreachable", busy: false };
  const kind = error?.providerFailure?.kind;
  if (PROVIDER_KINDS.has(kind)) return { kind, busy: false };
  // Nothing in its Fallback list could answer now: Spent, Unusable or waiting out a busy spell.
  if (error?.fallbackUnavailable) return { kind: "none", busy: false };
  if (error?.name === "AbortError") return { kind: "cancelled", busy: false };
  return { kind: "other", busy: false };
};

// The host's end, what the task runner reads off an error: a failure the
// paying device reported (`payFailure`, set by roundPayers.js) is raised again
// with the marks the host's own provider would have put on it.
export const callErrorOf = (error) => {
  const failure = error?.payFailure;
  if (!error || typeof error !== "object" || !failure || typeof failure !== "object") return error;
  switch (failure.kind) {
    case "refused":
      error.providerRefusal = { busy: failure.busy === true, detail: clean(error.message).slice(0, 300) };
      break;
    case "tooBig":
      error.providerFailure = { kind: "tooBig", reason: "the paying device's AI cannot take a request this size" };
      break;
    case "unreachable":
      error.providerFailure = couldNotBeReached();
      break;
    case "closed":
      error.providerFailure = couldNotBeReached();
      error.connectionClosed = true;
      break;
    default:
      break;
  }
  return error;
};

// The host's end of one carried call: the hooks the carrier is handed, and what
// the device's answer becomes.
const hostRunOf = ({ call, lookups, onActivity, historyLength }) => {
  const execute = call.lookupTools.length && typeof lookups?.execute === "function" ? lookups.execute : null;
  // round → { calls, results }, for the task's carry.
  const rounds = new Map();
  let counted = 0;
  let ids = 0;
  // The device's model is still at work; `round`, a lookup round it has begun.
  const alive = (round = 0) => {
    try {
      onActivity?.();
    } catch {
      // a listener must never cost the round its answer
    }
    const reached = Math.min(Number.isInteger(round) && round > 0 ? round : 0, MAX_ROUNDS);
    while (counted < reached) {
      counted += 1;
      try {
        lookups?.onRound?.(counted);
      } catch {
        // as above
      }
    }
  };
  // A lookup, answered from the host's own game as the host's own task would
  // answer it (main.jsx answerLookupCalls), and kept by its round.
  const lookup = execute ? async (name, args, round = 1) => {
    alive(0);
    const asked = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    let response;
    try {
      response = await execute(clean(name), asked);
    } catch (error) {
      response = { error: clean(error?.message || error).slice(0, 300) || "The lookup failed." };
    }
    if (response == null || typeof response !== "object" || Array.isArray(response)) response = { result: response ?? null };
    const at = Number.isInteger(round) && round > 0 ? Math.min(round, MAX_ROUNDS) : 1;
    const held = rounds.get(at) ?? { calls: [], results: [] };
    ids += 1;
    const id = `carried_${at}_${ids}`;
    held.calls.push({ id, name: clean(name), args: asked });
    held.results.push({ id, name: clean(name), response });
    rounds.set(at, held);
    return response;
  } : null;
  // The rounds answered go into the task's carry, once, answer or not: its next
  // attempt starts with them, as the host's own does (toolTurns.js).
  let kept = false;
  const keep = ({ outputOnly = false } = {}) => {
    if (kept) return;
    kept = true;
    const carry = lookups?.carry;
    if (!carry || typeof carry !== "object") return;
    for (const round of [...rounds.keys()].sort((a, b) => a - b)) {
      carryLookupRound(carry, historyLength, rounds.get(round).calls, rounds.get(round).results);
    }
    if (outputOnly) carry.outputOnly = true;
  };
  const answered = (answer, sink) => {
    keep({ outputOnly: answer?.outputOnly === true });
    if (answer?.cut === true && sink && typeof sink === "object") sink.stoppedAtOutputLimit = true;
    const toolInput = answer?.toolInput && typeof answer.toolInput === "object" && !Array.isArray(answer.toolInput) ? answer.toolInput : null;
    const reasoningText = String(answer?.reasoning ?? "");
    return {
      rawText: String(answer?.text ?? ""),
      ...(toolInput ? { toolInput } : {}),
      ...(answer?.asText ? { answeredAsText: true } : {}),
      ...(reasoningText ? { reasoningText } : {}),
    };
  };
  return { hooks: { execute: lookup, alive }, keep, answered };
};

// The host's end, from callAI: null when this call is not one to carry (no
// round is being paid by another device, or the call is not the round's), or
// a promise of the paying device's answer, as callAI returns a provider's.
// `onRequest` is told the status of every provider response the paying
// device's AI gave, in order, as callAI tells it of its own; `debugSink` is the
// task runner's, told when the answer stopped at the model's output limit.
export const carriedCall = ({ systemPrompt, history, opts = {}, lookups = null, spender = "", onRequest = null, debugSink = null, now = Date.now } = {}) => {
  if (!carrier || !clean(spender)) return null;
  const carry = carrier;
  const call = carriedRequestOf({ systemPrompt, history, opts, lookups, now });
  const run = hostRunOf({
    call,
    lookups,
    onActivity: typeof opts?.onActivity === "function" ? opts.onActivity : null,
    historyLength: list(history).length,
  });
  return Promise.resolve()
    .then(() => carry(call, {
      ...run.hooks,
      onRequest: typeof onRequest === "function" ? onRequest : null,
      signal: opts?.signal ?? null,
    }))
    .then((answer) => run.answered(answer, debugSink), (error) => {
      run.keep();
      throw callErrorOf(error);
    });
};

// The paying device's end: callAI's arguments for the request it was sent.
// `execute(name, args, round)` answers a lookup (it asks the host); `onRound`
// hears each lookup round begun, `onActivity` each piece of the answer,
// `onRequest` each provider response, all for the host; `signal` stops it.
// `limits`: this device's own settings, which hold the request whatever it
// was sent: no lookups where its own are off, no more rounds than its own allow.
// `sink` is what callAI tells of the answer (cut at the output limit), and
// `carry` the lookup rounds, both for answerOf.
export const payerCallOf = (call, {
  execute = null, signal = null, onRequest = null, onActivity = null, onRound = null, limits = null, now = Date.now,
} = {}) => {
  const tools = list(call?.lookupTools).filter((entry) => clean(entry?.name) && entry?.schema);
  const ownLookups = limits ? limits.lookups !== false : true;
  const asked = Number.isInteger(call?.maxRounds) ? call.maxRounds : null;
  const own = Number.isInteger(limits?.rounds) && limits.rounds >= 0 ? limits.rounds : null;
  const maxRounds = asked === null ? own : own === null ? asked : Math.min(asked, own);
  const carry = carriedRoundsOf(call?.carried) ?? { rounds: [], at: null, outputOnly: false };
  const sink = {};
  // The lookup round the model's next calls belong to: the first, and one more
  // each time it begins another (main.jsx runWithLookups calls onRound(n)
  // before the request that follows the n-th round).
  let round = 1;
  const lookups = tools.length && typeof execute === "function" && ownLookups
    ? {
      tools,
      execute: (name, args) => execute(name, args, round),
      carry,
      onRound: (begun) => {
        if (Number.isInteger(begun) && begun > 0) round = begun + 1;
        onRound?.(begun);
      },
      ...(maxRounds !== null ? { maxRounds } : {}),
    }
    : null;
  const waitMs = Number(call?.waitMs);
  return {
    systemPrompt: String(call?.systemPrompt ?? ""),
    history: list(call?.history),
    sink,
    carry,
    opts: {
      // The host's callAI wrote the world's language and the difficulty's line
      // into the prompt already; nothing of this device's is added to it.
      languageMode: "none",
      logLabel: "a shared round's request, paid on this device",
      taskKey: clean(call?.taskKey),
      __debugSink: sink,
      ...(call?.tool ? { tool: call.tool } : {}),
      ...(offset(call?.staticPrefixEnd) !== null ? { staticPrefixEnd: call.staticPrefixEnd } : {}),
      ...(offset(call?.sharedPrefixEnd) !== null ? { sharedPrefixEnd: call.sharedPrefixEnd } : {}),
      ...(clean(call?.promptCacheKey) ? { promptCacheKey: clean(call.promptCacheKey) } : {}),
      ...(Number(call?.maxTokens) > 0 ? { maxTokens: Number(call.maxTokens) } : {}),
      ...(Number.isFinite(waitMs) && waitMs >= 0 ? { deadline: now() + waitMs } : {}),
      ...(signal ? { signal } : {}),
      ...(typeof onRequest === "function" ? { onRequest } : {}),
      ...(typeof onActivity === "function" ? { onActivity } : {}),
      ...(lookups ? { lookups } : {}),
    },
  };
};

// What goes back to the host (game/messages.js "paid" `answer`): the answer's
// text, a function call's input as JSON text, whether it was answered as text,
// the model's reasoning where the provider gave it apart, whether it stopped at
// the output limit (`sink`), and whether it asked a lookup it already had the
// answer to (`carry.outputOnly`, which holds its next attempt to the answer).
export const answerOf = (result, { sink = null, carry = null } = {}) => {
  const reasoning = result && typeof result === "object" ? String(result.reasoningText ?? "") : "";
  return {
    text: typeof result === "string" ? result : String(result?.rawText ?? ""),
    toolJson: result && typeof result === "object" && result.toolInput && typeof result.toolInput === "object" ? JSON.stringify(result.toolInput) : "",
    asText: Boolean(result && typeof result === "object" && result.answeredAsText),
    ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_SENT_MAX) } : {}),
    ...(sink?.stoppedAtOutputLimit === true ? { cut: true } : {}),
    ...(carry?.outputOnly === true ? { outputOnly: true } : {}),
  };
};

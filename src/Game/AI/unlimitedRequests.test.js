/*! Open Historia — Unlimited requests: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/unlimitedRequests.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// Unlimited requests (Settings → AI → AI requests) is for a paid key or a local
// model: the model looks things up as it needs them instead of being sent
// everything. On, a skip may be up to eight requests with six rounds of
// questions, the lookup directive says six, and the prompt is slimmer. Off,
// which is every install until the player turns it on, nothing of that is
// different: each test below says so too.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_LOOKUP_ROUNDS,
  JUMP_REQUEST_CAP,
  REQUEST_BUDGET_KEYS,
  SKIP_SPENDERS,
  UNLIMITED_JUMP_REQUEST_CAP,
  UNLIMITED_LOOKUP_ROUNDS,
  createJumpBudget,
  createMemoryStorage,
  createRequestSettings,
  describeJumpCost,
  jumpRequestCap,
  lookupRoundLimit,
} from "./requestBudget.js";
import { parkedTurnRecord, restoreJumpRequests } from "./parkedTurn.js";
import { LOOKUP_DIRECTIVE, lookupDirective } from "./lookupTools.js";
import { anthropicMessagesFromHistory, appendLookupRound, withCachedHistory } from "./toolTurns.js";
import { withToolCallReminder } from "./anthropicToolChoice.js";
import { buildRegionOwnershipText } from "./regionVocab.js";
import { LEAN_RECENT_EVENTS, LEAN_TERRITORY_CHANGES, buildPromptContext } from "./promptContext.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---- The setting ------------------------------------------------------------

test("off on a fresh install; on, Save AI requests reads off, and turning saving on turns it off", () => {
  const storage = createMemoryStorage();
  const settings = createRequestSettings({ storage });
  assert.equal(settings.unlimited(), false);
  assert.equal(settings.saveRequests(), true);

  settings.setUnlimited(true);
  assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.unlimited), "1");
  assert.equal(settings.unlimited(), true);
  assert.equal(settings.saveRequests(), false, "unlimited is saving off");

  settings.setUnlimited(false);
  assert.equal(settings.saveRequests(), true, "off again, saving is as the player last set it");

  settings.setSaveRequests(false);
  settings.setUnlimited(true);
  settings.setSaveRequests(true);
  assert.equal(settings.unlimited(), false, "saving on turns unlimited off");
  assert.equal(settings.saveRequests(), true);
  assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.unlimited), "0");
});

test("only an explicit \"1\" turns it on", () => {
  for (const value of [null, "", "0", "true", "yes"]) {
    const settings = createRequestSettings({ storage: createMemoryStorage(value === null ? {} : { [REQUEST_BUDGET_KEYS.unlimited]: value }) });
    assert.equal(settings.unlimited(), false, String(value));
  }
});

// ---- The caps and the rounds ------------------------------------------------

test("a skip's cap: three as always, eight with Unlimited requests, one more per extra segment either way", () => {
  assert.equal(JUMP_REQUEST_CAP, 3);
  assert.equal(UNLIMITED_JUMP_REQUEST_CAP, 8);
  assert.equal(jumpRequestCap(), 3);
  assert.equal(jumpRequestCap({ segments: 1, unlimited: false }), 3);
  assert.equal(jumpRequestCap({ segments: 1, unlimited: true }), 8);
  assert.equal(jumpRequestCap({ segments: 4, unlimited: true }), 11);
  assert.equal(jumpRequestCap({ segments: 4 }), 6);
});

test("the rounds of questions: three as always, six with Unlimited requests", () => {
  assert.equal(DEFAULT_LOOKUP_ROUNDS, 3);
  assert.equal(UNLIMITED_LOOKUP_ROUNDS, 6);
  assert.equal(lookupRoundLimit(), 3);
  assert.equal(lookupRoundLimit({ unlimited: true }), 6);
});

test("an unlimited skip: the skip, six rounds, and one more to be asked again; then nothing", () => {
  const budget = createJumpBudget({ cap: jumpRequestCap({ unlimited: true }), only: SKIP_SPENDERS });
  budget.reserve("jump", 1);
  assert.equal(budget.take("jump"), true);
  // The rounds runJsonTask gives the attempt (gameplay.js): what is free, never
  // past the mode's limit.
  const rounds = Math.min(budget.free, lookupRoundLimit({ unlimited: true }));
  assert.equal(rounds, 6);
  for (let round = 0; round < rounds; round += 1) assert.equal(budget.take("jumpLookup"), true, `round ${round + 1}`);
  assert.equal(budget.free, 1, "one left after the rounds");
  assert.equal(budget.take("jumpRetry"), true);
  assert.equal(budget.take("jumpLookup"), false);
  assert.equal(budget.spent, 8);
});

test("off, the skip's rounds are the two they always were", () => {
  const budget = createJumpBudget({ cap: jumpRequestCap(), only: SKIP_SPENDERS });
  budget.reserve("jump", 1);
  budget.take("jump");
  assert.equal(Math.min(budget.free, lookupRoundLimit()), 2);
});

test("what a skip is said to cost follows the mode", () => {
  assert.deepEqual(describeJumpCost({ lookups: true, unlimited: true }), { min: 1, max: 8, lookups: true, rounds: 6, unlimited: true });
  assert.deepEqual(describeJumpCost({ lookups: true, segments: 2, unlimited: true }), { min: 2, max: 9, lookups: true, rounds: 6, unlimited: true });
  // No lookups, no rounds: the mode alone adds nothing to a skip.
  assert.deepEqual(describeJumpCost({ lookups: false, unlimited: true }), { min: 1, max: 1, lookups: false, rounds: 0, unlimited: true });
  assert.deepEqual(describeJumpCost({ lookups: true }), { min: 1, max: 3, lookups: true, rounds: 3, unlimited: false });
});

test("a skip kept for its campaign goes on under the cap it was given", () => {
  const budget = createJumpBudget({ cap: jumpRequestCap({ unlimited: true }), only: SKIP_SPENDERS });
  budget.reserve("jump", 1);
  budget.take("jump");
  budget.take("jumpLookup");
  const record = parkedTurnRecord({
    campaignId: "c1",
    applyArgs: { baseGame: { round: 3, gameDate: "1930-01-01" }, result: { stopDate: "1930-02-01" }, projects: { requests: { saving: false, budget, used: 2, refused: 0 } } },
  });
  const restored = restoreJumpRequests(record.requests);
  assert.equal(restored.budget.cap, 8);
  assert.equal(restored.budget.spent, 2);
  assert.equal(restored.budget.remaining, 6);
});

test("the skip's code reads the mode where it gives the cap, the rounds and the directive", () => {
  const gameplay = source("./gameplay.js");
  assert.match(gameplay, /const unlimited = unlimitedRequests\(\);\n\s*const pieces = [^\n]+\n\s*const budget = createJumpBudget\(\{ cap: jumpRequestCap\(\{ segments: pieces, unlimited \}\), only: SKIP_SPENDERS \}\);/);
  assert.match(gameplay, /\? Math\.min\(carriedRoundCount\(lookupCarry\) \+ budget\.free, lookupRoundLimit\(\{ unlimited: unlimitedRequests\(\) \}\)\)/);
  assert.match(gameplay, /const activeLookupDirective = \(\) => \(unlimitedRequests\(\)\n\s*\? lookupDirective\(\{ rounds: lookupRoundLimit\(\{ unlimited: true \}\) \}\)\n\s*: LOOKUP_DIRECTIVE\);/);
  assert.equal(gameplay.includes("${LOOKUP_DIRECTIVE}"), false, "every task's directive goes through the mode");
  assert.equal(/blocks\.push\(LOOKUP_DIRECTIVE\)/.test(gameplay), false);
  assert.match(gameplay, /const leanLookups = lookups && unlimitedRequests\(\);/);
  const main = source("./main.jsx");
  assert.match(main, /const defaultLookupRounds = \(\) => lookupRoundLimit\(\{ unlimited: unlimitedRequests\(\) \}\);/);
  assert.equal(/\bDEFAULT_LOOKUP_ROUNDS\b/.test(main), false);
});

// ---- The directive ----------------------------------------------------------

test("rule 5 says the rounds the task has: unchanged for three, six with Unlimited requests", () => {
  assert.equal(lookupDirective(), LOOKUP_DIRECTIVE);
  assert.equal(lookupDirective({ rounds: 3 }), LOOKUP_DIRECTIVE);
  assert.match(LOOKUP_DIRECTIVE, /5\. You have at most THREE lookup rounds, and the first is the one that counts:/);
  const six = lookupDirective({ rounds: lookupRoundLimit({ unlimited: true }) });
  assert.match(six, /5\. You have at most SIX lookup rounds, and the first is the one that counts:/);
  assert.equal(six.includes("THREE"), false);
  assert.equal(six.replace("SIX", "THREE"), LOOKUP_DIRECTIVE, "nothing else in it changes");
  assert.match(lookupDirective({ rounds: 1 }), /at most ONE lookup round, /);
  assert.match(lookupDirective({ rounds: 14 }), /at most 14 lookup rounds, /);
});

// ---- Anthropic: every round reads what came before from the cache ----------

const prompt = { role: "user", parts: [{ text: "Write the skip." }] };
const callsOf = (round) => [{ id: `call-${round}`, name: "find_region", args: { name: `Place ${round}` } }];
const answersOf = (round) => [{ id: `call-${round}`, name: "find_region", response: { region: `Place ${round}` } }];
const withRounds = (count) => {
  let history = [prompt];
  for (let round = 1; round <= count; round += 1) history = appendLookupRound(history, callsOf(round), answersOf(round));
  return history;
};
const breakpointsOf = (messages) => messages.flatMap((message, index) => (Array.isArray(message.content) ? message.content : [])
  .map((block, at) => (block.cache_control ? `${index}:${at}` : null))
  .filter(Boolean));
// What the request renders up to and including its message breakpoint, the
// markers left out: the prefix the cache is keyed by.
const prefixAtBreakpoint = (messages) => {
  const [mark] = breakpointsOf(messages);
  const [index, at] = mark.split(":").map(Number);
  const strip = (block) => {
    const { cache_control: _marker, ...rest } = block;
    return rest;
  };
  return JSON.stringify([
    ...messages.slice(0, index).map((message) => ({ ...message, content: message.content.map(strip) })),
    { ...messages[index], content: messages[index].content.slice(0, at + 1).map(strip) },
  ]);
};

test("without a follow-up the conversation is sent as it was, with no breakpoint", () => {
  const messages = anthropicMessagesFromHistory([prompt]);
  assert.equal(withCachedHistory(messages), messages);
  assert.equal(withCachedHistory(messages, { followUp: false }), messages);
  assert.deepEqual(breakpointsOf(withCachedHistory(messages, { followUp: false })), []);
});

test("a follow-up marks the conversation's last block, before the reminder, and leaves the rest alone", () => {
  const messages = anthropicMessagesFromHistory(withRounds(1));
  const cached = withCachedHistory(messages, { followUp: true });
  assert.deepEqual(breakpointsOf(cached), ["2:0"], "the last tool_result");
  assert.equal(cached[2].content[0].type, "tool_result");
  assert.equal(messages[2].content[0].cache_control, undefined, "the input is not changed");
  const sent = withToolCallReminder(cached, "Call submit.");
  assert.deepEqual(breakpointsOf(sent), ["2:0"]);
  assert.equal(sent[2].content.at(-1).text, "Call submit.", "the reminder sits past the breakpoint");
});

test("each round's request begins with the whole of the round before it, so the cache has it", () => {
  for (let rounds = 0; rounds < UNLIMITED_LOOKUP_ROUNDS; rounds += 1) {
    const before = withToolCallReminder(withCachedHistory(anthropicMessagesFromHistory(withRounds(rounds)), { followUp: true }), "Reminder.");
    const after = withToolCallReminder(withCachedHistory(anthropicMessagesFromHistory(withRounds(rounds + 1)), { followUp: true }), "Reminder.");
    const cachedPrefix = prefixAtBreakpoint(before);
    const sameSpan = JSON.stringify(after.slice(0, before.length).map((message, index) => {
      const strip = (block) => {
        const { cache_control: _marker, ...rest } = block;
        return rest;
      };
      const content = message.content.map(strip);
      // The prefix ends at the block the earlier request marked.
      return index === before.length - 1 ? { ...message, content: content.slice(0, before[index].content.findIndex((block) => block.cache_control) + 1) } : { ...message, content };
    }));
    assert.equal(sameSpan, cachedPrefix, `round ${rounds + 1} reads round ${rounds} from the cache`);
  }
});

test("main.jsx pins the tail and the conversation on every round after a lookup, the last one too", () => {
  const main = source("./main.jsx");
  const calls = main.split("const followUp = lookupsAllowed || chatTools.length > 0 || lookupRoundCount(history) > 0;").length - 1;
  assert.equal(calls, 2, "both Anthropic paths");
  assert.equal(main.split("withCachedHistory(toAnthropicMessages(chatToolsRefused ? flattenLookupRounds(history) : history), { followUp })").length - 1, 2);
  // (With the shared prefix's boundary beside it: promptCache.test.js.)
  assert.equal((main.match(/buildAnthropicSystemContent\((?:system|requestSystem)Prompt, staticPrefixEnd, \{\s*followUp,/g) || []).length, 2);
  assert.equal(main.includes("{ followUp: lookupsAllowed || chatTools.length > 0 }"), false);
});

// ---- The slimmer prompt -----------------------------------------------------

const game = { country: "Ruritania", gameDate: "1930-12-01", round: 12, startDate: "1930-01-01" };
const catalog = [];
const regionOwnershipOverrides = {};
for (const [owner, count] of [["Ruritania", 30], ["Borduria", 30], ["Slavonia", 6]]) {
  for (let index = 0; index < count; index += 1) {
    const id = `${owner}-${index}`;
    catalog.push({ id, name: `${owner} province ${index}`, country: owner });
  }
}
// Thirty Bordurian provinces taken by Ruritania: thirty territorial changes.
for (let index = 0; index < 30; index += 1) regionOwnershipOverrides[`Borduria-${index}`] = "Ruritania";
const events = Array.from({ length: 12 }, (_, index) => ({
  id: `e${index + 1}`,
  date: `1930-${String(index + 1).padStart(2, "0")}-01`,
  title: `Happening number ${index + 1}`,
  description: `Something happened, the ${index + 1}th time.`,
  importance: "minor",
  impacts: {},
}));
const world = {
  customRegions: true,
  regionOwnershipOverrides,
  language: "English",
  consolidatedHistory: [{ id: "h1", summary: "The long war of the spring, told in full.", throughEventId: "", throughDate: "1929-12-31" }],
};
const contextFor = (options) => buildPromptContext({ game, world, events, actions: [], chats: [] }, {
  requiredKeys: ["worldSummary", "recentEventsLong"],
  mapSource: { regionCatalog: catalog, nationTags: {} },
  ...options,
});
const recentCount = (text) => (text.split("RECENT EVENTS:")[1].match(/Happening number \d+/g) ?? []).length;
const storySoFar = (text) => text.split("RECENT EVENTS:")[0];

test("the lean prompt: four recent events, counts only, fewer territorial changes, the same history", async () => {
  const lookups = await contextFor({ lookups: true });
  const lean = await contextFor({ lookups: true, leanLookups: true });

  assert.equal(LEAN_RECENT_EVENTS, 4);
  assert.equal(recentCount(lookups.recentEventsLong), 8);
  assert.equal(recentCount(lean.recentEventsLong), 4);
  assert.equal(storySoFar(lean.recentEventsLong), storySoFar(lookups.recentEventsLong), "the history is never cut for it");
  assert.match(storySoFar(lean.recentEventsLong), /The long war of the spring, told in full\./);

  const changes = (text) => (text.match(/^- Borduria province \d+ \(Borduria\) -> Ruritania$/gm) ?? []).length;
  assert.equal(changes(lookups.worldSummary), 30);
  assert.equal(changes(lean.worldSummary), LEAN_TERRITORY_CHANGES);
  assert.match(lean.worldSummary, /\(\+10 more; region_info and map_around say who holds a region now\)/);
  assert.match(lean.worldSummary, /region counts only/);
  assert.ok(lean.worldSummary.length < lookups.worldSummary.length);
  assert.ok(lean.recentEventsLong.length < lookups.recentEventsLong.length);
});

test("off, the prompt is today's: lean without lookups is nothing, and lookups alone are unchanged", async () => {
  const full = await contextFor({});
  const fullLean = await contextFor({ leanLookups: true });
  assert.equal(fullLean.worldSummary, full.worldSummary);
  assert.equal(fullLean.recentEventsLong, full.recentEventsLong);
  const lookups = await contextFor({ lookups: true });
  const lookupsOff = await contextFor({ lookups: true, leanLookups: false });
  assert.equal(lookupsOff.worldSummary, lookups.worldSummary);
  assert.equal(lookupsOff.recentEventsLong, lookups.recentEventsLong);
});

test("a power's count alone, without its territories, when asked for", () => {
  const regions = [
    { id: "1", name: "Copenhagen", country: "Denmark", countryCode: "DNK" },
    { id: "2", name: "Nuuk", country: "Denmark", countryCode: "GRL" },
    { id: "3", name: "Sermersooq", country: "Denmark", countryCode: "GRL" },
  ];
  const withTerritories = buildRegionOwnershipText(regions, {}, { focusTotalCap: 0 });
  assert.match(withTerritories, /^- Denmark — 3 regions; territories: Greenland \(2 regions\)$/m);
  const countsOnly = buildRegionOwnershipText(regions, {}, { focusTotalCap: 0, territories: false });
  assert.match(countsOnly, /^- Denmark — 3 regions$/m);
});

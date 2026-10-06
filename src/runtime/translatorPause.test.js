/*! Open Historia — when the translation queue rests, and for how long: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translatorPause.test.js
//
// A failed batch rests the queue. A player's log (beta 0.0.66, 2026-10-05, the
// game in Russian, a Fallback list of Gemini entries with no API key) showed
// what one rule for every failure does: three calls that could not have
// worked, "translation paused for 60s after repeated failures (No model in
// your Fallback list can answer. … no API key …)", and the same again a minute
// later, for as long as the game was open. Nothing in the list being able to
// answer is not a hiccup, and it does not pass in a minute.
//
// planTranslationPause is the rule, kept pure so it runs here; the queue's use
// of it (said once, started again when the list changes) is read as source,
// since the queue itself needs a DOM and a provider.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  BATCH_MAX_STRINGS,
  FAILURE_PAUSE_MS,
  UNAVAILABLE_PAUSES_MS,
  planTranslationPause,
} from "./translator.js";

const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

// What the Fallback list's runner throws when nothing in it can answer
// (AI/fallbackRunner.js unavailableError); nextResetAt is the first Spent
// entry's return, null when the list is only Unusable or empty.
const nothingCanAnswer = (nextResetAt = null) => Object.assign(
  new Error("No model in your Fallback list can answer. gemini-3.5-flash-lite (Gemini): no API key. Fix it in Settings → AI."),
  { fallbackUnavailable: { nextResetAt, nextEntry: null } },
);
const hiccup = () => new Error("translation response was not a JSON array");

test("nothing in the list can answer: the queue rests after one call, for a minute, then five, then half an hour", () => {
  assert.deepEqual(UNAVAILABLE_PAUSES_MS, [MINUTE, 5 * MINUTE, 30 * MINUTE]);
  let unavailable = 0;
  const rests = [];
  for (let look = 0; look < 5; look += 1) {
    const plan = planTranslationPause({ error: nothingCanAnswer(), failures: 0, unavailable, now: NOW });
    assert.equal(plan.kind, "unavailable");
    assert.equal(plan.shrink, false, "the size of the batch was never the trouble");
    rests.push(plan.pauseUntil - NOW);
    unavailable = plan.unavailable;
  }
  assert.deepEqual(rests, [MINUTE, 5 * MINUTE, 30 * MINUTE, 30 * MINUTE, 30 * MINUTE]);
});

test("an hour with no key is four looks at the list, where it was three calls a minute", () => {
  // The queue is offered a turn every ten seconds (a scan after the page
  // changes) and takes it when its rest is over.
  let cooldownUntil = 0;
  let unavailable = 0;
  const calls = [];
  for (let at = NOW; at < NOW + 60 * MINUTE; at += 10 * 1000) {
    if (at < cooldownUntil) continue;
    calls.push((at - NOW) / MINUTE);
    const plan = planTranslationPause({ error: nothingCanAnswer(), unavailable, now: at });
    cooldownUntil = plan.pauseUntil;
    unavailable = plan.unavailable;
  }
  assert.deepEqual(calls, [0, 1, 6, 36]);
});

test("every entry Spent: the queue rests until the first one comes back", () => {
  const firstBack = NOW + 7 * 60 * MINUTE;
  assert.equal(planTranslationPause({ error: nothingCanAnswer(firstBack), now: NOW }).pauseUntil, firstBack);
  assert.equal(planTranslationPause({ error: nothingCanAnswer(firstBack), unavailable: 9, now: NOW }).pauseUntil, firstBack);
  // A reset already due is not a reason to ask at once: the rest still applies.
  assert.equal(planTranslationPause({ error: nothingCanAnswer(NOW - MINUTE), now: NOW }).pauseUntil, NOW + MINUTE);
  assert.equal(planTranslationPause({ error: nothingCanAnswer(NOW + 10 * 1000), unavailable: 1, now: NOW }).pauseUntil, NOW + 5 * MINUTE);
});

test("a hiccup keeps the old rule: two more calls with a smaller batch, then a minute's rest", () => {
  assert.equal(FAILURE_PAUSE_MS, MINUTE);
  const first = planTranslationPause({ error: hiccup(), failures: 0, now: NOW });
  assert.deepEqual(first, { kind: "retry", pauseUntil: 0, failures: 1, unavailable: 0, shrink: true });
  const second = planTranslationPause({ error: hiccup(), failures: first.failures, now: NOW });
  assert.deepEqual(second, { kind: "retry", pauseUntil: 0, failures: 2, unavailable: 0, shrink: true });
  const third = planTranslationPause({ error: hiccup(), failures: second.failures, now: NOW });
  assert.deepEqual(third, { kind: "paused", pauseUntil: NOW + MINUTE, failures: 0, unavailable: 0, shrink: true });
  // An error with no message, or none at all, is a hiccup too.
  assert.equal(planTranslationPause({ error: undefined, now: NOW }).kind, "retry");
  assert.equal(planTranslationPause({ now: NOW }).kind, "retry");
});

test("the two counts do not leak into each other", () => {
  // Two hiccups, then the list goes: the hiccups are forgotten.
  const gone = planTranslationPause({ error: nothingCanAnswer(), failures: 2, unavailable: 0, now: NOW });
  assert.deepEqual([gone.failures, gone.unavailable, gone.pauseUntil], [0, 1, NOW + MINUTE]);
  // The list answers again but the reply is broken: the long rests start over.
  const back = planTranslationPause({ error: hiccup(), failures: 0, unavailable: 3, now: NOW });
  assert.deepEqual([back.failures, back.unavailable, back.pauseUntil], [1, 0, 0]);
});

test("the queue says it once, and starts again when the Fallback list changes", () => {
  const source = fs.readFileSync(new URL("./translator.js", import.meta.url), "utf8");
  const queue = source.slice(source.indexOf("const processQueue = async () => {"), source.indexOf("// ---- the Fallback list changed ----"));
  assert.ok(queue.includes("planTranslationPause({ error: result.error, failures: failureCount, unavailable: unavailableCount })"));
  // Said when the reason is new, not at every look.
  assert.match(queue, /if \(reason !== unavailableSaid\) \{\s*unavailableSaid = reason;\s*console\.warn\(/);
  // A success clears it, so the same trouble on another day is said again.
  assert.match(queue, /unavailableCount = 0;\s*unavailableSaid = "";/);

  const listener = source.slice(source.indexOf("// ---- the Fallback list changed ----"), source.indexOf("// ---- content ----"));
  // Only while it is resting for that, only once the change has settled, and
  // only when something can answer: a look that costs no request.
  assert.match(listener, /const onFallbackChanged = \(\) => \{\s*if \(!waitingForFallback \|\| stopped\) return;/);
  assert.match(listener, /if \(!\(await fallbackCanAnswer\(\)\)\) return;[\s\S]*unavailableCount = 0;\s*cooldownUntil = 0;[\s\S]*void processQueue\(\);/);
  assert.match(listener, /isFallbackListConfigured\(\)/);
  assert.match(listener, /fallbackAvailability\(\{ entries, store: fallbackStateStore \}\)\.canAnswer/);
  assert.ok(source.includes('window.addEventListener("ai:fallback-changed", onFallbackChanged);'));
  // The event the list fires is the one listened for.
  const config = fs.readFileSync(new URL("../Game/AI/providerConfig.js", import.meta.url), "utf8");
  assert.ok(config.includes('new CustomEvent("ai:fallback-changed")'));
  // The first batch after the fix is a whole one.
  assert.equal(BATCH_MAX_STRINGS, 240);
});

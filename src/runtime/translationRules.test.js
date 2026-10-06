/*! Open Historia — what the translator sends to the AI: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translationRules.test.js
//
// Every string these rules let through can cost the player a request, and
// every answer they keep is saved to the language pack for good.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createMemoryStateStore, runWithFallback } from "../Game/AI/fallbackRunner.js";
import {
  CONTENT_MAX_ARRAY,
  CONTENT_MAX_DEPTH,
  TranslationReplyError,
  aiWaitIsOver,
  authoredEventText,
  chooseTranslationBatch,
  collectContentText,
  isAuthoredEvent,
  isNumericDate,
  isTranslatable,
  readTranslationFailure,
  readTranslationReply,
  routeUnknownText,
} from "./translationRules.js";

test("only text with words is translatable: glyphs, numbers and emoji are not", () => {
  assert.equal(isTranslatable("Save game"), true);
  assert.equal(isTranslatable("  Ok  "), true);
  for (const text of ["", " ", "x", "42", "1,204", "✕", "⚔️ 🛡️", "—", "+3.5%"]) {
    assert.equal(isTranslatable(text), false, JSON.stringify(text));
  }
  assert.equal(isTranslatable("word ".repeat(700)), false, "a wall of text is not a string to translate");
});

test("a numeric date is recognised whole, so the book writes it without a request", () => {
  for (const text of ["1/8/2016", "12/31/1999", "2016-01-08", "-0218-03-01", " 2016-01-08 "]) {
    assert.equal(isNumericDate(text), true, text);
  }
  for (const text of ["Jan 8, 2016", "2016", "1/8/16", "on 2016-01-08", "2016-1-8"]) {
    assert.equal(isNumericDate(text), false, text);
  }
});

test("with a shipped pack, unknown interface text is only listed, never sent to the AI", () => {
  assert.equal(routeUnknownText("Open the ledger", { packed: true }), "missing");
  assert.equal(routeUnknownText("Open the ledger", { packed: false }), "interface");
});

test("an unknown region name goes to the AI as content, in either kind of language", () => {
  const isContent = (text) => text === "Upper Bavaria";
  assert.equal(routeUnknownText("Upper Bavaria", { packed: true, isContent }), "content");
  assert.equal(routeUnknownText("Upper Bavaria", { packed: false, isContent }), "content");
  assert.equal(routeUnknownText("Open the ledger", { packed: true, isContent }), "missing");
});

test("only a scenario's own events are content; the AI's are written in the player's language", () => {
  assert.equal(isAuthoredEvent({ source: "scenario" }), true);
  assert.equal(isAuthoredEvent({}), true, "an event with no source is an old scenario's");
  for (const source of ["ai", "fallback", "pregame", "advisor", "game-master", "manual"]) {
    assert.equal(isAuthoredEvent({ source }), false, source);
  }
  const events = [
    { source: "scenario", title: "The Treaty of Rome", description: "Six nations sign." },
    { source: "ai", title: "Riots in Lyon", description: "Written by the model." },
    { title: "Old scenario event", description: 7 },
  ];
  assert.deepEqual(authoredEventText(events), ["The Treaty of Rome", "Six nations sign.", "Old scenario event"]);
  assert.deepEqual(authoredEventText(null), []);
});

test("written content gives up its display fields and aliases, and nothing from geometry", () => {
  const payload = {
    id: "scn-1",
    name: "Fault Lines",
    description: "A world on the edge.",
    world: {
      polityOverrides: {
        FRA: { name: "French Republic", aliases: ["France", 3], note: "A founding member.", color: "#123456" },
      },
    },
    regions: {
      type: "FeatureCollection",
      features: [{ properties: { name: "Île-de-France" }, geometry: { coordinates: [[0, 0]] } }],
    },
    geometry: { name: "never read" },
  };
  assert.deepEqual(collectContentText(payload).sort(), ["A founding member.", "A world on the edge.", "Fault Lines", "France", "French Republic"]);
});

test("the content walk stops at its depth and array limits", () => {
  let nested = { name: "Too deep" };
  for (let depth = 0; depth < CONTENT_MAX_DEPTH + 1; depth += 1) nested = { child: nested };
  assert.deepEqual(collectContentText(nested), []);

  let shallow = { name: "Deep enough" };
  for (let depth = 0; depth < CONTENT_MAX_DEPTH; depth += 1) shallow = { child: shallow };
  assert.deepEqual(collectContentText(shallow), ["Deep enough"]);

  const list = (count) => Array.from({ length: count }, (_unused, index) => ({ name: `Polity ${index}` }));
  assert.equal(collectContentText({ list: list(CONTENT_MAX_ARRAY) }).length, CONTENT_MAX_ARRAY);
  assert.deepEqual(collectContentText({ list: list(CONTENT_MAX_ARRAY + 1) }), [], "a bigger array is data, not text");
});

test("the interface goes first, alone; content waits while Background AI says no", () => {
  const pending = new Set(["Kingdom of Aragon", "Open the ledger", "Close"]);
  const isContent = (text) => text === "Kingdom of Aragon";
  let asked = 0;
  const no = () => { asked += 1; return false; };

  assert.deepEqual(
    chooseTranslationBatch(pending, { isContent, contentAllowed: no }),
    { kind: "interface", strings: ["Open the ledger", "Close"] },
  );
  assert.equal(asked, 0, "the interface is never held back by the background switch");

  const onlyContent = new Set(["Kingdom of Aragon"]);
  assert.equal(chooseTranslationBatch(onlyContent, { isContent, contentAllowed: no }), null);
  assert.deepEqual(
    chooseTranslationBatch(onlyContent, { isContent, contentAllowed: () => true }),
    { kind: "content", strings: ["Kingdom of Aragon"] },
  );
  assert.equal(chooseTranslationBatch(new Set(), { contentAllowed: () => true }), null);
});

test("a reply is paired with its strings by position, only when it has one entry per string", () => {
  const batch = ["Save game", "Load game", "France"];
  assert.deepEqual(
    readTranslationReply('```json\n["Spiel speichern", "Spiel laden", "Frankreich"]\n```', batch),
    { pairs: [["Save game", "Spiel speichern"], ["Load game", "Spiel laden"], ["France", "Frankreich"]], unusable: [] },
  );

  // One merged entry would shift every later string onto its neighbour's
  // translation: nothing of such a reply is kept.
  for (const reply of ['["Spiel speichern", "Frankreich"]', '["a", "b", "c", "d"]']) {
    assert.throws(() => readTranslationReply(reply, batch), (error) => error instanceof TranslationReplyError && error.misaligned);
  }
  assert.throws(() => readTranslationReply("Here are your translations!", batch), (error) => error instanceof TranslationReplyError && !error.misaligned);
  assert.throws(() => readTranslationReply('{"Save game": "Spiel speichern"}', batch), TranslationReplyError);
});

test("an empty or non-text entry is not kept as a translation, and the source is never saved in its place", () => {
  const { pairs, unusable } = readTranslationReply('["Spiel speichern", "", {"text": "x"}, "Paris"]', ["Save game", "Load game", "Quit", "Paris"]);
  assert.deepEqual(pairs, [["Save game", "Spiel speichern"], ["Paris", "Paris"]], "a name returned unchanged is an answer");
  assert.deepEqual(unusable, ["Load game", "Quit"]);
});

// A player's log, with the game in Russian and no key in it yet: "content
// translation: call FAILED after 0.0s — nothing in the Fallback list can
// answer. (×3)", then "[i18n] translation paused for 60s after repeated
// failures (No model in your Fallback list can answer. … no API key …)", again
// every minute. The errors below are the Fallback list's own (fallbackRunner.js),
// made the way a call makes them.
const fallbackFailure = async ({ entries, attempt, now = () => 1_000_000 }) => {
  try {
    await runWithFallback({ entries, store: createMemoryStateStore(), now, attempt });
  } catch (error) {
    return error;
  }
  throw new Error("the call answered");
};
const providerError = (kind, reason) => Object.assign(new Error(`${kind} failure`), { providerFailure: { kind, reason } });
const GEMINI = [
  { id: "g1", provider: "gemini", label: "gemini-3.5-flash-lite (Gemini)" },
  { id: "g2", provider: "gemini", label: "gemini-3.1-flash-lite (Gemini)" },
];

test("a call that found nothing in the Fallback list able to answer is waited out, not tried again", async () => {
  const noKey = await fallbackFailure({ entries: GEMINI, attempt: async () => { throw providerError("unusable", "no API key"); } });
  assert.equal(noKey.message, "No model in your Fallback list can answer. gemini-3.5-flash-lite (Gemini): no API key. Fix it in Settings → AI.");
  assert.deepEqual(readTranslationFailure(noKey), { kind: "unavailable", until: null });

  const emptyList = await fallbackFailure({ entries: [], attempt: async () => "never asked" });
  assert.deepEqual(readTranslationFailure(emptyList), { kind: "unavailable", until: null });

  // Every model has used its allowance: the list knows when the first is back.
  const spent = await fallbackFailure({ entries: GEMINI, attempt: async () => { throw providerError("spent", "quota"); } });
  const waiting = readTranslationFailure(spent);
  assert.equal(waiting.kind, "unavailable");
  assert.ok(waiting.until > 1_000_000, "the time the first Spent model comes back");
});

test("any other failure is one of a run that pauses for a minute, as before", async () => {
  const busy = await fallbackFailure({ entries: [GEMINI[0]], attempt: async () => { throw providerError("busy", "503"); } });
  assert.deepEqual(readTranslationFailure(busy), { kind: "transient", until: null });
  assert.deepEqual(readTranslationFailure(new Error("network error")), { kind: "transient", until: null });
  assert.deepEqual(readTranslationFailure(new TranslationReplyError("translation response was not a JSON array")), { kind: "transient", until: null });
  assert.deepEqual(readTranslationFailure(null), { kind: "transient", until: null });
  assert.deepEqual(readTranslationFailure({ fallbackUnavailable: true }), { kind: "transient", until: null }, "only the list's own mark counts");
});

test("a wait for the AI ends when the list can answer again, or when a Spent model is back", () => {
  const noKey = { until: null };
  assert.equal(aiWaitIsOver(noKey, { canAnswer: false, now: 9e15 }), false, "no key: time alone never ends it");
  assert.equal(aiWaitIsOver(noKey, { canAnswer: true }), true, "the player added a model that can answer");

  const spent = { until: 5_000 };
  assert.equal(aiWaitIsOver(spent, { now: 4_999 }), false);
  assert.equal(aiWaitIsOver(spent, { now: 5_000 }), true, "its allowance is back");
  assert.equal(aiWaitIsOver(spent, { canAnswer: true, now: 1 }), true, "or a backup was added first");
  assert.equal(aiWaitIsOver(null), true, "not waiting at all");
});

// translator.js needs a page to run, so its side is read in its source.
test("the translator waits for the AI settings instead of counting such a failure", () => {
  const source = fs.readFileSync(new URL("./translator.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const queue = source.slice(source.indexOf("const processQueue = async () => {"), source.indexOf("// ---- content ----"));
  assert.match(queue, /const failure = result\.error \? readTranslationFailure\(result\.error\) : null;\n\s*if \(failure\?\.kind === "unavailable"\) \{\n(?:\s*\/\/[^\n]*\n)*\s*waitForAi\(result\.error, failure\);\n\s*\} else if \(result\.error\) \{/);
  assert.equal(queue.match(/noteFailure\(/g).length, 1, "counted only on the other branch");
  assert.match(queue, /if \(waitingForAi\) \{\n\s*if \(!aiWaitIsOver\(waitingForAi\)\) return;/, "nothing is sent while waiting");
  assert.match(queue, /while \(pending\.size > 0 && !stopped && !halted && !waitingForAi && /);

  const wait = source.slice(source.indexOf("const waitForAi = "), source.indexOf("const processQueue = async () => {"));
  assert.doesNotMatch(wait, /cooldownCount|halted = true|cooldownUntil/, "a wait is not a pause and never stops the session");
  assert.match(wait, /if \(reason !== lastAiWaitReason\) \{/, "the log hears a reason once");
  assert.match(wait, /aiWaitIsOver\(waitingForAi, \{ canAnswer: await fallbackListCanAnswer\(\) \}\)/);
  assert.match(source, /window\.addEventListener\("ai:fallback-changed", onFallbackChanged\);/, "the Fallback list says when it changed");
  // The event's name is providerConfig.js's.
  const provider = fs.readFileSync(new URL("../Game/AI/providerConfig.js", import.meta.url), "utf8");
  assert.match(provider, /new CustomEvent\("ai:fallback-changed"\)/);
});

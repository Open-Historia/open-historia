// Run: node --test src/runtime/fallbackTurnText.test.js
//
// I79: a turn the engine wrote itself, when the provider failed, was English
// in every game, and it stays in the timeline for good. Its sentences now come
// from a table the language packs carry, looked up whole in the player's pack
// when they are written.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { extractFromSource } from "../../scripts/i18n/extractStrings.mjs";
import { createPhraseBook } from "./phraseBook.js";
import { FALLBACK_SUGGESTION_TOPICS, FALLBACK_TURN_TEXTS, fallbackTurnText } from "./fallbackTurnText.js";

test("every sentence reaches the language packs whole", () => {
  const file = "src/runtime/fallbackTurnText.js";
  const { exact, patterns } = extractFromSource(fs.readFileSync(new URL("./fallbackTurnText.js", import.meta.url), "utf8"), file, { jsx: false, catchAll: false });
  const found = new Set([...exact.keys(), ...patterns.keys()]);
  for (const [key, text] of Object.entries(FALLBACK_TURN_TEXTS)) assert.ok(found.has(text), `${key} is read by the extractor`);
  for (const topic of FALLBACK_SUGGESTION_TOPICS) {
    assert.ok(FALLBACK_TURN_TEXTS[topic.title] && FALLBACK_TURN_TEXTS[topic.description], "every topic names sentences of the table");
  }
});

test("without a pack the sentence is the English, filled", () => {
  assert.equal(
    fallbackTurnText("orderEventTitle", { country: "France", order: "Fortify Verdun" }),
    "France acts on the order \"Fortify Verdun\"",
  );
  assert.equal(fallbackTurnText("quietEventTitle"), "The international balance remains in motion");
  assert.equal(fallbackTurnText("no-such-key"), "");
});

test("with a pack the sentence is written in the player's language, names as they are", () => {
  const book = createPhraseBook();
  book.setAll({
    "{{country}} acts on the order \"{{order}}\"": "{{country}} führt den Befehl „{{order}}“ aus",
    "Time advances without a direct order from {{country}}, but the wider system keeps shifting and building pressure.":
      "Die Zeit vergeht ohne direkten Befehl von {{country}}, doch das System verschiebt sich weiter und baut Druck auf.",
  });
  const german = (english, params) => book.format(english, params) ?? english;
  assert.equal(
    fallbackTurnText("orderEventTitle", { country: "Frankreich", order: "Verdun befestigen" }, german),
    "Frankreich führt den Befehl „Verdun befestigen“ aus",
  );
  assert.equal(
    fallbackTurnText("summaryWithoutOrders", { country: "Frankreich" }, german),
    "Die Zeit vergeht ohne direkten Befehl von Frankreich, doch das System verschiebt sich weiter und baut Druck auf.",
  );
});

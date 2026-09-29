/*! Open Historia — what the translator sends to the AI: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translationRules.test.js
//
// Every string these rules let through can cost the player a request, and
// every answer they keep is saved to the language pack for good.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_MAX_ARRAY,
  CONTENT_MAX_DEPTH,
  TranslationReplyError,
  authoredEventText,
  chooseTranslationBatch,
  collectContentText,
  isAuthoredEvent,
  isNumericDate,
  isTranslatable,
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

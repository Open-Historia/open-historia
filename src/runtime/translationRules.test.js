/*! Open Historia — what the translator translates: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translationRules.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_MAX_ARRAY,
  CONTENT_MAX_DEPTH,
  authoredEventText,
  collectContentText,
  isAuthoredEvent,
  isNumericDate,
  isTranslatable,
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

test("a numeric date is recognised whole, so the book writes it", () => {
  for (const text of ["1/8/2016", "12/31/1999", "2016-01-08", "-0218-03-01", " 2016-01-08 "]) {
    assert.equal(isNumericDate(text), true, text);
  }
  for (const text of ["Jan 8, 2016", "2016", "1/8/16", "on 2016-01-08", "2016-1-8"]) {
    assert.equal(isNumericDate(text), false, text);
  }
});

test("with a shipped pack, unknown interface text is only listed, never translated live", () => {
  assert.equal(routeUnknownText("Open the ledger", { packed: true }), "missing");
  assert.equal(routeUnknownText("Open the ledger", { packed: false }), "interface");
});

test("an unknown region name goes to the model as content, in either kind of language", () => {
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

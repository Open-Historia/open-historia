/*! Open Historia — phrase book tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/phraseBook.test.js
//
// The shipped language packs translate the interface by the English the game
// renders: exactly, or by a pattern around a value ("Found {{count}} regions").
// These pin how a rendered string finds its translation, and the guards that
// keep a short pattern from rewriting prose that merely starts with its words.

import test from "node:test";
import assert from "node:assert/strict";

import { compilePattern, createPhraseBook, isPatternKey } from "./phraseBook.js";

const bookOf = (entries) => {
  const book = createPhraseBook();
  book.setAll(entries);
  return book;
};

test("an exact string is found as it is, and with its whitespace collapsed", () => {
  const book = bookOf({ "Save game": "Spiel speichern", "Save   the game": "Das Spiel speichern" });
  assert.equal(book.translate("Save game"), "Spiel speichern");
  assert.equal(book.translate("  Save game \n"), "Spiel speichern", "the caller's surrounding whitespace does not matter");
  assert.equal(book.translate("Save\n the game"), "Das Spiel speichern", "a line break where the source had spaces");
  assert.equal(book.translate("Load game"), null);
  assert.equal(book.has("Save game"), true);
});

test("a pattern fills its slots, in the translation's own order", () => {
  const book = bookOf({
    "Found {{count}} regions": "{{count}} Regionen gefunden",
    "{{name}} declared war on {{target}}": "{{target}} wurde von {{name}} der Krieg erklärt",
  });
  assert.equal(book.translate("Found 12 regions"), "12 Regionen gefunden");
  assert.equal(book.translate("Found  1,204\nregions"), "1,204 Regionen gefunden", "any whitespace between the words");
  assert.equal(
    book.translate("The Kingdom of France declared war on Spain"),
    "Spain wurde von The Kingdom of France der Krieg erklärt",
  );
  assert.equal(book.translate("Found regions"), null, "the literal text must all be there");
});

test("a slot's value is translated too when the book knows it", () => {
  const book = bookOf({ "Edit {{label}}": "{{label}} bearbeiten", Borders: "Grenzen" });
  assert.equal(book.translate("Edit Borders"), "Grenzen bearbeiten");
  assert.equal(book.translate("Edit Cities"), "Cities bearbeiten", "an unknown value stays as it is");
});

test("the most specific pattern wins", () => {
  const book = bookOf({
    "{{count}} flags": "{{count}} Flaggen",
    "{{count}} flags · scenario": "{{count}} Flaggen · Szenario",
  });
  assert.equal(book.translate("3 flags · scenario"), "3 Flaggen · Szenario");
  assert.equal(book.translate("3 flags"), "3 Flaggen");
});

test("an exact entry wins over a pattern that also matches", () => {
  const book = bookOf({ "Round {{value}}": "Runde {{value}}", "Round 1": "Erste Runde" });
  assert.equal(book.translate("Round 1"), "Erste Runde");
  assert.equal(book.translate("Round 2"), "Runde 2");
});

test("a weak pattern does not rewrite prose that starts with its words", () => {
  const book = bookOf({ "Our {{label}}": "Unser {{label}}", "by {{author}}": "von {{author}}" });
  assert.equal(book.translate("Our army"), "Unser army", "a short value is what the pattern is for");
  assert.equal(book.translate("by Arkniem"), "von Arkniem");
  assert.equal(book.translate("Our position is clear and we will not yield"), null);
  assert.equal(book.translate("by the way, I think we should talk"), null);
});

test("a weak pattern's value is a number or a name, not words and numbers together", () => {
  const book = createPhraseBook({ localizeValue: (text) => (text === "Jan 1, 2016" ? "1. Jan. 2016" : null) });
  book.setAll({ "{{value}} regions": "{{value}} Regionen", "{{value}} updated": "{{value}} aktualisiert" });
  assert.equal(book.translate("12 regions"), "12 Regionen");
  assert.equal(book.translate("Modern Day updated"), "Modern Day aktualisiert");
  assert.equal(book.translate("Found 12 regions"), null, "the start of another sentence");
  assert.equal(book.translate("Jan 1, 2016 updated"), "1. Jan. 2016 aktualisiert", "a date is known");
});

test("a value never spans sentences unless the pattern is substantial", () => {
  const book = bookOf({
    "{{name}} saved.": "{{name}} gespeichert.",
    "The editor could not save {{name}}.": "Der Editor konnte {{name}} nicht speichern.",
  });
  assert.equal(book.translate("Map saved."), "Map gespeichert.");
  assert.equal(book.translate("It failed. Then it saved."), null);
  assert.equal(
    book.translate("The editor could not save it. Try again."),
    "Der Editor konnte it. Try again nicht speichern.",
    "a long literal is evidence enough that this is the template",
  );
});

test("two slots with nothing between them are not a pattern", () => {
  assert.equal(compilePattern("{{charAt}}{{slice}} of {{overlord}}", "{{charAt}}{{slice}} von {{overlord}}"), null);
  const book = bookOf({ "{{charAt}}{{slice}} of {{overlord}}": "{{charAt}}{{slice}} von {{overlord}}" });
  assert.equal(book.translate("Kingdom of Spain"), null);
});

test("a pattern without words of its own is never compiled", () => {
  assert.equal(compilePattern("({{count}})", "({{count}})"), null);
  assert.equal(compilePattern("Plain text", "Klartext"), null, "no slot, no pattern");
  assert.equal(isPatternKey("Found {{count}} regions"), true);
  assert.equal(isPatternKey("Braces {{ like this"), false);
});

test("a slot named twice takes its values in order; one the English lacks is dropped", () => {
  const book = bookOf({
    "{{value}} of {{value}} done": "{{value}} von {{value}} erledigt",
    "Moved {{unit}}": "{{unit}} verlegt {{nowhere}}",
  });
  assert.equal(book.translate("3 of 7 done"), "3 von 7 erledigt");
  assert.equal(book.translate("Moved Fleet"), "Fleet verlegt");
});

test("values with dollar signs are inserted literally", () => {
  const book = bookOf({ "Budget: {{amount}}": "Haushalt: {{amount}}", "$5 million": "5 Mio. $" });
  assert.equal(book.translate("Budget: $5 million"), "Haushalt: 5 Mio. $");
  assert.equal(book.translate("Budget: $& $1"), "Haushalt: $& $1");
});

test("a list joined with / or · is translated part by part", () => {
  const book = bookOf({ Japan: "日本", "Round {{value}}": "第{{value}}回合" });
  assert.equal(book.translate("Modern Day Session / Japan / 1453"), "Modern Day Session / 日本 / 1453");
  assert.equal(book.translate("Japan · Round 3"), "日本 · 第3回合", "a part may be a pattern");
  assert.equal(book.translate("Nothing / known here"), null, "unchanged when no part is known");
  assert.equal(book.translate("The war ended — Japan"), null, "a dash is prose, not a list");
});

test("a pattern's last value may be a list, and is translated part by part", () => {
  const book = createPhraseBook({ localizeValue: (text) => (text === "Jan 1, 2016" ? "1. Jan. 2016" : null) });
  book.setAll({ "Playing as {{countryName}}": "Spielt als {{countryName}}", France: "Frankreich" });
  assert.equal(book.translate("Playing as France · Jan 1, 2016"), "Spielt als Frankreich · 1. Jan. 2016");
});

test("a later entry replaces an earlier one, patterns included", () => {
  const book = bookOf({ "Found {{count}} regions": "{{count}} Regionen" });
  assert.equal(book.translate("Found 2 regions"), "2 Regionen");
  book.set("Found {{count}} regions", "{{count}} Regionen gefunden");
  assert.equal(book.translate("Found 2 regions"), "2 Regionen gefunden", "the remembered answer is not reused");
  book.set("Save game", "Speichern");
  book.set("Save game", "Spiel speichern");
  assert.equal(book.translate("Save game"), "Spiel speichern");
});

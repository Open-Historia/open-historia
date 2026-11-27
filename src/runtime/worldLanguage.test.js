/*! Open Historia — a shared game's world is written in the host's language: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/worldLanguage.test.js
//
// Every request named the language its own device reads in: the host's engine
// wrote the shared world in the host's interface language, and a guest's own AI
// wrote its replies to the AI's governments in the guest's. The owner,
// 2026-11-18: the host sets the world's language in the lobby, and players who
// read another translate on their own device.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatLanguageDirective, languageDirective, readingLanguageName, setWorldLanguage, worldLanguageCode, writingLanguageCode } from "./i18n.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../multiplayer/host/settings.js";

const withDevice = (values, run) => {
  const had = Object.hasOwn(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  const store = new Map(Object.entries(values));
  globalThis.localStorage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  try {
    return run();
  } finally {
    setWorldLanguage("");
    if (had) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
};

test("while a game is shared, every request writes in the world's language, whatever the device reads", () => withDevice({ ui_language: "ar", ai_chat_language: "ar" }, () => {
  assert.equal(readingLanguageName("English"), "Arabic", "single player: the language the player reads");
  setWorldLanguage("fr");
  assert.equal(worldLanguageCode(), "fr");
  assert.equal(readingLanguageName("English"), "French");
  assert.equal(readingLanguageName("English", { chat: true }), "French", "a letter to a government is the world's too");
  assert.match(languageDirective(), /French \(fr\)/);
  assert.match(chatLanguageDirective(), /Reply in French/);
  // A language the game does not know is no rule; and leaving the game gives the device its own again.
  setWorldLanguage("klingon");
  assert.equal(worldLanguageCode(), "");
  setWorldLanguage("");
  assert.equal(readingLanguageName("English"), "Arabic");
}));

test("the host is offered the language it plays in", () => {
  withDevice({ ui_language: "ja" }, () => assert.equal(writingLanguageCode("English"), "ja"));
  withDevice({ ui_language: "en" }, () => assert.equal(writingLanguageCode("French"), "fr", "a save written in another language"));
  withDevice({}, () => assert.equal(writingLanguageCode(""), "en"));
});

test("the world's language is one of the host's settings, from the languages the game knows", () => {
  assert.equal(DEFAULT_SETTINGS.language, "");
  assert.equal(normalizeSettings({ language: "de" }).settings.language, "de");
  assert.equal(normalizeSettings({ language: "klingon" }).ok, false);
  // The engine names it when the game is shared, so the lobby carries a language every screen applies.
  const engine = readFileSync(new URL("../multiplayer/host/engineMain.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(engine, /const settings = \{ \.\.\.checked\.settings, language: checked\.settings\.language \|\| writingLanguageCode\(docs\.world\?\.language \|\| docs\.game\?\.language\) \};\n\s*setWorldLanguage\(settings\.language\);/);
  assert.match(engine, /setHostingSharedGame\(false\);\n\s*setWorldLanguage\(""\);/);
  const page = readFileSync(new URL("../multiplayer/client/sharedGame.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(page, /if \(lobby\?\.settings\) setWorldLanguage\(lobby\.settings\.language\);/);
  assert.match(page, /setSharedGameFeatures\(null\);\n\s*setWorldLanguage\(""\);/);
});

/*! Open Historia — the language setting: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/i18n.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { chatTextDirection } from "./i18n.js";

const withStorage = (values, run) => {
  const had = Object.hasOwn(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  const store = new Map(Object.entries(values));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try {
    run();
  } finally {
    if (had) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
};

test("a reply in the interface's own language takes the interface's direction", () => {
  withStorage({}, () => assert.equal(chatTextDirection(), undefined));
  withStorage({ ui_language: "ar" }, () => assert.equal(chatTextDirection(), undefined, "the chat follows the interface"));
  withStorage({ ui_language: "de", ai_chat_language: "de" }, () => assert.equal(chatTextDirection(), undefined));
});

test("a reply in another chat language reads in that language's direction", () => {
  withStorage({ ui_language: "en", ai_chat_language: "ar" }, () => assert.equal(chatTextDirection(), "rtl"));
  withStorage({ ui_language: "ar", ai_chat_language: "en" }, () => assert.equal(chatTextDirection(), "ltr", "English under an Arabic interface"));
  withStorage({ ui_language: "de", ai_chat_language: "fr" }, () => assert.equal(chatTextDirection(), "ltr"));
});

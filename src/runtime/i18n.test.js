/*! Open Historia — the language setting and boot language sync: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/i18n.test.js
//
// At boot the server's language wins over this device's copy, and the page
// reloads onto it (translator.js). With storage full or blocked the copy never
// changed, so every boot reloaded again, about once a second, for good.

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

// A storage that can refuse writes, like a full or blocked localStorage.
const makeStorage = ({ writable = true, initial = {} } = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (!writable) throw new Error("QuotaExceededError");
      data.set(key, String(value));
    },
    removeItem: (key) => {
      if (!writable) throw new Error("SecurityError");
      data.delete(key);
    },
  };
};

let fresh = 0;
// A fresh copy of the module per case: the held language is module state.
const boot = async ({ server, local, session }) => {
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ language: server }) });
  fresh += 1;
  return import(`./i18n.js?case=${fresh}`);
};

test("a new server language is stored and asks for one reload", async () => {
  const local = makeStorage();
  const session = makeStorage();
  const i18n = await boot({ server: "fr", local, session });
  assert.equal(await i18n.syncLanguageFromServer(), true);
  assert.equal(local.getItem("ui_language"), "fr");

  // After the reload the copy agrees, and nothing more is asked for.
  const after = await boot({ server: "fr", local, session });
  assert.equal(after.getStoredLanguage(), "fr");
  assert.equal(await after.syncLanguageFromServer(), false);
});

test("storage that refuses the write never asks for a reload, and holds the language for the page", async () => {
  const local = makeStorage({ writable: false });
  const session = makeStorage({ writable: false });
  for (let bootCount = 0; bootCount < 3; bootCount += 1) {
    const i18n = await boot({ server: "de", local, session });
    assert.equal(i18n.getStoredLanguage(), "en", "the device copy is still the old one");
    assert.equal(await i18n.syncLanguageFromServer(), false, `boot ${bootCount + 1} does not reload`);
    assert.equal(i18n.getStoredLanguage(), "de", "the server's choice applies to this page");
  }
});

test("a write that is lost across the reload reloads only once in a tab", async () => {
  // Reads back fine within the page, then comes back empty after the reload.
  const session = makeStorage();
  const first = await boot({ server: "ja", local: makeStorage(), session });
  assert.equal(await first.syncLanguageFromServer(), true);
  const second = await boot({ server: "ja", local: makeStorage(), session });
  assert.equal(await second.syncLanguageFromServer(), false, "the second boot does not reload again");
  assert.equal(second.getStoredLanguage(), "ja");
});

test("a later change in the same tab still reloads", async () => {
  const local = makeStorage();
  const session = makeStorage();
  assert.equal(await (await boot({ server: "fr", local, session })).syncLanguageFromServer(), true);
  assert.equal(await (await boot({ server: "fr", local, session })).syncLanguageFromServer(), false);
  assert.equal(await (await boot({ server: "es", local, session })).syncLanguageFromServer(), true, "a new language is a new reload");
  assert.equal(local.getItem("ui_language"), "es");
});

test("back to English removes the stored copy and reloads", async () => {
  const local = makeStorage({ initial: { ui_language: "fr" } });
  const i18n = await boot({ server: "en", local, session: makeStorage() });
  assert.equal(await i18n.syncLanguageFromServer(), true);
  assert.equal(local.getItem("ui_language"), null);
});

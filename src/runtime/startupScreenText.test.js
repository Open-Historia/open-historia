/*! Open Historia — the loading screen in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/startupScreenText.test.js
//
// The loading screen is the first thing every player sees, and it was always in
// English: the DOM translator waits for it to go (so translation can never stall
// the load), and its own strings were marked data-no-translate, so the catalog
// never had them. It now looks its text up itself (translateNow), in whatever
// the phrase book already holds.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { extractFromSource } from "../../scripts/i18n/extractStrings.mjs";

const SOURCE = fs.readFileSync(new URL("./StartupScreen.jsx", import.meta.url), "utf8");

test("the catalog reads the loading screen's own strings, as whole sentences", () => {
  const result = extractFromSource(SOURCE, "src/runtime/StartupScreen.jsx", { jsx: true, catchAll: true, messages: true });
  assert.equal(result.error, undefined);
  for (const text of ["Preparing the World", "Continuing…"]) assert.ok(result.exact.has(text), text);
  for (const pattern of ["{{doneCount}} of {{stepsCount}} complete", "{{formatBytes}} cached so far"]) {
    assert.ok(result.patterns.has(pattern), pattern);
  }
});

test("translateNow reads the pack synchronously, and never asks for more", async () => {
  const requests = [];
  let screenUp = true;
  const storage = new Map([["ui_language", "de"]]);
  globalThis.localStorage = {
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { addEventListener() {}, dispatchEvent() {}, location: { reload() { throw new Error("no reload"); } } };
  globalThis.document = {
    body: { style: {} },
    documentElement: {},
    // The loading screen is up until the test takes it down.
    querySelector: () => (screenUp ? {} : null),
  };
  const pack = {
    "Preparing the World": "Die Welt wird vorbereitet",
    "{{doneCount}} of {{stepsCount}} complete": "{{doneCount}} von {{stepsCount}} erledigt",
  };
  globalThis.fetch = async (url, init) => {
    requests.push(`${init?.method || "GET"} ${url}`);
    if (url === "/api/ui-settings") return { ok: true, json: async () => ({ language: "de" }) };
    if (url === "/api/lang/de") return { ok: true, json: async () => pack };
    return { ok: false, json: async () => ({}) };
  };

  const { startTranslator, stopTranslator, translateNow } = await import("./translator.js");
  assert.equal(translateNow("Preparing the World"), "Preparing the World", "before the translator starts: English");
  startTranslator();
  for (let tries = 0; tries < 50 && translateNow("Preparing the World") === "Preparing the World"; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  try {
    assert.equal(translateNow("Preparing the World"), "Die Welt wird vorbereitet");
    assert.equal(translateNow("3 of 8 complete"), "3 von 8 erledigt", "a pattern, with its values");
    assert.equal(translateNow("Continuing…"), "Continuing…", "what the pack lacks stays English");
    assert.equal(translateNow(""), "");
    const before = requests.length;
    translateNow("Something the pack has never heard of");
    assert.equal(requests.length, before, "a miss is never sent anywhere");
    assert.ok(!requests.some((request) => request.includes("translate")), "no translation request at all");
  } finally {
    stopTranslator();
    screenUp = false;
  }
});

/*! Open Historia — a scenario's own language pack comes first in a game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translatorScenarioPack.test.js
//
// When the player's language has a pack in the scenario in play
// (server/scenarioLanguages.js), the scenario's strings come from it first:
// over the game's shipped pack, over what the server's pack or this device
// learned from the model, and without any request. Strings it lacks fall back
// as before, and English is untouched.
//
// The translator runs here over a stand-in page: an empty body, no startup
// screen, and a server that answers the language pack with the game's own
// (and learned) translations. Japanese is used because it has a shipped pack
// and no on-device model, so nothing is downloaded or asked.
import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const events = new EventTarget();
globalThis.window = Object.assign(events, {
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
});
const emptyWalker = { nextNode: () => null };
globalThis.document = {
  documentElement: {},
  body: { style: {}, querySelectorAll: () => [] },
  title: "",
  querySelector: () => null,
  createTreeWalker: () => emptyWalker,
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

// The server's pack for Japanese: the shipped one over what was learned.
const SERVER_PACK = { "Kingdom of Bohemia": "ボヘミア王国（モデル）", Prague: "プラハ", Settings: "設定" };
const requests = [];
globalThis.fetch = async (address) => {
  requests.push(String(address));
  const body = String(address) === "/api/lang/ja" ? SERVER_PACK : String(address).startsWith("/api/") ? [] : {};
  return { ok: true, status: 200, json: async () => body };
};

const { lookupLabel, setScenarioLanguagePack, switchLanguage, translateNow } = await import("./translator.js");

const until = async (check) => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
};

const PACK = { "Kingdom of Bohemia": "ボヘミア王国", "The Defenestration of Prague": "プラハ窓外投擲事件" };

test("in English nothing changes, whatever the scenario's pack", () => {
  setScenarioLanguagePack("ja", PACK);
  assert.equal(translateNow("Kingdom of Bohemia"), "Kingdom of Bohemia");
});

test("the scenario's pack comes first, over the server's; what it lacks falls back; another language's pack is not used", async () => {
  setScenarioLanguagePack("ja", PACK);
  await switchLanguage("ja");
  await until(() => lookupLabel("Settings") === "設定");
  assert.equal(translateNow("Kingdom of Bohemia"), "ボヘミア王国", "the author's translation, not the model's");
  assert.equal(lookupLabel("The Defenestration of Prague"), "プラハ窓外投擲事件", "map labels and names read it too");
  assert.equal(translateNow("Prague"), "プラハ", "a string the pack lacks comes from the game's pack as before");
  assert.equal(translateNow("Settings"), "設定");
  assert.ok(!requests.some((address) => /languages|generativelanguage|anthropic|openai/.test(address)), "no request for the scenario's strings");

  // A pack that arrives while the game is already in the language is laid over at once.
  setScenarioLanguagePack("ja", { Prague: "プラーグ（作者）" });
  assert.equal(translateNow("Prague"), "プラーグ（作者）");

  // A pack for another language is kept for it and not used in this one.
  setScenarioLanguagePack("de", { "Settings": "Einstellungen" });
  assert.equal(translateNow("Settings"), "設定");
});

/*! Open Historia — the AI setup prompt's three choices: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/apiSetupChoices.test.js
//
// "update the popup to configure a free Gemini api key to have 3 boxes one with
// a gemini logo and another with an commandcode logo and another with that's
// custom and has 3 dots on it. and the commandcode one helps you easily config
// a commandcode $10 Goat plan api key with GLM 5.3 Flash preconfigured. the
// gemini api should say best free option, the commandcode one should say best
// quality option and recommended, the custom should say you can configure any
// provider and any model or a local model" (the owner, 2026-11-07).
//
// The prompt is drawn as the page draws it: apiSetupPrompt.jsx bundled with
// esbuild (what Vite compiles JSX with) and rendered by react-dom/server, once
// on the three cards and once on each choice's steps. What Command Code's key
// sets up is then called for real, through callAI, against a stubbed fetch and
// a made-up key.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const { buildSync } = require("esbuild");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement: h } = require("react");

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};
// A phone answers the narrow-screen query; the desktop does not.
let phoneScreen = false;
const hadWindow = "window" in globalThis;
if (!hadWindow) {
  globalThis.window = {
    matchMedia: (query) => ({ matches: phoneScreen && /max-width|pointer: coarse|hover: none/.test(query), addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    location: { origin: "http://localhost", href: "http://localhost/", protocol: "http:", hostname: "localhost" },
  };
}

// One bundle for the prompt and the engine, so both read and write the same
// Connections and Fallback list.
const loaded = (() => {
  const { outputFiles } = buildSync({
    stdin: {
      contents: [
        'export * from "./src/Game/GameUI/apiSetupPrompt.jsx";',
        'export { callAI } from "./src/Game/AI/main.jsx";',
        'export { COMMANDCODE_TEMPLATE, COMMANDCODE_BASE_URL, COMMANDCODE_MODEL, COMMANDCODE_KEYS_URL, COMMANDCODE_PRICING_URL, CONNECTION_TEMPLATES, GEMINI_DEFAULT_CHAIN, getResolvedFallbackList, getConnections } from "./src/Game/AI/providerConfig.js";',
      ].join("\n"),
      resolveDir: ROOT,
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".js": "jsx", ".jsx": "jsx" },
    jsx: "automatic",
    define: { "import.meta.env": JSON.stringify({ BASE_URL: "/", MODE: "test" }) },
    external: ["react", "react-dom"],
    logLevel: "error",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();
const { ApiSetupPrompt, SETUP_CHOICES, saveSetupChoice } = loaded;

const render = (props = {}) => renderToStaticMarkup(h(ApiSetupPrompt, { onConfigure: () => {}, onDismiss: () => {}, ...props }));
const count = (html, text) => html.split(text).length - 1;
const cards = (html) => [...html.matchAll(/<button type="button" class="oh-tap-row" data-setup-choice="([a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map(([whole, choice, inner]) => ({ choice, inner, whole }));
const words = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test.beforeEach(() => { store.clear(); store.set("ai_gemini_default_chain_v3", "1"); phoneScreen = false; });

test("the prompt opens on three cards: Gemini, Command Code, Custom", () => {
  assert.deepEqual([...SETUP_CHOICES], ["gemini", "commandcode", "custom"]);
  const html = render();
  const [gemini, commandCode, custom] = cards(html);
  assert.deepEqual(cards(html).map((card) => card.choice), ["gemini", "commandcode", "custom"]);
  // Each with its mark: the two providers' own logos, Custom's three dots.
  assert.match(gemini.inner, /<img src="\/brands\/gemini\.png" alt="" width="40" height="40"/);
  assert.match(commandCode.inner, /<img src="\/brands\/commandcode\.svg" alt="" width="40" height="40"/);
  assert.equal(count(custom.inner, "<circle "), 3);
  assert.match(custom.inner, /<svg width="40" height="40"/);
  // And its words.
  assert.equal(words(gemini.inner), "Gemini Best free option");
  assert.equal(words(commandCode.inner), "Recommended Command Code Best quality option");
  assert.equal(words(custom.inner), "Custom Configure any provider and any model, or a local model");
  // Nothing to save until one is chosen; full settings stay one click away.
  assert.equal(html.includes("Save and play"), false);
  assert.match(html, /data-setup-action="full-settings"/);
});

test("Command Code is the highlighted card, in the theme's accent, and the only one", () => {
  const [gemini, commandCode, custom] = cards(render());
  assert.equal(count(render(), "Recommended"), 1);
  assert.match(commandCode.whole, /border:1\.5px solid var\(--oh-ui-accent, #2bc1f3\)/);
  for (const plain of [gemini, custom]) {
    assert.doesNotMatch(plain.whole, /--oh-ui-accent/);
    assert.match(plain.whole, /border:1px solid var\(--oh-ui-line, rgba\(255,255,255,0\.12\)\)/);
  }
  // Grey, no gradient, no purple anywhere in the prompt.
  const source = fs.readFileSync(new URL("./apiSetupPrompt.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /gradient\(/);
  assert.doesNotMatch(source, /#(?:7c3aed|8b5cf6|a855f7|9333ea)|purple|violet/i);
});

test("side by side on a wide screen, one under another on a phone", () => {
  assert.match(render(), /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  phoneScreen = true;
  const phone = render();
  assert.match(phone, /grid-template-columns:1fr/);
  for (const card of cards(phone)) assert.match(card.whole, /flex-direction:row/);
});

test("the Gemini card leads into the free-key steps as they were", () => {
  const html = render({ initialChoice: "gemini" });
  assert.match(html, /href="https:\/\/aistudio\.google\.com\/app\/apikey" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Get a key at Google AI Studio ↗/);
  assert.match(html, /Play the video \(loads YouTube\)/);
  assert.match(html, /Gemini API key/);
  assert.match(html, /placeholder="Paste your Gemini API key"/);
  assert.match(html, /Model \(optional\)/);
  assert.equal(html.includes("<select"), false, "Gemini is chosen already");
  assert.equal(html.includes("<iframe"), false, "and YouTube is asked for nothing yet");
  assert.match(html, /Save and play/);
  assert.match(html, /← Back/);
});

test("saving the Gemini choice sets up Gemini as the one-step setup always did", () => {
  saveSetupChoice("gemini", { apiKey: "AIzaFAKEKEYFORTHETEST000" });
  const list = loaded.getResolvedFallbackList();
  assert.deepEqual(list.slice(0, 2).map((entry) => [entry.provider, entry.model, entry.apiKey]), [
    ["gemini", loaded.GEMINI_DEFAULT_CHAIN[0], "AIzaFAKEKEYFORTHETEST000"],
    ["gemini", loaded.GEMINI_DEFAULT_CHAIN[1], "AIzaFAKEKEYFORTHETEST000"],
  ]);
});

test("the Command Code card: its plan, its key page, then only the key", () => {
  const html = render({ initialChoice: "commandcode" });
  assert.match(html, /href="https:\/\/commandcode\.ai\/pricing" target="_blank" rel="noopener noreferrer"[^>]*data-setup-link="pricing"/);
  assert.match(html, /href="https:\/\/commandcode\.ai\/settings\/keys" target="_blank" rel="noopener noreferrer"[^>]*data-setup-link="keys"/);
  assert.match(html, /GOAT plan, \$10 a month/);
  assert.match(html, /Command Code API key/);
  assert.match(html, /placeholder="Paste your Command Code API key"/);
  assert.match(html, /GLM 5\.3 Flash/);
  // No provider, address or model to fill in.
  assert.equal(html.includes("<select"), false);
  assert.equal(html.includes("API endpoint"), false);
  assert.equal(html.includes("Model (optional)"), false);
  assert.equal(html.includes("data-setup-action=\"full-settings\""), false);
});

test("Command Code's key sets up its address and GLM-5.3 Flash at the top of the list", () => {
  saveSetupChoice("gemini", { apiKey: "AIzaFAKEKEYFORTHETEST000" });
  saveSetupChoice("commandcode", { apiKey: "  fake-command-code-key-1  " });
  const [top] = loaded.getResolvedFallbackList();
  assert.deepEqual(
    { provider: top.provider, connectionName: top.connectionName, endpoint: top.endpoint, model: top.model, apiKey: top.apiKey },
    { provider: "openai-compatible", connectionName: "Command Code", endpoint: "https://api.commandcode.ai/provider/v1", model: "z-ai/glm-5.3-flash", apiKey: "fake-command-code-key-1" },
  );
  assert.equal(loaded.COMMANDCODE_BASE_URL, "https://api.commandcode.ai/provider/v1");
  assert.equal(loaded.COMMANDCODE_MODEL, "z-ai/glm-5.3-flash");
  // A new key later replaces the old one on the same Connection, with no twin.
  saveSetupChoice("commandcode", { apiKey: "fake-command-code-key-2" });
  const commandCodeConnections = loaded.getConnections().filter((connection) => connection.endpoint === loaded.COMMANDCODE_BASE_URL);
  assert.equal(commandCodeConnections.length, 1);
  assert.equal(commandCodeConnections[0].apiKey, "fake-command-code-key-2");
  assert.equal(loaded.getResolvedFallbackList().filter((entry) => entry.connectionName === "Command Code").length, 1);
  // Without a key nothing is written.
  assert.throws(() => saveSetupChoice("commandcode", { apiKey: "  " }), /Paste an API key first/);
  // Settings → AI offers it as a starting point too.
  assert.equal(loaded.CONNECTION_TEMPLATES[0], loaded.COMMANDCODE_TEMPLATE);
});

test("a call after the Command Code setup goes to Command Code, with the key and the model", async () => {
  saveSetupChoice("commandcode", { apiKey: "fake-command-code-key-3" });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "An answer from the stub." }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const answer = await loaded.callAI("You are a test.", [{ role: "user", parts: [{ text: "Say hello." }] }], {});
    assert.match(JSON.stringify(answer), /An answer from the stub\./);
  } finally {
    globalThis.fetch = realFetch;
  }
  const call = calls.find((entry) => entry.url.startsWith("https://api.commandcode.ai/"));
  assert.ok(call, `no call reached Command Code: ${calls.map((entry) => entry.url).join(", ")}`);
  assert.equal(call.url, "https://api.commandcode.ai/provider/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, "Bearer fake-command-code-key-3");
  assert.equal(JSON.parse(call.init.body).model, "z-ai/glm-5.3-flash");
});

test("the Custom card: any provider, a local server to start with, and full settings", () => {
  const html = render({ initialChoice: "custom" });
  assert.match(html, /<select id="[^"]+-provider" data-no-translate="true"/);
  assert.match(html, /<option value="openai-compatible" style="color:black" selected=""/);
  assert.match(html, /value="http:\/\/localhost:11434\/v1"/, "a local model's address to start from");
  for (const provider of ["gemini", "openai", "anthropic", "anthropic-compatible"]) assert.match(html, new RegExp(`<option value="${provider}"`));
  assert.match(html, /API key \(optional\)/);
  assert.match(html, /Model \(optional\)/);
  assert.match(html, /data-setup-action="full-settings"/);
  // "Open full settings" is the game's own: Settings, on its AI section.
  const prompt = fs.readFileSync(new URL("./apiSetupPrompt.jsx", import.meta.url), "utf8");
  assert.match(prompt, /data-setup-action="full-settings" onClick=\{onConfigure\}/);
  const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.match(main, /<ApiSetupPrompt[\s\S]{0,400}onConfigure=\{\(\) => \{\s*answerApiPrompt\(\);\s*setSettingsScope\("game"\);\s*setSettingsInitialSection\("ai"\);\s*setIsSettingsOpen\(true\);/);
});

test("saving the Custom choice writes what was typed", () => {
  saveSetupChoice("custom", { provider: "openai-compatible", endpoint: "http://localhost:11434/v1", model: "llama3.3" });
  const [top] = loaded.getResolvedFallbackList();
  assert.deepEqual([top.provider, top.endpoint, top.model], ["openai-compatible", "http://localhost:11434/v1", "llama3.3"]);
});

test("the logos ship with the game, and their sizes match", () => {
  const png = fs.readFileSync(new URL("../../../public/brands/gemini.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 96, "Gemini's mark is 96 px wide");
  assert.equal(png.readUInt32BE(20), 96, "and 96 px high");
  const svg = fs.readFileSync(new URL("../../../public/brands/commandcode.svg", import.meta.url), "utf8");
  assert.match(svg, /^<svg fill="none" height="137" viewBox="0 0 137 137" width="137"/, "Command Code's logomark, square");
});

// ---- My key has no request limit, set by the choice -----------------------
//
// Command Code's GOAT plan is a paid key and a server of the player's own a
// local model: both turn Settings → AI → AI requests' switch on. Gemini's free
// key leaves it off. Shown as already set, with no question to answer.

const SWITCH_KEY = "ai_no_request_limit";
const switchRow = /data-setup-no-request-limit="on"/;

test("Command Code turns the switch on, and its steps say so without asking", () => {
  const html = render({ initialChoice: "commandcode" });
  assert.match(html, switchRow);
  assert.match(words(html), /My key has no request limit On/);
  assert.equal(/<input[^>]*type="checkbox"/.test(html), false, "nothing to answer");
  assert.equal(store.get(SWITCH_KEY), undefined, "drawing the steps sets nothing");
  saveSetupChoice("commandcode", { apiKey: "fake-command-code-key-4" });
  assert.equal(store.get(SWITCH_KEY), "1");
  assert.equal(store.get("ai_background_activity"), "1", "with everything it turns on");
  assert.equal(store.get("ai_lookup_functions"), "1");
});

test("a local server through Custom turns it on; a hosted one leaves it as it was", () => {
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "openai-compatible", endpoint: "http://localhost:11434/v1" }), true);
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "openai-compatible", endpoint: "192.168.1.20:1234/v1" }), true);
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "anthropic-compatible", endpoint: "http://127.0.0.1:4000/v1" }), true);
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "openai-compatible", endpoint: "https://openrouter.ai/api/v1" }), null);
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "openai", endpoint: "" }), null);
  assert.equal(loaded.noRequestLimitFor("custom", { provider: "gemini" }), null);
  assert.equal(loaded.noRequestLimitFor("commandcode"), true);
  assert.equal(loaded.noRequestLimitFor("gemini"), false);

  // The Custom card opens on a local server, so it shows the switch set.
  assert.match(render({ initialChoice: "custom" }), switchRow);
  saveSetupChoice("custom", { provider: "openai-compatible", endpoint: "http://localhost:11434/v1", model: "llama3.3" });
  assert.equal(store.get(SWITCH_KEY), "1");

  store.set(SWITCH_KEY, "0");
  saveSetupChoice("custom", { provider: "openai", apiKey: "sk-fake-key-for-the-test-000" });
  assert.equal(store.get(SWITCH_KEY), "0", "a hosted provider says nothing about the limit");
});

test("Gemini's free key leaves it off, and its steps show nothing about it", () => {
  assert.equal(switchRow.test(render({ initialChoice: "gemini" })), false);
  saveSetupChoice("gemini", { apiKey: "AIzaFAKEKEYFORTHETEST000" });
  assert.equal(store.get(SWITCH_KEY), "0");
  assert.equal(store.get("ai_background_activity"), undefined, "nothing else is touched for a limited key");
  assert.equal(store.get("ai_lookup_functions"), undefined);
  // A player who had turned it on and then sets up a free key is back on the free key's settings.
  store.set(SWITCH_KEY, "1");
  saveSetupChoice("gemini", { apiKey: "AIzaFAKEKEYFORTHETEST000" });
  assert.equal(store.get(SWITCH_KEY), "0");
});

test("a setup that could not be saved sets no switch", () => {
  assert.throws(() => saveSetupChoice("commandcode", { apiKey: "  " }), /Paste an API key first/);
  assert.equal(store.get(SWITCH_KEY), undefined);
});

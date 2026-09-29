/*! Open Historia — country display names across a save switch, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/polityNames.test.js
//
// Needs a full install: polityNames.js -> assets.js -> maplibre-gl.
//
// After switching saves the header kept the previous save's polity names —
// "German Reich" over a Cold War campaign — for as long as the cache was
// trusted, and a refresh begun in the old save could land after the switch
// and write them back.

import assert from "node:assert/strict";
import test from "node:test";

// Only what the asset layer and the listener touch: events and the page origin.
const page = new EventTarget();
page.location = { origin: "http://localhost", href: "http://localhost/" };
globalThis.window = page;
// There is no tile archive here; the catalog says so once per read.
const warn = console.warn;
console.warn = (...args) => {
  if (!String(args[0]).startsWith("The stock country tiles could not be read")) warn(...args);
};

const { setRuntimeAssetEndpoints } = await import("./assets.js");
const { ensurePolityNames, onPolityNamesReset, polityDisplayName } = await import("./polityNames.js");

const WORLDS = {
  "save-a": { polityOverrides: { GER: { code: "GER", name: "German Reich" } } },
  "save-b": { polityOverrides: { GER: { code: "GER", name: "Federal Republic of Germany" } } },
};
// World reads for a save listed here wait until it is released.
const held = new Map();
globalThis.fetch = (url) => {
  const text = String(url);
  if (!/\/api\/runtime\/json\/world/.test(text)) return Promise.resolve(new Response("missing", { status: 404 }));
  const save = Object.keys(WORLDS).find((key) => text.includes(key));
  const answer = () => new Response(JSON.stringify(WORLDS[save] ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  if (!held.has(save)) return Promise.resolve(answer());
  return new Promise((resolve) => held.get(save).push(() => resolve(answer())));
};
const release = (save) => {
  const waiting = held.get(save) ?? [];
  held.delete(save);
  for (const go of waiting) go();
};
const switchTo = (save) => {
  setRuntimeAssetEndpoints({ token: save });
  window.dispatchEvent(new CustomEvent("oh:active-game-changed", { detail: { gameId: save } }));
};

test("a switch to another save forgets the names and tells every mounted name", async () => {
  switchTo("save-a");
  await ensurePolityNames();
  assert.equal(polityDisplayName("GER"), "German Reich");

  let told = 0;
  const unsubscribe = onPolityNamesReset(() => { told += 1; });
  switchTo("save-b");
  unsubscribe();
  assert.equal(told, 1);
  assert.equal(polityDisplayName("GER"), "GER", "not the previous save's name, even for a moment");
  await ensurePolityNames();
  assert.equal(polityDisplayName("GER"), "Federal Republic of Germany");
});

test("a refresh begun in the previous save is dropped when it lands", async () => {
  switchTo("save-a");
  held.set("save-a", []);
  const old = ensurePolityNames();
  await new Promise((resolve) => setTimeout(resolve, 10));

  switchTo("save-b");
  const fresh = ensurePolityNames();
  await fresh;
  assert.equal(polityDisplayName("GER"), "Federal Republic of Germany");

  release("save-a");
  await old;
  assert.equal(polityDisplayName("GER"), "Federal Republic of Germany", "the old save's answer changed nothing");
});

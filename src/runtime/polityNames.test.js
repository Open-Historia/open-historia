/*! Open Historia — country display names across a save switch, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/polityNames.test.js
//
// Needs a full install: polityNames.js -> assets.js -> maplibre-gl.
//
// The code-to-name lookup reads the world once per game and then follows the
// writes. It used to force-read and clone the whole world.json whenever the
// lookup was 15 s old.
//
// After switching saves the header kept the previous save's polity names —
// "German Reich" over a Cold War campaign — for as long as the cache was
// trusted, and a refresh begun in the old save could land after the switch
// and write them back.

import assert from "node:assert/strict";
import test from "node:test";

// Only what the asset layer and the listener touch: events and the page origin.
// The lookup installs its listeners when it loads, so the window comes first.
const page = new EventTarget();
page.location = { origin: "http://localhost", href: "http://localhost/" };
globalThis.window = page;
// There is no tile archive here; the catalog says so once per read.
const warn = console.warn;
console.warn = (...args) => {
  if (!String(args[0]).startsWith("The stock country tiles could not be read")) warn(...args);
};

const { JSON_URLS, primeJson, setRuntimeAssetEndpoints } = await import("./assets.js");
const { ensurePolityNames, polityDisplayName, subscribePolityNames } = await import("./polityNames.js");

// The world-write cases each load their own copy of the module.
let copies = 0;
const loadNames = () => import(`./polityNames.js?case=${copies += 1}`);

const WORLDS = {
  "save-a": { polityOverrides: { GER: { code: "GER", name: "German Reich" } } },
  "save-b": { polityOverrides: { GER: { code: "GER", name: "Federal Republic of Germany" } } },
};
// World reads for a save listed here wait until it is released.
const held = new Map();
const worldReads = [];
globalThis.fetch = (url, init = {}) => {
  const text = String(url);
  const save = Object.keys(WORLDS).find((key) => text.includes(key));
  if (save && /\/api\/runtime\/json\/world/.test(text)) {
    const answer = () => new Response(JSON.stringify(WORLDS[save] ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
    if (!held.has(save)) return Promise.resolve(answer());
    return new Promise((resolve) => held.get(save).push(() => resolve(answer())));
  }
  if (text === JSON_URLS.world && String(init.method || "GET").toUpperCase() === "GET") {
    worldReads.push(init);
    return Promise.resolve(new Response(JSON.stringify({ polityOverrides: { RUR: { code: "RUR", name: "Kingdom of Ruritania" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }
  return Promise.resolve(new Response("missing", { status: 404 }));
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

const worldUpdated = (world) => globalThis.window.dispatchEvent(new CustomEvent("oh:world-updated", { detail: { world } }));

test("the names are read once, not polled", async () => {
  const { ensurePolityNames, polityDisplayName } = await loadNames();
  assert.equal(polityDisplayName("RUR"), "RUR", "the code until the lookup is warm");
  await ensurePolityNames();
  await ensurePolityNames();
  assert.equal(polityDisplayName("RUR"), "Kingdom of Ruritania");
  assert.equal(worldReads.length, 1, "one read of world.json, however often it is asked");
});

test("a world write renames at once, with no read", async () => {
  const { ensurePolityNames, polityDisplayName, subscribePolityNames } = await loadNames();
  await ensurePolityNames();
  const reads = worldReads.length;
  let told = 0;
  subscribePolityNames(() => { told += 1; });

  worldUpdated({ polityOverrides: { RUR: { code: "RUR", name: "Federal Republic of Ruritania" } } });
  assert.equal(polityDisplayName("RUR"), "Federal Republic of Ruritania");
  assert.equal(told, 1);
  assert.equal(worldReads.length, reads, "the write carries the world; nothing is fetched");
});

test("a game switch drops the old game's names and reads the new one's", async () => {
  const { ensurePolityNames, polityDisplayName, subscribePolityNames } = await loadNames();
  await ensurePolityNames();
  let told = 0;
  subscribePolityNames(() => { told += 1; });

  // The new save is what the (repointed) world URL now answers with.
  primeJson(JSON_URLS.world, { polityOverrides: { BOR: { code: "BOR", name: "Borduria" } } });
  globalThis.window.dispatchEvent(new CustomEvent("oh:active-game-changed", { detail: { gameId: "other" } }));
  assert.equal(polityDisplayName("RUR"), "RUR", "the previous game's name is gone at once");
  await ensurePolityNames();
  assert.equal(polityDisplayName("BOR"), "Borduria");
  assert.ok(told >= 2, "told of the reset and of the new names");
});

// The switch lands while the first read is still out (a game opened at start-up,
// say). That read answers for the old save, so the new one's is read after it,
// and whoever was waiting on the first read gets the new names.
test("a game switch during the first read still ends with the new game's names", async () => {
  const { ensurePolityNames, polityDisplayName, subscribePolityNames } = await loadNames();
  const originalFetch = globalThis.fetch;
  let releaseOldRead = () => {};
  const answer = (polityOverrides) => new Response(JSON.stringify({ polityOverrides }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  globalThis.fetch = async (url, init = {}) => {
    if (String(init.method || "GET").toUpperCase() !== "GET") return new Response("", { status: 404 });
    if (String(url).includes("v=old-save")) {
      return new Promise((resolve) => { releaseOldRead = () => resolve(answer({ RUR: { code: "RUR", name: "Kingdom of Ruritania" } })); });
    }
    if (String(url).includes("v=new-save")) return answer({ BOR: { code: "BOR", name: "Borduria" } });
    return new Response("", { status: 404 });
  };
  try {
    setRuntimeAssetEndpoints({ token: "old-save" });
    subscribePolityNames(() => {});
    const firstRead = ensurePolityNames();
    await new Promise((resolve) => setImmediate(resolve));

    setRuntimeAssetEndpoints({ token: "new-save" });
    globalThis.window.dispatchEvent(new CustomEvent("oh:active-game-changed", { detail: { gameId: "new" } }));
    releaseOldRead();
    await firstRead;

    assert.equal(polityDisplayName("BOR"), "Borduria");
    assert.equal(polityDisplayName("RUR"), "RUR", "the old save's names never come back");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a switch to another save forgets the names and tells every mounted name", async () => {
  switchTo("save-a");
  await ensurePolityNames();
  assert.equal(polityDisplayName("GER"), "German Reich");

  let told = 0;
  const unsubscribe = subscribePolityNames(() => { told += 1; });
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

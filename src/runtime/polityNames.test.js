// Needs node_modules: polityNames.js reaches assets.js, which imports maplibre-gl.
// Run: node --test src/runtime/polityNames.test.js
//
// The code-to-name lookup reads the world once per game and then follows the
// writes. It used to force-read and clone the whole world.json whenever the
// lookup was 15 s old.
import test from "node:test";
import assert from "node:assert/strict";

import { JSON_URLS, primeJson } from "./assets.js";

// The lookup installs its listeners when it loads, so the window comes first,
// and each case loads its own copy of the module.
globalThis.window = new EventTarget();
let copies = 0;
const loadNames = () => import(`./polityNames.js?case=${copies += 1}`);

const worldReads = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === JSON_URLS.world && String(init.method || "GET").toUpperCase() === "GET") {
    worldReads.push(init);
    return new Response(JSON.stringify({ polityOverrides: { RUR: { code: "RUR", name: "Kingdom of Ruritania" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("", { status: 404 });
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

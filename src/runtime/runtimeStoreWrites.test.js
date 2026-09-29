// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// Run: node --test src/runtime/runtimeStoreWrites.test.js
//
// A world write used to be normalized twice on the main thread: once by
// writeWorldState before saving, and again by the runtime store when the saved
// copy came back on oh:runtime-json-updated. A writer that already normalized
// now says so, and the store takes the document as it is.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { JSON_URLS } from "./assets.js";
import { normalizeWorldState, writeWorldState } from "./gameState.js";
import { __resetRuntimeStoreForTests, deepEqual, getRuntimeValue, primeRuntimeValue, subscribeRuntime } from "./runtimeStore.js";

// The store's listeners install on the first subscription, and only where there
// is a window. No BroadcastChannel, so nothing keeps the test process open.
const withWindow = async (run) => {
  const saved = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel };
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = undefined;
  try {
    return await run();
  } finally {
    globalThis.BroadcastChannel = saved.BroadcastChannel;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
  }
};

const publish = (value, normalized) => globalThis.window.dispatchEvent(new CustomEvent("oh:runtime-json-updated", {
  detail: { key: "world", url: JSON_URLS.world, value, ...(normalized === undefined ? {} : { normalized }) },
}));

test("a write its writer normalized is taken as it is; any other write is normalized", async (t) => {
  t.after(__resetRuntimeStoreForTests);
  __resetRuntimeStoreForTests();
  await withWindow(() => {
    primeRuntimeValue("world", normalizeWorldState({}));
    const heard = [];
    subscribeRuntime("world", (world) => heard.push(world));

    const saved = { ...normalizeWorldState({}), lastJumpSummary: "The war ends." };
    publish(saved, true);
    assert.equal(getRuntimeValue("world"), saved, "a pre-normalized write is not normalized again");
    assert.equal(heard.at(-1), saved);

    publish({ lastJumpSummary: "A raw write." });
    const stored = getRuntimeValue("world");
    assert.equal(stored.lastJumpSummary, "A raw write.");
    assert.ok(Array.isArray(stored.projects), "a write nobody normalized still is");
  });
});

test("writeWorldState says its write is already normalized", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => new Response(init.body ?? "{}", { status: 200, headers: { "content-type": "application/json" } });
  try {
    await withWindow(async () => {
      const details = [];
      globalThis.window.addEventListener("oh:runtime-json-updated", (event) => details.push(event.detail));
      await writeWorldState({ lastJumpSummary: "Saved." });
      assert.equal(details.length, 1);
      assert.equal(details[0].url, JSON_URLS.world);
      assert.equal(details[0].normalized, true);
    });
  } finally {
    globalThis.fetch = original;
  }
});

// Skipping the second pass is only safe because the first one is a fixed point:
// a normalized world that has been through the store's JSON round trip comes
// out of the normalizer unchanged.
test("normalizing a saved world a second time changes nothing", () => {
  const seed = JSON.parse(fs.readFileSync(new URL("../../server/seed/default/world.json", import.meta.url), "utf8"));
  const saved = JSON.parse(JSON.stringify(normalizeWorldState(seed)));
  assert.ok(deepEqual(JSON.parse(JSON.stringify(normalizeWorldState(saved))), saved));
});

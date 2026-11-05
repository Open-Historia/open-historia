// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// Run: node --test src/runtime/runtimeStoreWrites.test.js
//
// A world write used to be normalized twice on the main thread: once by
// writeWorldState before saving, and again by the runtime store when the saved
// copy came back on oh:runtime-json-updated. A writer that already normalized
// now says so, and the store takes the document as it is.
//
// The store then compared every write with the world it held by deepEqual, a
// full walk of the document whenever the write changed nothing. A normalized
// write now carries the text it was parsed from, and equal texts settle it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { JSON_URLS } from "./assets.js";
import { normalizeWorldState, writeWorldState } from "./gameState.js";
import { __resetRuntimeStoreForTests, deepEqual, getRuntimeValue, primeRuntimeValue, subscribeRuntime } from "./runtimeStore.js";

// The store's listeners install on the first subscription, and only where there
// is a window. No BroadcastChannel, so nothing keeps the test process open. One
// window for the file: the listeners stay on the one they were installed on.
const testWindow = new EventTarget();
const withWindow = async (run) => {
  const saved = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel };
  globalThis.window = testWindow;
  globalThis.BroadcastChannel = undefined;
  try {
    return await run();
  } finally {
    globalThis.BroadcastChannel = saved.BroadcastChannel;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
  }
};

const publish = (value, normalized, text) => globalThis.window.dispatchEvent(new CustomEvent("oh:runtime-json-updated", {
  detail: {
    key: "world",
    url: JSON_URLS.world,
    value,
    ...(normalized === undefined ? {} : { normalized }),
    ...(text === undefined ? {} : { text }),
  },
}));

// What writeJson hands the store: the echo's text and a fresh parse of it.
const publishSaved = (world) => {
  const text = JSON.stringify(world);
  publish(JSON.parse(text), true, text);
};

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

test("a write with the same text as the held world changes nothing and wakes nobody", async (t) => {
  t.after(__resetRuntimeStoreForTests);
  __resetRuntimeStoreForTests();
  await withWindow(() => {
    const world = { ...normalizeWorldState({}), lastJumpSummary: "The war ends." };
    primeRuntimeValue("world", normalizeWorldState({}));
    const heard = [];
    subscribeRuntime("world", (value) => heard.push(value));
    publishSaved(world);
    const held = getRuntimeValue("world");
    assert.equal(held.lastJumpSummary, "The war ends.");
    assert.equal(heard.length, 2);

    publishSaved(world);
    assert.equal(getRuntimeValue("world"), held, "the held document stays");
    assert.equal(heard.length, 2, "a no-op write notifies nobody");

    // The text decides, not a walk of the document: an object that differs
    // under a text that does not is taken as the same write.
    const text = JSON.stringify(world);
    publish({ ...JSON.parse(text), lastJumpSummary: "Not what the text says." }, true, text);
    assert.equal(getRuntimeValue("world"), held);
    assert.equal(heard.length, 2);

    publishSaved({ ...world, lastJumpSummary: "Peace is signed." });
    assert.equal(getRuntimeValue("world").lastJumpSummary, "Peace is signed.");
    assert.equal(heard.length, 3);
  });
});

test("without a text on both sides the store still deep-compares", async (t) => {
  t.after(__resetRuntimeStoreForTests);
  __resetRuntimeStoreForTests();
  await withWindow(() => {
    const world = { ...normalizeWorldState({}), lastJumpSummary: "The war ends." };
    primeRuntimeValue("world", normalizeWorldState({}));
    const heard = [];
    subscribeRuntime("world", (value) => heard.push(value));
    // The turn commit publishes the world with no text of its own.
    publish(JSON.parse(JSON.stringify(world)), true);
    assert.equal(heard.length, 2);

    // Same content, first write with a text: deepEqual finds nothing new...
    publishSaved(world);
    assert.equal(heard.length, 2);
    // ...and the text it brought settles the next one.
    const text = JSON.stringify(world);
    publish({ ...JSON.parse(text), lastJumpSummary: "Not what the text says." }, true, text);
    assert.equal(heard.length, 2);

    // A document the store normalizes (a raw write, a primed value) is compared
    // by deepEqual and forgets the text.
    primeRuntimeValue("world", JSON.parse(text));
    assert.equal(heard.length, 2);
    primeRuntimeValue("world", { ...world, lastJumpSummary: "Peace is signed." });
    assert.equal(heard.length, 3);
    publishSaved(world);
    assert.equal(heard.length, 4);
    assert.equal(getRuntimeValue("world").lastJumpSummary, "The war ends.");
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
      assert.equal(typeof details[0].text, "string", "it carries the text the saved world was parsed from");
      assert.deepEqual(JSON.parse(details[0].text), details[0].value);
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

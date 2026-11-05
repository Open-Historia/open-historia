/*! Open Historia — native HTTP in the Android app: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/http.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpFetch } from "./http.js";

// A Capacitor bridge carrying one fake HTTP plugin, for the length of a test.
const withPlugin = async (request, run) => {
  const previous = globalThis.window;
  globalThis.window = { Capacitor: { Plugins: { CapacitorHttp: { request } } } };
  try {
    await run();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
};

test("a reply comes back as a fetch Response", async () => {
  await withPlugin(async (options) => {
    assert.equal(options.url, "http://192.168.1.9:11434/v1/models");
    return { status: 200, data: "{\"data\":[]}", headers: { "content-type": "application/json" } };
  }, async () => {
    const response = await nativeHttpFetch("http://192.168.1.9:11434/v1/models", { method: "GET" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: [] });
  });
});

test("Stop answers at once, even while the plugin is still waiting on the model", async () => {
  await withPlugin(() => new Promise(() => {}), async () => {
    const controller = new AbortController();
    const pending = nativeHttpFetch("http://192.168.1.9:11434/v1/chat/completions", { payload: {}, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === "AbortError");
  });
});

test("the plugin failing after a Stop changes nothing", async () => {
  let fail;
  await withPlugin(() => new Promise((_, reject) => { fail = reject; }), async () => {
    const controller = new AbortController();
    const pending = nativeHttpFetch("http://192.168.1.9:11434/v1/chat/completions", { payload: {}, signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    fail(new Error("Socket closed"));
    await assert.rejects(pending, (error) => error.name === "AbortError");
  });
});

test("an unreachable server fails the way fetch does, so the Fallback list moves on", async () => {
  await withPlugin(async () => { throw new Error("Failed to connect to /192.168.1.9:11434"); }, async () => {
    await assert.rejects(
      nativeHttpFetch("http://192.168.1.9:11434/v1/chat/completions", { payload: {} }),
      (error) => error instanceof TypeError
        && /network request failed/i.test(error.message)
        && /192\.168\.1\.9/.test(error.message)
        && error.cause instanceof Error,
    );
  });
});

test("an already-aborted call never reaches the plugin", async () => {
  let asked = false;
  await withPlugin(async () => { asked = true; return { status: 200, data: "" }; }, async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(nativeHttpFetch("http://10.0.0.2/v1/models", { signal: controller.signal }), (error) => error.name === "AbortError");
  });
  assert.equal(asked, false);
});

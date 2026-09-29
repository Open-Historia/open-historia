import test from "node:test";
import assert from "node:assert/strict";
import { loadDocument, saveDocument } from "./documentIO.js";

// Answers every request with one response, and records what was asked.
const withFetch = async (respond, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    return respond(url, init);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a failed save says why, in the store's own words", async () => {
  await withFetch(() => json({ error: "Map document not found: world_1" }, 400), async (calls) => {
    await assert.rejects(saveDocument("world_1", { name: "x" }), { message: "Map document not found: world_1" });
    assert.deepEqual(calls, [{ url: "/api/mapeditor/documents/world_1", method: "PUT" }]);
  });
});

test("a failure with no message still says which status came back", async () => {
  await withFetch(() => new Response("<html>oops</html>", { status: 502 }), async () => {
    await assert.rejects(saveDocument(null, { name: "x" }), { message: "Could not save the map (HTTP 502)" });
    await assert.rejects(loadDocument("a"), { message: "Could not load the map (HTTP 502)" });
  });
});

test("a create posts and a save that lands returns the store's answer", async () => {
  await withFetch(() => json({ id: "new_1" }, 201), async (calls) => {
    assert.deepEqual(await saveDocument(null, { name: "x" }), { id: "new_1" });
    assert.deepEqual(calls, [{ url: "/api/mapeditor/documents", method: "POST" }]);
  });
});

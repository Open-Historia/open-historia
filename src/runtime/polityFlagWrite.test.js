// Needs node_modules: polityFlags.js reaches assets.js, which imports maplibre-gl.
// Run: node --test src/runtime/polityFlagWrite.test.js
//
// setPolityFlag writes the whole flags map back, so it must never mistake a
// failed read for an empty file: that would erase every other authored flag.
import test from "node:test";
import assert from "node:assert/strict";

import { JSON_URLS } from "./assets.js";
import { setPolityFlag } from "./polityFlags.js";

const world = {
  polityOverrides: {
    Ruritania: { code: "Ruritania", name: "Ruritania", aliases: [], status: "active" },
    Borduria: { code: "Borduria", name: "Borduria", aliases: [], status: "active" },
  },
};

// A stand-in for the store: `read` answers the flags GET, every PUT is kept.
const withStore = async (read, run) => {
  const original = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (String(url) !== JSON_URLS.flags) throw new Error(`unexpected request to ${url}`);
    if (method === "PUT") {
      writes.push(JSON.parse(init.body));
      return new Response(init.body, { status: 200, headers: { "content-type": "application/json" } });
    }
    return read();
  };
  try {
    return await run(writes);
  } finally {
    globalThis.fetch = original;
  }
};

const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

test("a failed read stops the write instead of wiping every other flag", async () => {
  await withStore(() => { throw new TypeError("network down"); }, async (writes) => {
    await assert.rejects(
      setPolityFlag({ polity: "Ruritania", world, dataUrl: "data:image/png;base64,AAAA" }),
      /could not be read, so nothing was changed/,
    );
    assert.deepEqual(writes, [], "nothing may be written after a failed read");
  });
});

test("an error status is a failed read too", async () => {
  await withStore(() => new Response("oops", { status: 500 }), async (writes) => {
    await assert.rejects(setPolityFlag({ polity: "Ruritania", world, dataUrl: "data:image/png;base64,AAAA" }));
    assert.deepEqual(writes, []);
  });
});

test("a read that works keeps the other flags", async () => {
  await withStore(() => json({ Borduria: "data:image/png;base64,BBBB" }), async (writes) => {
    const next = await setPolityFlag({ polity: "Ruritania", world, dataUrl: "data:image/png;base64,AAAA" });
    assert.deepEqual(next, { Borduria: "data:image/png;base64,BBBB", Ruritania: "data:image/png;base64,AAAA" });
    assert.deepEqual(writes, [next]);
  });
});

test("a game with no flags of its own yet starts from an empty map", async () => {
  await withStore(() => json({}), async (writes) => {
    const next = await setPolityFlag({ polity: "Ruritania", world, dataUrl: "data:image/png;base64,AAAA" });
    assert.deepEqual(next, { Ruritania: "data:image/png;base64,AAAA" });
    assert.equal(writes.length, 1);
  });
});

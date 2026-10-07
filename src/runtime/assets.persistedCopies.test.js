// Run: node --test src/runtime/assets.persistedCopies.test.js
//
// The copies of server files the page keeps in Cache Storage: which ones are
// stale, and that a change of token deletes them. They once piled up for good,
// about 215 MB for every sitting of every game (see isLoopbackHost in assets.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isLoopbackHost, isStalePersistedCopy, setRuntimeAssetEndpoints, sweepPersistedCopies } from "./assets.js";

// A Cache Storage stand-in: one cache, keyed by URL.
const installFakeCaches = (urls) => {
  const entries = new Map(urls.map((url) => [url, {}]));
  const cache = {
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    async delete(request) {
      return entries.delete(String(request?.url ?? request));
    },
  };
  const previous = globalThis.caches;
  globalThis.caches = { open: async () => cache };
  return { entries, restore: () => { globalThis.caches = previous; } };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const SITE = "https://openhistoria.com";
const OLD = "modern-day-session-2026-09-05T04:34:23.673Z-2026-09-04T23:37:08.982Z";
const NOW = "modern-day-session-2-2026-10-03T18:34:37.591Z-2026-10-03T18:34:37.517Z";
const at = (path, token) => `${SITE}${path}${token ? `?v=${encodeURIComponent(token)}` : ""}`;

test("the hosts that are this machine", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.3.2.1", "[::1]", "::1"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["openhistoria.com", "192.168.1.20", "localhost.example.com", "my-localhost", "", null, undefined]) {
    assert.equal(isLoopbackHost(host), false, String(host));
  }
});

test("from this machine's own server every copy of a server file is stale", () => {
  const local = { local: true, token: NOW };
  assert.equal(isStalePersistedCopy("http://localhost:3000/api/runtime/pmtiles/regions?v=" + encodeURIComponent(NOW), local), true, "even the current one");
  assert.equal(isStalePersistedCopy("http://localhost:3000/api/runtime/json/regionsGeojson", local), true);
  assert.equal(isStalePersistedCopy("http://localhost:3000/api/runtime/json/regionsGeojson", { local: true, token: "" }), true, "before any token is known too");
  assert.equal(isStalePersistedCopy("http://localhost:3000/__runtime-cache/region-catalog-v1.json", local), false, "a payload computed here is not a copy");
});

test("elsewhere a copy is stale once the token has moved on", () => {
  const site = { local: false, token: NOW };
  assert.equal(isStalePersistedCopy(at("/api/runtime/pmtiles/regions", OLD), site), true);
  assert.equal(isStalePersistedCopy(at("/api/runtime/pmtiles/regions", NOW), site), false);
  assert.equal(isStalePersistedCopy(at("/api/runtime/json/regionsGeojson"), site), true, "stored before the library had answered");
  assert.equal(isStalePersistedCopy(at("/assets/relief.json"), site), false, "an address without a token is not one of the world's");
  assert.equal(isStalePersistedCopy(at("/__runtime-cache/region-catalog-v1.json"), site), false);
  assert.equal(isStalePersistedCopy(at("/api/runtime/pmtiles/regions", OLD), { local: false, token: "" }), false, "nothing to compare with yet");
  assert.equal(isStalePersistedCopy("not a url at all ::", site), false);
});

test("the sweep deletes the stale copies and nothing else", async () => {
  const fake = installFakeCaches([
    at("/api/runtime/pmtiles/regions", OLD),
    at("/api/runtime/pmtiles/countries", OLD),
    at("/api/runtime/json/regionsGeojson", OLD),
    at("/api/runtime/json/regionsGeojson"),
    at("/api/runtime/pmtiles/regions", NOW),
    at("/__runtime-cache/region-catalog-v1.json"),
  ]);
  try {
    assert.equal(await sweepPersistedCopies({ local: false, token: NOW }), 4);
    assert.deepEqual([...fake.entries.keys()], [at("/api/runtime/pmtiles/regions", NOW), at("/__runtime-cache/region-catalog-v1.json")]);
    assert.equal(await sweepPersistedCopies({ local: false, token: NOW }), 0);
    assert.equal(await sweepPersistedCopies({ local: true, token: NOW }), 1, "this machine's server keeps none");
    assert.deepEqual([...fake.entries.keys()], [at("/__runtime-cache/region-catalog-v1.json")]);
  } finally {
    fake.restore();
  }
});

test("a change of token sweeps the copies of the one before", async () => {
  setRuntimeAssetEndpoints({ token: OLD });
  await settle();
  const fake = installFakeCaches([
    at("/api/runtime/pmtiles/regions", OLD),
    at("/api/runtime/json/regionsGeojson", OLD),
    at("/api/runtime/pmtiles/regions", NOW),
  ]);
  try {
    setRuntimeAssetEndpoints({ token: OLD });
    await settle();
    assert.equal(fake.entries.size, 3, "the same token again sweeps nothing");
    setRuntimeAssetEndpoints({ token: NOW });
    await settle();
    assert.deepEqual([...fake.entries.keys()], [at("/api/runtime/pmtiles/regions", NOW)]);
  } finally {
    fake.restore();
    setRuntimeAssetEndpoints({ token: "" });
    await settle();
  }
});

test("a file from this machine's own server is neither read from the cache nor written to it", () => {
  // The page's origin is fixed when the module loads, so this half is held by
  // the source: both writers and the one reader ask servedFromThisMachine.
  const source = fs.readFileSync(new URL("./assets.js", import.meta.url), "utf8");
  assert.match(source, /const persistent = !bypassPersistentCache && !servedFromThisMachine;/);
  assert.match(source, /if \(persistent\) \{\s+const cached = await readPersistedResponse\(url\);/);
  assert.match(source, /if \(persistent\) \{\s+persistResponse\(url, response\.clone\(\)\);/);
  assert.match(source, /if \(!isMutableRuntimeJsonUrl\(url\) && !servedFromThisMachine\) \{\s+persistResponse\(/);
  // Those two and writeRuntimeJson, whose payloads are computed here and kept.
  assert.equal((source.match(/persistResponse\(/g) ?? []).length, 3, "a new writer to the cache has to decide this too");
});

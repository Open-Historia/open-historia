/*! Open Historia — signed-document fetch tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/trust.test.js
//
// The website's Enter button, and every map archive's fallback to the origin,
// wait on the signed node directory. A request that never answers (a captive
// portal, a stalled connection) must end as "untrusted, use the origin".

import assert from "node:assert/strict";
import test from "node:test";

import { SIGNED_FETCH_TIMEOUT_MS, fetchSignedJson } from "./trust.js";

const withFetch = async (stub, body) => {
  const previous = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await body();
  } finally {
    globalThis.fetch = previous;
  }
};

// A server that accepts the request and never answers; only the caller's signal ends it.
const hanging = (seen) => (url, { signal } = {}) => {
  seen.push({ url, signal });
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
};

test("a signed document that never arrives ends as untrusted at the deadline", async () => {
  const seen = [];
  const started = Date.now();
  // AbortSignal.timeout's timer does not keep node's event loop alive (a page
  // stays alive on its own), and nothing else here does: without this, node
  // can finish before the deadline fires and cancel the test.
  const keepAlive = setTimeout(() => {}, 2000);
  let result;
  try {
    result = await withFetch(hanging(seen), () => fetchSignedJson("https://registry.example/node-directory.json", { timeoutMs: 50 }));
  } finally {
    clearTimeout(keepAlive);
  }
  assert.deepEqual(result, { valid: false, data: null, reason: "error" });
  assert.ok(Date.now() - started < 2000, "it gave up at the deadline, not later");
  assert.deepEqual(seen.map((s) => s.url), ["https://registry.example/node-directory.json", "https://registry.example/node-directory.json.sig"]);
  assert.ok(seen.every((s) => s.signal), "both the document and its signature are bounded");
});

test("the directory and one node probe fit inside the connect deadline", async () => {
  const { CONNECT_DEADLINE_MS } = await import("./nativeBoot.js");
  // selectBestNode waits on this before its 4 s probes; the two together must
  // fit inside the deadline the home page and the boot screen give a connection.
  assert.ok(SIGNED_FETCH_TIMEOUT_MS + 4000 <= CONNECT_DEADLINE_MS);
});

test("an unsigned document is still reported as unsigned, not as a timeout", async () => {
  const result = await withFetch(async (url) => (url.endsWith(".sig")
    ? new Response("", { status: 404 })
    : new Response("{}", { status: 200 })), () => fetchSignedJson("/node-directory.json"));
  assert.equal(result.reason, "unsigned");
});

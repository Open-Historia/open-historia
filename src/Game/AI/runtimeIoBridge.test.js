/*! Open Historia — a worker's runtime I/O, answered by the page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/runtimeIoBridge.test.js
//
// Runs without node_modules. Both halves wired to each other in-process: the
// worker's client posts to the page's server, which answers with a scripted
// fetch and posts back — the same round trip the Country Stats worker makes
// on the website and in the Android app, where its own fetch would 404.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { IO_CONFIG, IO_REQUEST, IO_RESULT, createWorkerIoClient, serveWorkerIo } from "./runtimeIoBridge.js";

const wire = (fetchImpl) => {
  const seen = [];
  let client;
  const page = async (message) => {
    seen.push(message);
    const reply = await serveWorkerIo(message, fetchImpl);
    if (reply) client.handle(reply);
  };
  client = createWorkerIoClient(page);
  return { client, seen };
};

test("a GET travels to the page's fetch and comes back with ok, status, text and json", async () => {
  const { client, seen } = wire(async (url, init) => {
    assert.equal(url, "/api/runtime/json/world?v=1");
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    return new Response(JSON.stringify({ gameDate: "2014-04-21" }), { status: 200 });
  });
  const response = await client.fetch("/api/runtime/json/world?v=1", { cache: "no-store" });
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { gameDate: "2014-04-21" });
  assert.equal(seen[0].type, IO_REQUEST);
  assert.equal(client.pendingCount(), 0, "nothing left waiting");
});

test("a PUT carries its body and headers, and a non-2xx is not ok", async () => {
  const { client } = wire(async (url, init) => {
    assert.equal(init.method, "PUT");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.body, "{\"a\":1}");
    return new Response("nope", { status: 500 });
  });
  const response = await client.fetch("/api/runtime/json/world", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{\"a\":1}" });
  assert.equal(response.ok, false);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "nope");
});

test("a fetch that throws on the page rejects in the worker as a TypeError, like fetch would", async () => {
  const { client } = wire(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(client.fetch("/api/x"), (error) => error instanceof TypeError && /Failed to fetch/.test(error.message));
});

test("answers are matched by id, and other messages are left alone", async () => {
  const posted = [];
  const client = createWorkerIoClient((message) => posted.push(message));
  const first = client.fetch("/one");
  const second = client.fetch("/two");
  assert.equal(client.handle({ type: "prepare", id: 3 }), false, "not ours");
  assert.equal(client.handle({ type: IO_RESULT, ioId: 99, status: 200, text: "" }), true, "ours, but nobody is waiting — swallowed");
  client.handle({ type: IO_RESULT, ioId: posted[1].ioId, status: 200, text: "two" });
  client.handle({ type: IO_RESULT, ioId: posted[0].ioId, status: 200, text: "one" });
  assert.equal(await (await first).text(), "one");
  assert.equal(await (await second).text(), "two");
});

test("the page ignores everything that is not an io request", async () => {
  assert.equal(await serveWorkerIo({ type: IO_CONFIG }, async () => new Response("")), null);
  assert.equal(await serveWorkerIo(null, async () => new Response("")), null);
});

test("Country Stats hosted-worker path keeps the page-side runtime I/O bridge wired", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /import \{ IO_CONFIG, IO_REQUEST, serveWorkerIo \} from "\.\/runtimeIoBridge\.js"/);
  assert.match(gameplay, /VITE_OH_WEB\) worker\.postMessage\(\{ type: IO_CONFIG, bridgeRuntimeIo: true \}\)/);
  assert.match(gameplay, /event\?\.data\?\.type === IO_REQUEST/);
  assert.match(gameplay, /serveWorkerIo\(event\.data, fetch\)/);
});

/*! Open Historia — shared game served from the host's view: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/remoteRuntime.test.js
//
// While a shared game is on, the game's document reads are answered from the
// host's view and writes to them are turned away; everything else is this
// device's own. Off, nothing changes.

import test from "node:test";
import assert from "node:assert/strict";
import { installRemoteRuntime, startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";

const origin = "http://localhost:5173";
const network = [];
const target = {
  location: { href: `${origin}/`, origin },
  fetch: async (input, init) => {
    network.push(`${String(init?.method || "GET")} ${typeof input === "string" ? input : input.url}`);
    return new Response(JSON.stringify({ local: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
};
installRemoteRuntime({ target, waitMs: 200 });

const body = async (response) => ({ status: response.status, json: await response.json() });
const published = [];
const urlFor = (key) => `/api/runtime/json/${key}?v=token`;

test("off, every request goes where it always did", async () => {
  stopRemoteRuntime();
  network.length = 0;
  assert.deepEqual(await body(await target.fetch("/api/runtime/json/world?v=1")), { status: 200, json: { local: true } });
  await target.fetch("/api/runtime/json/world?v=1", { method: "PUT", body: "{}" });
  assert.equal(network.length, 2);
});

test("on, the game's documents come from the host's view, and a newer view replaces an older", async () => {
  const runtime = startRemoteRuntime({ publish: (entries) => published.push(...entries), urlFor });
  network.length = 0;
  assert.equal(runtime.apply({ rev: 1, docs: { world: { units: [1] }, game: { country: "Spain" }, events: [], chat: [], actions: [] } }), true);
  assert.deepEqual(await body(await target.fetch("/api/runtime/json/world?v=token")), { status: 200, json: { units: [1] } });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/game?v=token"))).json, { country: "Spain" });
  assert.equal(runtime.apply({ rev: 1, docs: { world: { units: [2] } } }), false, "not newer");
  assert.equal(runtime.apply({ rev: 2, docs: { world: { units: [3] } } }), true);
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/world?v=token"))).json, { units: [3] });
  assert.equal(network.length, 0, "nothing reached this device's store");
  assert.deepEqual(published.at(-1), { url: urlFor("world"), value: { units: [3] } });
});

test("writes to the host's documents are turned away with a reason; a turn cannot be committed here", async () => {
  const refused = [];
  startRemoteRuntime({ publish: () => {}, urlFor, onRefusedWrite: (key) => refused.push(key) });
  network.length = 0;
  for (const key of ["world", "actions", "chat", "events", "game"]) {
    const reply = await body(await target.fetch(`/api/runtime/json/${key}?v=token`, { method: "PUT", body: "[]" }));
    assert.equal(reply.status, 409);
    assert.match(reply.json.error, /requests/);
  }
  assert.equal((await target.fetch("/api/runtime/turn-commit", { method: "PUT", body: "{}" })).status, 409);
  assert.equal((await target.fetch("/api/runtime/json/snapshots?v=token", { method: "PUT", body: "[]" })).status, 409);
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/snapshots?v=token"))).json, []);
  assert.deepEqual(refused, ["world", "actions", "chat", "events", "game"]);
  assert.equal(network.length, 0);
});

test("what is this device's own passes through: the advisor, the map's files, the library, other origins", async () => {
  startRemoteRuntime({ publish: () => {}, urlFor });
  network.length = 0;
  await target.fetch("/api/runtime/json/advisor?v=token", { method: "PUT", body: "[]" });
  await target.fetch("/api/runtime/json/regionsGeojson?v=token");
  await target.fetch("/api/runtime/pmtiles/regions?v=token");
  await target.fetch("/api/library");
  await target.fetch("https://relay.example/x");
  assert.equal(network.length, 5);
});

test("a document the host has not sent yet is waited for, then served; an optional one falls back to this device", async () => {
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor });
  network.length = 0;
  const pending = target.fetch("/api/runtime/json/events?v=token");
  setTimeout(() => runtime.apply({ rev: 1, docs: { events: [{ id: "e1" }] } }), 20);
  assert.deepEqual((await body(await pending)).json, [{ id: "e1" }]);
  // colors are optional: until the host sends its own, the scenario's are used.
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/colors?v=token"))).json, { local: true });
  const late = await target.fetch("/api/runtime/json/chat?v=token");
  assert.equal(late.status, 503, "a required document that never comes is an error, not a silent empty");
  stopRemoteRuntime();
});

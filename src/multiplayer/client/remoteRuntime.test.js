/*! Open Historia — shared game served from the host's view: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/remoteRuntime.test.js
//
// While a shared game is on, the game's document reads are answered from the
// host's view, and a write to one is read by a hook and answered with the
// document the page holds; everything else is this device's own. Off, nothing
// changes. A view is shown only if it follows the one held and adds up to what
// the host says it holds (protocol/digest.js).

import test from "node:test";
import assert from "node:assert/strict";
import { installRemoteRuntime, startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";
import { VIEW_KEYS } from "../game/messages.js";
import { digestText } from "../protocol/digest.js";

// Views as the host builds them (host/gameHost.js pushViews): what changed
// since the last one, the number it follows (0 for a whole view), and what
// every document adds up to.
const viewsFrom = (epoch = "e1") => {
  const sent = new Map();
  let rev = 0;
  return {
    next(state, { whole = false } = {}) {
      if (whole) sent.clear();
      const isWhole = sent.size === 0;
      const docs = {};
      for (const key of VIEW_KEYS) {
        const json = JSON.stringify(state[key] ?? null);
        if (sent.get(key) !== json) {
          sent.set(key, json);
          docs[key] = state[key] ?? null;
        }
      }
      const base = isWhole ? 0 : rev;
      rev += 1;
      return { epoch, rev, base, docs, sums: Object.fromEntries(VIEW_KEYS.map((key) => [key, digestText(sent.get(key) ?? "null")])) };
    },
  };
};
const GAME = { world: { units: [1] }, game: { country: "Spain" }, events: [], chat: [], actions: [] };

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

test("on, the game's documents come from the host's view, and each view is shown only if it follows the one held", async () => {
  const runtime = startRemoteRuntime({ publish: (entries) => published.push(...entries), urlFor });
  const host = viewsFrom("e1");
  network.length = 0;
  const first = host.next(GAME);
  assert.equal(first.base, 0, "a connection's first view is whole");
  assert.deepEqual(runtime.apply(first), { ok: true });
  assert.deepEqual(await body(await target.fetch("/api/runtime/json/world?v=token")), { status: 200, json: { units: [1] } });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/game?v=token"))).json, { country: "Spain" });
  assert.deepEqual(runtime.apply(first), { ok: false, reason: "repeat" });

  const second = host.next({ ...GAME, world: { units: [3] } });
  assert.deepEqual(Object.keys(second.docs), ["world"], "only what changed");
  assert.deepEqual(runtime.apply(second), { ok: true });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/world?v=token"))).json, { units: [3] });
  assert.deepEqual(published.at(-1), { url: urlFor("world"), value: { units: [3] } });

  // A view lost on the way: the next one does not follow the one held, and is
  // not shown; the page holds what it held.
  host.next({ ...GAME, world: { units: [4] } });
  const after = host.next({ ...GAME, world: { units: [4] }, events: [{ id: "e9" }] });
  assert.deepEqual(runtime.check(after), { ok: false, reason: "gap" });
  assert.deepEqual(runtime.apply(after), { ok: false, reason: "gap" });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/world?v=token"))).json, { units: [3] });
  // The whole view, sent again, puts it right.
  assert.deepEqual(runtime.apply(host.next({ ...GAME, world: { units: [4] }, events: [{ id: "e9" }] }, { whole: true })), { ok: true });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/events?v=token"))).json, [{ id: "e9" }]);
  assert.equal(network.length, 0, "nothing reached this device's store");
});

test("a reconnect is a new connection: its whole view is shown, whatever number it starts from", () => {
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor });
  const before = viewsFrom("aaa");
  runtime.apply(before.next(GAME));
  for (let n = 0; n < 59; n += 1) runtime.apply(before.next({ ...GAME, world: { units: [n] } }));
  assert.equal(runtime.rev, 60);
  // The host counts from 1 again on the new connection. The page wanted a view
  // above 60, ignored every one, and played on in a frozen world.
  const again = viewsFrom("bbb");
  const whole = again.next({ ...GAME, world: { units: ["after the reconnect"] } });
  assert.equal(whole.rev, 1);
  assert.deepEqual(runtime.apply(whole), { ok: true });
  assert.deepEqual(runtime.held("world"), { units: ["after the reconnect"] });
  assert.equal(runtime.epoch, "bbb");
  // And a view of the old connection that arrives late changes nothing.
  assert.deepEqual(runtime.apply(before.next({ ...GAME, world: { units: ["stale"] } })), { ok: false, reason: "gap" });
  assert.deepEqual(runtime.held("world"), { units: ["after the reconnect"] });
});

test("a view that does not add up to what the host holds is not shown", () => {
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor });
  const host = viewsFrom("e1");
  runtime.apply(host.next(GAME));
  const view = host.next({ ...GAME, chat: [{ id: "t1" }] });
  const changed = { ...view, docs: { chat: [{ id: "t1", messages: ["not what the host sent"] }] } };
  assert.deepEqual(runtime.apply(changed), { ok: false, reason: "digest", key: "chat" });
  assert.deepEqual(runtime.held("chat"), []);
  // Nor one whose digests say the page lacks something it was never sent.
  const wrongSums = { ...view, sums: { ...view.sums, world: digestText("{\"units\":[99]}") } };
  assert.deepEqual(runtime.apply(wrongSums), { ok: false, reason: "digest", key: "world" });
  assert.deepEqual(runtime.apply(view), { ok: true });
});

test("a document the view sends as null is one the page no longer holds", async () => {
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor });
  const host = viewsFrom("e1");
  runtime.apply(host.next({ ...GAME, colors: { Spain: "#c60b1e" } }));
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/colors?v=token"))).json, { Spain: "#c60b1e" });
  network.length = 0;
  assert.deepEqual(runtime.apply(host.next(GAME)), { ok: true });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/colors?v=token"))).json, { local: true }, "the scenario's own again");
  assert.equal(network.length, 1);
});

test("a write never reaches the host's game or this device's store: a hook reads it, and the page is answered with the document it holds", async () => {
  const writes = [];
  const shown = [];
  const runtime = startRemoteRuntime({
    publish: (entries) => shown.push(...entries),
    urlFor,
    onWrite: ({ key, wanted, held }) => {
      writes.push({ key, wanted, held });
      // The hook may answer in the shape the page's own writers save in.
      return key === "actions" ? [{ id: "shaped" }] : undefined;
    },
  });
  const host = viewsFrom("e1");
  runtime.apply(host.next({ world: { units: [1], projects: [] }, game: { country: "Spain", round: 3 }, events: [], chat: [], actions: [] }));
  network.length = 0;

  const wanted = { units: [1, 2], projects: [], actionSuggestions: ["a"] };
  const reply = await body(await target.fetch("/api/runtime/json/world?v=token", { method: "PUT", body: JSON.stringify(wanted) }));
  assert.deepEqual(reply, { status: 200, json: { units: [1], projects: [] } }, "the host's view, whatever was written");
  assert.deepEqual(writes, [{ key: "world", wanted, held: { units: [1], projects: [] } }]);
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/actions?v=token", { method: "PUT", body: "[]" }))).json, [{ id: "shaped" }]);

  // What is this device's own is laid over every view of the document from here on.
  runtime.patch("world", { actionSuggestions: ["a"] });
  assert.deepEqual(shown.at(-1), { url: urlFor("world"), value: { units: [1], projects: [], actionSuggestions: ["a"] } });
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/world?v=token"))).json.actionSuggestions, ["a"]);
  runtime.apply(host.next({ world: { units: [9], projects: [] }, game: { country: "Spain", round: 3 }, events: [], chat: [], actions: [] }));
  assert.deepEqual(shown.at(-1).value, { units: [9], projects: [], actionSuggestions: ["a"] });
  const before = shown.length;
  runtime.patch("world", { actionSuggestions: undefined }, { quiet: true });
  assert.equal(shown.length, before, "quietly: a view is about to show it");
  assert.deepEqual(runtime.held("world"), { units: [9], projects: [] });

  // A turn is never committed here, and the rollback archive is the host's.
  assert.equal((await target.fetch("/api/runtime/turn-commit", { method: "PUT", body: "{}" })).status, 409);
  assert.equal((await target.fetch("/api/runtime/json/snapshots?v=token", { method: "PUT", body: "[]" })).status, 409);
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/snapshots?v=token"))).json, []);
  // One restore point read on its own holds the whole world as it was: there is none here.
  assert.equal((await target.fetch("/api/runtime/snapshots/turn-12?v=token")).status, 404);
  // A document the host has not sent cannot be written either.
  assert.equal((await target.fetch("/api/runtime/json/flags?v=token", { method: "PUT", body: "{}" })).status, 409);
  assert.equal(network.length, 0);
});

test("a save that repeats without end is stopped", async () => {
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor, onWrite: () => undefined });
  runtime.apply(viewsFrom("e1").next({ world: {}, game: {}, events: [], chat: [], actions: [] }));
  const statuses = [];
  for (let n = 0; n < 40; n += 1) statuses.push((await target.fetch("/api/runtime/json/world?v=token", { method: "PUT", body: "{}" })).status);
  assert.equal(statuses.slice(0, 30).every((status) => status === 200), true, "an ordinary run of saves is answered");
  assert.equal(statuses.at(-1), 409, "one that never stops is turned away");
  // Another document is counted on its own.
  assert.equal((await target.fetch("/api/runtime/json/actions?v=token", { method: "PUT", body: "[]" })).status, 200);
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
  setTimeout(() => runtime.apply(viewsFrom("e1").next({ world: {}, game: {}, events: [{ id: "e1" }], chat: [], actions: [] })), 20);
  assert.deepEqual((await body(await pending)).json, [{ id: "e1" }]);
  // colors are optional: until the host sends its own, the scenario's are used.
  assert.deepEqual((await body(await target.fetch("/api/runtime/json/colors?v=token"))).json, { local: true });
  stopRemoteRuntime();
  // A required document that never comes: before the first view, a read waits, then says so.
  startRemoteRuntime({ publish: () => {}, urlFor });
  const late = await target.fetch("/api/runtime/json/chat?v=token");
  assert.equal(late.status, 503, "a required document that never comes is an error, not a silent empty");
  stopRemoteRuntime();
});

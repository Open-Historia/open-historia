/*! Open Historia — single-document queued mutation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.mutateDocument.test.js
//
// mutateRuntimeDocument reads a document fresh inside the canonical write
// queue and writes back only that document. These drive it against an
// in-memory runtime store behind a stubbed fetch, the way the page talks to
// the local server, and pin the two things it exists for: concurrent writers
// never erase each other's changes, and a write never lands in a campaign the
// player has since switched away from.

import test from "node:test";
import assert from "node:assert/strict";
import { JSON_URLS, setRuntimeAssetEndpoints } from "./assets.js";
import {
  mutateCanonicalTurnState,
  mutateChatsState,
  mutateRuntimeDocument,
  mutateWorldState,
  readWorldState,
  runInCanonicalWriteQueue,
  writeChatsState,
  writeWorldState,
} from "./gameState.js";

const store = new Map();
let puts = 0;

const keyOf = (url) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  return match ? match[1] : null;
};

const CANONICAL_KEYS = ["actions", "chat", "events", "game", "colors", "world"];

globalThis.fetch = async (url, init = {}) => {
  // Every request takes a turn of the event loop, as a real one does, so
  // unqueued writers really do interleave.
  await new Promise((resolve) => setTimeout(resolve, 1));
  // The whole-generation commit: all six documents at once, echoed back.
  if (String(url).startsWith("/api/runtime/turn-commit")) {
    const assets = JSON.parse(String(init.body));
    puts += 1;
    for (const key of CANONICAL_KEYS) store.set(key, JSON.stringify(assets[key]));
    return new Response(JSON.stringify({ assets, transactionId: `t${puts}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const key = keyOf(url);
  if (!key) return new Response("not found", { status: 404 });
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    puts += 1;
    store.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const reset = (token = "campaign-a") => {
  store.clear();
  puts = 0;
  setRuntimeAssetEndpoints({ token });
  store.set("world", JSON.stringify({ notes: "" }));
  store.set("chat", JSON.stringify([]));
};

test("concurrent world mutations all land: none is erased by another's older copy", async () => {
  reset();
  const writers = Array.from({ length: 8 }, (_, index) => mutateWorldState((world) => ({
    ...world,
    notes: `${world.notes || ""}[${index}]`,
  })));
  await Promise.all(writers);
  const world = await readWorldState({ force: true });
  for (let index = 0; index < 8; index += 1) {
    assert.ok(world.notes.includes(`[${index}]`), `writer ${index}'s change was lost: ${world.notes}`);
  }
});

test("the old read-then-write pattern loses updates; the queued one does not", async () => {
  reset();
  // What the engine did: read, wait on something slow, write the old copy back.
  const stale = (async () => {
    const world = await readWorldState({ force: true });
    // Long next to a timer tick: a 1 ms timer can take 15 ms on Windows, and the
    // control needs the stale write to land after the player's for certain.
    await new Promise((resolve) => setTimeout(resolve, 250)); // the model call
    await writeWorldState({ ...world, notes: `${world.notes}[stale]` });
  })();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await mutateWorldState((world) => ({ ...world, notes: `${world.notes}[player]` }));
  await stale;
  const lost = await readWorldState({ force: true });
  assert.equal(lost.notes.includes("[player]"), false, "control: the stale writer erases the player's change");

  reset();
  const queued = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 250)); // the model call, done first
    await mutateWorldState((world) => ({ ...world, notes: `${world.notes}[engine]` }));
  })();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await mutateWorldState((world) => ({ ...world, notes: `${world.notes}[player]` }));
  await queued;
  const kept = await readWorldState({ force: true });
  assert.ok(kept.notes.includes("[player]") && kept.notes.includes("[engine]"), kept.notes);
});

test("returning null writes nothing and resolves to null", async () => {
  reset();
  const before = puts;
  const result = await mutateWorldState(() => null);
  assert.equal(result, null);
  assert.equal(puts, before);
});

test("a mutation queued before a campaign switch writes nothing into the new campaign", async () => {
  reset("campaign-a");
  // Hold the queue with a slow chat write, queue a world mutation behind it,
  // then switch campaigns before the mutation's turn comes.
  const blocker = writeChatsState([]);
  const mutation = mutateWorldState((world) => ({ ...world, notes: "from campaign A" }));
  setRuntimeAssetEndpoints({ token: "campaign-b" });
  await blocker;
  await assert.rejects(mutation, /Active campaign changed/);
  const world = await readWorldState({ force: true });
  assert.notEqual(world.notes, "from campaign A");
  assert.match(JSON_URLS.world, /campaign-b/);
});

test("chat mutations share the queue with ordinary chat writes, in order", async () => {
  reset();
  const first = writeChatsState([{ id: "one", countries: [{ name: "France", code: "" }], messages: [] }]);
  const second = mutateChatsState((chats) => [
    ...chats,
    { id: "two", countries: [{ name: "Spain", code: "" }], messages: [] },
  ]);
  await Promise.all([first, second]);
  const saved = JSON.parse(store.get("chat"));
  assert.deepEqual(saved.map((chat) => chat.id), ["one", "two"]);
});

test("an unknown document or a missing mutator is refused", async () => {
  await assert.rejects(mutateRuntimeDocument("snapshots", () => ({})), /unknown document/);
  await assert.rejects(mutateRuntimeDocument("world", null), /requires a mutator/);
});

test("a task run in the queue holds it: no queued write lands in the middle of it", async () => {
  reset();
  const order = [];
  // What the stats worker does from its own thread: read, wait, write back.
  const worker = runInCanonicalWriteQueue(async () => {
    order.push("worker read");
    const world = JSON.parse(store.get("world"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.set("world", JSON.stringify({ ...world, notes: `${world.notes}[sheet]` }));
    order.push("worker wrote");
  });
  const page = mutateWorldState((world) => {
    order.push("page mutation");
    return { ...world, notes: `${world.notes}[unit]` };
  });
  await Promise.all([worker, page]);
  assert.deepEqual(order, ["worker read", "worker wrote", "page mutation"]);
  const world = await readWorldState({ force: true });
  assert.ok(world.notes.includes("[sheet]") && world.notes.includes("[unit]"), world.notes);
});

test("a queued task refuses to run once the campaign has changed", async () => {
  reset("campaign-a");
  const blocker = writeChatsState([]);
  let ran = false;
  const task = runInCanonicalWriteQueue(() => { ran = true; });
  setRuntimeAssetEndpoints({ token: "campaign-b" });
  await blocker;
  await assert.rejects(task, /Active campaign changed/);
  assert.equal(ran, false);
});

test("a canonical mutation keeps the GM's same-prose corrections only when asked to", async () => {
  // Two events a GM approved that read the same but settle different wars: the
  // exact transaction keeps both; an ordinary write folds the prose repeat.
  const twin = (warId) => ({ id: `e-${warId}`, date: "2014-03-01", title: "Border clash", description: "Shots were exchanged.", warId });
  reset();
  await mutateCanonicalTurnState(() => ({ events: [twin("a"), twin("b")] }), { preserveApprovedEvents: true });
  assert.equal(JSON.parse(store.get("events")).length, 2);
  reset();
  await mutateCanonicalTurnState(() => ({ events: [twin("a"), twin("b")] }));
  assert.equal(JSON.parse(store.get("events")).length, 1);
});

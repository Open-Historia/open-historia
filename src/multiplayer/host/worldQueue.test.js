/*! Open Historia — the one order a shared game's changes are applied in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/worldQueue.test.js
//
// The owner pressed "Start the game" in a game with two guests in: the button
// animated and nothing happened, nothing was said (2026-11-18). Start is an
// entry of the host's one queue, and an entry ahead of it never ended. For a
// while the queue then passed over an entry after three minutes; the entry
// passed over still wrote, beside the next one, and a request's write was
// marked as another request's (the review of 2026-11-19, F1 and F2). These pin
// the class: one entry at a time, always; a long entry is said; one past its
// bound fails, with why, and writes nothing more; the round, long by nature,
// is said as long and never bounded here.

import test from "node:test";
import assert from "node:assert/strict";

import { appliedIn, createRequestLedger, requestStamp } from "./requestLedger.js";
import { ENTRY_MOST_MS, OVERDUE, SLOW_MS, createWorldQueue, guardedStore } from "./worldQueue.js";

const createClock = () => {
  let t = 0;
  let next = 1;
  const pending = new Map();
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    now: () => t,
    timers: {
      setInterval: (fn, ms) => {
        const id = next++;
        pending.set(id, { at: t + ms, every: ms, fn });
        return id;
      },
      clearInterval: (id) => pending.delete(id),
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...pending.values()].filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        due.at += due.every;
        due.fn();
        await flush();
      }
      t = end;
      await flush();
    },
    flush,
  };
};

const queueWith = (clock) => {
  const slow = [];
  const overdue = [];
  const settled = [];
  const queue = createWorldQueue({
    timers: clock.timers,
    now: clock.now,
    onSlow: (entry) => slow.push(entry),
    onOverdue: (entry) => overdue.push(entry),
    onSettled: (label) => settled.push(label),
  });
  return { queue, slow, overdue, settled };
};

test("an entry left open is said while it runs, fails at its bound with why, and nothing behind it runs beside it", async () => {
  const clock = createClock();
  const { queue, slow, overdue } = queueWith(clock);
  let finish = () => {};
  let signal = null;
  const stuck = queue.run("ownSheet", (entry) => {
    signal = entry.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  let started = false;
  const start = queue.run("start", async () => { started = true; });
  await clock.flush();
  assert.equal(queue.running, "ownSheet");

  await clock.advance(SLOW_MS);
  assert.deepEqual(slow.map((entry) => [entry.label, entry.waiting, entry.long]), [["ownSheet", 1, false]], "said, with what waits behind it");

  let failure = null;
  stuck.catch((error) => { failure = error; });
  await clock.advance(ENTRY_MOST_MS);
  assert.equal(overdue.length, 1);
  assert.equal(failure?.code, OVERDUE, "its requester is answered: not applied, and why");
  assert.equal(signal.aborted, true);
  assert.equal(queue.overdue, true);
  assert.equal(started, false, "Start still waits: nothing is ever applied beside an entry");
  assert.equal(queue.running, "ownSheet");

  finish();
  await start;
  assert.equal(started, true, "and is applied the moment it has ended");
  assert.equal(queue.overdue, false);
});

test("the round is said as long, never bounded, and nothing is applied beside it", async () => {
  const clock = createClock();
  const { queue, slow, overdue } = queueWith(clock);
  let land = () => {};
  void queue.run("round", () => new Promise((resolve) => { land = resolve; }));
  let started = false;
  void queue.run("start", async () => { started = true; });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS * 3);
  assert.ok(slow.length > 0 && slow.every((entry) => entry.long === true), "said, as the long entry it is");
  assert.equal(overdue.length, 0);
  assert.equal(started, false);
  land();
  await clock.flush();
  assert.equal(started, true);
});

test("an entry that ends in time is never said, and the queue keeps its order", async () => {
  const clock = createClock();
  const { queue, slow, settled } = queueWith(clock);
  const order = [];
  const first = queue.run("a", async () => { order.push("a"); });
  const second = queue.run("b", async () => { order.push("b"); });
  await Promise.all([first, second]);
  await clock.advance(SLOW_MS * 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.deepEqual(settled, ["a", "b"]);
  assert.equal(slow.length, 0);
  assert.equal(queue.runningFor(), 0);
});

test("an entry dropped while it waited is not applied, and the next one runs", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  let hold = () => {};
  void queue.run("first", () => new Promise((resolve) => { hold = resolve; }));
  const mine = queue.run("order", async () => "applied", { owner: "device-a" });
  const after = queue.run("next", async () => "next");
  assert.equal(queue.drop("device-a", "let go"), 1);
  await clock.flush();
  hold();
  await assert.rejects(mine, /let go/);
  assert.equal(await after, "next");
});

// The reviewer's probe (ledgerOverlap.mjs), as a test: a request's entry that waits long (an enterSimulation behind
// a long Game Master think, say), then writes, with the next player's request behind it. When the queue passed the
// first over, the two ran at once and shared the ledger's one open slot: A's write was stamped with B's mark, A was
// left unmarked (applied twice after an engine restart), and B was marked before it had written anything.
test("no two entries ever write at once: each request's write carries its own mark", async () => {
  const clock = createClock();
  const docs = { world: { n: 0 }, game: {}, actions: [], events: [], chats: [] };
  const store = {
    updateGameDocs: async (fn) => { const patch = await fn(docs); if (patch) Object.assign(docs, patch); },
    updateWorld: async (fn) => { const next = await fn(docs.world); if (next) docs.world = next; },
  };
  const ledger = createRequestLedger(store);
  const { queue } = queueWith(clock);
  const A = requestStamp("devA", "1");
  const B = requestStamp("devB", "1");
  let resumeA = () => {};
  const aWaits = new Promise((resolve) => { resumeA = resolve; });
  const written = [];
  const a = queue.run("order", () => ledger.during(A, async () => {
    await aWaits;
    written.push("a");
    await ledger.store.updateWorld((world) => ({ ...world, a: true }));
  }));
  const b = queue.run("order", () => ledger.during(B, async () => {
    written.push("b");
    assert.equal(appliedIn(docs.game, A), true, "A was written and marked before B began");
    await ledger.store.updateWorld((world) => ({ ...world, b: true }));
  }));
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS - SLOW_MS);
  assert.deepEqual(written, [], "B never begins beside A");
  resumeA();
  await Promise.all([a, b]);
  assert.deepEqual(written, ["a", "b"]);
  assert.deepEqual(docs.world, { n: 0, a: true, b: true });
  assert.equal(appliedIn(docs.game, A), true);
  assert.equal(appliedIn(docs.game, B), true);
});

test("an overdue entry's late write is refused at the store's door; reads and the session's record pass", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  const writes = [];
  const store = guardedStore({
    read: async () => ({ ok: true }),
    readShared: async () => ({}),
    writeShared: async () => { writes.push("session"); },
    updateWorld: async () => { writes.push("world"); },
  }, () => queue.overdue);
  let finish = () => {};
  const late = queue.run("order", async () => {
    await new Promise((resolve) => { finish = resolve; });
    return store.updateWorld(() => ({}));
  });
  late.catch(() => {});
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS);
  assert.equal(queue.overdue, true);
  await assert.rejects(store.updateWorld(() => ({})), (error) => error.code === OVERDUE);
  assert.deepEqual(await store.read(), { ok: true });
  await store.writeShared({});
  finish();
  await assert.rejects(late, (error) => error.code === OVERDUE);
  await queue.settled();
  assert.deepEqual(writes, ["session"], "nothing of the overdue entry landed");
  await store.updateWorld(() => ({}));
  assert.deepEqual(writes, ["session", "world"], "and the next entry writes as ever");
});

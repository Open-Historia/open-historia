/*! Open Historia — the one order a shared game's changes are applied in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/worldQueue.test.js
//
// The owner pressed "Start the game" in a game with two guests in: the button
// animated and nothing happened, nothing was said (2026-11-18). Start is an
// entry of the host's one queue, and an entry ahead of it never ended. Every
// way an entry is left open (a reading's write held and never let go, a write
// that waits on an entry queued behind itself, a lock whose holder waits on
// the queue) blocked every entry behind it for good, silently. These pin the
// class: a long entry is said, and one that never ends no longer holds the
// queue; the round, long by nature, is said and never passed over.

import test from "node:test";
import assert from "node:assert/strict";

import { GIVE_UP_MS, SLOW_MS, createWorldQueue } from "./worldQueue.js";

const createClock = () => {
  let t = 0;
  let next = 1;
  const pending = new Map();
  const flush = async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
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
  const gaveUp = [];
  const queue = createWorldQueue({
    timers: clock.timers,
    now: clock.now,
    onSlow: (entry) => slow.push(entry),
    onGaveUp: (entry) => gaveUp.push(entry),
  });
  return { queue, slow, gaveUp };
};

test("an entry left open is said while it runs, and after a bound the entries behind it are applied", async () => {
  const clock = createClock();
  const { queue, slow, gaveUp } = queueWith(clock);
  // A reading's write entered and never let go (engineMain.js setReadingsOrder).
  void queue.run("reading:stat-sheet", () => new Promise(() => {}));
  let started = false;
  const start = queue.run("start", async () => { started = true; });
  await clock.flush();
  assert.equal(queue.running, "reading:stat-sheet");

  await clock.advance(SLOW_MS);
  assert.deepEqual(slow.map((entry) => [entry.label, entry.waiting]), [["reading:stat-sheet", 1]], "said, with what waits behind it");
  assert.equal(started, false);

  await clock.advance(GIVE_UP_MS - SLOW_MS);
  assert.equal(gaveUp.length, 1);
  assert.equal(gaveUp[0].label, "reading:stat-sheet");
  await start;
  assert.equal(started, true, "Start is applied");
  assert.equal(queue.running, "");
});

test("a write that waits on an entry queued behind itself no longer deadlocks the queue", async () => {
  const clock = createClock();
  const { queue, gaveUp } = queueWith(clock);
  // An entry whose write takes another entry (a reading's write inside a request's own).
  const outer = queue.run("ownSheet", () => queue.run("reading:intelligence-rating", async () => "rated"));
  let after = false;
  void queue.run("start", async () => { after = true; });
  await clock.flush();
  await clock.advance(GIVE_UP_MS);
  assert.equal(gaveUp[0]?.label, "ownSheet");
  assert.equal(await outer, "rated", "the inner entry ran once the outer one let go of the queue");
  await clock.flush();
  assert.equal(after, true);
});

test("the round is said while it runs and never passed over", async () => {
  const clock = createClock();
  const { queue, slow, gaveUp } = queueWith(clock);
  let land = () => {};
  void queue.run("round", () => new Promise((resolve) => { land = resolve; }));
  let started = false;
  void queue.run("start", async () => { started = true; });
  await clock.flush();
  await clock.advance(GIVE_UP_MS * 3);
  assert.ok(slow.length > 0);
  assert.equal(gaveUp.length, 0);
  assert.equal(started, false, "nothing is applied beside a round");
  land();
  await clock.flush();
  assert.equal(started, true);
});

test("an entry that ends in time is never said, and the queue keeps its order", async () => {
  const clock = createClock();
  const { queue, slow } = queueWith(clock);
  const order = [];
  const first = queue.run("a", async () => { order.push("a"); });
  const second = queue.run("b", async () => { order.push("b"); });
  await Promise.all([first, second]);
  await clock.advance(SLOW_MS * 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(slow.length, 0);
  assert.equal(queue.runningFor(), 0);
});

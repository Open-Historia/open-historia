/*! Open Historia — the one order a shared game's changes are applied in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/worldQueue.test.js
//
// The owner pressed "Start the game" in a game with two guests in: the button
// animated and nothing happened, nothing was said (2026-11-18). Start is an
// entry of the host's one queue, and an entry ahead of it never ended. For a
// while the queue then passed over an entry after three minutes; the entry
// passed over still wrote, beside the next one, and a request's write was
// marked as another request's (the review of 2026-11-19, F1 and F2). Then an
// entry past its bound was failed but still waited for, and one whose work
// never ended held the queue for good. These pin the class: one entry at a
// time, always; a long entry is said; one past its bound is stopped, with why,
// and let go, and nothing of it (a write, a read, the work after them) ever
// lands after; the round, long by nature, is said as long and never bounded.

import test from "node:test";
import assert from "node:assert/strict";

import { appliedIn, requestStamp, requestStore } from "./requestLedger.js";
import { ENTRY_MOST_MS, OVERDUE, OVERDUE_MAYBE_WORDS, OVERDUE_WORDS, SLOW_MS, createWorldQueue, fencedStore } from "./worldQueue.js";

// A clock stepped by hand: each timer that falls due runs, then everything it set going settles (a turn of the event
// loop runs every microtask queued before it, and the ones those queue).
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
  const overdue = [];
  const settled = [];
  const stale = [];
  const queue = createWorldQueue({
    timers: clock.timers,
    now: clock.now,
    onSlow: (entry) => slow.push(entry),
    onOverdue: (entry) => overdue.push(entry),
    onSettled: (label) => settled.push(label),
    onStale: (entry) => stale.push(entry),
  });
  return { queue, slow, overdue, settled, stale };
};

// The game's documents, and a store over them as the host's is: its writes queued one at a time in the order asked,
// each reading the documents fresh and handing them to its mutator (gameState.js enqueueCanonicalGenerationWrite). A
// write can be made to hang (`stall()`): it, and every write behind it, waits until `resume()`.
const memoryStore = () => {
  const docs = { world: { n: 0 }, game: {}, actions: [], events: [], chats: [] };
  let chain = Promise.resolve();
  let stalled = null;
  const run = (job) => {
    const turn = chain.then(async () => {
      if (stalled) await stalled.promise;
      return job();
    });
    chain = turn.then(() => {}, () => {});
    return turn;
  };
  const one = (key) => (fn) => run(async () => {
    const next = await fn(structuredClone(docs[key]));
    if (next !== null && next !== undefined) docs[key] = next;
    return next ?? null;
  });
  return {
    docs,
    stall() {
      let resume = () => {};
      const promise = new Promise((resolve) => { resume = resolve; });
      stalled = { promise };
      return () => {
        stalled = null;
        resume();
      };
    },
    read: () => run(async () => structuredClone(docs)),
    updateWorld: one("world"),
    updateActions: one("actions"),
    updateChats: one("chats"),
    updateGame: one("game"),
    updateGameDocs: (fn) => run(async () => {
      const patch = await fn(structuredClone(docs));
      if (patch) Object.assign(docs, patch);
      return patch ?? null;
    }),
  };
};

test("an entry that never ends is said while it runs, stopped at its bound with why, and the next one runs", async () => {
  const clock = createClock();
  const { queue, slow, overdue, settled } = queueWith(clock);
  let signal = null;
  let fence = null;
  const stuck = queue.run("ownSheet", (entry) => {
    ({ signal, fence } = entry);
    // A promise nobody ever keeps: the save the game's server never answered.
    return new Promise(() => {});
  });
  let started = false;
  const start = queue.run("start", async () => { started = true; return "started"; });
  await clock.flush();
  assert.equal(queue.running, "ownSheet");

  await clock.advance(SLOW_MS);
  assert.deepEqual(slow.map((entry) => [entry.label, entry.waiting, entry.long]), [["ownSheet", 1, false]], "said, with what waits behind it");
  assert.equal(started, false, "one entry at a time: nothing runs beside it while it may still write");
  assert.equal(fence.live, true);

  let failure = null;
  stuck.catch((error) => { failure = error; });
  await clock.advance(ENTRY_MOST_MS);
  assert.equal(failure?.code, OVERDUE, "its requester is answered: stopped, and why");
  assert.equal(failure?.message, OVERDUE_WORDS);
  assert.deepEqual(overdue.map((entry) => [entry.label, entry.passed]), [["ownSheet", true]], "the host is told");
  assert.equal(signal.aborted, true, "what it waits on that listens is ended");
  assert.equal(fence.live, false, "and it can change nothing more");
  assert.equal(await start, "started", "Start is applied: the bound bounds");
  assert.equal(started, true);
  assert.deepEqual(settled, ["start"]);
  assert.equal(queue.running, "");
  assert.equal(queue.overdue, false);
  await queue.settled();
});

test("every write an entry let go makes after its bound is refused, and changes nothing; the next entry's lands", async () => {
  const clock = createClock();
  const { queue, stale } = queueWith(clock);
  const store = memoryStore();
  const after = [];
  let late = () => {};
  const comeBack = new Promise((resolve) => { late = resolve; });
  // An entry that waits long (a map read that never came back, say), then would write, read, and go on.
  const stuck = queue.run("deploy", async (entry) => {
    const own = fencedStore(store, entry.fence);
    await entry.fence.hold(comeBack);
    after.push("it went on");
    await own.updateWorld((world) => ({ ...world, stale: true }));
    after.push("it wrote");
  });
  stuck.catch(() => {});
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  // The next entry writes as ever.
  await queue.run("order", async (entry) => {
    await fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, order: true }));
  });
  assert.deepEqual(store.docs.world, { n: 0, order: true });
  // What the stopped entry waited on comes back at last: nothing of it runs, so nothing of it is written or said.
  late();
  await clock.flush();
  assert.deepEqual(after, [], "the rest of its work never runs");
  assert.deepEqual(store.docs.world, { n: 0, order: true });
  assert.deepEqual(stale.map((entry) => entry.label), ["deploy"], "said once for the host's log");
  await queue.settled();
});

test("a write an entry asked for before its bound, still waiting in the game's write chain when the bound passes, writes nothing", async () => {
  const clock = createClock();
  const { queue, stale } = queueWith(clock);
  const store = memoryStore();
  // The game's write chain is held (its server is slow): the entry's write waits in it, the mutator not yet run.
  const resume = store.stall();
  let fenceOf = null;
  const stuck = queue.run("goal", (entry) => {
    fenceOf = entry.fence;
    return fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, goal: "Hold the coast" }));
  });
  let failure = null;
  stuck.catch((error) => { failure = error; });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  assert.equal(failure?.message, OVERDUE_WORDS, "nothing of it had been handed on: not applied");
  // The next entry's write waits behind it in the chain, as every write does, and lands after it.
  const next = queue.run("post", (entry) => fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, post: true })));
  resume();
  await next;
  assert.deepEqual(store.docs.world, { n: 0, post: true }, "the stopped entry's mutator ran after its bound and wrote nothing");
  assert.equal(fenceOf.live, false);
  assert.deepEqual(stale.map((entry) => entry.label), ["goal"]);
});

test("a write already handed on when the bound passes lands in the game's one order, before the next entry's, and its requester is told it may have been saved", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  const docs = { world: { n: 0 } };
  let chain = Promise.resolve();
  let answer = () => {};
  // A store whose server takes the first commit and does not answer for a long while.
  let first = true;
  const store = {
    updateWorld: (fn) => {
      const turn = chain.then(async () => {
        const next = await fn(structuredClone(docs.world));
        if (next) {
          if (first) {
            first = false;
            await new Promise((resolve) => { answer = resolve; });
          }
          docs.world = next;
        }
      });
      chain = turn.then(() => {}, () => {});
      return turn;
    },
  };
  const stuck = queue.run("order", (entry) => fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, order: 1 })));
  let failure = null;
  stuck.catch((error) => { failure = error; });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  assert.equal(failure?.message, OVERDUE_MAYBE_WORDS, "told it may have been saved: its commit was handed on");
  const next = queue.run("post", (entry) => fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, post: world.order === 1 })));
  answer();
  await next;
  assert.deepEqual(docs.world, { n: 0, order: 1, post: true }, "never beside it: the next entry read what it left");
});

test("the round is said as long, never bounded, and nothing is applied beside it", async () => {
  const clock = createClock();
  const { queue, slow, overdue } = queueWith(clock);
  let land = () => {};
  let fence = null;
  void queue.run("round", (entry) => {
    fence = entry.fence;
    return new Promise((resolve) => { land = resolve; });
  });
  let started = false;
  void queue.run("start", async () => { started = true; });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS * 3);
  assert.ok(slow.length > 0 && slow.every((entry) => entry.long === true), "said, as the long entry it is");
  assert.equal(overdue.length, 0);
  assert.equal(fence.live, true, "its fence stays open for as long as it runs");
  assert.equal(started, false);
  land();
  await clock.flush();
  assert.equal(started, true);
  assert.equal(fence.live, false, "and closes when it ends");
});

test("an entry that ends in time is never said, keeps its order, and its fence closes when it ends", async () => {
  const clock = createClock();
  const { queue, slow, settled, stale } = queueWith(clock);
  const order = [];
  const fences = [];
  const first = queue.run("a", async ({ fence }) => { fences.push(fence); order.push(fence.live ? "a" : "a closed"); return "a"; });
  const second = queue.run("b", async ({ fence }) => { fences.push(fence); order.push(fence.live ? "b" : "b closed"); return "b"; });
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
  await clock.advance(SLOW_MS * 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.deepEqual(settled, ["a", "b"]);
  assert.equal(slow.length, 0);
  assert.equal(stale.length, 0);
  assert.notEqual(fences[0], fences[1], "every entry's fence is its own");
  assert.ok(fences.every((fence) => !fence.live));
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

test("one an entry dropped behind a stopped one is not applied either", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  void queue.run("stuck", () => new Promise(() => {})).catch(() => {});
  const mine = queue.run("order", async () => "applied", { owner: "device-a" });
  const refused = assert.rejects(mine, /let go/);
  const after = queue.run("next", async () => "next");
  queue.drop("device-a", "let go");
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  await refused;
  assert.equal(await after, "next");
});

// An entry whose writes do not all carry its fence (`fenced: false`) cannot be told from the next one by what it
// writes: it is stopped at its bound, with why, and waited for, as before.
test("an entry that does not carry its fence to every write is stopped at its bound but waited for, and nothing runs beside it", async () => {
  const clock = createClock();
  const { queue, overdue } = queueWith(clock);
  let finish = () => {};
  const held = queue.run("institution-business", () => new Promise((resolve) => { finish = resolve; }), { fenced: false });
  held.catch(() => {});
  let started = false;
  const start = queue.run("start", async () => { started = true; });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  await assert.rejects(held, (error) => error.code === OVERDUE);
  assert.deepEqual(overdue.map((entry) => [entry.label, entry.passed]), [["institution-business", false]]);
  assert.equal(queue.overdue, true);
  assert.equal(started, false, "waited for");
  finish();
  await start;
  assert.equal(started, true);
  assert.equal(queue.overdue, false);
});

// The reviewer's probe (ledgerOverlap.mjs), as a test: a request's entry that waits long, then writes, with the next
// player's request behind it. When the queue passed the first over, the two shared the ledger's one open slot: A's
// write was stamped with B's mark, A was left unmarked (applied twice after an engine restart), and B was marked
// before it had written anything. Each request's store is its own now, and a stopped one writes nothing.
test("each request's write carries its own mark, and a request stopped at its bound marks nothing and writes nothing", async () => {
  const clock = createClock();
  const store = memoryStore();
  const { queue } = queueWith(clock);
  const A = requestStamp("devA", "1");
  const B = requestStamp("devB", "1");
  let resumeA = () => {};
  const aWaits = new Promise((resolve) => { resumeA = resolve; });
  const written = [];
  const a = queue.run("order", async (entry) => {
    const own = fencedStore(requestStore(store, A), entry.fence);
    await entry.fence.hold(aWaits);
    written.push("a");
    await own.updateWorld((world) => ({ ...world, a: true }));
  });
  a.catch(() => {});
  const b = queue.run("order", async (entry) => {
    written.push("b");
    await fencedStore(requestStore(store, B), entry.fence).updateWorld((world) => ({ ...world, b: true }));
  });
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS - SLOW_MS);
  assert.deepEqual(written, [], "B never begins beside A while A may still write");
  await clock.advance(SLOW_MS * 2);
  await b;
  resumeA();
  await clock.flush();
  assert.deepEqual(written, ["b"], "A, let go, never writes");
  assert.deepEqual(store.docs.world, { n: 0, b: true });
  assert.equal(appliedIn(store.docs.game, A), false, "A is not marked: sent again, it is applied, once");
  assert.equal(appliedIn(store.docs.game, B), true, "B's write carries B's mark");
});

test("an entry's store reads and writes through its fence; the session's own record is no entry's to write", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  const writes = [];
  const store = {
    read: async () => ({ ok: true }),
    readShared: async () => ({}),
    writeShared: async () => { writes.push("session"); },
    updateWorld: async (fn) => { const next = await fn({}); if (next) writes.push("world"); },
  };
  let own = null;
  await queue.run("order", async (entry) => {
    own = fencedStore(store, entry.fence);
    assert.deepEqual(await own.read(), { ok: true });
    await own.updateWorld(() => ({ moved: true }));
  });
  assert.equal(own.writeShared, undefined);
  assert.deepEqual(writes, ["world"]);
  // Once its entry has ended, nothing written through it lands, and nothing read through it comes back.
  let answered = false;
  void own.read().then(() => { answered = true; });
  void own.updateWorld(() => ({ late: true }));
  await clock.flush();
  assert.equal(answered, false);
  assert.deepEqual(writes, ["world"]);
});

// The game's simulation lock, taken for an entry (gameplay.js statsWrite), was given back only when the entry's work
// ended: one whose write never came back left every reading and the Game Master waiting on it for good.
test("what an entry took for itself is given back when it is let go, whether or not its work comes back, and only once", async () => {
  const clock = createClock();
  const { queue } = queueWith(clock);
  let held = 0;
  let late = () => {};
  const stuck = queue.run("reading:stat-sheet", async ({ fence }) => {
    held += 1;
    let mine = true;
    const giveBack = () => {
      if (!mine) return;
      mine = false;
      held -= 1;
    };
    fence.onClose(giveBack);
    try {
      await new Promise((resolve) => { late = resolve; });
    } finally {
      giveBack();
    }
  });
  stuck.catch(() => {});
  await clock.flush();
  assert.equal(held, 1);
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  assert.equal(held, 0, "given back at its bound");
  late();
  await clock.flush();
  assert.equal(held, 0, "and not twice");
  let after = 0;
  await queue.run("ended", async ({ fence }) => { fence.onClose(() => { after += 1; }); });
  assert.equal(after, 1, "an entry that ends gives back what it took as it ends");
});

test("a committing write that lands after its bound still notifies onSettled so the host broadcasts the saved world", async () => {
  const clock = createClock();
  const { queue, settled } = queueWith(clock);
  let finishCommit = () => {};
  const docs = { world: { n: 0 } };
  const store = {
    updateWorld: async (fn) => {
      const next = await fn(structuredClone(docs.world));
      await new Promise((resolve) => { finishCommit = resolve; });
      if (next) docs.world = next;
    },
  };
  const stuck = queue.run("order", (entry) => fencedStore(store, entry.fence).updateWorld((world) => ({ ...world, n: 1 })));
  stuck.catch(() => {});
  await clock.flush();
  await clock.advance(ENTRY_MOST_MS + SLOW_MS);
  assert.deepEqual(settled, [], "not yet settled while commit is in flight");
  finishCommit();
  await clock.flush();
  assert.deepEqual(settled, ["order"], "onSettled fires once the late-landing commit finishes");
});

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

// A shared game's host sets a flag in a player's request's entry of its queue (multiplayer/host/worldQueue.js), and
// the write carries that entry's fence (gameState.js mutateFlagsState `fence`): an entry the queue let go at its bound
// writes nothing, however late the game's write order comes to it, and the next entry's flag is set as ever.
test("a flag set for an entry the host's queue has let go writes nothing; the next entry's is set", async () => {
  const { createWorldQueue, ENTRY_MOST_MS, OVERDUE } = await import("../multiplayer/host/worldQueue.js");
  let t = 0;
  const timers = new Map();
  let nextTimer = 1;
  const queue = createWorldQueue({
    now: () => t,
    timers: {
      setInterval: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms, at: ms }); return id; },
      clearInterval: (id) => timers.delete(id),
    },
  });
  const drain = async () => { for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const step = async (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.values()].filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      due.at += due.ms;
      due.fn();
      await drain();
    }
    t = end;
    await drain();
  };
  // The flags' first read never comes back until long after (the game's server is stuck), then answers.
  let answer = () => {};
  const firstRead = new Promise((resolve) => { answer = resolve; });
  let reads = 0;
  await withStore(() => (reads++ === 0 ? firstRead.then(() => json({})) : json({ Borduria: "data:image/png;base64,BBBB" })), async (writes) => {
    let refused = null;
    const stuck = queue.run("flag", ({ fence }) => setPolityFlag({ polity: "Ruritania", world, dataUrl: "data:image/png;base64,AAAA", fence })
      .catch((error) => { refused = error; throw error; }));
    stuck.catch(() => {});
    await drain();
    await step(ENTRY_MOST_MS + 20_000);
    await assert.rejects(stuck, (error) => error.code === OVERDUE);
    const next = queue.run("flag", ({ fence }) => setPolityFlag({ polity: "Borduria", world, dataUrl: "", fence }));
    answer();
    await next;
    await drain();
    assert.equal(refused?.code, OVERDUE, "the stopped one's write was refused when its turn came");
    assert.deepEqual(writes, [{}], "only the next entry's: Borduria's flag taken off, and Ruritania's never set");
  });
});

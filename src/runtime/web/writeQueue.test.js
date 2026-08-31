/*! Open Historia — web-mode write serializer tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Reported: on the website the game date does not progress properly; in the
// desktop app it always does. Same game code — the difference is the store. The
// web store keeps every runtime JSON asset of a game in ONE IndexedDB record, so
// writing one asset is a read-modify-write of all of them, and the end of a turn
// fires six of those concurrently (gameplay.js, the Promise.all after a jump).
//
// The first test below is the bug itself, reproduced against a stand-in store: it
// asserts the OLD behaviour loses writes, so if the coupling is ever removed and
// this stops being possible, it fails and says so. The rest pin the fix.

import assert from "node:assert/strict";
import test from "node:test";

import { serializeWrite, writeQueueIdle } from "./writeQueue.js";

// A stand-in for the IndexedDB game record: one object holding all six assets,
// with a real await between read and write so the interleave is genuine.
const makeStore = () => {
  let record = { game: { gameDate: "1936-01-01", round: 1 }, world: {}, events: [], actions: [], chat: [], colors: {} };
  return {
    read: async () => {
      await Promise.resolve();
      return structuredClone(record);
    },
    write: async (next) => {
      await Promise.resolve();
      record = structuredClone(next);
    },
    get: () => structuredClone(record),
  };
};

// What writeRuntimeJsonAsset does: read the whole record, set one key, write it back.
const writeAsset = (store, key, value) => async () => {
  const current = await store.read();
  current[key] = value;
  await store.write(current);
};

// The six writes a finished turn issues, with the new date among them.
const turnWrites = (store) => [
  writeAsset(store, "actions", [{ id: "a1", status: "resolved" }]),
  writeAsset(store, "chat", [{ id: "c1" }]),
  writeAsset(store, "events", [{ id: "e1", title: "Anschluss" }]),
  writeAsset(store, "game", { gameDate: "1938-03-12", round: 2 }),
  writeAsset(store, "colors", { GER: [1, 2, 3] }),
  writeAsset(store, "world", { units: ["u1"] }),
];

test("the bug: six concurrent writes lose all but the last", async () => {
  const store = makeStore();
  await Promise.all(turnWrites(store).map((run) => run()));

  const after = store.get();
  const landed = [
    after.game.gameDate === "1938-03-12",
    after.events.length === 1,
    after.world.units?.length === 1,
    after.actions.length === 1,
    after.chat.length === 1,
    Boolean(after.colors.GER),
  ].filter(Boolean).length;

  // Exactly one survives: every writer read the same starting record, so whichever
  // put last overwrote the other five with its stale copy. This is why the date
  // stops progressing — writeGameData is simply not the last one to finish.
  assert.equal(landed, 1, "unserialized concurrent read-modify-writes must lose data");
  assert.equal(after.game.gameDate, "1936-01-01", "the date write is one of the five that got clobbered");
});

test("serialized, the same six all land and the date progresses", async () => {
  const store = makeStore();
  await Promise.all(turnWrites(store).map((run) => serializeWrite(run)));

  const after = store.get();
  assert.equal(after.game.gameDate, "1938-03-12");
  assert.equal(after.game.round, 2);
  assert.equal(after.events.length, 1);
  assert.equal(after.world.units.length, 1);
  assert.equal(after.actions.length, 1);
  assert.equal(after.chat.length, 1);
  assert.deepEqual(after.colors.GER, [1, 2, 3]);
});

test("tasks run in the order they were queued", async () => {
  const order = [];
  await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      serializeWrite(async () => {
        // A varying delay so a broken queue interleaves visibly rather than by luck.
        await new Promise((resolve) => setTimeout(resolve, (6 - n) * 4));
        order.push(n);
      }),
    ),
  );
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test("a rejected task does not wedge the queue or lose the ones behind it", async () => {
  const done = [];
  const failing = serializeWrite(async () => {
    throw new Error("quota exceeded");
  });
  const after = serializeWrite(async () => { done.push("after"); });

  await assert.rejects(failing, /quota exceeded/, "the failure still reaches its own caller");
  await after;
  assert.deepEqual(done, ["after"], "a failed write must not strand every write behind it");
});

test("the caller gets its own task's result back", async () => {
  assert.equal(await serializeWrite(async () => "normalized record"), "normalized record");
});

test("writeQueueIdle resolves once the queue drains", async () => {
  const seen = [];
  serializeWrite(async () => { seen.push("a"); });
  serializeWrite(async () => { seen.push("b"); });
  await writeQueueIdle();
  assert.deepEqual(seen, ["a", "b"]);
});

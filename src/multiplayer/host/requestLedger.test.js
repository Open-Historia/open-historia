/*! Open Historia — a request's answer kept with its effect: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/requestLedger.test.js
//
// The answers that make a resend safe were saved with the session, after the
// request's effect and apart from it: an engine closed in between had written
// the effect and not the answer, and the request sent again was applied twice
// (FOLLOWUPS A4). The request is kept with its effect now.

import test from "node:test";
import assert from "node:assert/strict";

import { APPLIED_BEFORE, LEDGER_KEY, appliedIn, requestStamp, requestStore, withApplied, withoutLedger } from "./requestLedger.js";

// The game's documents, and a store over them as the host's is (host/engineMain.js store): each write its own
// document's, and updateGameDocs one commit of them all.
const memoryStore = () => {
  const docs = { game: { country: "Latvia" }, world: { wars: [] }, actions: [], chats: [], events: [] };
  const commits = [];
  const one = (key) => async (fn) => {
    const next = await fn(structuredClone(docs[key]));
    if (next !== null && next !== undefined) {
      docs[key] = next;
      commits.push([key]);
    }
  };
  return {
    docs,
    commits,
    read: async () => structuredClone(docs),
    updateActions: one("actions"),
    updateWorld: one("world"),
    updateChats: one("chats"),
    updateGame: one("game"),
    updateForces: async (fn) => {
      const next = await fn({ world: structuredClone(docs.world), actions: structuredClone(docs.actions), game: structuredClone(docs.game), events: structuredClone(docs.events) });
      if (!next) return;
      Object.assign(docs, next);
      commits.push(Object.keys(next));
    },
    updateGameDocs: async (fn) => {
      const next = await fn(structuredClone(docs));
      if (!next) return;
      Object.assign(docs, next);
      commits.push(Object.keys(next).sort());
    },
  };
};

test("a request's first write is one commit with its mark; what it writes after is written as ever", async () => {
  const store = memoryStore();
  const stamp = requestStamp("device-guest", "0000000000000001");
  const mine = requestStore(store, stamp);
  await mine.updateActions((actions) => [...actions, { id: "order-1", text: "Hold Narva" }]);
  await mine.updateWorld((world) => ({ ...world, after: true }));
  assert.deepEqual(store.commits, [["actions", "game"], ["world"]]);
  assert.equal(appliedIn(store.docs.game, stamp), true);
  assert.deepEqual(store.docs.actions.map((action) => action.id), ["order-1"]);
  // Outside a request, every write is its own, as ever.
  await store.updateChats((chats) => [...chats, { id: "c1" }]);
  assert.deepEqual(store.commits.at(-1), ["chats"]);
});

test("a request applied before is found by its mark: nothing of it is applied again", async () => {
  const store = memoryStore();
  const stamp = requestStamp("device-guest", "0000000000000002");
  const post = async () => {
    await requestStore(store, stamp).updateForces(({ world }) => ({ world: { ...world, posts: [...(world.posts ?? []), "A post"] } }));
    return "";
  };
  assert.equal(await post(), "");
  // The engine closed before the answer was saved; the page sends the request again.
  await assert.rejects(post(), (error) => error.code === APPLIED_BEFORE);
  assert.deepEqual(store.docs.world.posts, ["A post"], "applied once");
  // Another device's request of the same id is another request.
  await requestStore(store, requestStamp("device-other", "0000000000000002")).updateWorld((world) => ({ ...world, other: true }));
  assert.equal(store.docs.world.other, true);
});

test("a write that changes nothing marks nothing, so the same request asked again is judged again", async () => {
  const store = memoryStore();
  const stamp = requestStamp("device-guest", "0000000000000003");
  await requestStore(store, stamp).updateWorld(() => null);
  assert.equal(appliedIn(store.docs.game, stamp), false);
  assert.deepEqual(store.commits, []);
});

test("without the game's one commit nothing is marked; the marks are kept few, and no view carries them", () => {
  const plain = memoryStore();
  delete plain.updateGameDocs;
  assert.equal(requestStore(plain, requestStamp("device-guest", "id-x")).updateGameDocs, undefined);
  let game = { country: "Latvia" };
  const first = requestStamp("device-guest", "id-0");
  for (let n = 0; n < 40; n += 1) game = withApplied(game, requestStamp("device-guest", `id-${n}`));
  assert.equal(appliedIn(game, first), false, "the oldest are let go");
  assert.equal(appliedIn(game, requestStamp("device-guest", "id-39")), true);
  assert.equal(Object.values(game[LEDGER_KEY])[0].length, 32);
  assert.ok(!JSON.stringify(game).includes("device-guest"), "neither the device nor the request is named");
  assert.deepEqual(withoutLedger(game), { country: "Latvia" });
  const bare = { country: "Latvia" };
  assert.equal(withoutLedger(bare), bare);
});

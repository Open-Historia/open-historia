// Run: npm ci && node --test src/runtime/runtimeStore.gameSwitch.test.js
//
// Needs a full install: runtimeStore.js -> gameState.js -> assets.js -> maplibre-gl.
//
// A background refresh was in flight when the player switched saves. The switch
// cleared the store's values but not the read, the new save's refresh joined
// it, and the old save's date, round and world were shown; its round then
// became the published stamp, so the new save's own reads were refused as
// "behind" until something in it was written.

import assert from "node:assert/strict";
import test from "node:test";

// The store opens a BroadcastChannel for other tabs; a test has none, and an
// open channel would hold node's event loop.
globalThis.BroadcastChannel = undefined;
// Only what the store and the asset layer touch: events and the page origin.
const page = new EventTarget();
page.location = { origin: "http://localhost", href: "http://localhost/" };
globalThis.window = page;

const { setRuntimeAssetEndpoints } = await import("./assets.js");
const { __resetRuntimeStoreForTests, getRuntimeValue, refreshRuntimeState, subscribeRuntime } = await import("./runtimeStore.js");

const gameReads = [];
globalThis.fetch = (url) => {
  if (!/\/api\/runtime\/json\/game/.test(String(url))) return Promise.resolve(new Response("missing", { status: 404 }));
  return new Promise((resolve) => {
    gameReads.push({ url: String(url), answer: (game) => resolve(new Response(JSON.stringify(game), { status: 200, headers: { "Content-Type": "application/json" } })) });
  });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a read begun in the previous save is dropped, and the new save's is not refused", async (t) => {
  t.after(__resetRuntimeStoreForTests);
  __resetRuntimeStoreForTests();
  setRuntimeAssetEndpoints({ token: "save-a" });

  const rounds = [];
  subscribeRuntime("game", (round) => rounds.push(round), { select: (game) => Number(game?.round) || 0 });
  await settle();
  assert.equal(gameReads.length, 1, "subscribing reads the game");
  const oldRead = gameReads[0];

  // The switch: the endpoints are repointed, then the event fires.
  setRuntimeAssetEndpoints({ token: "save-b" });
  window.dispatchEvent(new CustomEvent("oh:active-game-changed", { detail: { gameId: "save-b" } }));
  await settle();
  assert.equal(gameReads.length, 2, "the new save is read afresh, not by joining the old read");
  assert.match(gameReads[1].url, /save-b/);

  gameReads[1].answer({ country: "Serbia", gameDate: "1914-06-28", round: 1 });
  await settle();
  // The old save's answer arrives late, a turn ahead.
  oldRead.answer({ country: "France", gameDate: "1916-02-21", round: 9 });
  await settle();
  assert.equal(getRuntimeValue("game").country, "Serbia");
  assert.equal(getRuntimeValue("game").round, 1);

  // The new save's own next turn is accepted, not refused as behind round 9.
  const refreshed = refreshRuntimeState(["game"]);
  await settle();
  gameReads.at(-1).answer({ country: "Serbia", gameDate: "1914-07-28", round: 2 });
  await refreshed;
  assert.equal(getRuntimeValue("game").round, 2);
  assert.deepEqual(rounds.filter((round) => round === 9), [], "the old save's round was never shown");
});

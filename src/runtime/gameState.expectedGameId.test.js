/*! Open Historia — a canonical mutation carries its campaign to the store © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.expectedGameId.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// A Council round waits on the model, then commits its debate lines, ballots
// and cursors through mutateCanonicalTurnState. The commit named its campaign
// from game.json, which never carries an id, so it sent none and the store
// could not refuse a round that outlived a switch to another save. The callers
// now stamp the campaign before the model call; this pins the seam they rely
// on: the stamp reaches the store, and a refusal publishes nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "./assets.js";
import { mutateCanonicalTurnState, readWorldState } from "./gameState.js";

const store = new Map();
let activeGameId = "campaign-b";
const commits = [];
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  if (String(url).includes("/api/runtime/turn-commit") && method === "PUT") {
    const payload = JSON.parse(String(init.body));
    commits.push(payload);
    // What both stores do (server/libraryStore.js, web/libraryStore.js).
    if (payload.expectedGameId && payload.expectedGameId !== activeGameId) {
      return new Response(JSON.stringify({ error: `Turn commit belongs to game "${payload.expectedGameId}", but "${activeGameId}" is active.` }), { status: 400 });
    }
    return new Response(JSON.stringify({ assets: payload, transactionId: "t1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  if (!store.has(match[1])) return new Response("missing", { status: 404 });
  return new Response(store.get(match[1]), { status: 200, headers: { "Content-Type": "application/json" } });
};

const seed = () => {
  store.set("world", JSON.stringify({ gmChanges: [] }));
  store.set("game", JSON.stringify({ country: "France", gameDate: "1914-06-01", round: 3 }));
  store.set("events", "[]");
  store.set("actions", "[]");
  store.set("chat", "[]");
  store.set("colors", "{}");
};

test("the campaign stamped before the model call reaches the store with the commit", async () => {
  setRuntimeAssetEndpoints({ token: "expected-game-1" });
  seed();
  activeGameId = "campaign-a";
  commits.length = 0;
  await mutateCanonicalTurnState(({ world }) => ({ world: { ...world, playerGoals: { France: { text: "Hold", round: 3, date: "1914-06-01" } } } }), { expectedGameId: "campaign-a" });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].expectedGameId, "campaign-a");
  assert.equal((await readWorldState()).playerGoals?.France?.text, "Hold", "an accepted commit is published");
});

test("a round that outlived a switch is refused by the store, and nothing is published", async () => {
  setRuntimeAssetEndpoints({ token: "expected-game-2" });
  seed();
  activeGameId = "campaign-b";
  commits.length = 0;
  await assert.rejects(
    mutateCanonicalTurnState(({ world }) => ({ world: { ...world, playerGoals: { France: { text: "From A", round: 3, date: "1914-06-01" } } } }), { expectedGameId: "campaign-a" }),
    /HTTP 400/,
  );
  assert.equal(commits.length, 1, "the store saw it and refused it");
  const world = await readWorldState();
  assert.equal(world.playerGoals?.France, undefined, "campaign A's change never reached the open campaign's cache");
});

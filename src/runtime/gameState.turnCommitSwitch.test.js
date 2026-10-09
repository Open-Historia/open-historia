/*! Open Historia — a turn's commit and a campaign switch during its echo © 2026. */
// The turn commit's echo is several MB, and the player can open another save
// while it arrives. The generation is on disk in the right campaign by then
// (the store checked expectedGameId); what must not happen is the client
// publishing it into the caches of the save that is open now.
import test from "node:test";
import assert from "node:assert/strict";
import { JSON_URLS, readJson, setRuntimeAssetEndpoints } from "./assets.js";
import { writeCanonicalTurnState } from "./gameState.js";

// Save B's world as the local server holds it; the turn belongs to save A.
const storedWorlds = new Map([["campaign-b", { notes: "save B" }]]);
let switchDuringEcho = false;

globalThis.fetch = async (url, init = {}) => {
  const text = String(url);
  if (text.includes("/api/runtime/turn-commit")) {
    const payload = JSON.parse(String(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => {
        // The player opens save B while the echo is still being read.
        if (switchDuringEcho) setRuntimeAssetEndpoints({ token: "campaign-b" });
        return { assets: payload, transactionId: "turn-a" };
      },
    };
  }
  const token = new URL(text, "http://local").searchParams.get("v");
  if (text.includes("/api/runtime/json/world") && storedWorlds.has(token)) {
    return new Response(JSON.stringify(storedWorlds.get(token)), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("missing", { status: 404 });
};

const turnOfA = {
  actions: [],
  chats: [],
  events: [],
  game: { country: "France", gameDate: "1914-08-01", round: 4 },
  colors: {},
  world: { notes: "save A after its turn" },
};

test("a turn that finishes committing after the player opened another save leaves that save's caches alone", async () => {
  setRuntimeAssetEndpoints({ token: "campaign-a" });
  switchDuringEcho = true;
  const committed = await writeCanonicalTurnState(turnOfA, { expectedGameId: "campaign-a" });
  assert.equal(committed.published, false);
  assert.equal(committed.world.notes, "save A after its turn", "the caller still learns what was written");

  // An unforced read in save B is what used to hand A's world back to be saved over B.
  const world = await readJson(JSON_URLS.world, { defaultValue: {} });
  assert.equal(world.notes, "save B");
});

test("a turn committed while its campaign stays open is published as before", async () => {
  setRuntimeAssetEndpoints({ token: "campaign-a2" });
  switchDuringEcho = false;
  const committed = await writeCanonicalTurnState(turnOfA, { expectedGameId: "campaign-a2" });
  assert.notEqual(committed.published, false);
  // Served from the cache the commit primed: the server has no world under this token.
  const world = await readJson(JSON_URLS.world, { defaultValue: {} });
  assert.equal(world.notes, "save A after its turn");
});

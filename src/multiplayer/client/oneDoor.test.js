/*! Open Historia — the one door, held to by the game's own writers: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/oneDoor.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// The map's rule 6: a player's screen cannot write the game. It sends a named
// request through one door; a write that is neither a request nor declared
// "this device only" is a visible error, in development a failing test. A save
// no door took was answered "saved" and only logged (the review of 2026-11-18,
// door 3), and two of the game's own writers still made one on every shared
// page: the Stats chart's history backfill and the units' stale-motion repair.
//
// Here the game's own writers run on a page playing a shared game, served by
// the remote runtime as a guest's page is (client/remoteRuntime.js), with the
// page's hook as strict as it is in development: a save holding a change no
// request carries is refused (client/seatWrites.js unroutedRefusal), and the
// writer fails. Each writer must ask the host, or keep to this device's own
// fields, or not write at all.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The page's own server, behind the shared game (its documents are single player's).
const local = new Map();
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  const key = match[1];
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    local.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!local.has(key)) return new Response("missing", { status: 404 });
  return new Response(local.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const { installRemoteRuntime, startRemoteRuntime, stopRemoteRuntime } = await import("./remoteRuntime.js");
installRemoteRuntime({ target: globalThis, waitMs: 500 });
const { planWorldWrite, unroutedChanges, unroutedRefusal } = await import("./seatWrites.js");
const { setSharedRequester } = await import("./sharedGameBridge.js");
const { JSON_URLS, setRuntimeAssetEndpoints } = await import("../../runtime/assets.js");
const gameState = await import("../../runtime/gameState.js");
const units = await import("../../Game/Map/unitsController.js");
const { saveSettledStructure } = await import("../../runtime/structurePlacement.js");
const { VIEW_KEYS } = await import("../game/messages.js");
const { digestText } = await import("../protocol/digest.js");

setRuntimeAssetEndpoints({ token: "one-door" });

// The page's hook as strict as in development (client/sharedGame.js ownWrite):
// what of a save is this device's own is kept on it, and a change no request
// carries refuses the save. Every save that reached it is recorded.
const NORMALIZE = {
  world: gameState.normalizeWorldState,
  chat: gameState.normalizeChats,
  actions: gameState.normalizeActions,
  events: gameState.normalizeEvents,
  game: gameState.normalizeGameData,
};
const asSaved = (key, value) => (NORMALIZE[key] ? NORMALIZE[key](value) : value);
const saves = [];
let runtime = null;
const strictHook = ({ key, wanted, held }) => {
  const before = asSaved(key, held);
  const after = asSaved(key, wanted);
  const unrouted = unroutedChanges(key, before, after);
  saves.push({ key, unrouted });
  if (key === "world") {
    const plan = planWorldWrite(before, after);
    if (Object.keys(plan.device).length) runtime.patch("world", plan.device, { quiet: true });
  }
  if (unrouted.length) throw unroutedRefusal(key, unrouted);
  return asSaved(key, runtime.held(key));
};

// As the host's world has it: normalized, so stamped (gameState.js normalizeUnits).
const stale = { id: "u-stale", name: "1st Army", type: "infantry", ownerCode: "Estonia", strength: 80, lng: 25, lat: 59, status: "moving", createdAt: "2014-01-01T00:00:00.000Z", updatedAt: "2014-01-01T00:00:00.000Z" };
const GAME = {
  world: { units: [stale], markers: [{ id: "fort-1", ownerCode: "Estonia", lng: 24, lat: 59, approximate: true }] },
  game: { country: "Estonia", round: 3, gameDate: "2014-04-01" },
  events: [],
  chat: [],
  actions: [],
  advisor: [],
};
// A whole view, as the host sends a connection's first (host/gameHost.js pushViews).
const wholeView = (docs) => ({
  epoch: "e1", rev: 1, base: 0, docs,
  sums: Object.fromEntries(VIEW_KEYS.map((key) => [key, digestText(JSON.stringify(docs[key] ?? null))])),
});
const asked = [];
const openSharedPage = () => {
  saves.length = 0;
  asked.length = 0;
  runtime = startRemoteRuntime({ publish: () => {}, urlFor: (key) => JSON_URLS[key] || "", onWrite: strictHook });
  assert.deepEqual(runtime.apply(wholeView(GAME)), { ok: true });
  setSharedRequester(async (t, fields) => {
    asked.push({ t, fields });
    return { ok: true, error: "" };
  });
};
const closeSharedPage = () => {
  stopRemoteRuntime();
  setSharedRequester(null);
  runtime = null;
};
const settle = async (ms = 60) => {
  for (let waited = 0; waited < ms; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("a save holding a change no request carries is refused, and its writer is told; this device's own fields are kept", async () => {
  openSharedPage();
  try {
    const world = await gameState.readWorldState({ force: true });
    await assert.rejects(gameState.writeWorldState({ ...world, countryStatsHistory: { Estonia: [{ date: "2014-04-01", round: 3 }] } }), /HTTP 409/);
    assert.deepEqual(saves.at(-1), { key: "world", unrouted: ["countryStatsHistory"] });
    // The AI's suggested orders are this device's own (seatWrites.js DEVICE_WORLD_KEYS): kept here, and no error.
    await gameState.writeWorldState({ ...world, actionSuggestions: [{ id: "s1", title: "Hold Narva" }] });
    assert.deepEqual(saves.at(-1).unrouted, []);
    assert.deepEqual(runtime.held("world").actionSuggestions.map((entry) => entry.title), ["Hold Narva"]);
    assert.equal(local.size, 0, "nothing reached this device's own documents");
  } finally {
    closeSharedPage();
  }
});

test("a chat bubble the screen shows of its own moves its thread in the inbox: that is the screen's, no change of the game", () => {
  const held = [{ id: "c1", activityOrdinal: 4, messages: [{ id: "m1", role: "user", text: "Hello" }] }];
  const wanted = [{ id: "c1", activityOrdinal: 9, messages: [{ id: "m1", role: "user", text: "Hello" }, { role: "error", text: "The host did not take the message." }] }];
  assert.deepEqual(unroutedChanges("chat", held, wanted), []);
  assert.deepEqual(unroutedChanges("chat", held, [{ ...wanted[0], title: "Renamed here" }]), ["thread c1"], "anything else of a thread is the host's");
});

test("the map's units on a shared page: the stale-motion repair writes nothing there, deploy and disband ask the host, and single player is repaired as before", async () => {
  openSharedPage();
  let stop = () => {};
  try {
    stop = units.startUnitsSync();
    for (let tries = 0; tries < 100 && !units.getUnitById("u-stale"); tries += 1) await settle(10);
    await settle();
    assert.deepEqual(saves, [], "the host's world is repaired when its host plays it alone");
    assert.deepEqual(await units.deployUnit({ type: "infantry", strength: 50, name: "2nd Army", composition: "", lng: 25, lat: 58 }), { ok: true });
    await units.disbandUnit("u-stale");
    assert.deepEqual(asked.map((entry) => entry.t), ["deploy", "disband"]);
    assert.deepEqual(saves, [], "asked, never saved");
  } finally {
    stop();
    closeSharedPage();
  }
  // The page's own game again: its stale unit is repaired once, as it always was.
  local.set("world", JSON.stringify({ units: [stale] }));
  local.set("game", JSON.stringify(GAME.game));
  local.set("actions", "[]");
  stop = units.startUnitsSync();
  try {
    for (let tries = 0; tries < 100 && JSON.parse(local.get("world")).units[0].status === "moving"; tries += 1) await settle(10);
    assert.equal(JSON.parse(local.get("world")).units[0].status, "idle");
  } finally {
    stop();
  }
});

test("a structure placed approximately is kept or moved by asking the host", async () => {
  openSharedPage();
  try {
    await saveSettledStructure("fort-1");
    await saveSettledStructure("fort-1", { lng: 24.5, lat: 59.2 });
    assert.deepEqual(asked, [
      { t: "settle", fields: { marker: "fort-1", move: false, lng: 0, lat: 0 } },
      { t: "settle", fields: { marker: "fort-1", move: true, lng: 24.5, lat: 59.2 } },
    ]);
    assert.deepEqual(saves, []);
  } finally {
    closeSharedPage();
  }
});

// The Stats pane is a screen (stats.jsx), which no test can load: its history
// backfill is held to the rule by what it reads before it saves.
test("the Stats chart's history backfill saves nothing on a shared page", () => {
  const source = fs.readFileSync(new URL("../../Game/GameUI/stats.jsx", import.meta.url), "utf8");
  const backfill = source.indexOf("rollback history backfill could not be persisted");
  assert.ok(backfill > 0, "the backfill is where it was");
  const guard = source.lastIndexOf("if (!inSharedGame() && JSON.stringify(persistedSeries) !== JSON.stringify(stored))", backfill);
  const write = source.lastIndexOf("await writeWorldState({", backfill);
  assert.ok(guard > 0 && guard < write, "its one write is behind the shared game's guard");
});

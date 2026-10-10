/*! Open Historia — a kept time skip stored with its own game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip that finishes after the player opened another game is kept for
// the game it was generated for (src/Game/AI/parkedTurn.js), and stored there so
// closing the app does not lose it. It is written while ANOTHER game is the
// active one, so it goes by game id: /api/games/:gameId/parked-turn. The web
// store's twin is covered in src/runtime/web/libraryStore.test.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-parked-turn-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39523";

let httpServer;
let base;
let store;

before(async () => {
  ({ httpServer } = await import("./server.js"));
  store = await import("./libraryStore.js");
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const route = (gameId) => `${base}/api/games/${encodeURIComponent(gameId)}/parked-turn`;
const send = (gameId, method, body) => fetch(route(gameId), {
  method,
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

test("a kept turn is stored with its own game while another is open, and goes when removed", async () => {
  const kept = store.createGame({ id: "where-the-skip-ran", name: "Where the skip ran" }).game.id;
  const other = store.createGame({ id: "opened-meanwhile", name: "Opened meanwhile", setActive: true }).game.id;
  assert.equal(store.getGameCatalog().activeGameId, other);

  assert.equal(await (await send(kept, "GET")).json(), null, "none until one is kept");
  const record = { version: 1, campaignId: kept, round: 3, turn: { baseGame: { round: 3 } } };
  assert.equal((await send(kept, "PUT", record)).status, 200);
  assert.deepEqual(await (await send(kept, "GET")).json(), record);
  assert.equal(await (await send(other, "GET")).json(), null, "the open game is not given it");

  // Its own file, out of the bundle: an export does not carry it.
  const exported = store.exportGameBundle(kept);
  assert.equal(JSON.stringify(exported).includes("parked"), false);

  assert.equal((await send(kept, "DELETE")).status, 200);
  assert.equal(await (await send(kept, "GET")).json(), null);
  assert.equal((await send(kept, "DELETE")).status, 200, "removing none is not an error");
});

test("a kept turn is refused for another game or a game that is not there", async () => {
  const kept = store.createGame({ id: "kept-here", name: "Kept here" }).game.id;
  const other = store.createGame({ id: "elsewhere", name: "Elsewhere" }).game.id;
  assert.equal((await send(other, "PUT", { version: 1, campaignId: kept })).status, 400);
  assert.equal((await send("no-such-game", "PUT", { version: 1, campaignId: "no-such-game" })).status, 400);
  assert.equal((await send("no-such-game", "GET")).status, 404);
  assert.equal(await (await send(other, "GET")).json(), null);
});

test("a copy of a game does not inherit its kept turn", async () => {
  const kept = store.createGame({ id: "the-original", name: "The original" }).game.id;
  assert.equal((await send(kept, "PUT", { version: 1, campaignId: kept })).status, 200);
  const copy = store.createGame({ name: "The copy", seedGameId: kept }).game.id;
  assert.equal(await (await send(copy, "GET")).json(), null);
});

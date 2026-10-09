/*! Open Historia — a shared game's engine window routes: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The desktop host opens and closes its shared game's hidden engine window through
// these routes. They read the handle off globalThis, which only the Electron main
// process publishes (electron/main.cjs), so the same server is inert anywhere
// else, and another website can never reach them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-engine-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
process.env.PORT = "39541";

let httpServer;
let base;

before(async () => {
  ({ httpServer } = await import("./server.js"));
  base = `http://127.0.0.1:${process.env.PORT}`;
});

after(() => {
  httpServer?.close();
  delete globalThis.__ohSharedGameEngine;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("outside the desktop app there is no engine window to open", async () => {
  delete globalThis.__ohSharedGameEngine;
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine`)).json(), { supported: false });
  for (const route of ["open", "close"]) {
    const res = await fetch(`${base}/api/multiplayer/engine/${route}`, { method: "POST" });
    assert.equal(res.status, 404);
  }
});

test("inside it, the routes open, report and close the window", async () => {
  let open = false;
  globalThis.__ohSharedGameEngine = {
    status: () => ({ open }),
    open: async () => { open = true; return { open }; },
    close: () => { open = false; return { open }; },
  };
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine/open`, { method: "POST" })).json(), { open: true });
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine`)).json(), { supported: true, open: true });
  assert.deepEqual(await (await fetch(`${base}/api/multiplayer/engine/close`, { method: "POST" })).json(), { open: false });
});

test("another website cannot open it", async () => {
  let opened = false;
  globalThis.__ohSharedGameEngine = { status: () => ({ open: opened }), open: async () => { opened = true; return { open: true }; }, close: () => ({ open: false }) };
  const res = await fetch(`${base}/api/multiplayer/engine/open`, { method: "POST", headers: { Origin: "https://evil.example" } });
  assert.notEqual(res.status, 200);
  assert.equal(opened, false);
});

// --- A hosting computer keeps its game open ---------------------------------------
//
// The engine window runs the game that was open when the hosting began and
// stamps every turn with its id. A second window on a host's own computer
// joined the host's lobby, which makes a stand-in game and opens it; every
// page of one server shares the one open game, so each save the host made
// from then on was refused ("Turn commit belongs to game A, but B is active").

const json = async (route, { method = "GET", body } = {}) => {
  const res = await fetch(`${base}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const idOf = (answer) => String(answer.body?.game?.id || answer.body?.id || "");
const openGame = async () => (await json("/api/library")).body?.activeGameId;

test("while the engine window is open, no page can open, make-and-open or delete another game in the hosted one's place", async () => {
  let open = false;
  globalThis.__ohSharedGameEngine = { status: () => ({ open }), open: async () => ({ open }), close: () => ({ open }) };
  const hosted = idOf(await json("/api/games", { method: "POST", body: { name: "The hosted campaign", setActive: true } }));
  const other = idOf(await json("/api/games", { method: "POST", body: { name: "Another save" } }));
  assert.ok(hosted && other && hosted !== other);
  assert.equal(await openGame(), hosted);

  open = true;
  // A guest's page on this same computer: its stand-in is made, then opened.
  const standIn = await json("/api/games", { method: "POST", body: { id: "shared-game-0123456789ab", name: "Shared game: a stand-in" } });
  assert.equal(standIn.status, 201, "a game may be made beside the hosted one");
  const switched = await json("/api/games/active", { method: "PUT", body: { gameId: idOf(standIn) } });
  assert.equal(switched.status, 400);
  assert.match(switched.body.error, /hosting a shared game/);
  assert.equal(await openGame(), hosted, "the hosted game is still the open one");

  // Every other way to the same end.
  const before = (await json("/api/library")).body.games.length;
  const madeOpen = await json("/api/games", { method: "POST", body: { name: "Made and opened", setActive: true } });
  assert.equal(madeOpen.status, 400);
  assert.match(madeOpen.body.error, /hosting a shared game/);
  assert.equal((await json("/api/library")).body.games.length, before, "nothing was left half made");
  assert.equal((await json(`/api/games/${other}`, { method: "PUT", body: { setActive: true } })).status, 400);
  assert.equal((await json(`/api/games/${hosted}`, { method: "DELETE" })).status, 400);
  assert.equal(await openGame(), hosted);

  // What does not take the hosted game's place is as free as ever.
  assert.equal((await json("/api/games/active", { method: "PUT", body: { gameId: hosted } })).status, 200);
  assert.equal((await json(`/api/games/${other}`, { method: "PUT", body: { name: "Another save, renamed" } })).status, 200);
  assert.equal((await json(`/api/games/${other}`, { method: "DELETE" })).status, 200);
  assert.equal(await openGame(), hosted);

  // The hosting over, the library is the player's again.
  open = false;
  assert.equal((await json("/api/games/active", { method: "PUT", body: { gameId: idOf(standIn) } })).status, 200);
  assert.equal(await openGame(), idOf(standIn));
});

/*! Open Historia — a turn commit for a game that is gone © 2026. */
// The player deletes their only campaign while a time skip runs. When the skip
// finishes, its commit must be refused and leave the library as the player left
// it: no "<scenario> Session" created and switched to on its way to the refusal.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-turn-commit-wrong-game-"));
process.env.OH_DATA_DIR = DATA_DIR;

let store;

before(async () => {
  store = await import("./libraryStore.js");
});

after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const turn = (expectedGameId) => ({
  actions: [],
  chat: [],
  events: [],
  game: { country: "", gameDate: "2014-03-01", round: 2 },
  colors: {},
  world: { ownerSchema: 4 },
  expectedGameId,
});

test("a turn for a campaign deleted while it ran is refused without creating a game", () => {
  store.createGame({ id: "deleted-mid-skip", name: "Deleted mid-skip", setActive: true });
  store.deleteGame("deleted-mid-skip");
  assert.deepEqual(store.getGameCatalog().games.map((game) => game.id), []);

  assert.throws(
    () => store.writeRuntimeTurnState(turn("deleted-mid-skip")),
    /belongs to game "deleted-mid-skip", but no game is active/,
  );
  const catalog = store.getGameCatalog();
  assert.deepEqual(catalog.games.map((game) => game.id), [], "no game was created for the refused turn");
  assert.equal(catalog.activeGameId, "");
});

test("a turn with no campaign stamp still starts a game when none is active", () => {
  const result = store.writeRuntimeTurnState(turn(""));
  assert.ok(result.transactionId);
  assert.equal(store.getGameCatalog().games.length, 1);
});

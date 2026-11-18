/*! Open Historia — a shared game's stand-in in the library: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/libraryStandIns.test.js
//
// A guest's stand-in was a game like any other: listed, opened as the player's after they left, kept for good and
// hosted (the gap audit of 2026-11-18). Its record says what it is (server/sharedGameStandIn.js): the library never
// lists it, opens it only for its shared game, closes it with that game or at the next start, and the map its shared
// game is drawn on is not changed under it.
import test from "node:test";
import assert from "node:assert/strict";

const games = () => [
  { id: "mine", name: "My campaign", country: "France", scenarioId: "modern" },
  { id: "sg-1", name: "Shared game: Friday", country: "Abkhazia", scenarioId: "modern", standIn: { returnTo: "mine" } },
  { id: "sandbox", name: "Sandbox", country: "Peru", scenarioId: "other" },
];
let catalog = { activeGameId: "sg-1", games: games(), scenarios: [{ id: "modern", name: "Modern Day" }, { id: "other", name: "Other" }], token: "t1" };
const requests = [];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = String(init.method || "GET").toUpperCase();
  requests.push(`${method} ${path}`);
  if (path === "/api/library") return json(catalog);
  if (path === "/api/games/active" && method === "PUT") {
    catalog = { ...catalog, activeGameId: JSON.parse(init.body).gameId };
    return json(catalog);
  }
  const game = /^\/api\/games\/([^/]+)$/.exec(path);
  if (game && method === "DELETE") {
    const id = decodeURIComponent(game[1]);
    catalog = { ...catalog, games: catalog.games.filter((entry) => entry.id !== id), activeGameId: catalog.activeGameId === id ? catalog.games.find((entry) => entry.id !== id)?.id ?? "" : catalog.activeGameId };
    return json(catalog);
  }
  if (/^\/api\/scenarios\//.test(path) || /^\/api\/games\//.test(path)) return json({});
  return json({ error: "not here" }, 404);
};

const library = await import("./library.js");
const { closeAbandonedStandIns, closeStandIn, holdStandIn } = await import("./standInGames.js");

const reset = async (active = "sg-1") => {
  catalog = { ...catalog, activeGameId: active, games: games() };
  requests.length = 0;
  library.setSharedGameEntry(null);
  await library.refreshLibraryCatalog({ force: true });
};

test("the library never lists a stand-in; while its shared game is open the page still runs on it", async () => {
  await reset();
  const state = library.getLibraryState();
  assert.deepEqual(state.games.map((game) => game.id), ["mine", "sandbox"]);
  assert.equal(state.activeGame.id, "sg-1", "the game the page runs on");
  assert.deepEqual(library.libraryStandIns(), [{ id: "sg-1", standIn: { returnTo: "mine" } }]);
});

test("a stand-in is opened by its shared game alone", async () => {
  await reset("mine");
  await assert.rejects(library.activateGame("sg-1"), new RegExp(library.STAND_IN_CLOSED.slice(0, 30)));
  await library.activateGame("sg-1", { forSharedGame: true });
  assert.equal(library.getLibraryState().activeGameId, "sg-1");
});

test("while a shared game is open, its map's scenario and its game's files are not changed; any other scenario is", async () => {
  await reset();
  library.setSharedGameEntry({ gameId: "sg-1", country: "Russia" });
  try {
    await assert.rejects(library.saveScenario("modern", { name: "Edited" }), /its map is this scenario's/);
    await assert.rejects(library.uploadScenarioAsset("modern", "regionsGeojson", "{}"), /its map is this scenario's/);
    await assert.rejects(library.clearScenarioAsset("modern", "citiesGeojson"), /its map is this scenario's/);
    await assert.rejects(library.updateScenarioFromBundle("modern", {}), /its map is this scenario's/);
    await assert.rejects(library.removeScenario("modern"), /its map is this scenario's/);
    await assert.rejects(library.restoreScenarioBasemap("modern", {}), /its map is this scenario's/);
    await assert.rejects(library.uploadGameAsset("sg-1", "cover", "x"), /Leave the shared game first/);
    await library.saveScenario("other", { name: "Edited" }, { refresh: false });
    assert.ok(requests.includes("PUT /api/scenarios/other"));
  } finally {
    library.setSharedGameEntry(null);
  }
  await library.saveScenario("modern", { name: "Edited" }, { refresh: false });
  assert.ok(requests.includes("PUT /api/scenarios/modern"), "the game closed, it is the player's to change again");
});

test("a stand-in is closed with its shared game: the game open before is the library's again, and the stand-in is gone", async () => {
  await reset();
  assert.equal(await closeStandIn(library.libraryStandIns()[0]), true);
  assert.deepEqual(requests.filter((line) => !line.startsWith("GET")), ["PUT /api/games/active", "DELETE /api/games/sg-1"]);
  assert.equal(library.getLibraryState().activeGameId, "mine");
  assert.deepEqual(library.libraryStandIns(), []);
});

test("at start, a stand-in no page holds is closed; one a page of this app holds is left to it", async () => {
  const held = new Set();
  const target = {
    navigator: {
      locks: {
        request: (name, fn) => {
          held.add(name);
          return Promise.resolve(fn()).finally(() => held.delete(name));
        },
        query: async () => ({ held: [...held].map((name) => ({ name })), pending: [] }),
      },
    },
  };
  await reset();
  const release = holdStandIn("sg-1", { target });
  assert.equal(await closeAbandonedStandIns({ target }), 0, "a page still shows its shared game");
  assert.equal(library.getLibraryState().activeGame.id, "sg-1");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await closeAbandonedStandIns({ target }), 1, "its page went without closing it");
  assert.equal(library.getLibraryState().activeGameId, "mine");
  assert.deepEqual(library.getLibraryState().games.map((game) => game.id), ["mine", "sandbox"]);
  // With no Web Locks, every stand-in is one no page holds.
  await reset();
  assert.equal(await closeAbandonedStandIns({ target: {} }), 1);
});

test("a guest with no games of their own runs its shared game: the War Room, the music and Discord take it for a game being played", async () => {
  // The list leaves the stand-in out, and "no games" was read from the list: a first-time player who joined a
  // friend could not open the War Room, heard the menu's music all game and showed "in the menu" on Discord
  // (the review of 2026-11-18, door 2).
  const only = { id: "sg-1", name: "Shared game: Friday", country: "Abkhazia", scenarioId: "modern", standIn: { returnTo: "" } };
  catalog = { ...catalog, activeGameId: "sg-1", games: [only] };
  library.setSharedGameEntry(null);
  await library.refreshLibraryCatalog({ force: true });
  const state = library.getLibraryState();
  assert.deepEqual(state.games, [], "never listed");
  assert.equal(state.activeGame.id, "sg-1");
  assert.equal(library.hasNoGameToRun(state), false, "the game the page runs");
  // Single player as before: nothing listed and nothing active is nothing to run; a listed game is one.
  catalog = { ...catalog, activeGameId: null, games: [] };
  await library.refreshLibraryCatalog({ force: true });
  assert.equal(library.hasNoGameToRun(library.getLibraryState()), true);
  assert.equal(library.hasNoGameToRun({ loaded: false, games: [], activeGame: null }), false, "not before the library is read");
  await reset("mine");
  assert.equal(library.hasNoGameToRun(library.getLibraryState()), false);
});

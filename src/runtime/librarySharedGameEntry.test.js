// A shared game's entry in the library (library.js setSharedGameEntry): while
// one is open, the game it is shown in names the view's country and date, not
// the files' own; nothing else in the library changes, and clearing it gives
// the files' entry back.
import test from "node:test";
import assert from "node:assert/strict";

const CATALOG = {
  activeGameId: "standin",
  games: [
    { id: "standin", name: "Shared game: Friday", country: "Abkhazia", currentDate: "2016-01-01", scenarioId: "modern" },
    { id: "mine", name: "My campaign", country: "France", currentDate: "1900-01-01", scenarioId: "modern" },
  ],
  scenarios: [{ id: "modern", name: "Modern Day" }],
  token: "t1",
};

globalThis.fetch = async (url) => (String(url).endsWith("/api/library")
  ? new Response(JSON.stringify(CATALOG), { status: 200, headers: { "Content-Type": "application/json" } })
  : new Response("{}", { status: 404 }));

const library = await import("./library.js");

test("the shared game's entry shows the view's country and date, and only that entry", async () => {
  await library.refreshLibraryCatalog({ force: true });
  assert.equal(library.getLibraryState().activeGame.country, "Abkhazia");

  // Before a country is taken there is none to name.
  library.setSharedGameEntry({ gameId: "standin", country: "" });
  assert.equal(library.getLibraryState().activeGame.country, "");
  assert.equal(library.getLibraryState().activeGame.currentDate, "2016-01-01");

  library.setSharedGameEntry({ gameId: "standin", country: "Russia", currentDate: "2016-01-31" });
  const state = library.getLibraryState();
  assert.equal(state.activeGame.country, "Russia");
  assert.equal(state.activeGame.currentDate, "2016-01-31");
  assert.equal(state.games.find((game) => game.id === "standin").country, "Russia");
  assert.deepEqual(state.games.find((game) => game.id === "mine"), CATALOG.games[1]);
});

test("the entry survives the library being read again, and clearing it restores the files' own", async () => {
  library.setSharedGameEntry({ gameId: "standin", country: "Russia", currentDate: "2016-01-31" });
  await library.refreshLibraryCatalog({ force: true });
  assert.equal(library.getLibraryState().activeGame.country, "Russia");

  library.setSharedGameEntry(null);
  assert.equal(library.getLibraryState().activeGame.country, "Abkhazia");
  assert.equal(library.getLibraryState().activeGame.currentDate, "2016-01-01");
});

test("an unchanged entry does not wake the library's listeners", async () => {
  await library.refreshLibraryCatalog({ force: true });
  library.setSharedGameEntry({ gameId: "standin", country: "Russia", currentDate: "2016-01-31" });
  let calls = 0;
  const stop = library.subscribeToLibraryState(() => { calls += 1; });
  library.setSharedGameEntry({ gameId: "standin", country: "Russia", currentDate: "2016-01-31" });
  assert.equal(calls, 0);
  library.setSharedGameEntry({ gameId: "standin", country: "Russia", currentDate: "2016-02-28" });
  assert.equal(calls, 1);
  stop();
  library.setSharedGameEntry(null);
});

// A guest's page could switch to another game, make one, change one or delete the stand-in the shared game is drawn
// on, mid-game; the host's server refused it only on the host's computer (the gap audit of 2026-11-18).
test("while a shared game is open, the library switches to no other game, makes none, changes none and deletes none", async () => {
  library.setSharedGameEntry({ gameId: "game-1", country: "France" });
  try {
    await assert.rejects(library.activateGame("game-2"), new RegExp(library.SHARED_GAME_OPEN.slice(0, 30)));
    await assert.rejects(library.createGame({ name: "Another" }), /Leave the shared game first/);
    await assert.rejects(library.saveGame("game-1", { features: {} }), /Leave the shared game first/);
    await assert.rejects(library.removeGame("game-1"), /Leave the shared game first/);
    // The shared game's own stand-in is made and opened through the same doors.
    await assert.doesNotReject(library.activateGame("game-1", { forSharedGame: true }).catch((error) => {
      if (/Leave the shared game first/.test(String(error?.message))) throw error;
    }));
  } finally {
    library.setSharedGameEntry(null);
  }
});

// "if I exit the game and then try to reenter by clicking current on my open game, nothing happens" (the owner,
// 2026-11-18): Current on the open shared game's own card was refused as a switch to another game would be, and the
// refusal went to an error line under a menu that had just closed.
test("Current on the open shared game's own card goes back into it, for the host and for a guest", async () => {
  const entry = await import("./gameEntry.js");
  library.setSharedGameEntry({ gameId: "mine", country: "France" });
  try {
    entry.leaveGame();
    await assert.doesNotReject(library.activateGame("mine"));
    assert.equal(entry.hasEnteredGame(), true);
    // Any other game is still refused while it is open.
    await assert.rejects(library.activateGame("standin"), /Leave the shared game first/);
  } finally {
    library.setSharedGameEntry(null);
  }
});

test("a guest's stand-in is listed while its shared game is open, so its card has a Current", async () => {
  CATALOG.games[0].standIn = true;
  try {
    await library.refreshLibraryCatalog({ force: true });
    assert.equal(library.getLibraryState().games.some((game) => game.id === "standin"), false);
    library.setSharedGameEntry({ gameId: "standin", country: "Russia" });
    assert.equal(library.getLibraryState().games.some((game) => game.id === "standin"), true);
    library.setSharedGameEntry(null);
    assert.equal(library.getLibraryState().games.some((game) => game.id === "standin"), false);
  } finally {
    delete CATALOG.games[0].standIn;
    library.setSharedGameEntry(null);
  }
});

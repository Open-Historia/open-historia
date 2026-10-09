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

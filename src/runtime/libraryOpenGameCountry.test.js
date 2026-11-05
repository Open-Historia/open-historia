// Which country a game is played as (library.js setOpenGameCountry). A player
// (2026-10-13): "I used cheats to make myself be ukraine and the ai seemed to
// think I was ukraine but the rest of the game no". The cheat wrote the game's
// own record; the game's bar, its country drawer, the war room's button and
// the music read the library's list, which is only read again when the library
// itself is written. So the open game's entry names the country its own
// record names.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const CATALOG = {
  activeGameId: "session",
  games: [
    // Started with no country: an observer's game.
    { id: "session", name: "Modern Day Session", country: "", currentDate: "2016-06-29", scenarioId: "modern" },
    { id: "other", name: "Another campaign", country: "France", currentDate: "1900-01-01", scenarioId: "modern" },
  ],
  scenarios: [{ id: "modern", name: "Modern Day" }],
  token: "t1",
};

globalThis.fetch = async (url) => (String(url).endsWith("/api/library")
  ? new Response(JSON.stringify(CATALOG), { status: 200, headers: { "Content-Type": "application/json" } })
  : new Response("{}", { status: 404 }));

const library = await import("./library.js");
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

test("the open game's entry names the country its own record names, at once, and only that entry", async () => {
  await library.refreshLibraryCatalog({ force: true });
  assert.equal(library.getLibraryState().activeGame.country, "");

  // The cheat: the record now says Ukraine.
  library.setOpenGameCountry("session", "Ukraine");
  const state = library.getLibraryState();
  assert.equal(state.activeGame.country, "Ukraine");
  assert.equal(state.games.find((game) => game.id === "session").country, "Ukraine");
  assert.equal(state.activeGame.currentDate, "2016-06-29");
  assert.deepEqual(state.games.find((game) => game.id === "other"), CATALOG.games[1]);

  // And again: the entry follows the record every time it changes.
  library.setOpenGameCountry("session", " Russia ");
  assert.equal(library.getLibraryState().activeGame.country, "Russia");
});

test("it stands when the library is read again with the old list, and gives way to nothing but the record", async () => {
  library.setOpenGameCountry("session", "Ukraine");
  await library.refreshLibraryCatalog({ force: true });
  assert.equal(library.getLibraryState().activeGame.country, "Ukraine");
  // A game with no country says so with an empty name: that is a country to name, too.
  library.setOpenGameCountry("session", "");
  assert.equal(library.getLibraryState().activeGame.country, "");
  // Another game opened: the first goes back to what its files say.
  library.setOpenGameCountry("session", "Ukraine");
  library.setOpenGameCountry("other", "France");
  assert.equal(library.getLibraryState().games.find((game) => game.id === "session").country, "");
  assert.equal(library.getLibraryState().games.find((game) => game.id === "other").country, "France");
});

test("a record that agrees with the list wakes nobody, and one that does not wakes them once", async () => {
  library.setOpenGameCountry(null);
  await library.refreshLibraryCatalog({ force: true });
  let calls = 0;
  const stop = library.subscribeToLibraryState(() => { calls += 1; });
  // Every game opened tells the library its country: nearly always what the list already says.
  library.setOpenGameCountry("other", "France");
  assert.equal(calls, 0);
  library.setOpenGameCountry("other", "France");
  assert.equal(calls, 0);
  library.setOpenGameCountry("other", "Germany");
  assert.equal(calls, 1);
  library.setOpenGameCountry("other", "Germany");
  assert.equal(calls, 1);
  stop();
  library.setOpenGameCountry(null);
});

test("the game's screen tells the library the country of the game's own record, once it is read", () => {
  const screen = read("../Game/GameUI/main.jsx");
  assert.ok(screen.includes("const selectPlayedCountry = (game) => (game ? String(game.country ?? \"\").trim() : null);"));
  assert.ok(screen.includes("const playedCountry = useRuntimeState(\"game\", selectPlayedCountry);"));
  assert.match(screen, /if \(gameEntered && activeGame\?\.id && playedCountry !== null\) setOpenGameCountry\(activeGame\.id, playedCountry\);\s+\}, \[gameEntered, activeGame\?\.id, playedCountry\]\);/);
  // The record's empty value, before it is read, is null: never taken for "no country".
  assert.ok(read("./runtimeStore.js").includes("game: { read: readGameData, normalize: normalizeGameData, empty: null },"));
  // The cheat writes the record, which is what the screen follows.
  assert.ok(read("../Game/GameUI/cheats.jsx").includes("await writeGameData({ ...current, country: target });"));
});

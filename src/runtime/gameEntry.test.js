/*! Open Historia — no game is loaded until the player opens one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameEntry.test.js
//
// The page starts on the main menu and loads no game behind it (gameEntry.js).
// Here: the store itself; the library entering the game it opens, and only
// once that game has landed; and, read from the source (none of these screens
// loads under node), that the map and the game's controls wait for it, that
// the startup screen no longer waits for a world, and that every way out of the
// menu opens a game.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// ---- a library to open games in ---------------------------------------------------

const GAMES = [
  { id: "last-played", name: "Last played", country: "France", scenarioId: "modern" },
  { id: "another", name: "Another", country: "Japan", scenarioId: "modern" },
];
let server = { activeGameId: "last-played", games: [...GAMES] };
let failing = false;
const requests = [];
const catalog = () => ({ ...server, scenarios: [{ id: "modern", name: "Modern Day" }], token: `t-${server.activeGameId}` });
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  const method = init.method || "GET";
  requests.push(`${method} ${url}`);
  if (failing) return answer({ error: "The server said no." }, 500);
  if (url === "/api/library") return answer(catalog());
  if (url === "/api/games/active" && method === "PUT") {
    server = { ...server, activeGameId: JSON.parse(init.body).gameId };
    return answer(catalog());
  }
  if (url === "/api/games" && method === "POST") {
    const payload = JSON.parse(init.body);
    const game = { id: payload.id || `made-${server.games.length}`, name: payload.name, country: "", scenarioId: payload.scenarioId };
    server = { games: [...server.games, game], activeGameId: payload.setActive ? game.id : server.activeGameId };
    return answer({ game }, 201);
  }
  return answer({}, 404);
};

const entry = await import("./gameEntry.js");
const library = await import("./library.js");

const fresh = async () => {
  entry.resetGameEntryForTests();
  server = { activeGameId: "last-played", games: [...GAMES] };
  failing = false;
  await library.refreshLibraryCatalog({ force: true });
};

// ---- the store ----------------------------------------------------------------------

test("a page starts with no game entered, and a game is entered once and for good", () => {
  entry.resetGameEntryForTests();
  assert.equal(entry.hasEnteredGame(), false);
  let heard = 0;
  let stoppedHeard = 0;
  entry.subscribeGameEntry(() => { heard += 1; });
  const stop = entry.subscribeGameEntry(() => { stoppedHeard += 1; });
  stop();
  entry.enterGame();
  assert.equal(entry.hasEnteredGame(), true);
  assert.equal(heard, 1);
  assert.equal(stoppedHeard, 0, "a listener that stopped hears nothing");
  // Another game opened, the menu gone back to and left again: still entered, and nobody is woken for it.
  entry.enterGame();
  assert.equal(heard, 1);
  assert.equal(entry.hasEnteredGame(), true);
  assert.equal(typeof entry.useGameEntered, "function");
});

test("it is kept in the page and nowhere else, so every page load starts on the menu", () => {
  const source = read("./gameEntry.js").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(source, /let entered = false;/);
  // Only leaving the open game (archived or deleted) and the test's own reset take it back.
  assert.equal(source.match(/entered = false/g).length, 3);
  assert.match(source, /export const leaveGame = \(\) => \{\s+if \(!entered\) return;\s+entered = false;/);
});

// "when you archive or delete your current game it shouldnt auto open the next on the list";
// "make a button to delete your game when it is archived next to the unarchive button" (the owner).
test("archiving or deleting the open game leaves it, and an archived game's card can delete it", () => {
  const bar = read("../Game/GameUI/libraryBar.jsx");
  assert.match(bar, /await saveGame\(game\.id, \{ archived: !game\.archived \}\);\s+if \(!game\.archived && game\.id === activeGameId && hasEnteredGame\(\)\) leaveGame\(\);/);
  assert.match(bar, /const wasOpen = record\.id === activeGameId && hasEnteredGame\(\);\s+await removeGame\(record\.id\);\s+if \(wasOpen\) leaveGame\(\);/);
  assert.match(bar, /const handleGameDelete = async \(game\) => \{[\s\S]+?const wasOpen = game\.id === activeGameId && hasEnteredGame\(\);\s+await removeGame\(game\.id\);\s+if \(wasOpen\) leaveGame\(\);/);
  // Delete is on an archived game's card only, in the archived branch of its buttons.
  assert.match(bar, /\{game\.archived \? \([\s\S]+?\{onDelete && game\.canDelete && \(\s+<button[\s\S]+?onClick=\{\(\) => onDelete\(game\)\}[\s\S]+?\) : null\}/);
  assert.match(bar, /const handleGameDelete = async \(game\) => \{\s+if \(!game\?\.canDelete\) return;/);
  assert.equal(bar.match(/onDelete=\{handleGameDelete\}/g).length, 2);
  assert.match(bar, /const handleEmpty = \(\) => \{\s+setConfirmEmpty\(false\);\s+run\(\(\) => emptyTrash\(kind\)\);\s+\};/);
  assert.match(bar, /action=\{confirmEmpty \? \([\s\S]+?onClick=\{\(\) => setConfirmEmpty\(false\)\}[\s\S]+?onClick=\{handleEmpty\}[\s\S]+?onClick=\{\(\) => setConfirmEmpty\(true\)\}[\s\S]+?description=\{confirmEmpty \? question : description\}/);
});

// ---- the library enters the game it opens -------------------------------------------

test("reading the library enters nothing: the active game is only the one last played", async () => {
  await fresh();
  assert.equal(library.getLibraryState().activeGameId, "last-played");
  assert.equal(entry.hasEnteredGame(), false);
});

test("Play on another game enters it once it is the library's active game, not before", async () => {
  await fresh();
  const activeWhenEntered = [];
  const stop = entry.subscribeGameEntry(() => activeWhenEntered.push(library.getLibraryState().activeGameId));
  const opening = library.activateGame("another");
  assert.equal(entry.hasEnteredGame(), false, "not while the request is out: the map would start on the game last played");
  await opening;
  stop();
  assert.equal(entry.hasEnteredGame(), true);
  assert.deepEqual(activeWhenEntered, ["another"]);
});

test("Play on the game that is already the active one enters it though the id does not change", async () => {
  await fresh();
  let switched = 0;
  const stop = library.subscribeToLibraryState(() => { switched += 1; });
  await library.activateGame("last-played");
  stop();
  assert.equal(library.getLibraryState().activeGameId, "last-played");
  assert.ok(switched >= 1);
  assert.equal(entry.hasEnteredGame(), true);
});

test("a game that could not be opened is not entered", async () => {
  await fresh();
  failing = true;
  await assert.rejects(library.activateGame("another"), /The server said no\./);
  await assert.rejects(library.createGame({ name: "New", scenarioId: "modern", setActive: true }), /The server said no\./);
  assert.equal(entry.hasEnteredGame(), false);
});

test("a new game made to be played is entered when the library holds it; one made aside is not", async () => {
  await fresh();
  // A shared game's stand-in is made without setActive, and opened by activateGame later.
  await library.createGame({ id: "stand-in", name: "Shared game", scenarioId: "modern" });
  assert.equal(entry.hasEnteredGame(), false);

  const activeWhenEntered = [];
  const stop = entry.subscribeGameEntry(() => activeWhenEntered.push(library.getLibraryState().activeGameId));
  const made = await library.createGame({ name: "A new game", scenarioId: "modern", setActive: true });
  stop();
  assert.equal(entry.hasEnteredGame(), true);
  assert.deepEqual(activeWhenEntered, [made.game.id]);
});

// ---- the screens, read from the source ------------------------------------------------

const app = read("../App.jsx");
const main = read("../Game/GameUI/main.jsx");
const menu = read("../Game/GameUI/libraryBar.jsx");
const cover = read("../Game/GameUI/gameLoadingScreen.jsx");
const lobbies = read("../multiplayer/ui/LobbiesTab.jsx");
const sharedGame = read("../multiplayer/client/sharedGame.js");

test("App.jsx mounts the map only once a game is entered", () => {
  assert.match(app, /const gameEntered = useGameEntered\(\);/);
  // The one place the map is rendered is inside the check.
  assert.equal(app.match(/<WorldMap\b/g).length, 1);
  assert.match(app, /\{gameEntered && \(\s*<Suspense fallback=\{null\}>\s*<WorldMap\s/);
  // And it is still the lazy chunk, so the menu does not fetch MapLibre either.
  assert.match(app, /const WorldMap = lazy\(\(\) => import\("\.\/Game\/Map\/World\.jsx"\)\)/);
});

test("the startup screen ends with the list of games, and waits for no world", () => {
  assert.match(app, /ensureLibraryCatalog\(\)\s*\.catch\([\s\S]*?\)\s*\.finally\(\(\) => \{\s*if \(isActive\) setIsReady\(true\);\s*\}\);/);
  // The first world idle only warms the AI chunk now.
  const idle = app.slice(app.indexOf("const handleFirstWorldIdle"), app.indexOf("return (", app.indexOf("const handleFirstWorldIdle")));
  assert.match(idle, /prefetchGameplay\(\);/);
  assert.doesNotMatch(idle, /setIsReady/);
  assert.doesNotMatch(app, /Finalizing first world render|hasFirstWorldIdle|preloadFinishedRef/);
  // Its one step is the library's.
  const preload = read("./preload.js");
  assert.match(preload, /export const createMenuStartupState = \(\) => \(\{[\s\S]*?steps: \[\{ id: "library", label: "Syncing games and scenarios", status: "active" \}\]/);
  assert.match(app, /useState\(createMenuStartupState\)/);
});

test("a game's warm-ups run when the first game is entered, not with the page", () => {
  assert.equal(app.match(/runStartupPreload\(/g).length, 1);
  assert.match(app, /useEffect\(\(\) => \{\s*if \(!gameEntered\) return;\s*runStartupPreload\(\)\.catch\(/);
  assert.match(app, /\}, \[gameEntered\]\);/);
});

test("the game's own controls are mounted with a game, and nothing is told of one before", () => {
  assert.match(main, /const gameEntered = useGameEntered\(\);/);
  const hud = main.slice(main.indexOf('<div data-oh-hud="" style={hudStyle}>'));
  const gate = hud.indexOf("{gameEntered && (");
  assert.notEqual(gate, -1);
  assert.ok(hud.indexOf("<LibraryTopBar") < gate, "the menu itself is always there");
  for (const control of ["<DateWidget", "<Toolbar", "<Other", "<Search", "<ForcesPanel", "<AdvisorButton"]) {
    assert.ok(hud.indexOf(control) > gate, `${control} is mounted before a game is opened`);
  }
  // No player, so no war and no war room button; no scenario music; Discord told "the menu"; no AI timers.
  assert.match(main, /const playerCountry = gameEntered \? activeGame\?\.country \|\| "" : "";/);
  assert.match(main, /const scenarioMusicKey = JSON\.stringify\(\(gameEntered && activeGame\?\.id && runtimeScenario\?\.music\) \|\| null\);/);
  assert.match(main, /inMenu: mainMenuOpen \|\| hasNoGames \|\| !gameEntered,/);
  assert.equal(main.match(/if \(hasNoGames \|\| mainMenuOpen \|\| !gameEntered\) return undefined;/g).length, 2);
  assert.match(main, /useCountryDisplayName\(activeGame\?\.country \|\| "", \{ wait: !gameEntered \}\)/);
  // The hooks that read the game's documents wait too.
  assert.match(read("./useRuntimeState.js"), /useEffect\(\(\) => \{\s*if \(!entered\) return undefined;[\s\S]*?\}, \[key, depsKey, entered\]\);/);
  assert.match(read("./polityNames.js"), /useEffect\(\(\) => \{\s*if \(wait\) return undefined;/);
  assert.match(read("../Game/Map/useWorldState.js"), /export function useWorldState\(\{ wait = false \} = \{\}\) \{[\s\S]*?useEffect\(\(\) => \{\s*if \(wait\) return undefined;/);
});

test("the cover's wait, and its ceiling, start when a game is entered", () => {
  assert.match(cover, /const entered = useGameEntered\(\);/);
  assert.match(cover, /useWorldState\(\{ wait: !entered \}\)/);
  // The effect that arms the ceiling does nothing until then, and runs again when it is.
  assert.match(cover, /useEffect\(\(\) => \{\s*if \(!entered\) return undefined;\s*let settled = false;[\s\S]*?later\(finish, LOADING_CEILING_MS\);[\s\S]*?timers\.forEach\(clearTimeout\);\s*\};\s*\}, \[entered\]\);/);
  assert.match(cover, /return \{ active: entered && phase !== "done", phase \};/);
  // Between a press of Play and the game landing the cover is up all the same, and cannot stay up over nothing.
  assert.match(main, /const awaitingGame = !gameEntered && !mainMenuOpen;/);
  assert.match(main, /const showGameLoading = awaitingGame \|\| \(gameLoading\.active && Boolean\(activeGame\?\.id\)\);/);
  assert.match(main, /if \(!awaitingGame\) return undefined;\s*const timer = setTimeout\(enterGame, LOADING_CEILING_MS\);/);
});

// A flow of the menu, from its name to the end of its body.
const flow = (name) => {
  const from = menu.indexOf(`const ${name} = async (`);
  assert.notEqual(from, -1, `${name} is gone from libraryBar.jsx`);
  const end = menu.slice(from).search(/\r?\n {2}\};/);
  return menu.slice(from, from + end);
};

test("every way out of the menu opens a game: each flow closes it and then has the library open one", () => {
  const opens = {
    startGameForCountry: /await createGame\(\{[\s\S]*?setActive: true,/,
    startGameForFaction: /await createGame\(\{[\s\S]*?setActive: true,/,
    startGameForGroup: /await createGame\(\{[\s\S]*?setActive: true,/,
    handleGameClone: /await createGame\(\{[\s\S]*?setActive: true,/,
    playAppliedMap: /await createGame\(\{[\s\S]*?setActive: true,/,
    handleGameActivate: /await activateGame\(gameId\);/,
    handleMissingScenarioImport: /await activateGame\(game\.id\);/,
    choosePlayCountry: /await activateGame\(gid\);/,
  };
  let closes = 0;
  for (const [name, opening] of Object.entries(opens)) {
    const body = flow(name);
    const closed = body.indexOf("setMenuOpen(false);");
    assert.notEqual(closed, -1, `${name} no longer closes the menu`);
    const opened = body.slice(closed).search(opening);
    assert.notEqual(opened, -1, `${name} closes the menu without opening a game after it`);
    closes += body.match(/setMenuOpen\(false\)/g).length;
  }
  // The one other close: over the game that is already the active one, which it enters itself.
  assert.match(menu, /const enterActiveGame = \(\) => \{\s*enterGame\(\);\s*setMenuOpen\(false\);\s*\};/);
  closes += 1;
  assert.equal(
    menu.match(/setMenuOpen\(false\)/g).length,
    closes,
    "the menu is closed somewhere new: that flow must open a game through the library, or close it with enterActiveGame",
  );
  // A flow that fails opens the menu again, so the cover does not stay up over no game.
  for (const name of ["startGameForCountry", "startGameForFaction", "startGameForGroup", "handleGameClone", "playAppliedMap", "handleGameActivate", "handleMissingScenarioImport"]) {
    assert.match(flow(name), /catch \(nextError\) \{[\s\S]*?setMenuOpen\(true\);/, `${name} leaves the menu closed when it fails`);
  }
});

test("hosting and joining a shared game enter the game the menu closes over", () => {
  assert.match(menu, /<LobbiesTab hosting=\{lobbyHosting\} onHostingChange=\{setLobbyHosting\} onEnterGame=\{enterActiveGame\} \/>/);
  assert.match(lobbies, /await joinSharedGame\(\{ token: code, name: name \|\| "Player" \}\);\s*onEnterGame\?\.\(\);/);
  assert.match(lobbies, /await hostSharedGame\(\{ settings, name: name \|\| "Host" \}\);\s*onClose\?\.\(\);\s*onEnterGame\?\.\(\);/);
  // The guest's stand-in is opened by the library like any game.
  assert.match(sharedGame, /await activateGame\(gameId\);/);
  // Back, on a phone, closes the menu only over a game it was opened from, and by the same way out.
  assert.match(menu, /useBackToClose\(menuOpen && menuOverGame && Boolean\(activeGame\), enterActiveGame\);/);
});

test("the menu has no other way to be closed, and nothing of a game is fetched for it", () => {
  // No close button: the menu's own words for it, and the count of its closes above.
  assert.match(menu, /closes only by entering a game/);
  assert.match(menu, /let menuOpenDefault = true;/);
  // The last played game's missing basemap and its country's name wait for a game too.
  assert.match(menu, /if \(gameEntered && runtimeScenario\?\.missingBasemap\) retryMissingBasemap\(runtimeScenario\);/);
  assert.match(menu, /useCountryDisplayName\(activeGame\?\.country \|\| "", \{ wait: !gameEntered \}\)/);
  // Switching the globe from the menu's Settings redraws no map.
  assert.match(app, /if \(value !== globeRef\.current && hasEnteredGame\(\)\) announceMapRerender\(\);/);
});

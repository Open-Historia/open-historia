/*! Open Historia — whether a game has been opened since the page started © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The app starts on the main menu and loads no game there (the owner,
// 2026-10-13: "make your current game not load on startup anymore, make it so
// you need to manually click play for it to open the game"). The library still
// has an ACTIVE game, the one last played, and everything used to be loaded
// for it as the page started: its map, its regions, its borders and labels,
// and the game's whole UI behind the menu. Somebody who wanted another game,
// or only the menu, paid for all of it.
//
// So one fact, kept here: has the player opened a game since this page loaded?
//   - App.jsx mounts the map, and starts the map's warm-ups
//     (runtime/preload.js), only once it is true, and its startup screen no
//     longer waits for a world to be drawn;
//   - GameUI/main.jsx mounts the game's own controls only then, and until then
//     tells nothing about a game to anything (the music, Discord, the AI's
//     timers);
//   - the cover a game opens under starts its wait then, not when the page
//     did (GameUI/gameLoadingScreen.jsx).
//
// Who sets it:
//   - the library, when a game it was asked to open has landed in its state:
//     activateGame (Play on a game's card, the active one included; Import &
//     play) and createGame({ setActive }) (a new
//     game, a clone, Apply & Play). Not before: the map must not start on the
//     game that is on its way out;
//   - the main menu, when it closes over the game that is already the active
//     one without the library opening anything: a phone's Back over a game the
//     menu was opened from (GameUI/libraryBar.jsx enterActiveGame).
// Between a press of Play and the game landing, the menu is closed and nothing
// is entered yet: the cover is up (main.jsx `awaitingGame`), and a flow that
// fails opens the menu again.
//
// It is unset only when the open game is archived or deleted (leaveGame): the
// next game is not opened in its place, and waits for a Play like the first.
// Leaving a game for the menu keeps that game loaded behind the menu.
// It lives in this module and nowhere else (no storage), so every page load
// starts on the menu again.
import { useSyncExternalStore } from "react";

let entered = false;
const listeners = new Set();

export const hasEnteredGame = () => entered;

export const enterGame = () => {
  if (entered) return;
  entered = true;
  for (const listener of [...listeners]) listener();
};

export const leaveGame = () => {
  if (!entered) return;
  entered = false;
  for (const listener of [...listeners]) listener();
};
export const subscribeGameEntry = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useGameEntered = () => useSyncExternalStore(subscribeGameEntry, hasEnteredGame, hasEnteredGame);

// Tests only: a page never goes back to "no game opened".
export const resetGameEntryForTests = () => {
  entered = false;
  listeners.clear();
};

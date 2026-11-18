/*! Open Historia — a shared game's stand-in, opened and closed with it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's screen draws the host's game on a stand-in: a game of this device's
// library, made from its copy of the host's scenario, whose own record says what
// it is (server/sharedGameStandIn.js). It lasts as long as its shared game is
// open on a page of this device, and no longer:
//
//   - while it is open, the page holds a lock named for it (the Web Locks API),
//     which the browser lets go of the moment that page goes, however it goes:
//     Leave, a reload, a closed window, a crash;
//   - when the shared game closes, the game that was open before is the active
//     one again and the stand-in is deleted (closeStandIn);
//   - and when the app starts, any stand-in no page holds is closed the same way
//     (closeAbandonedStandIns): one a page left behind was otherwise the
//     library's active game, and the menu's Continue opened it as a game of the
//     player's, a round-1 copy of someone else's world.
//
// Before, the stand-in was a game like any other: listed, kept for good after
// the guest left, and hosted by some as though it were a save.

import { activateGame, getLibraryState, libraryStandIns, refreshLibraryCatalog, removeGame } from "./library.js";
export { STAND_IN_NOT_SHARED } from "./library.js";
import { logDebugEvent } from "./debugLog.js";
export { standInMark, standInOf } from "../../server/sharedGameStandIn.js";


const lockName = (gameId) => `oh:mp:stand-in:${gameId}`;
const locksOf = (target = globalThis) => target?.navigator?.locks ?? null;

// Held by the page whose shared game the stand-in shows, until it lets go (the
// returned function) or the page goes. Where the browser has no Web Locks,
// nothing is held, and the next start closes the stand-in whatever page shows it.
export const holdStandIn = (gameId, { target = globalThis } = {}) => {
  const locks = locksOf(target);
  if (!gameId || typeof locks?.request !== "function") return () => {};
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  locks.request(lockName(gameId), () => held).catch(() => {});
  return () => release();
};

// The stand-ins some page of this app holds now, by game id.
const heldStandIns = async (target) => {
  const locks = locksOf(target);
  if (typeof locks?.query !== "function") return new Set();
  try {
    const { held = [], pending = [] } = await locks.query();
    return new Set([...held, ...pending].map((lock) => String(lock?.name ?? "")));
  } catch {
    return new Set();
  }
};

// A stand-in closed: the game that was open before it is the active one again
// (when the stand-in was, and that game is still here), and the stand-in is
// deleted. `{ id, standIn: { returnTo } }`, as library.js libraryStandIns lists
// it. Resolves true when it is gone; one that could not be deleted stays hidden,
// for the next start to try again.
export const closeStandIn = async (entry) => {
  const id = String(entry?.id ?? "");
  if (!id) return false;
  const back = String(entry?.standIn?.returnTo ?? "");
  try {
    const library = getLibraryState();
    if (library.activeGameId === id && back && (library.games ?? []).some((game) => game?.id === back)) {
      await activateGame(back, { enter: false });
    }
    await removeGame(id);
    logDebugEvent("shared game", "the shared game's stand-in on this device was closed", { gameId: id });
    return true;
  } catch (error) {
    logDebugEvent("shared game", "the shared game's stand-in on this device could not be closed yet", { gameId: id, error: String(error?.message || error) }, { problem: true });
    return false;
  }
};

// At start: every stand-in no page of this app holds, closed.
export const closeAbandonedStandIns = async ({ target = globalThis } = {}) => {
  if (!libraryStandIns().length) return 0;
  const held = await heldStandIns(target);
  let closed = 0;
  for (const entry of libraryStandIns()) {
    if (held.has(lockName(entry.id))) continue;
    if (await closeStandIn(entry)) closed += 1;
  }
  if (closed) await refreshLibraryCatalog({ force: true }).catch(() => {});
  return closed;
};

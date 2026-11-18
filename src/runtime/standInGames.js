/*! Open Historia — a shared game's stand-in, opened and closed with it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's screen draws the host's game on a stand-in: a game of this device's
// library, made from its copy of the host's scenario, whose own record says what
// it is (server/sharedGameStandIn.js). It lasts as long as its shared game is
// open on a page of this device, and no longer:
//
//   - while it is open, the page holds a lock named for it (the Web Locks API),
//     which the browser lets go of the moment that page goes, however it goes:
//     Leave, a reload, a closed window, a crash; and it renews a lease on it
//     with its server (server/standInLeases.js), which every browser and device
//     reaching that server reads: a lock is one browser's alone, and the
//     desktop's library is its server's, so a page started in another browser
//     took the live stand-in for one left behind and closed it under the shared
//     game (the review of 2026-11-18, door 9);
//   - when the shared game closes, the game that was open before is the active
//     one again and the stand-in is deleted (closeStandIn);
//   - and when the app starts, any stand-in no page holds (no lock here, no
//     fresh lease on the server) is closed the same way
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
const leaseUrl = (gameId) => `/api/stand-ins/${encodeURIComponent(gameId)}/lease`;
// How often the page renews its lease: well inside the server's minute
// (server/standInLeases.js STAND_IN_LEASE_MS).
export const STAND_IN_RENEW_MS = 20_000;
const fetchOf = (target) => (typeof target?.fetch === "function" ? target.fetch.bind(target) : globalThis.fetch);

// Held by the page whose shared game the stand-in shows, until it lets go (the
// returned function) or the page goes: a Web Lock in this browser, and a lease
// renewed with the server for every other browser and device. A server with no
// leases (the website's and the phone's library is the browser's own, where the
// lock is all there is) is asked once. Where the browser has no Web Locks
// either, nothing is held, and the next start closes the stand-in whatever page
// shows it.
export const holdStandIn = (gameId, { target = globalThis, timers = globalThis } = {}) => {
  if (!gameId) return () => {};
  const locks = locksOf(target);
  let release = () => {};
  if (typeof locks?.request === "function") {
    const held = new Promise((resolve) => { release = resolve; });
    locks.request(lockName(gameId), () => held).catch(() => {});
  }
  const ask = fetchOf(target);
  let renewing = null;
  let released = false;
  const renew = () => {
    if (released || typeof ask !== "function") return;
    void Promise.resolve()
      .then(() => ask(leaseUrl(gameId), { method: "PUT" }))
      .then((response) => {
        // A server that keeps no leases: the lock is all there is.
        if (response?.status === 404 && renewing !== null) {
          timers.clearInterval(renewing);
          renewing = null;
        }
      })
      .catch(() => {
        // the next renewal tries again
      });
  };
  renewing = timers.setInterval(renew, STAND_IN_RENEW_MS);
  renew();
  return () => {
    released = true;
    if (renewing !== null) timers.clearInterval(renewing);
    renewing = null;
    release();
    if (typeof ask === "function") void Promise.resolve().then(() => ask(leaseUrl(gameId), { method: "DELETE" })).catch(() => {});
  };
};

// The stand-ins some page holds now, by lock name: a lock in this browser, or a
// lease another browser or device renews with the server.
const heldStandIns = async (target) => {
  const names = new Set();
  const locks = locksOf(target);
  if (typeof locks?.query === "function") {
    try {
      const { held = [], pending = [] } = await locks.query();
      for (const lock of [...held, ...pending]) names.add(String(lock?.name ?? ""));
    } catch {
      // no locks read: the leases still say
    }
  }
  try {
    const response = await fetchOf(target)("/api/stand-ins/leases");
    const answer = response?.ok ? await response.json() : null;
    for (const id of Array.isArray(answer?.held) ? answer.held : []) names.add(lockName(String(id ?? "")));
  } catch {
    // a server with no leases: the locks are all there is
  }
  return names;
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

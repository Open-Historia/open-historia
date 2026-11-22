/*! Open Historia — which shared games' stand-ins a page is showing now, as this server hears it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's stand-in (sharedGameStandIn.js) lasts as long as its shared game is
// open on a page, and the next start of the app closes one no page holds
// (src/runtime/standInGames.js closeAbandonedStandIns). The page's hold was a
// Web Lock, which a browser keeps to itself: the desktop's library is this
// server's, and any page of it can start, the app's window, the same address
// in another browser, another device on the network. Such a page saw no lock,
// took the live stand-in for one left behind, deleted it and made another game
// the active one, under the shared game still running in the app (the review
// of 2026-11-18, door 9).
//
// So the page holding a stand-in also says so here, every little while (a
// lease), and a start closes only a stand-in that no lock in its own browser
// and no fresh lease here holds. In memory alone: a server that restarts has
// no page of its own showing anything until they say so again, which they do
// within a lease's renewal.
//
// Runtime-free: time is injected, so the tests drive it.

export const STAND_IN_LEASE_MS = 60_000;
// The most stand-ins remembered at once: a page shows one, and a device has few.
const LEASES_KEPT = 64;
const ID_MAX = 200;

export const createStandInLeases = ({ now = () => Date.now(), leaseMs = STAND_IN_LEASE_MS } = {}) => {
  const leases = new Map(); // game id → when its page last said it holds it
  const fresh = (at) => now() - at < leaseMs;
  const prune = () => {
    for (const [id, at] of leases) if (!fresh(at)) leases.delete(id);
    while (leases.size > LEASES_KEPT) leases.delete(leases.keys().next().value);
  };
  return {
    // A page says it holds this stand-in. False for no id worth keeping.
    touch(gameId) {
      const id = String(gameId ?? "").trim();
      if (!id || id.length > ID_MAX) return false;
      leases.delete(id);
      leases.set(id, now());
      prune();
      return true;
    },
    // The page let it go (its shared game closed).
    release(gameId) {
      leases.delete(String(gameId ?? "").trim());
    },
    // The stand-ins some page holds now, by game id.
    held() {
      prune();
      return [...leases.keys()];
    },
  };
};

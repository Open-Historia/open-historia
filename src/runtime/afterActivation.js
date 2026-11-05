/*! Open Historia — work that outlives the UI a game activation remounts © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// App keys the whole UI on the active game (src/App.jsx), so a flow that
// activates a game (a new game from the picker, a clone, Workshop Apply & Play)
// is awaited by a component that is unmounted before the await returns. Its
// state setters then go nowhere: the Apply & Play country picker never showed,
// the new game's editor never opened, and an error after the activation was
// never seen. The flow leaves the rest here instead, naming the game it is for,
// and the component mounted for that game takes it.
export const createActivationHandOff = () => {
  let work = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    // Leave `{ gameId, ... }` for the UI of game `gameId`; replaces anything left before.
    put(next) {
      work = next ?? null;
      notify();
    },
    // What was left for `gameId`, handed over once; null for any other game.
    take(gameId) {
      if (!work || !gameId || work.gameId !== gameId) return null;
      const taken = work;
      work = null;
      notify();
      return taken;
    },
    get: () => work,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

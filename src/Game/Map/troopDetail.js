/*! Open Historia — when the map shows every troop © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// On the map at large a troop has its counter only from close in
// (FrontLayers.jsx): hundreds of them seen from further off are a swarm that
// hides the map. Some of what is on the screen is for looking at the war,
// though, and wants every troop there from far off. The war room is one, and
// says so through its own store. The Events panel is another: a player reads
// there what happened, and looks at the map to see where.
//
// Whoever wants every troop shown says so here under a name of its own, and
// says when it no longer does. They are shown while anybody wants them.
// Nothing here is saved.

import { useSyncExternalStore } from "react";

const askers = new Set();
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const everyTroopShown = () => askers.size > 0;

// `who` wants every troop shown (on), or no longer does. The same asker
// saying the same thing twice changes nothing.
export const showEveryTroop = (who, on) => {
  const name = String(who ?? "").trim();
  if (!name || askers.has(name) === Boolean(on)) return;
  const before = everyTroopShown();
  if (on) askers.add(name);
  else askers.delete(name);
  if (everyTroopShown() !== before) for (const listener of [...listeners]) listener();
};

export const useEveryTroopShown = () => useSyncExternalStore(subscribe, everyTroopShown, everyTroopShown);

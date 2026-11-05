/*! Open Historia — the land war a skip fought before its story, for the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A skip fights its period's land war BEFORE its story is asked for
// (frontApply.js forecastTurnFronts), so the battlefields as the period leaves
// them, with every day of their fighting, are known while the story is still
// being written. The reveal of a turn being written (GameUI/time.jsx) plays
// them at each event as it arrives, as it plays the landed turn's: "in the
// first event after a new time skip, units seem to disappear from the
// battlefield and even when they dont, they dont move until like 4-5 more
// events pass and then it all moves at once" (the owner, 2026-10-14), which is
// what the map did while it had only the battlefields as the last turn left
// them to show.
//
// One value, the last skip's: { fromDate, toDate, battlefields } or null.

let foreseen = null;
const listeners = new Set();

// Kept by the skip as the period is fought (and fought again with an order of a player's action): null when it
// fought nothing.
export const foreseeFronts = (value) => {
  foreseen = value && Array.isArray(value.battlefields) && value.battlefields.length > 0
    ? { fromDate: String(value.fromDate ?? ""), toDate: String(value.toDate ?? ""), battlefields: value.battlefields }
    : null;
  for (const listener of listeners) listener(foreseen);
};

export const foreseenFronts = () => foreseen;

// Called with the value each time it changes; returns what stops it.
export const onForeseenFronts = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

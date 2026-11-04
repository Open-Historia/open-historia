/*! Open Historia — opening Rostra on a place © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Check in Rostra" on a region card (Selection/Regions.jsx) opens Rostra's
// Search on that country. The place waits here until the panel takes it, so
// the first press of a game, the one that mounts the panel, is not lost.

import { placeFeedPlace } from "../../runtime/placeFeed.js";

let waiting = null;
const listeners = new Set();

export const openRostraPlace = (raw) => {
  const place = placeFeedPlace(raw);
  if (!place) return;
  waiting = place;
  for (const listener of [...listeners]) listener(place);
};

// The place to show, once: null when none is waiting.
export const takeRostraPlace = () => {
  const place = waiting;
  waiting = null;
  return place;
};

export const onRostraPlace = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/*! Open Historia — the events a map card names © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The unit card names the event that put a formation on the map, and the
// structure card the events that built or changed it. Both resolve event ids
// through this one cache, so the log (events.json, the largest document a game
// has) is read at most once per id asked for, never on a render or a map move.
//
// A read is made only for an id not yet in hand; an id the log does not hold is
// remembered as null, so an event that has aged out of it costs one read, not
// one per selection. A failed read is not an answer: nothing is recorded, and
// the next selection tries again. Only what the cards show is kept (id, title,
// date), not the events themselves.

import { useEffect, useState } from "react";
import { readEventsState } from "../../runtime/gameState.js";

const cache = new Map();

const clean = (value) => String(value ?? "").trim();
const brief = (event) => ({ id: clean(event.id), title: clean(event.title), date: clean(event.date) });

export const clearEventLookup = () => cache.clear();

// The events for these ids, in order, null for one the log does not hold.
// Rejects when the log could not be read.
export const resolveEventsById = async (ids, { readEvents = readEventsState } = {}) => {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(clean).filter(Boolean))];
  if (wanted.some((id) => !cache.has(id))) {
    const events = await readEvents({ force: true });
    for (const event of Array.isArray(events) ? events : []) {
      if (event && clean(event.id)) cache.set(clean(event.id), brief(event));
    }
    for (const id of wanted) if (!cache.has(id)) cache.set(id, null);
  }
  return wanted.map((id) => cache.get(id) ?? null);
};

// The events for these ids, as they resolve: [] until then, and the ones found.
export const useEventsById = (ids) => {
  const key = (Array.isArray(ids) ? ids : []).map(clean).filter(Boolean).join("\n");
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const wanted = key ? key.split("\n") : [];
    // What is in hand at once, and never the previous selection's events.
    setEvents(wanted.map((id) => cache.get(id)).filter(Boolean));
    if (!wanted.length || wanted.every((id) => cache.has(id))) return undefined;
    let cancelled = false;
    resolveEventsById(wanted)
      .then((found) => {
        if (!cancelled) setEvents(found.filter(Boolean));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return events;
};

// Another save's events are another log.
if (typeof window !== "undefined") {
  window.addEventListener("oh:active-game-changed", clearEventLookup);
}

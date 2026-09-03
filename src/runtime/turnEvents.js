/*! Open Historia — turn event assembly © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A turn produces its events in two passes: the simulator's, and then
// espionage's — which cannot run until the first pass has been applied to the
// world, because it reads the intelligence ratings that pass may have changed.
//
// Two things are derived from the finished list: what gets persisted, and the
// id list the turn's history record points at. Both must come from the SAME,
// COMPLETE list. Deriving either one before espionage has appended is how every
// exposure and discovery went missing — the state said an agent was rolled up
// and the timeline had never heard of it.
//
// So both are built here, together, from one array. There is no intermediate
// list for a caller to snapshot too early, which is the only real guard against
// that mistake coming back.

import { normalizeEventEntry } from "./gameState.js";

export const buildTurnEvents = ({
  priorEvents = [],
  freshEvents = [],
  espionageEvents = [],
  round = 0,
} = {}) => {
  const turnEvents = [...freshEvents];

  for (const event of espionageEvents) {
    // Espionage events are narrative only (see resolveEspionage in spycraft.js).
    // Impacts attached here would be appended AFTER the turn's only pass over
    // impacts has run, so they would persist, render and reach the model while
    // changing nothing in the world. Say so rather than dropping them in silence.
    if (event?.impacts && Object.keys(event.impacts).length > 0) {
      console.warn(
        "[ai] espionage event impacts are ignored — route a world change through a generated event instead:",
        event?.title,
      );
    }
    // The position in the list doubles as the id suffix, so several agents
    // resolving in the same round still get distinct ids.
    const entry = normalizeEventEntry(
      { ...event, id: `espionage-${round}-${turnEvents.length}` },
      turnEvents.length,
    );
    // normalizeEventEntry returns null for an entry with nothing to show. Such a
    // one must not leave a dangling id in the turn record either.
    if (entry) turnEvents.push(entry);
  }

  return {
    // The turn's own events, simulator's and espionage's, in order.
    turnEvents,
    // The whole log as it will be persisted.
    nextEvents: [...priorEvents, ...turnEvents],
    // What this turn's history record points at (time.jsx renders a turn from
    // exactly this list).
    eventIds: turnEvents.map((event) => event.id),
  };
};

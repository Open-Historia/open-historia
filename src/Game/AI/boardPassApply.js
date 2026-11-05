/*! Open Historia — applying the board pass's ops, one event at a time © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Projects board pass (gameplay.js applySimulationResult) moves the board
// once for the whole round. Its ops are APPLIED here, one event at a time,
// through the same event path every other impact takes (release of completion
// effects included), so the board the player sees after the write is the one the
// model moved. Only the project ops are replayed: the events' other impacts were
// applied when the world was first impacted, and must not run twice. A Hidden
// event's carrier is never stamped into an entry's activity, which lists
// timeline events only; nor is a fallback, which names no event of its own
// (stampsActivity).
//
// A provisional event is judged on the Board itself, before and after its OWN
// ops: if nothing changed materially, its claim was never recorded, so its ops
// are applied unstamped and the event leaves the timeline (the caller takes it
// out, from unbackedIds).
//
// A Project completing here releases its onComplete effects like any other, and
// those can rename or recolour a polity. The colours and the renames come back
// with the world, so the caller carries them into what the world does not hold
// (the game's own polity, the orders, the chats, the flags, the baked regions);
// keeping only the world left the player's own key behind a rename.

import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import { materiallyChangedEntryIds } from "../../runtime/projects.js";

export const applyBoardCarriers = ({
  world,
  colors,
  carriers = [],
  visibleEvents = [],
  hiddenEvents = [],
  provisionalIndexes = new Set(),
  date = "",
  round = 0,
} = {}) => {
  let nextWorld = world;
  let nextColors = colors;
  const renamedPolities = [];
  const unbackedIds = new Set();
  // A provisional event the board pass left no ops of its own on is unbacked
  // before anything is applied, so not even a fallback op stamps it.
  for (const index of provisionalIndexes) {
    const touched = carriers.some((carrier) => carrier.onTimeline && !carrier.fallback && carrier.eventIndex === index);
    if (!touched && visibleEvents[index]) unbackedIds.add(visibleEvents[index].id);
  }
  const movedByHidden = new Set();
  let hiddenEventsThatMoved = 0;
  const applyCarrier = (before, carrier, event, { stamped }) => applyEventImpactsToWorld({
    colors: nextColors,
    events: [{ id: event.id, date: event.date || date, title: event.title, description: "", impacts: { projectOps: carrier.ops } }],
    world: before,
    motion: null,
    round,
    boardOnlyEventIds: stamped ? [] : [event.id],
  });
  for (const carrier of carriers) {
    const event = carrier.onTimeline ? visibleEvents[carrier.eventIndex] : hiddenEvents[carrier.hiddenIndex];
    if (!event) continue;
    const before = nextWorld;
    const stamped = carrier.stampsActivity && !unbackedIds.has(event.id);
    let after = applyCarrier(before, carrier, event, { stamped });
    const changed = materiallyChangedEntryIds(before.projects, after.world.projects);
    if (carrier.onTimeline && !carrier.fallback && provisionalIndexes.has(carrier.eventIndex) && !changed.length) {
      unbackedIds.add(event.id);
      after = applyCarrier(before, carrier, event, { stamped: false });
    }
    if (!carrier.onTimeline && changed.length) {
      hiddenEventsThatMoved += 1;
      changed.forEach((id) => movedByHidden.add(id));
    }
    nextWorld = after.world;
    nextColors = after.colors;
    renamedPolities.push(...(Array.isArray(after.renamedPolities) ? after.renamedPolities : []));
  }
  return {
    world: nextWorld,
    colors: nextColors,
    renamedPolities,
    unbackedIds,
    movedByHidden,
    hiddenEventsThatMoved,
  };
};

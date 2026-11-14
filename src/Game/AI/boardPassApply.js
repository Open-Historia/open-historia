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
import { normalizeEventPlaces } from "../../runtime/eventPlaces.js";
import { materiallyChangedEntryIds } from "../../runtime/projects.js";

const clean = (value) => String(value ?? "").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// An operation's focus is where on the map it happens: the place the war room
// sends its troops at (runtime/fronts/plans.js operationsOn). A time skip's board
// ops carry none (gameplaySchemas.js FOLDED_PROJECT_OP_OMITS), and the place used
// to be found by reading the operation's name and summary for an enemy city, in
// English only. Where an op that opens or moves an operation gives no focus,
// and the operation has none yet, the event that carries the op says where it
// happens: the first of its places (its `places` field, as found on the map,
// runtime/eventPlaces.js) that is a point. Nothing is read from its words.
const placePointOf = (event) => {
  const place = normalizeEventPlaces(event?.places).find((entry) => Number.isFinite(entry.lng) && Number.isFinite(entry.lat));
  return place ? { lng: place.lng, lat: place.lat } : null;
};
export const withEventFocus = (ops, event, projects = []) => {
  const point = placePointOf(event);
  if (!point) return ops;
  const entryOf = (op) => (Array.isArray(projects) ? projects : []).find((entry) => (clean(op.projectId) && clean(entry?.id) === clean(op.projectId))
    || (!clean(op.projectId) && clean(entry?.name).toLowerCase() === clean(op.name ?? op.project?.name).toLowerCase()));
  return (Array.isArray(ops) ? ops : []).map((op) => {
    if (!isRecord(op)) return op;
    const kind = clean(op.op).toLowerCase();
    // Where the op's own fields are: a nested create's are its `project`, an update's its `patch` or `project`.
    const body = kind === "create" ? (isRecord(op.project) ? op.project : op) : (isRecord(op.patch) ? op.patch : isRecord(op.project) ? op.project : op);
    if (body.focus) return op;
    const operation = kind === "create"
      ? clean(body.kind).toLowerCase() === "operation"
      : kind === "update" && entryOf(op)?.kind === "operation" && !entryOf(op)?.focus;
    if (!operation) return op;
    return body === op ? { ...op, focus: point } : { ...op, [body === op.project ? "project" : "patch"]: { ...body, focus: point } };
  });
};

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
    // A fallback rides on an event it did not come from, whose places are not its.
    events: [{ id: event.id, date: event.date || date, title: event.title, description: "", impacts: { projectOps: carrier.fallback ? carrier.ops : withEventFocus(carrier.ops, event, before?.projects) } }],
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

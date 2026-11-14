/*! Open Historia — which ledger records go with a dropped event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Ledger records (wars, relations, agreements, puppets, storylines) reference the
// events that caused them by id. When a post-processor drops an event — the
// integrity screen on a segment, the curator on the round — every record bound
// only to it goes too; a record bound to no event at all (a baseline row) stays.
// Import-free, so node tests can drive it.

const clean = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Every string anywhere in the record that IS one of the known event ids —
// eventIds, eventId, sourceEventIds, the same fields on a nested entry. Whole
// values only: a substring search found "segment-1-event-1" inside
// "segment-1-event-12", so a war opened by a dropped event 12 survived on the
// strength of a kept event 1, with no founding event on the timeline.
const referencedEventIds = (record, knownIds, found = new Set(), depth = 0) => {
  if (depth > 6 || record == null) return found;
  if (typeof record === "string") {
    const id = clean(record);
    if (knownIds.has(id)) found.add(id);
    return found;
  }
  if (typeof record !== "object") return found;
  for (const value of Array.isArray(record) ? record : Object.values(record)) {
    referencedEventIds(value, knownIds, found, depth + 1);
  }
  return found;
};

// War records are not their events' to lose. A war record is the war's state:
// when the events it was tied to are dropped (the integrity screen, the
// curator), it stays, tied to those of its events still kept, and dated by the
// first dropped one where none is kept (baselineDate, which the ledger reads
// for a record no event dates). It used to go with its event, and a war whose
// opening event the curator took for a duplicate never began, while its joins
// were refused and its battles kept a war id no war held.
export const keepWarRecordsBeyondEvents = (updates, allEvents, keptEvents) => {
  const allById = new Map(asArray(allEvents).map((event) => [clean(event?.id), event]).filter(([id]) => id));
  const keptIds = new Set(asArray(keptEvents).map((event) => clean(event?.id)).filter(Boolean));
  return asArray(updates).map((update) => {
    if (!update || typeof update !== "object" || Array.isArray(update)) return update;
    const ids = asArray(update.eventIds).map(clean).filter(Boolean);
    if (!ids.length || ids.every((id) => keptIds.has(id))) return update;
    const kept = ids.filter((id) => keptIds.has(id));
    const date = kept.length ? "" : ids.map((id) => clean(allById.get(id)?.date)).find(Boolean) || "";
    return {
      ...update,
      eventIds: kept,
      eventIndexes: [],
      ...(date && !clean(update.baselineDate) ? { baselineDate: date } : {}),
    };
  });
};

export const filterBoundLedgerUpdatesToKeptEvents = (updates, allEvents, keptEvents) => {
  const allIds = new Set(asArray(allEvents).map((event) => clean(event?.id)).filter(Boolean));
  const keptIds = new Set(asArray(keptEvents).map((event) => clean(event?.id)).filter(Boolean));

  return asArray(updates).filter((update) => {
    const referenced = [...referencedEventIds(update ?? {}, allIds)];
    if (!referenced.length) return true;
    return referenced.some((id) => keptIds.has(id));
  });
};

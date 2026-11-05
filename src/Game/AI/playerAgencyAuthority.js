const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();


const activeCanonicalStorylineIds = (world = {}) => {
  const ids = new Set();
  for (const storyline of Array.isArray(world?.storylines) ? world.storylines : []) {
    const id = clean(storyline?.id);
    if (!id) continue;
    const status = clean(storyline?.status).toLowerCase();
    if (status === "resolved") continue;
    ids.add(id);
  }
  return ids;
};

// Native provenance repair for an already-established event <-> storyline binding.
//
// The model may correctly classify an event as a consequence of an existing
// canonical process but omit the opaque process id from agency.authorityRef.
// Once native storyline bookkeeping has established exactly one existing
// storyline as the event's process, JS can safely carry that id into the
// structural authority record. This does NOT infer causality from prose, create
// a new process, or authorize fresh sovereign discretion. Ambiguous/unbound
// cases remain untouched so the normal authority validator can reject them.
export const propagateCanonicalProcessAuthorityRefs = (candidate, {
  world = {},
  includeStorylineUpdates = true,
} = {}) => {
  if (!candidate || typeof candidate !== "object") {
    return { applied: 0, bindings: [], ambiguous: [] };
  }

  const events = Array.isArray(candidate.events) ? candidate.events : [];
  if (!events.length) return { applied: 0, bindings: [], ambiguous: [] };

  const existingStorylineIds = activeCanonicalStorylineIds(world);
  if (!existingStorylineIds.size) {
    return { applied: 0, bindings: [], ambiguous: [] };
  }

  const linkedByEventIndex = new Map();
  const addLinked = (eventIndex, storylineId) => {
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= events.length) return;
    const id = clean(storylineId);
    if (!id || !existingStorylineIds.has(id)) return;
    if (!linkedByEventIndex.has(eventIndex)) linkedByEventIndex.set(eventIndex, new Set());
    linkedByEventIndex.get(eventIndex).add(id);
  };

  // Normalized storyline updates are native bookkeeping evidence. A single
  // existing update may legitimately point at several events; each event still
  // receives only that one process id.
  if (includeStorylineUpdates) {
    for (const update of Array.isArray(candidate.storylineUpdates) ? candidate.storylineUpdates : []) {
      const storylineId = clean(update?.id);
      if (!existingStorylineIds.has(storylineId)) continue;
      for (const value of Array.isArray(update?.eventIndexes) ? update.eventIndexes : []) {
        const eventIndex = Number(value);
        if (Number.isInteger(eventIndex)) addLinked(eventIndex, storylineId);
      }
    }
  }

  let applied = 0;
  const bindings = [];
  const ambiguous = [];

  candidate.events = events.map((event, eventIndex) => {
    if (!event || typeof event !== "object") return event;
    const agency = event?.agency;
    if (!agency || typeof agency !== "object" || Array.isArray(agency)) return event;
    if (clean(agency.authority).toLowerCase() !== "canonical-process") return event;
    if (clean(agency.authorityRef)) return event;

    // canonical-process is only valid for an already-authorized consequence.
    // Do not help an invalid payload that is still exercising sovereign choice;
    // the authority validator must continue to reject that case.
    if (clean(agency.sovereignPolity)) return event;
    if (Array.isArray(agency.sovereignActors) && agency.sovereignActors.length) return event;

    const candidates = new Set(linkedByEventIndex.get(eventIndex) || []);
    for (const storylineId of Array.isArray(event?.storylineIds) ? event.storylineIds : []) {
      const id = clean(storylineId);
      if (existingStorylineIds.has(id)) candidates.add(id);
    }

    if (candidates.size !== 1) {
      if (candidates.size > 1) {
        ambiguous.push({
          eventIndex,
          eventId: clean(event?.id),
          storylineIds: [...candidates].sort(),
        });
      }
      return event;
    }

    const authorityRef = [...candidates][0];
    applied += 1;
    bindings.push({
      eventIndex,
      eventId: clean(event?.id),
      authorityRef,
    });

    return {
      ...event,
      agency: {
        ...agency,
        authorityRef,
      },
    };
  });

  return { applied, bindings, ambiguous };
};

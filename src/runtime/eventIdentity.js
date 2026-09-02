/*! Open Historia — canonical timeline event identity helpers. */

const norm = (value) => String(value ?? "").trim();

const dateToken = (value) => {
  const compact = norm(value).replace(/[^0-9]/g, "");
  return compact || "undated";
};

const roundToken = (value) => {
  const round = Math.max(0, Math.trunc(Number(value) || 0));
  return String(round).padStart(4, "0");
};

const sequenceToken = (value) => String(Math.max(1, Math.trunc(Number(value) || 1))).padStart(3, "0");

export const duplicateEventIds = (events) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const id = norm(event?.id);
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return [...duplicates];
};

// Allocate canonical ids ONLY for newly generated events. Existing history is never
// rewritten here: old saves may contain duplicate legacy ids that already appear in
// storyline/history references, and blindly renaming those records would be ambiguous.
// New AI events instead get ids that are unique across ordinary turn commits because
// the canonical round increases once per committed turn and each event has a unique
// sequence inside that turn.
export const allocateCanonicalTurnEventIds = ({
  existingEvents = [],
  newEvents = [],
  round = 0,
} = {}) => {
  const used = new Set(
    (Array.isArray(existingEvents) ? existingEvents : [])
      .map((event) => norm(event?.id))
      .filter(Boolean),
  );

  const idMap = new Map();
  let sequence = 0;
  const events = (Array.isArray(newEvents) ? newEvents : []).map((event) => {
    sequence += 1;
    const previousId = norm(event?.id);
    const token = dateToken(event?.date);
    let candidate = `event-ai-r${roundToken(round)}-${token}-${sequenceToken(sequence)}`;
    while (used.has(candidate)) {
      sequence += 1;
      candidate = `event-ai-r${roundToken(round)}-${token}-${sequenceToken(sequence)}`;
    }
    used.add(candidate);
    if (previousId && !idMap.has(previousId)) idMap.set(previousId, candidate);
    return {
      ...(event && typeof event === "object" ? event : {}),
      id: candidate,
    };
  });

  return { events, idMap };
};

export const remapLedgerEventIds = (updates, idMap) => {
  if (!(idMap instanceof Map) || idMap.size === 0) {
    return Array.isArray(updates) ? updates : [];
  }
  return (Array.isArray(updates) ? updates : []).map((update) => ({
    ...(update && typeof update === "object" ? update : {}),
    eventIds: [...new Set(
      (Array.isArray(update?.eventIds) ? update.eventIds : [])
        .map((value) => idMap.get(norm(value)) || norm(value))
        .filter(Boolean),
    )].slice(0, 24),
  }));
};

/*! Open Historia — a time skip's answer read for what it means © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A model often writes the right change in the wrong place: an event's map
// change (regionTransfers) or a country's (polityChanges) on the event itself
// instead of in its impacts, a puppet, war, relation or agreement record on the
// event instead of in the answer's ledger of them. The schema check knew only
// that the field was "not allowed" there, and the salvage cut it out
// (schemaSalvage.js): "Scripted events don't work at all or have any effect,
// Geopolitical events don't happen anymore" (a player's report, 2026-11-03):
// the United States took Maduro, Venezuela became its client state, Yemen
// conquered the south and Syria made peace, every one of them told, and every
// change that carried them out thrown away for where it stood.
//
// Each is put where it belongs before the answer is checked, as the game
// understands the Game Master's intent (gameMasterWars.js) rather than refusing
// its syntax: an impact into the event's impacts, beside any written there; a
// ledger record into the answer's ledger, bound to the event it was written on.
// Nothing is invented and nothing is dropped here; what is still wrong after it
// is the check's and the salvage's as before.
//
// Pure, and loads in plain Node.

// An event's impacts (gameplaySchemas.js impactsSchema and the folded skip's projectOps).
export const EVENT_IMPACT_KEYS = Object.freeze([
  "actionIds", "createdChats", "polityChanges", "politicalActorOps", "partyOps", "regionTransfers", "regionControlOps",
  "unitOps", "markerOps", "spyOps", "institutionLifecycleOps", "reports", "regionClaims", "groupOps", "projectOps",
]);
// The answer's ledgers whose readers take a record as a line or an object (nativeWarLedger.js
// decodeWarUpdates, nativeDiplomaticDirector.js, nativeWorldDirector.js decodeWorldStorylineUpdates,
// peaceTerms.js readTreatyLines).
export const ANSWER_LEDGER_KEYS = Object.freeze([
  "warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates", "storylineUpdates", "peaceTreaties",
]);

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const asList = (value) => (Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value]);
const linesOf = (value) => (typeof value === "string" ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : asList(value));

// { payload, moved: [{ event, field, to }] }: the answer with every misplaced part where it belongs (a new object
// where anything moved; the same one where nothing did).
export const reshelveJumpAnswer = (payload) => {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return { payload, moved: [] };
  const moved = [];
  const ledgers = {};
  const events = payload.events.map((event, index) => {
    if (!isRecord(event)) return event;
    const misplaced = [...EVENT_IMPACT_KEYS, ...ANSWER_LEDGER_KEYS].filter((key) => event[key] !== undefined);
    if (misplaced.length === 0) return event;
    const next = { ...event };
    const impacts = isRecord(event.impacts) ? { ...event.impacts } : {};
    for (const key of misplaced) {
      const value = next[key];
      delete next[key];
      if (EVENT_IMPACT_KEYS.includes(key)) {
        const entries = asList(value);
        if (entries.length === 0) continue;
        impacts[key] = [...asList(impacts[key]), ...entries];
        moved.push({ event: index, field: key, to: `impacts.${key}` });
        continue;
      }
      // A ledger record: a line as it was written, an object bound to this event where it names none.
      const records = linesOf(value).map((record) => (isRecord(record) && !asList(record.eventIndexes).length && !asList(record.eventIds).length
        ? { ...record, ...(event.id ? { eventIds: [event.id] } : { eventIndexes: [index] }) }
        : record));
      if (records.length === 0) continue;
      ledgers[key] = [...(ledgers[key] ?? []), ...records];
      moved.push({ event: index, field: key, to: key });
    }
    if (Object.keys(impacts).length > 0) next.impacts = impacts;
    return next;
  });
  if (moved.length === 0) return { payload, moved };
  const next = { ...payload, events };
  for (const [key, records] of Object.entries(ledgers)) {
    const all = [...linesOf(payload[key]), ...records];
    // Lines stay the one text the field always was; a record written as an object makes it a list.
    next[key] = all.every((record) => typeof record === "string") ? all.join("\n") : all;
  }
  return { payload: next, moved };
};

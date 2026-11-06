/*! Open Historia — a time skip's answer read for what it means © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A model often writes the right change in the wrong place: an event's map
// change (regionTransfers) or a country's (polityChanges) on the event itself
// instead of in its impacts, a puppet, war, relation or agreement record on the
// event, or inside its impacts, instead of in the answer's ledger of them. The
// schema check knew only that the field was "not allowed" there, and the
// salvage cut it out (schemaSalvage.js): "Scripted events don't work at all or
// have any effect, Geopolitical events don't happen anymore" (a player's
// report, 2026-11-03): the United States took Maduro, Venezuela became its
// client state, Yemen conquered the south and Syria made peace, every one of
// them told, and every change that carried them out thrown away for where it
// stood. Replayed live, a model that is not held to the schema (an Ollama
// model, a Gemini answer written as JSON text) put the client state and the
// war of the author's scripted events inside an event's impacts in four
// answers out of four, on the release before that report as on its own.
//
// Each is put where it belongs before the answer is checked, as the game
// understands the Game Master's intent (gameMasterWars.js) rather than refusing
// its syntax: an impact into the event's impacts, beside any written there; a
// ledger record into the answer's ledger, bound to the event it was written on.
//
// And a ledger line that names its events by something other than their
// numbers (a date, an event's id, an order's id: three live answers in four did)
// is given the numbers they stand for, where exactly one event is meant: a
// record tied to no event cannot be told apart from bookkeeping, and the
// ledgers drop it (nativeDiplomaticDirector.js "no unique causal event").
// Nothing is invented and nothing is dropped here; what is still wrong after it
// is the check's and the salvage's as before.
//
// Pure, and loads in plain Node.

// An event's impacts (gameplaySchemas.js impactsSchema and the folded skip's projectOps).
export const EVENT_IMPACT_KEYS = Object.freeze([
  "actionIds", "createdChats", "polityChanges", "politicalActorOps", "regionTransfers", "regionControlOps",
  "unitOps", "markerOps", "spyOps", "institutionLifecycleOps", "reports", "regionClaims", "regionRenames", "groupOps", "projectOps",
]);
// The answer's ledgers whose readers take a record as a line or an object (nativeWarLedger.js
// decodeWarUpdates, nativeDiplomaticDirector.js, nativeWorldDirector.js decodeWorldStorylineUpdates,
// peaceTerms.js readTreatyLines).
export const ANSWER_LEDGER_KEYS = Object.freeze([
  "warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates", "storylineUpdates", "peaceTreaties",
]);
// The field of a ledger's line (split on ~, from 0) that names the events it rides on, as its reader
// takes it: warId~op~actors~opponents~EVENTS~note, A~B~score~status~EVENTS~summary,
// id~op~type~parties~EVENTS~title~terms, op~overlord~puppet~kind~loyalty~secrecy~EVENTS~note,
// id~status~pressure~momentum~started~kind~title~participants~EVENTS~state. A peace line names none.
export const LEDGER_EVENT_FIELD = Object.freeze({
  warUpdates: 4, relationUpdates: 4, agreementUpdates: 4, puppetUpdates: 6, storylineUpdates: 8,
});
// Names a model made up for the same ledgers, after the impacts' own *Ops (Gemma 4 31B wrote the author's client
// state as impacts.puppetOps, 2026-11-03).
export const LEDGER_ALIASES = Object.freeze({
  warOps: "warUpdates", relationOps: "relationUpdates", agreementOps: "agreementUpdates", puppetOps: "puppetUpdates", storylineOps: "storylineUpdates",
});
const LEDGER_NAMES = [...ANSWER_LEDGER_KEYS, ...Object.keys(LEDGER_ALIASES)];
const ledgerOf = (name) => LEDGER_ALIASES[name] ?? name;

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const asList = (value) => (Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value]);
const linesOf = (value) => (typeof value === "string" ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : asList(value));
const text = (value) => String(value ?? "").trim();

// The event numbers (from 1) a line's event field stands for: numbers as they are, and a date, an event id or
// an order id as the one event it names. [] where nothing in it names exactly one event.
const numbersMeant = (field, events) => {
  const numbers = [];
  for (const ref of text(field).split(/[,;\s]+/).filter(Boolean)) {
    if (/^\d+$/.test(ref)) {
      const number = Number(ref);
      if (number >= 1 && number <= events.length) numbers.push(number);
      continue;
    }
    const matches = events
      .map((event, index) => ({ event: isRecord(event) ? event : {}, number: index + 1 }))
      .filter(({ event }) => text(event.date) === ref || text(event.id) === ref
        || asList(event.impacts?.actionIds).some((id) => text(id) === ref));
    if (matches.length === 1) numbers.push(matches[0].number);
  }
  return [...new Set(numbers)];
};
const allNumbers = (field) => text(field) !== "" && text(field).split(/[,;\s]+/).filter(Boolean).every((ref) => /^\d+$/.test(ref));

// A ledger line with its event field naming event numbers: what it names by date or id where that is one
// event, and `fallback` (the event it was written on) where it names nothing. Any other line as it was.
const withEventNumbers = (line, key, events, fallback = []) => {
  if (typeof line !== "string" || LEDGER_EVENT_FIELD[key] === undefined) return line;
  const parts = line.split("~");
  // relationUpdates also comes as relation-update-0~A~B~…, one field further on.
  const at = LEDGER_EVENT_FIELD[key] + (key === "relationUpdates" && /^relation-update-\d+$/i.test(text(parts[0])) ? 1 : 0);
  if (parts.length <= at || allNumbers(parts[at])) return line;
  const meant = numbersMeant(parts[at], events);
  const numbers = meant.length ? meant : fallback;
  if (!numbers.length) return line;
  parts[at] = numbers.join(",");
  return parts.join("~");
};

// { payload, moved: [{ event, field, to }] }: the answer with every misplaced part where it belongs (a new object
// where anything moved; the same one where nothing did).
export const reshelveJumpAnswer = (payload) => {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return { payload, moved: [] };
  const moved = [];
  const ledgers = {};
  const lifted = (key, value, event, index) => {
    // A ledger record: a line as it was written, citing this event where it cites none; an object bound to
    // this event where it names none.
    const records = linesOf(value).map((record) => {
      if (typeof record === "string") return withEventNumbers(record, key, payload.events, [index + 1]);
      return isRecord(record) && !asList(record.eventIndexes).length && !asList(record.eventIds).length
        ? { ...record, ...(event.id ? { eventIds: [event.id] } : { eventIndexes: [index] }) }
        : record;
    });
    if (records.length === 0) return false;
    ledgers[key] = [...(ledgers[key] ?? []), ...records];
    return true;
  };
  const events = payload.events.map((event, index) => {
    if (!isRecord(event)) return event;
    const misplaced = [...EVENT_IMPACT_KEYS, ...LEDGER_NAMES].filter((key) => event[key] !== undefined);
    const inImpacts = isRecord(event.impacts) ? LEDGER_NAMES.filter((key) => event.impacts[key] !== undefined) : [];
    if (misplaced.length === 0 && inImpacts.length === 0) return event;
    const next = { ...event };
    const impacts = isRecord(event.impacts) ? { ...event.impacts } : {};
    for (const key of inImpacts) {
      const value = impacts[key];
      delete impacts[key];
      if (lifted(ledgerOf(key), value, event, index)) moved.push({ event: index, field: `impacts.${key}`, to: ledgerOf(key) });
    }
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
      if (lifted(ledgerOf(key), value, event, index)) moved.push({ event: index, field: key, to: ledgerOf(key) });
    }
    if (Object.keys(impacts).length > 0 || isRecord(event.impacts)) next.impacts = impacts;
    return next;
  });
  const next = { ...payload, events };
  let changed = moved.length > 0;
  // A made-up ledger name at the answer's top level is its ledger too.
  const aliased = {};
  for (const [alias, key] of Object.entries(LEDGER_ALIASES)) {
    if (payload[alias] === undefined) continue;
    delete next[alias];
    changed = true;
    aliased[key] = [...(aliased[key] ?? []), ...linesOf(payload[alias])];
    moved.push({ event: null, field: alias, to: key });
  }
  for (const key of ANSWER_LEDGER_KEYS) {
    const written = [...linesOf(payload[key]), ...(aliased[key] ?? [])];
    // The answer's own lines, each naming its events by number where it named them some other way.
    const own = written.map((record) => withEventNumbers(record, key, events));
    own.forEach((record, index) => {
      if (record !== written[index]) moved.push({ event: null, field: key, to: `${key} (event numbers)` });
    });
    const all = [...own, ...(ledgers[key] ?? [])];
    if (!ledgers[key] && !aliased[key] && own.every((record, index) => record === written[index])) continue;
    changed = true;
    // Lines stay the one text the field always was; a record written as an object makes it a list.
    next[key] = all.every((record) => typeof record === "string") ? all.join("\n") : all;
  }
  return changed ? { payload: next, moved } : { payload, moved: [] };
};

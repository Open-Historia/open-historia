/*! Open Historia — a skip's ledger records tied to the events they name, before the events move © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every ledger of a time skip's answer names its events by their place in the
// answer as the model wrote it ("1" is the first event written): the war,
// relation, agreement and puppet records, the storyline records and the
// battlefields' orders alike. Before any of them is read, the engine puts the
// events in date order (runtime/timelineOrder.js) and writes in the author's
// scripted events the answer left out (scriptedEventImpacts.js), and a place
// read after that is another event's: a probe stamped a war's id and sides
// onto a flood, and a revolt onto a treaty signed the same month.
//
// So each record is tied to its events by id first, while the places still
// mean what the model meant, and its places are then spent: a record is never
// read by a place it was written with against a list that has since moved
// (the war ledger's rule, nativeWarLedger.js linkedEventsForUpdate, and what
// eventIdentity.js remapLedgerEventIds does once a round's ids are minted). A
// number that names no event of the answer ties the record to none, as a
// record that named none: each ledger's own repair for such a record stands.
//
// politicalClaims is not among them: it is tied to the event objects
// themselves before the sort (politicalImpactCompleteness.js
// preparePoliticalClaimContext).
//
// Loads in plain Node.

import { bindWarUpdatesToEvents, warUpdateProseLines } from "./nativeWarLedger.js";
import { bindAgreementUpdatesToEvents, bindPuppetUpdatesToEvents, bindRelationUpdatesToEvents } from "./nativeDiplomaticDirector.js";
import { FRONT_ORDERS_FIELD, bindFrontOrdersToEvents, frontOrderProseLines } from "./nativeFrontLedger.js";
import { bindWorldStorylineUpdatesToEvents } from "./nativeWorldDirector.js";

const clean = (value) => String(value ?? "").trim();

// Each ledger and the binder its readers already use. Every record is read
// here: how many one answer may hold is each ledger's to say, where it always
// has (settleWarLedger says it of wars).
const LEDGERS = Object.freeze([
  ["warUpdates", bindWarUpdatesToEvents],
  ["relationUpdates", bindRelationUpdatesToEvents],
  ["agreementUpdates", bindAgreementUpdatesToEvents],
  ["puppetUpdates", bindPuppetUpdatesToEvents],
  [FRONT_ORDERS_FIELD, bindFrontOrdersToEvents],
  ["storylineUpdates", bindWorldStorylineUpdatesToEvents],
]);

const written = (value) => (Array.isArray(value) ? value.length > 0 : clean(value) !== "");

// The segment's temporary id for every event without one, by its place in the
// list (segment-N-event-M: the round's own ids are minted once the whole skip
// is in hand, and the records follow them), and never an id another event
// has. An event the engine adds after the answer's (a scripted one) is named
// by its place after them; two events under one id were one event to every
// record tied to it, and to the round's ids.
export const giveSegmentEventIds = (events, segmentIndex = 0) => {
  const list = Array.isArray(events) ? events : [];
  const taken = new Set(list.map((event) => clean(event?.id)).filter(Boolean));
  list.forEach((event, index) => {
    if (!event || typeof event !== "object" || clean(event.id)) return;
    const name = `segment-${segmentIndex + 1}-event-${index + 1}`;
    let id = name;
    for (let again = 2; taken.has(id); again += 1) id = `${name}-${again}`;
    taken.add(id);
    event.id = id;
  });
  return list;
};

// The answer's events given their ids and every ledger tied to them, in place.
// A ledger leaves as its records, each with the ids of the events it named and
// no places; one with nothing written is left as it was. Prose where records
// go (a heading, "No changes.") is no record: it is handed back to be said
// once, and dropped.
export const pinLedgersToEvents = (candidate, { segmentIndex = 0 } = {}) => {
  const prose = { warProse: [], frontProse: [] };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return prose;
  const events = giveSegmentEventIds(candidate.events, segmentIndex);
  prose.warProse = warUpdateProseLines(candidate.warUpdates);
  prose.frontProse = frontOrderProseLines(candidate[FRONT_ORDERS_FIELD]);
  for (const [key, bind] of LEDGERS) {
    if (!written(candidate[key])) continue;
    candidate[key] = bind(candidate[key], events, { limit: Infinity })
      .map((record) => ({ ...record, eventIndexes: [] }));
  }
  return prose;
};

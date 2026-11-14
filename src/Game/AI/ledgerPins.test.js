/*! Open Historia — a skip's ledger records stay on the events they name: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/ledgerPins.test.js
//
// gameplay.js cannot be imported without the whole app, so this walks the
// time skip's segment path with the pieces it calls, in its order: the
// ledgers tied to their events (ledgerPins.js), the sort, the author's
// scripted events, the ledgers' checks and binding (validateSegmentLedgers),
// the battlefields' screen (screenSegmentFrontOrders) and the storylines'
// links (validateSegmentStorylines). Its wiring is read as source, last.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { giveSegmentEventIds, pinLedgersToEvents } from "./ledgerPins.js";
import { sortTimelineEventsChronologically } from "../../runtime/timelineOrder.js";
import { allocateCanonicalTurnEventIds, remapLedgerEventIds } from "../../runtime/eventIdentity.js";
import { ensureScriptedEventsWithImpacts } from "./scriptedEventImpacts.js";
import { applyWarUpdates, bindWarUpdatesToEvents, decodeWarUpdates, settleWarLedger } from "./nativeWarLedger.js";
import {
  bindAgreementUpdatesToEvents,
  bindPuppetUpdatesToEvents,
  bindRelationUpdatesToEvents,
  decodeAgreementUpdates,
  decodePuppetUpdates,
  decodeRelationUpdates,
  salvageDiplomaticLedgerPayload,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import { bindFrontOrdersToEvents, screenFrontOrders } from "./nativeFrontLedger.js";
import { normalizeWorldStorylineEventLinks, validateWorldEventConsequencePayload } from "./nativeWorldDirector.js";

const world = {
  polityOverrides: Object.fromEntries(["France", "Russia", "Germany", "Serbia", "Belgium"].map((name) => [name, { code: name, name }])),
  regionOwnershipOverrides: { r1: "France", r2: "Russia", r3: "Germany", r4: "Serbia", r5: "Belgium" },
  relations: [],
  agreements: [],
  wars: [],
  puppets: [{
    id: "puppet-germany-serbia", overlord: "Germany", puppet: "Serbia", kind: "client", loyalty: 30, secrecy: "open",
    knownTo: [], status: "active", startedDate: "1900-01-01", endedDate: "", lastUpdatedDate: "1900-01-01", sourceEventIds: [],
  }],
};

const BREAK = "Serbia breaks with Berlin";
const FLOOD = "Spring floods in Serbia";
const CONVENTION = "France and Russia sign a naval convention";
const INVASION = "German troops cross into Belgium";

// Written as a model writes a month: not in date order. Every ledger names its
// events by their place in it (1 is the break, 3 the convention, 4 the invasion).
const answer = () => ({
  events: [
    { date: "1914-03-10", title: BREAK, description: "Belgrade expels the German advisers.", kind: "diplomacy" },
    { date: "1914-03-02", title: FLOOD, description: "The Danube bursts its banks near Belgrade.", kind: "world" },
    { date: "1914-03-20", title: CONVENTION, description: "Paris and St Petersburg agree to coordinate their fleets.", kind: "diplomacy" },
    { date: "1914-03-15", title: INVASION, description: "The German army marches on Liège.", kind: "military", warId: "war-germany-belgium-1914", combatants: ["Germany", "Belgium"] },
  ],
  warUpdates: "war-germany-belgium-1914~start~Germany~Belgium~4~Title: The Belgian War; the invasion",
  relationUpdates: "France~Russia~70~friendly~3~Naval convention",
  agreementUpdates: "fr-ru-naval~start~military_cooperation~France,Russia~3~Naval Convention~The fleets coordinate",
  puppetUpdates: "revolt~Germany~Serbia~~~~1~Belgrade throws off Berlin",
  frontOrders: "Belgian Front~Germany~advance~all~4~city: Liège~~major",
  // Its words match both Serbian events equally, so the number it was written
  // with is what ties it (normalizeWorldStorylineEventLinks).
  storylineUpdates: "storyline-balkan-quarrel~active~60~50~1914-03-10~crisis~Balkan quarrel~Serbia~1~The quarrel is open",
});

// An author's scripted event the answer left out, dated before all of them.
const REICHSTAG = "The Kaiser opens the Reichstag";
const reichstag = { date: "1914-03-01", title: REICHSTAG, text: "Wilhelm II opens the new session.", textMode: "inspired" };

// The segment path, step by step. `pin: false` reads the numbers after the
// sort, as every ledger but the war's was read before ledgerPins.js.
const runSegment = (candidate, { pin = true, beats = [] } = {}) => {
  if (pin) pinLedgersToEvents(candidate, { segmentIndex: 0 });
  sortTimelineEventsChronologically(candidate);
  if (beats.length) {
    const scripted = ensureScriptedEventsWithImpacts(candidate.events, beats);
    candidate.events = scripted.events;
    if (pin) giveSegmentEventIds(candidate.events, 0);
    sortTimelineEventsChronologically(candidate);
  }
  // validateSegmentLedgers
  if (pin) giveSegmentEventIds(candidate.events, 0);
  else candidate.events.forEach((event, index) => { if (!event.id) event.id = `segment-1-event-${index + 1}`; });
  settleWarLedger(candidate, { world, authority: "skip" });
  salvageDiplomaticLedgerPayload(candidate, { world });
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), "");
  const { events } = candidate;
  candidate.warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(candidate.warUpdates), events);
  candidate.relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), events);
  candidate.puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(candidate.puppetUpdates), events);
  candidate.agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), events);
  // screenSegmentFrontOrders
  candidate.frontOrders = screenFrontOrders(bindFrontOrdersToEvents(candidate.frontOrders, events), { events }).kept;
  // validateSegmentStorylines, first of all
  normalizeWorldStorylineEventLinks(candidate, { world });
  return candidate;
};

// The titles of the events each record of a ledger is tied to.
const tiedTo = (candidate) => {
  const titleOf = new Map(candidate.events.map((event) => [event.id, event.title]));
  const titles = (records) => records.map((record) => record.eventIds.map((id) => titleOf.get(id)));
  return {
    war: titles(candidate.warUpdates),
    relation: titles(candidate.relationUpdates),
    agreement: titles(candidate.agreementUpdates),
    puppet: titles(candidate.puppetUpdates),
    front: titles(candidate.frontOrders),
    storyline: candidate.storylineUpdates.map((record) => record.eventIndexes.map((index) => candidate.events[index]?.title)),
  };
};

const NAMED = {
  war: [[INVASION]],
  relation: [[CONVENTION]],
  agreement: [[CONVENTION]],
  puppet: [[BREAK]],
  front: [[INVASION]],
  storyline: [[BREAK]],
};

test("every ledger of an answer written out of date order keeps each record on the event the model named", () => {
  const candidate = runSegment(answer());
  assert.deepEqual(candidate.events.map((event) => event.title), [FLOOD, BREAK, INVASION, CONVENTION], "in date order");
  assert.deepEqual(tiedTo(candidate), NAMED);
  // A record's places were spent once it was tied: none is read again by one.
  for (const key of ["warUpdates", "puppetUpdates", "frontOrders"]) {
    assert.ok(candidate[key].every((record) => record.eventIndexes.length === 0), key);
  }
  assert.ok(candidate.storylineUpdates.every((record) => !("eventIds" in record)), "a storyline leaves with places alone, as it always has");
});

test("read after the sort, the same numbers name other events", () => {
  const read = tiedTo(runSegment(answer(), { pin: false }));
  assert.deepEqual(read.war, [[INVASION, CONVENTION]], "the Belgian war, opened by the naval convention too (its own tagged event is added by the ledger)");
  assert.deepEqual(read.puppet, [[FLOOD]], "Serbia's revolt, told by a flood");
  assert.deepEqual(read.front, [[CONVENTION]]);
  assert.deepEqual(read.storyline, [[FLOOD]]);
  // Relations and agreements are tied by their numbers too, and nothing else:
  // their words no longer pull them onto the event they match.
  assert.deepEqual(read.relation, [[INVASION]], "the naval convention's relation, told by the invasion");
  assert.deepEqual(read.agreement, [[INVASION]]);
});

test("an event the engine writes in takes an id of its own, and the records keep theirs into the round's ids", () => {
  const candidate = runSegment(answer(), { beats: [reichstag] });
  assert.deepEqual(candidate.events.map((event) => event.title), [REICHSTAG, FLOOD, BREAK, INVASION, CONVENTION]);
  assert.equal(candidate.events[0].id, "segment-1-event-5", "named after the answer's four, before the sort");
  assert.equal(new Set(candidate.events.map((event) => event.id)).size, 5);
  assert.deepEqual(tiedTo(candidate), NAMED);

  const round = allocateCanonicalTurnEventIds({ existingEvents: [], newEvents: candidate.events, round: 7 });
  const idOf = new Map(round.events.map((event) => [event.title, event.id]));
  assert.deepEqual(remapLedgerEventIds(candidate.puppetUpdates, round.idMap)[0].eventIds, [idOf.get(BREAK)]);
  const wars = applyWarUpdates({ world, updates: remapLedgerEventIds(candidate.warUpdates, round.idMap), events: round.events, stopDate: "1914-03-31", round: 7 }).wars;
  assert.equal(wars[0].startedDate, "1914-03-15", "the war began with the invasion");

  // Named by its place in date order instead, the engine's event took the id
  // of the answer's first event, and the round gave both to the one sorted first.
  const old = answer();
  pinLedgersToEvents(old, { segmentIndex: 0 });
  sortTimelineEventsChronologically(old);
  old.events = ensureScriptedEventsWithImpacts(old.events, [reichstag]).events;
  sortTimelineEventsChronologically(old);
  old.events.forEach((event, index) => { if (!event.id) event.id = `segment-1-event-${index + 1}`; });
  assert.equal(old.events[0].id, old.events.find((event) => event.title === BREAK).id);
  const oldRound = allocateCanonicalTurnEventIds({ existingEvents: [], newEvents: old.events, round: 7 });
  const oldPuppet = remapLedgerEventIds(bindPuppetUpdatesToEvents(old.puppetUpdates, old.events), oldRound.idMap)[0];
  assert.deepEqual(oldPuppet.eventIds, [oldRound.events[0].id], "Serbia's revolt went to the Reichstag's opening");
});

test("a number past the answer's last event names no event, even once the engine adds one", () => {
  const candidate = {
    events: [
      { date: "1914-03-10", title: BREAK, description: "Belgrade expels the German advisers.", kind: "diplomacy" },
      { date: "1914-03-15", title: INVASION, description: "The German army marches on Liège.", kind: "military" },
    ],
    frontOrders: "Belgian Front~Germany~advance~all~3~city: Liège",
  };
  pinLedgersToEvents(candidate, { segmentIndex: 0 });
  sortTimelineEventsChronologically(candidate);
  candidate.events = ensureScriptedEventsWithImpacts(candidate.events, [reichstag]).events;
  giveSegmentEventIds(candidate.events, 0);
  sortTimelineEventsChronologically(candidate);
  const [order] = bindFrontOrdersToEvents(candidate.frontOrders, candidate.events);
  assert.deepEqual(order.eventIds, [], "its 3 was never the Reichstag's");
});

// A strict pass refuses a major event that changes nothing (a second request),
// and what it changes includes the records tied to it: read by place alone,
// the war record of an invasion written first and dated second was the flood's.
test("the strict check of what an event changed finds the records tied to it by id", () => {
  const candidate = {
    events: [
      { date: "1914-03-15", title: INVASION, description: "The German army marches on Liège.", kind: "military", importance: "major" },
      { date: "1914-03-02", title: FLOOD, description: "The Danube bursts its banks near Belgrade.", kind: "world" },
    ],
    warUpdates: "war-germany-belgium-1914~start~Germany~Belgium~1~the invasion",
  };
  pinLedgersToEvents(candidate, { segmentIndex: 0 });
  sortTimelineEventsChronologically(candidate);
  assert.equal(candidate.events[1].title, INVASION);
  assert.equal(validateWorldEventConsequencePayload(candidate, { strict: true }), "", "its war record is what it changed");
});

test("no event is given an id another event has, and prose where records go is handed back once", () => {
  const events = [{ title: "a" }, { id: "segment-1-event-1", title: "b" }, { title: "c" }];
  assert.deepEqual(giveSegmentEventIds(events, 0).map((event) => event.id), ["segment-1-event-1-2", "segment-1-event-1", "segment-1-event-3"]);
  assert.deepEqual(giveSegmentEventIds(events, 0).map((event) => event.id), ["segment-1-event-1-2", "segment-1-event-1", "segment-1-event-3"], "and again changes nothing");
  assert.equal(giveSegmentEventIds([{ title: "d" }], 2)[0].id, "segment-3-event-1");

  const candidate = {
    events: [{ date: "1914-03-15", title: INVASION, description: "", kind: "military" }],
    warUpdates: "### War updates\nNo changes.",
    frontOrders: "### Front orders\nBelgian Front~Germany~hold~all~1",
    relationUpdates: "",
  };
  const prose = pinLedgersToEvents(candidate, { segmentIndex: 0 });
  assert.deepEqual(prose, { warProse: ["### War updates", "No changes."], frontProse: ["### Front orders"] });
  assert.deepEqual(candidate.warUpdates, [], "a ledger of prose alone holds no record");
  assert.deepEqual(candidate.frontOrders.map((order) => order.eventIds), [["segment-1-event-1"]]);
  assert.equal(candidate.relationUpdates, "", "a ledger with nothing written is left as it was");
  assert.equal("puppetUpdates" in candidate, false);
  assert.deepEqual(pinLedgersToEvents(candidate, { segmentIndex: 0 }), { warProse: [], frontProse: [] }, "said once");
});

test("the time skip ties every ledger to its events before it sorts them, and names the engine's events before they are sorted in", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const pin = source.indexOf("pinSegmentLedgers(candidate, segmentIndex);");
  assert.ok(pin > 0 && pin < source.indexOf("sortTimelineEventsChronologically(candidate);", pin), "tied before the answer is put in date order");
  const wrapper = source.slice(source.indexOf("const pinSegmentLedgers = "), source.indexOf("const validateSegmentLedgers = "));
  assert.match(wrapper, /pinLedgersToEvents\(candidate, \{ segmentIndex \}\)/);
  const inserted = source.indexOf("candidate.events = scripted.events;", pin);
  const named = source.indexOf("giveSegmentEventIds(candidate.events, segmentIndex);", inserted);
  assert.ok(inserted > pin && named > inserted && named < source.indexOf("sortTimelineEventsChronologically(candidate);", inserted),
    "the engine's events are named before they are sorted in");
  const ledgers = source.slice(source.indexOf("const validateSegmentLedgers = "), source.indexOf("const screenSegmentFrontOrders = "));
  assert.match(ledgers, /giveSegmentEventIds\(candidate\?\.events, segmentIndex\)/);
  assert.ok(!source.includes("event.id = `segment-${segmentIndex + 1}-event-"), "no event is named anywhere else by its place");
  assert.ok(!source.includes("pinWarRecordsToEvents"), "the war ledger's own pin is every ledger's now");
});

// Pinned records leave as objects, and an object is read as its line was: a
// client state's blank loyalty stays blank (it begins at 50), where Number(null)
// made it 0.
test("a record tied to its events means what its line meant, a blank figure included", async () => {
  const diplomacy = await import("./nativeDiplomaticDirector.js");
  const events = [{ id: "e1", date: "2016-01-01", title: "Belarus is made a satellite", description: "" }];
  const candidate = {
    events,
    puppetUpdates: "install~Russia~Belarus~satellite~~open~1~note",
    relationUpdates: "Russia~Belarus~~friendly~1~closer ties",
  };
  const asLines = {
    loyalty: diplomacy.decodePuppetUpdates(candidate.puppetUpdates).map((record) => record.loyalty),
    score: diplomacy.decodeRelationUpdates(candidate.relationUpdates).map((record) => record.score),
  };
  pinLedgersToEvents(candidate);
  assert.deepEqual(asLines.loyalty, [null]);
  assert.deepEqual(diplomacy.decodePuppetUpdates(candidate.puppetUpdates).map((record) => record.loyalty), asLines.loyalty);
  assert.deepEqual(diplomacy.decodeRelationUpdates(candidate.relationUpdates).map((record) => record.score), asLines.score);
});

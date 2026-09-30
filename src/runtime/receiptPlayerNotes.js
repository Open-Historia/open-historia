/*! Open Historia — the application receipt, told to the player © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every note the engine writes on a time skip's receipt (applicationReceipt.js)
// is written to the model: in the second person, in English, with the field
// names it has to fix ("Name a city… as the map spells it"). The Events panel
// shows the same receipt to the player (time.jsx, "What the engine changed"),
// and showing them the model's words was the wrong voice in the wrong language.
//
// So each place that writes a note also writes the player's own sentence,
// stored beside the model's (note.player), and the event it concerns, if any
// (note.event, shown above the sentence as a name, never inside it). The
// sentences live in RECEIPT_PLAYER_TEXTS, a *_TEXTS table the string extractor
// reads (scripts/i18n/), so the shipped language packs carry them; each is one
// whole sentence with {{slots}}, stored filled in English and translated in the
// panel by the pack's pattern, like any other interface text. Plurals are whole
// sentences of their own.
//
// Free of imports but the phrase book's slot filler and the game-date
// formatter, both pure: gameplay.js, applicationReceipt.js and the diplomatic
// director all call this under bare node.
import { fillSlots } from "./phraseBook.js";
import { formatGameDateReadable } from "./gameDates.js";

export const RECEIPT_PLAYER_TEXTS = Object.freeze({
  // Events kept off the timeline.
  eventDiscarded: "An event with neither a title nor a description was discarded.",
  withheldImpossible: "Kept off the timeline: the engine judged it impossible in this world.",
  withheldContradiction: "Kept off the timeline: it contradicted the established record.",
  withheldRestatement: "Kept off the timeline: it restated an event already on the record.",
  withheldProcess: "Kept off the timeline: it described work going on with no concrete outcome.",
  withheldIncrement: "Kept off the timeline: the change it described was too small to record.",
  withheldRoutineMilitary: "Kept off the timeline: routine military activity that changed nothing.",
  withheldRoutineAdministration: "Kept off the timeline: routine administration with no concrete outcome.",
  withheldSaturated: "Kept off the timeline: one more small update on a story that already had several.",
  withheldPlayerAgency: "Kept off the timeline: it made a decision for your country that none of your orders or messages authorized.",
  withheldOther: "Kept off the timeline by the engine's checks.",
  withheldWordForWord: "Kept off the timeline: word for word an event already on the record.",
  interventionOne: "You stopped the time skip after \"{{title}}\" ({{date}}): the event after it never happened, and the world stands at {{closingDate}}.",
  interventionMany: "You stopped the time skip after \"{{title}}\" ({{date}}): the {{count}} events after it never happened, and the world stands at {{closingDate}}.",
  tempoOne: "1 territorial change was held back: this scenario limits how fast the map may change.",
  tempoMany: "{{count}} territorial changes were held back: this scenario limits how fast the map may change.",

  // Changes that were not applied.
  malformedOne: "One change this event carried was malformed and was ignored.",
  malformedMany: "{{count}} changes this event carried were malformed and were ignored.",
  warRecordsOne: "1 war record could not be tied to its events and was dropped; the events stay as history.",
  warRecordsMany: "{{count}} war records could not be tied to their events and were dropped; the events stay as history.",
  warLinksOne: "1 event lost its link to a war whose record could not be tied to it; the event stays as history.",
  warLinksMany: "{{count}} events lost their links to a war whose records could not be tied to them; the events stay as history.",
  relationUnknownCountry: "The change in relations between {{a}} and {{b}} was not recorded: {{name}} is not a country on this map.",
  relationSameCountry: "A change in relations was not recorded: both of its sides were the same country.",
  relationIncomplete: "The change in relations between {{a}} and {{b}} was not recorded: it was incomplete.",
  agreementIncomplete: "A change to an agreement was not recorded: it was incomplete.",
  agreementMissing: "A change to the agreement \"{{name}}\" was not recorded: no such agreement exists.",
  agreementAlreadyInForce: "The agreement \"{{name}}\" was not signed again: it is already in force.",
  agreementTooFewParties: "The agreement \"{{name}}\" was not recorded: fewer than two of its parties are countries on this map.",
  agreementUntitled: "A new agreement was not recorded: it had no title.",
  staleOrderLinksOne: "1 link from an event to an order that is not in your queue was removed.",
  staleOrderLinksMany: "{{count}} links from events to orders that are not in your queue were removed.",
  cityControlUnchanged: "The event says control of {{city}} changed, but nothing changed it, so the map still shows its previous controller.",
  transferWholeCountryUnknown: "The transfer of all of {{name}}'s land was not applied: no regions are held under that exact name.",
  controlWholeCountryUnknown: "The change of control over all of {{name}}'s land was not applied: no regions are held under that exact name.",
  transferUnknownOwner: "The transfer of {{region}} was not applied: {{owner}} is not a country on this map.",
  controlUnknownOwner: "The change of control over {{region}} was not applied: {{owner}} is not a country on this map.",
  transferNoRegion: "The transfer of {{region}} was not applied: no region on the map matches that name.",
  controlNoRegion: "The change of control over {{region}} was not applied: no region on the map matches that name.",
  politicalRefused: "A change to a government, party or leader was not applied: the engine's political records refused it.",
  institutionRefused: "A change to an institution or its membership was not applied: the institution's rules refused it.",
  chatNotOpened: "The conversation \"{{title}}\" was not opened: none of its participants is a country on this map.",
  untitledChatNotOpened: "A conversation was not opened: none of its participants is a country on this map.",
  unitNotRaised: "A new unit was not raised: it had no name or no owner.",
  unitOrderNoUnit: "An order to a unit was not carried out: it did not say which unit.",
  unitOrderUnknownUnit: "An order to the unit \"{{unit}}\" was not carried out: no unit has that id, and it may have been destroyed.",
  structureUnnamed: "A structure was not built: it had no name.",
  structureNowhere: "The structure \"{{name}}\" was not built: it had no position on the map.",
  structureRemovalUnnamed: "A structure was not removed: the event did not say which one.",
  reportEmpty: "A report was not written: it carried no document.",
  reportNoHolders: "The report \"{{title}}\" was not written: none of the governments meant to hold it is a country on this map.",
  projectUnnamed: "A project was not opened: it had no name.",
  projectChangeNoProject: "A change to a project was not applied: it did not say which project.",
  projectChangeUnknown: "A change to the project \"{{name}}\" was not applied: nothing on the board has that name.",
  schemaTruncatedOne: "1 item beyond the allowed length was left out of the answer.",
  schemaTruncatedMany: "{{count}} items beyond the allowed length were left out of the answer.",
  schemaMalformed: "A malformed part of the answer was left out.",
  placedNowhere: "{{name}} could not be placed where the event said and was left off the map.",
  unnamedPlacedNowhere: "A unit or structure could not be placed where the event said and was left off the map.",

  // Changes the engine adjusted.
  warLinkRemoved: "Kept as history, but no longer tied to a war: it described fighting the engine could not match to one.",
  claimInsteadOfTransfer: "The transfer of {{region}} to {{country}} was recorded as a claim instead, since a claim moves no border; the region now shows as disputed.",
  claimInsteadOfControl: "Control of {{region}} passing to {{country}} was recorded as a claim instead, since a claim moves no border; the region now shows as disputed.",
  transferMovesNoBorder: "The transfer of {{region}} was not applied: the event described something that moves no border, so nothing changed on the map.",
  controlMovesNoBorder: "The change of control over {{region}} was not applied: the event described something that moves no border, so nothing changed on the map.",
  wholeCountryMovesNoBorder: "The transfer of all of {{name}}'s land was not applied: the event described something that moves no border, so nothing changed on the map.",
  reportFewerHolders: "The report \"{{title}}\" went only to {{holders}}: the other governments it named are not countries on this map.",
  placedInRegion: "{{name}} could not be placed where the event said, so it was placed in {{region}} instead.",
  unnamedPlacedInRegion: "A unit or structure could not be placed where the event said, so it was placed in {{region}} instead.",
  raisedAtHome: "{{name}} could not be placed where the event said, so it was raised in {{region}}, inside {{owner}}'s own territory.",
  unnamedRaisedAtHome: "A new unit could not be placed where the event said, so it was raised in {{region}}, inside {{owner}}'s own territory.",
  placedByCoordinates: "{{name}} could not be placed where the event said, so the coordinates it came with were used.",
  unnamedPlacedByCoordinates: "A unit or structure could not be placed where the event said, so the coordinates it came with were used.",
  movedAshore: "{{name}} was placed in the sea and was moved ashore to {{region}}.",
  unnamedMovedAshore: "A land unit was placed in the sea and was moved ashore to {{region}}.",
  datesClamped: "Some event dates fell outside this period and were moved inside it.",
  scriptedBeatWritten: "The scripted event \"{{title}}\" of {{date}} was missing, so the engine wrote it in the author's words.",

  // Rejected and written again.
  redone: "The first answer broke one of the engine's rules and was written again.",

  // Kept as written, though short of what was asked.
  eventCountOne: "The time skip wrote 1 event for a period that called for {{min}} to {{max}}.",
  eventCountMany: "The time skip wrote {{count}} events for a period that called for {{min}} to {{max}}.",
  worldShareOne: "1 of the {{total}} events was about the world beyond your country; this scenario asks for at least {{needed}}.",
  worldShareMany: "{{count}} of the {{total}} events were about the world beyond your country; this scenario asks for at least {{needed}}.",
  focusOne: "1 of the {{total}} events involved your country; your focus setting asks for at least {{needed}}.",
  focusMany: "{{count}} of the {{total}} events involved your country; your focus setting asks for at least {{needed}}.",
  politicalNotRecorded: "Kept as written, but the change of government, party or leader it describes was not recorded.",
  overdueOrdersOne: "1 of your orders got no outcome in this time skip and stays queued as overdue.",
  overdueOrdersMany: "{{count}} of your orders got no outcome in this time skip and stay queued as overdue.",
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const whole = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

// { text, event }: the sentence filled in English, and the event it is about.
export const receiptPlayerNote = (key, params = {}, event = "") => {
  const template = RECEIPT_PLAYER_TEXTS[key];
  if (!template) return null;
  const text = clean(fillSlots(template, params));
  return text ? { text, event: clean(event) } : null;
};

const one = (count, singular, plural, params = {}, event = "") =>
  receiptPlayerNote(whole(count) === 1 ? singular : plural, { ...params, count: whole(count) }, event);

const readableDate = (value) => formatGameDateReadable(clean(value)) || clean(value);

// Why the curator or the integrity screen kept an event off the timeline, by
// the route it gave (gameplay.js WITHHELD_ROUTE_WORDS says the same to the model).
const WITHHELD_ROUTE_KEYS = Object.freeze({
  NON_BELLIGERENT_WARTIME_CAUSALITY: "withheldImpossible",
  UNSUPPORTED_REVERSAL: "withheldContradiction",
  EXACT_DUPLICATE: "withheldRestatement",
  EVIDENCED_REDUNDANCY: "withheldRestatement",
  RETRIEVAL_ASSISTED_REDUNDANCY: "withheldRestatement",
  NATIVE_PROCESS_FILLER: "withheldProcess",
  LOW_VALUE_INCREMENTAL_CHURN: "withheldIncrement",
  ROUTINE_MILITARY_NO_DELTA: "withheldRoutineMilitary",
  ROUTINE_MILITARY_PRECURATION: "withheldRoutineMilitary",
  ROUTINE_ADMINISTRATIVE_PROCESS: "withheldRoutineAdministration",
  SATURATED_ROUTINE_MILITARY_CHURN: "withheldSaturated",
  SATURATED_INCREMENTAL_REDUNDANCY: "withheldSaturated",
  LOW_TRAJECTORY_FEED_SATURATION: "withheldSaturated",
  PLAYER_AGENCY_AUTHORITY: "withheldPlayerAgency",
});

export const withheldEventNote = (row) => receiptPlayerNote(
  WITHHELD_ROUTE_KEYS[clean(row?.route)] || "withheldOther",
  {},
  clean(row?.title || row?.event?.title),
);

export const interventionNote = ({ kept = [], dropped = [], closingDate = "" } = {}) => {
  const last = Array.isArray(kept) ? kept.at(-1) : null;
  const count = Array.isArray(dropped) ? dropped.length : 0;
  if (!last || !count) return null;
  return one(count, "interventionOne", "interventionMany", {
    title: clean(last.title),
    date: readableDate(last.date),
    closingDate: readableDate(closingDate),
  });
};

// A territorial operation the resolver could not place (gameplay.js
// describeUnresolvedTerritory says the same to the model).
export const unresolvedTerritoryNote = (entry, family, eventTitle = "") => {
  const control = family === "regionControlOps";
  const region = clean(entry?.label);
  if (entry?.kind === "narrated-city-coverage") {
    return receiptPlayerNote("cityControlUnchanged", { city: clean(entry.cityName) || region || clean(entry.regionName) }, eventTitle);
  }
  if (entry?.wholeCountry) {
    return receiptPlayerNote(control ? "controlWholeCountryUnknown" : "transferWholeCountryUnknown", { name: region }, eventTitle);
  }
  if (entry?.unknownOwner) {
    return receiptPlayerNote(control ? "controlUnknownOwner" : "transferUnknownOwner", { region, owner: clean(entry.unknownOwner) }, eventTitle);
  }
  return receiptPlayerNote(control ? "controlNoRegion" : "transferNoRegion", { region }, eventTitle);
};

// A transfer or control flip whose basis moves no border (territoryBasis.js
// describeBasisAction says the same to the model). A whole country's is named
// "all of X" there; here the country's name alone.
export const basisActionNote = (action, { eventTitle = "" } = {}) => {
  const control = action?.family === "regionControlOps";
  if (action?.outcome === "claimed") {
    return receiptPlayerNote(control ? "claimInsteadOfControl" : "claimInsteadOfTransfer", {
      region: clean(action.region),
      country: clean(action.toCode),
    }, eventTitle);
  }
  if (action?.wholeCountry) {
    return receiptPlayerNote("wholeCountryMovesNoBorder", { name: clean(action.region).replace(/^all of /, "") }, eventTitle);
  }
  return receiptPlayerNote(control ? "controlMovesNoBorder" : "transferMovesNoBorder", { region: clean(action?.region) }, eventTitle);
};

// A unit or structure placed by name (gameplay.js resolvePlacements).
// `outcome`: "region" (a fallback region), "home" (its owner's own land),
// "coordinates" (the ones it came with), "nowhere" or "ashore".
export const placementNote = (outcome, { name = "", region = "", owner = "", eventTitle = "" } = {}) => {
  const named = Boolean(clean(name));
  const keys = {
    region: named ? "placedInRegion" : "unnamedPlacedInRegion",
    home: named ? "raisedAtHome" : "unnamedRaisedAtHome",
    coordinates: named ? "placedByCoordinates" : "unnamedPlacedByCoordinates",
    nowhere: named ? "placedNowhere" : "unnamedPlacedNowhere",
    ashore: named ? "movedAshore" : "unnamedMovedAshore",
  };
  return receiptPlayerNote(keys[outcome], { name: clean(name), region: clean(region), owner: clean(owner) }, eventTitle);
};

// A part of the answer the schema could not accept (schemaSalvage.js). The
// caller's label is an event's title in quotes, or a position ("event 3"),
// which is the model's and is not shown.
export const schemaRemovalNote = (removal) => {
  const label = clean(removal?.label);
  const quoted = /^"(.+)"$/.exec(label);
  const event = quoted ? quoted[1] : "";
  if (removal?.kind === "truncate") return one(removal.removedCount, "schemaTruncatedOne", "schemaTruncatedMany", {}, event);
  return receiptPlayerNote("schemaMalformed", {}, event);
};

export const eventCountNote = ({ count, min, max }) =>
  one(count, "eventCountOne", "eventCountMany", { min: whole(min), max: whole(max) });

export const worldShareNote = ({ world, total, needed }) =>
  one(world, "worldShareOne", "worldShareMany", { total: whole(total), needed: whole(needed) });

export const focusShareNote = ({ have, total, needed }) =>
  one(have, "focusOne", "focusMany", { total: whole(total), needed: whole(needed) });

export const countedNote = (count, singular, plural, params = {}, event = "") =>
  one(count, singular, plural, params, event);

export const readableReceiptDate = readableDate;

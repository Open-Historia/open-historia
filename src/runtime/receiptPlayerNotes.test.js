// Run: node --test src/runtime/receiptPlayerNotes.test.js
//
// I278: the Events panel's "What the engine changed" showed the notes the
// engine writes to the model: English, second person, with the field names the
// model has to fix. These are the player's sentences for the same facts. They
// have to reach the language packs whole (the extractor reads the table), say
// nothing in the model's vocabulary, and pick the right sentence for each case.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { extractFromSource } from "../../scripts/i18n/extractStrings.mjs";
import {
  RECEIPT_PLAYER_TEXTS,
  basisActionNote,
  countedNote,
  eventCountNote,
  focusShareNote,
  interventionNote,
  placementNote,
  receiptPlayerNote,
  schemaRemovalNote,
  unresolvedTerritoryNote,
  withheldEventNote,
  worldShareNote,
} from "./receiptPlayerNotes.js";

test("every sentence reaches the language packs whole", () => {
  const file = "src/runtime/receiptPlayerNotes.js";
  const { exact, patterns } = extractFromSource(fs.readFileSync(new URL("./receiptPlayerNotes.js", import.meta.url), "utf8"), file, { jsx: false, catchAll: false });
  const found = new Set([...exact.keys(), ...patterns.keys()]);
  for (const [key, text] of Object.entries(RECEIPT_PLAYER_TEXTS)) {
    assert.ok(found.has(text), `${key} is read by the extractor`);
  }
});

test("every sentence is the player's: whole, and in none of the model's vocabulary", () => {
  for (const [key, text] of Object.entries(RECEIPT_PLAYER_TEXTS)) {
    assert.match(text, /\.$/, `${key} is a sentence`);
    assert.doesNotMatch(text.replace(/\{\{\w+\}\}/g, "X"), /\b[a-z]+[A-Z][A-Za-z]*\b/, `${key} names no field`);
    assert.doesNotMatch(text, /\byou wrote\b|\bpolit(?:y|ies)\b/i, `${key} is not an instruction to the model`);
    assert.doesNotMatch(text, /\bNOT\b/, `${key} does not shout`);
  }
});

test("a sentence is filled in English, and the event beside it", () => {
  assert.deepEqual(
    receiptPlayerNote("chatNotOpened", { title: "Talks in Minsk" }, "Ceasefire"),
    { text: "The conversation \"Talks in Minsk\" was not opened: none of its participants is a country on this map.", event: "Ceasefire" },
  );
  assert.equal(receiptPlayerNote("no-such-key"), null);
  assert.equal(countedNote(1, "overdueOrdersOne", "overdueOrdersMany").text, "1 of your orders got no outcome in this time skip and stays queued as overdue.");
  assert.equal(countedNote(3, "overdueOrdersOne", "overdueOrdersMany").text, "3 of your orders got no outcome in this time skip and stay queued as overdue.");
});

test("a withheld event says why, by its route", () => {
  assert.deepEqual(withheldEventNote({ route: "EXACT_DUPLICATE", title: "Treaty signed" }), {
    text: "Kept off the timeline: it restated an event already on the record.",
    event: "Treaty signed",
  });
  assert.equal(withheldEventNote({ route: "PLAYER_AGENCY_AUTHORITY", event: { title: "Kyiv mobilizes" } }).event, "Kyiv mobilizes");
  assert.equal(withheldEventNote({ route: "SOMETHING_NEW", reason: "the curator's own words" }).text, "Kept off the timeline by the engine's checks.");
});

test("a stop names where the player stopped, in readable dates, BC included", () => {
  const note = interventionNote({
    kept: [{ title: "Hannibal crosses the Alps", date: "-0218-10-20" }],
    dropped: [{ title: "Trebia" }, { title: "Lake Trasimene" }],
    closingDate: "-0218-10-20",
  });
  assert.equal(note.text, "You stopped the time skip after \"Hannibal crosses the Alps\" (20 October 218 BC): the 2 events after it never happened, and the world stands at 20 October 218 BC.");
  assert.match(interventionNote({ kept: [{ title: "A", date: "2014-05-03" }], dropped: [{}], closingDate: "2014-05-03" }).text, /the event after it never happened/);
  assert.equal(interventionNote({ kept: [], dropped: [{}] }), null);
});

test("an unresolved transfer or control change picks its own sentence", () => {
  assert.equal(unresolvedTerritoryNote({ label: "Kharkiv" }, "regionTransfers").text, "The transfer of Kharkiv was not applied: no region on the map matches that name.");
  assert.equal(unresolvedTerritoryNote({ label: "Kharkiv" }, "regionControlOps").text, "The change of control over Kharkiv was not applied: no region on the map matches that name.");
  assert.equal(unresolvedTerritoryNote({ label: "Donbas", unknownOwner: "DPR" }, "regionTransfers").text, "The transfer of Donbas was not applied: DPR is not a country on this map.");
  assert.equal(unresolvedTerritoryNote({ label: "Ukraine", wholeCountry: true }, "regionTransfers").text, "The transfer of all of Ukraine's land was not applied: no regions are held under that exact name.");
  assert.equal(
    unresolvedTerritoryNote({ kind: "narrated-city-coverage", cityName: "Mariupol", label: "x", regionName: "Donetsk" }, "regionControlOps", "Siege ends").event,
    "Siege ends",
  );
});

test("a basis that moves no border is said as a claim or as nothing", () => {
  assert.equal(
    basisActionNote({ family: "regionTransfers", outcome: "claimed", region: "Crimea", toCode: "Russia" }).text,
    "The transfer of Crimea to Russia was recorded as a claim instead, since a claim moves no border; the region now shows as disputed.",
  );
  assert.match(basisActionNote({ family: "regionControlOps", outcome: "refused", region: "Kherson" }).text, /^The change of control over Kherson was not applied/);
  assert.match(basisActionNote({ family: "regionTransfers", outcome: "refused", region: "all of Moldova", wholeCountry: true }).text, /^The transfer of all of Moldova's land was not applied/);
});

test("a placement names the unit, or says a unit or structure when it has no name", () => {
  assert.equal(placementNote("ashore", { name: "1st Guards", region: "Odesa" }).text, "1st Guards was placed in the sea and was moved ashore to Odesa.");
  assert.equal(placementNote("nowhere", {}).text, "A unit or structure could not be placed where the event said and was left off the map.");
  assert.equal(placementNote("home", { region: "Quito", owner: "Ecuador" }).text, "A new unit could not be placed where the event said, so it was raised in Quito, inside Ecuador's own territory.");
});

test("a schema removal shows the event only when the label is its title", () => {
  assert.deepEqual(schemaRemovalNote({ kind: "item", label: "\"Fall of Kassala\"" }), { text: "A malformed part of the answer was left out.", event: "Fall of Kassala" });
  assert.equal(schemaRemovalNote({ kind: "property", label: "event 3" }).event, "", "a position is the model's, not a name");
  assert.equal(schemaRemovalNote({ kind: "truncate", removedCount: 4 }).text, "4 items beyond the allowed length were left out of the answer.");
});

test("the shortfalls count as the model's notes do, in the player's words", () => {
  assert.equal(eventCountNote({ count: 1, min: 6, max: 12 }).text, "The time skip wrote 1 event for a period that called for 6 to 12.");
  assert.equal(worldShareNote({ world: 2, total: 9, needed: 4 }).text, "2 of the 9 events were about the world beyond your country; this scenario asks for at least 4.");
  assert.equal(focusShareNote({ have: 1, total: 8, needed: 3 }).text, "1 of the 8 events involved your country; your focus setting asks for at least 3.");
});

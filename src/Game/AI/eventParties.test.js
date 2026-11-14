/*! Open Historia — who an event involves, by what it records: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/eventParties.test.js
//
// An event's parties are what it records, never its words: a name looked for
// in a title found "IRA" in "Iran" and never found "Allemagne" for Germany.

import test from "node:test";
import assert from "node:assert/strict";

import { eventPartyNames, eventPlaceCountries } from "./eventParties.js";

test("an event's parties are every party its structure names", () => {
  const event = {
    actors: ["Austria"],
    combatants: ["France", "Prussia"],
    agency: {
      principal: "Irish Republican Army",
      principalKind: "organization",
      sovereignPolity: "Denmark",
      authority: "autonomous",
      sovereignActors: [{ polity: "Denmark", authority: "autonomous" }, { polity: "Norway", authority: "autonomous" }],
    },
    warId: "war-1",
    places: [{ kind: "country", name: "Belgium" }, { kind: "city", name: "Liège", lng: 5.57, lat: 50.63 }, "city: Lyon, country: Savoy"],
    impacts: {
      polityChanges: [{ code: "Bavaria", operation: "update" }],
      regionTransfers: [{ regionId: "r1", fromCode: "Saxony", toCode: "Hanover" }],
      regionControlOps: [{ op: "control", regionId: "r2", toCode: "Russia", actorCode: "Russia" }],
      createdChats: [{ speaker: "Sweden", countries: ["Sweden"] }],
      unitOps: [{ op: "spawn", unit: { ownerCode: "Italy" } }],
      markerOps: [{ op: "build", marker: { ownerCode: "Spain" } }],
      groupOps: [{ op: "update", name: "Fenian Brotherhood", newName: "Irish Brotherhood" }],
      institutionLifecycleOps: [{ actorPolity: "Portugal", targetPolity: "Greece" }],
    },
  };
  const wars = [{ id: "war-1", sideA: ["France", "Piedmont"], sideB: ["Prussia", "Württemberg"] }];
  assert.deepEqual(new Set(eventPartyNames(event, { wars })), new Set([
    "Austria", "France", "Prussia", "Irish Republican Army", "Denmark", "Norway", "Belgium", "Savoy", "Piedmont", "Württemberg",
    "Bavaria", "Saxony", "Hanover", "Russia", "Sweden", "Italy", "Spain", "Fenian Brotherhood", "Irish Brotherhood", "Portugal", "Greece",
  ]));
  // A found city or region keeps no country: its name is a place, not a party.
  assert.ok(!eventPartyNames(event, { wars }).includes("Liège"));
});

test("an event's words name nobody, and the same structure names the same parties in every language", () => {
  assert.deepEqual(eventPartyNames({ title: "Iran and the IRA", description: "Oman watches Romania; Germany and Poland are silent.", impacts: {} }), []);
  const structure = { combatants: ["Germany", "Poland"], places: [{ kind: "country", name: "Poland" }], impacts: {} };
  const english = eventPartyNames({ ...structure, title: "Germany invades Poland", description: "Panzers cross the border." });
  const french = eventPartyNames({ ...structure, title: "L'Allemagne envahit la Pologne", description: "Les panzers franchissent la frontière." });
  const chinese = eventPartyNames({ ...structure, title: "德国入侵波兰", description: "装甲部队越过边境。" });
  assert.deepEqual(english, ["Germany", "Poland"]);
  assert.deepEqual(french, english);
  assert.deepEqual(chinese, english);
});

test("a place's country: a found country, or the country a place not yet found was written with", () => {
  assert.deepEqual(eventPlaceCountries({ places: [
    { kind: "country", name: "Poland" },
    { kind: "region", name: "Crimea", regionId: "4441" },
    "city: Kharkiv, country: Ukraine",
    "country: Moldova",
    "the salmon run",
  ] }), ["Poland", "Ukraine", "Moldova"]);
  assert.deepEqual(eventPlaceCountries({}), []);
  assert.deepEqual(eventPartyNames(null), []);
  assert.deepEqual(eventPartyNames({ warId: "war-9", impacts: {} }, { wars: [] }), [], "a war the world does not have names nobody");
});

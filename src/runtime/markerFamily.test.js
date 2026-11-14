/*! Open Historia — what family a structure on the map belongs to: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/markerFamily.test.js
//
// A structure is drawn by the family it is given (by the time skip, the
// Workshop or the Game Master), never by English words in its kind or name.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  KIND_FAMILIES,
  MARKER_FAMILIES,
  NEUTRAL_MARKER_FAMILY,
  SAID_MARKER_FAMILIES,
  isStrategicMarker,
  kindFamily,
  markerFamilyOf,
} from "./markerFamily.js";
import { applyMarkerOps, normalizeMarkerEntry } from "./gameState.js";
import { MAP_FEATURE_KINDS } from "../Editor/mapFeatures.js";
import { GM_MAP_FEATURE_FAMILIES, GM_MAP_FEATURE_KINDS, gmFeatureFamily } from "../Game/GameUI/mapFeatureKinds.js";
import { getGameplayTool, validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the game's own kinds each have a family, and those are all the kinds it reads by id", () => {
  const offered = [...MAP_FEATURE_KINDS.map((kind) => kind.id), "city"].sort();
  assert.deepEqual(Object.keys(KIND_FAMILIES).sort(), offered);
  for (const family of Object.values(KIND_FAMILIES)) assert.ok(MARKER_FAMILIES.includes(family), family);
  // The Game Master's types: the Workshop's, a city, and two with no family of their own.
  for (const kind of GM_MAP_FEATURE_KINDS) {
    const expected = ["temporary marker", "other"].includes(kind.id) ? "" : KIND_FAMILIES[kind.id];
    assert.equal(kindFamily(kind.id), expected, kind.id);
  }
  assert.deepEqual(SAID_MARKER_FAMILIES, MARKER_FAMILIES.filter((family) => family !== NEUTRAL_MARKER_FAMILY));
});

test("a structure's family is the one it was given, else its kind's when the game offers that kind, else a landmark", () => {
  assert.equal(markerFamilyOf({ kind: "military base" }), "military");
  assert.equal(markerFamilyOf({ kind: "Oil_Field" }), "resource", "an id, its spacing written any way");
  assert.equal(markerFamilyOf({ kind: "military base", family: "diplomatic" }), "diplomatic", "what it was given comes first");
  // The same structure in Russian, given its family: drawn alike.
  assert.equal(markerFamilyOf({ kind: "военная база", family: "military" }), markerFamilyOf({ kind: "military base", family: "military" }));
  // Words are never read: a kind the game does not offer, given nothing, is a landmark in every language.
  for (const kind of ["военная база", "missile silo", "base militaire", "army base", ""]) {
    assert.equal(markerFamilyOf({ kind, name: "Strategic Missile Command" }), NEUTRAL_MARKER_FAMILY, kind);
  }
  assert.equal(markerFamilyOf({ kind: "x", family: "castle" }), NEUTRAL_MARKER_FAMILY, "a family the game does not have is none");
  assert.equal(isStrategicMarker({ strategic: true }), true);
  assert.equal(isStrategicMarker({ strategic: "true" }), false);
});

test("a structure keeps its family and weight across a save, and an update can change them", () => {
  const marker = normalizeMarkerEntry({ id: "m1", name: "Шахта", kind: "шахта", family: "Military", strategic: true, lng: 40, lat: 55 });
  assert.equal(marker.family, "military");
  assert.equal(marker.strategic, true);
  const plain = normalizeMarkerEntry({ id: "m2", name: "Old", kind: "landmark", family: "castle", strategic: "yes", lng: 40, lat: 55 });
  assert.equal("family" in plain || "strategic" in plain, false, "a structure without saves exactly as before");
  const [updated] = applyMarkerOps([marker], [{ op: "update", markerId: "m1", family: "infrastructure", strategic: false }]);
  assert.equal(updated.family, "infrastructure");
  assert.equal(isStrategicMarker(updated), false);
  // A kind changed with no family keeps the family it had.
  const [renamed] = applyMarkerOps([marker], [{ op: "update", markerId: "m1", kind: "космодром" }]);
  assert.equal(renamed.family, "military");
});

test("the skip is offered a structure's family and weight on the marker it builds, and an answer that writes them elsewhere is read", () => {
  const impacts = getGameplayTool("jumpForward").schema.properties.events.items.properties.impacts.properties;
  const branches = impacts.markerOps.items.anyOf;
  const nested = branches.find((branch) => branch.properties.marker).properties.marker.properties;
  assert.deepEqual(nested.family.enum, [...SAID_MARKER_FAMILIES]);
  assert.equal(nested.strategic.type, "boolean");
  // The contract sent stays lean: the flat build and the update do not carry them.
  for (const branch of branches.filter((entry) => !entry.properties.marker)) {
    assert.equal("family" in branch.properties, false, branch.properties.op.enum[0]);
  }
  const answer = (op) => ({ events: [{ date: "1950-01-01", title: "Built", description: "It was built.", impacts: { markerOps: [op] } }], stopDate: "1950-02-01", summary: "A month." });
  for (const op of [
    { op: "build", marker: { name: "Base", kind: "база", family: "military", strategic: true } },
    { op: "build", name: "Base", kind: "база", family: "military", strategic: true },
    { op: "update", name: "Base", family: "resource", strategic: false },
  ]) {
    const verdict = validateGameplayPayload("jumpForward", answer(op));
    assert.equal(verdict.valid, true, `${JSON.stringify(op)}: ${verdict.error}`);
  }
});

test("the Game Master draws a type of the player's own as the family picked for it", () => {
  assert.equal(gmFeatureFamily("airfield"), "military");
  assert.equal(gmFeatureFamily("other", "resource"), "resource");
  assert.equal(gmFeatureFamily("other", ""), "");
  assert.equal(gmFeatureFamily("temporary marker", "military"), "", "a type the tools offer keeps its own");
  assert.deepEqual(GM_MAP_FEATURE_FAMILIES.map((family) => family.id).sort(), [...MARKER_FAMILIES].sort());
  // Wired into both of its tools (cheats.jsx cannot be imported under node).
  const cheats = read("../Game/GameUI/cheats.jsx");
  assert.equal(cheats.match(/<label style=\{labelStyle\}>Drawn as<\/label>/g)?.length, 2);
  assert.match(cheats, /family: formFamily\(marker\),/);
  assert.match(cheats, /family: nextMarker\.family \|\| "landmark",/);
  assert.match(cheats, /kind: isCity \? "city" : customKind,\n\s*\.\.\.\(family \? \{ family \} : \{\}\),/);
  // And the card on the map shows the family's emoji, not a word's.
  const card = read("../Game/Selection/Features.jsx");
  assert.match(card, /FAMILY_EMOJI\[markerFamilyOf\(structure\)\]/);
  assert.doesNotMatch(card, /KIND_EMOJI|emojiForKind/);
});

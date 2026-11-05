/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
// Run: node --test src/Editor/warGeographyDoc.test.js
//
// What a scenario draws on its map for war (runtime/warGeography.js) has to
// be carried at every step a Workshop map takes, or it is gone the first time
// the map is opened again: the document and the stores' create list, the save
// into the scenario, the scenario's world, and the map the scenario hands the
// Workshop when it opens. A field missing from any of them is dropped without
// a word, which is how a map's units and its puppet states were lost before.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildGameSeed } from "./exportPreset.js";
import { createDocument, openStoredDocument } from "./useMapDocument.js";
import { normalizeWorldState } from "../runtime/gameState.js";
import { normalizeClimateZones, normalizeFortifications, normalizeTerrainAreas } from "../runtime/warGeography.js";
import { documentFieldsFromBody } from "../../server/mapEditorFields.js";
import {
  WAR_KEYS,
  monthDayOf,
  monthDayParts,
  mostCommon,
  newClimateZone,
  newFortification,
  newTerrainArea,
  seasonsOfClimate,
  warGeographyForGame,
  warGeographyOf,
  warGeographyWorldPatch,
} from "./warGeographyDoc.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const region = (id, typeId, owner = "") => ({
  type: "Feature",
  id,
  properties: { id, typeId, owner },
  geometry: { type: "Polygon", coordinates: [ring(0, 0, 1, 1)] },
});
const regions = {
  type: "FeatureCollection",
  features: [region("lake_1", "lake"), region("field_1", "land", "Aland"), region("sea_1", "sea")],
};

// A map with one of each, as the Workshop's tools and panel leave them.
const workshopDocument = () => {
  const doc = createDocument({ name: "The North", kind: "blank" });
  doc.types = [...doc.types, { id: "lake", name: "Lake", water: true }, { id: "sea", name: "Sea" }];
  const alps = { ...newTerrainArea("terrain_1", [ring(6, 45, 11, 48)], []), name: "The Alps", level: 8 };
  const wall = { ...newFortification("wall_1", [[20, 50], [21.5, 50.25], [23, 50.5]], "Aland", []), name: "The Wall", level: 10 };
  const zone = {
    ...newClimateZone("zone_1", [ring(18, 55, 30, 70)], []),
    name: "The Long Winter",
    color: "#4f8fd6",
    blendKm: 250,
    transitionDays: 21,
    events: [{ name: "The Long Night", from: "0300-01-01", to: "0300-06-01", weather: "blizzard", effects: { pace: 0.2, freezes: true } }],
  };
  zone.seasons[0] = { ...zone.seasons[0], color: "#dfe8f2", effects: { pace: 0.5, cold: 1.5, freezes: true } };
  return {
    ...doc,
    terrainAreas: [alps],
    fortifications: [wall],
    climateZones: [zone],
    // A lake, a land region marked when it was water, and a region since deleted.
    freezingRegions: ["lake_1", "field_1", "gone_1"],
  };
};

// The Workshop's fields as MapEditor.jsx buildDocumentFields hands them to a save.
const documentFields = (doc) => ({
  name: doc.metadata.name,
  metadata: doc.metadata,
  types: doc.types,
  features: doc.features,
  units: doc.units,
  groups: doc.groups,
  puppets: doc.puppets,
  ...Object.fromEntries(WAR_KEYS.map((key) => [key, doc[key]])),
});

test("a document saved and opened again keeps every shape and every frozen lake", () => {
  const doc = workshopDocument();
  // The first save creates the document from the stores' one list.
  const stored = { id: "the-north", name: "The North", metadata: doc.metadata, ...documentFieldsFromBody(documentFields(doc)) };
  const reopened = openStoredDocument(stored).doc;
  for (const key of WAR_KEYS) assert.deepEqual(reopened[key], warGeographyOf(doc)[key], key);
  assert.deepEqual(reopened.freezingRegions, ["lake_1", "field_1", "gone_1"], "the document keeps every mark it was given");
});

test("document to scenario to game and back to the Workshop: the war geography survives the whole round", () => {
  const doc = workshopDocument();
  const seed = buildGameSeed(doc, regions, {});

  // The save writes the four keys into the world, the frozen water only where
  // it is water on this map.
  assert.deepEqual(seed.world.terrainAreas, normalizeTerrainAreas(doc.terrainAreas));
  assert.deepEqual(seed.world.fortifications, normalizeFortifications(doc.fortifications));
  assert.deepEqual(seed.world.climateZones, normalizeClimateZones(doc.climateZones));
  assert.deepEqual(seed.world.freezingRegions, ["lake_1"]);

  // libraryBar.jsx writeMapToScenario: the keys the save carries replace the
  // scenario world's.
  const before = { regionOwnershipOverrides: {}, terrainAreas: [{ id: "old", level: 2, rings: [ring(0, 0, 1, 1)] }] };
  const scenarioWorld = { ...before, ...warGeographyWorldPatch(seed.world) };
  // The game the scenario starts (and the scenario as read back) normalises it.
  const world = normalizeWorldState(scenarioWorld);
  for (const key of WAR_KEYS) assert.deepEqual(world[key], seed.world[key], `the world keeps ${key}`);

  // libraryBar.jsx openMapEditorFor hands the Workshop the world's four keys,
  // and MapEditor.jsx's hydration puts them in the new document.
  const initialMap = { name: "The North", ...warGeographyOf(world) };
  const reopened = Object.assign(createDocument({ name: initialMap.name }), warGeographyOf(initialMap));
  assert.deepEqual(reopened.terrainAreas, warGeographyOf(doc).terrainAreas);
  assert.deepEqual(reopened.fortifications, warGeographyOf(doc).fortifications);
  assert.deepEqual(reopened.climateZones, warGeographyOf(doc).climateZones);
  assert.deepEqual(reopened.freezingRegions, ["lake_1"]);

  // And saving it again writes the same world.
  const again = buildGameSeed({ ...reopened, types: doc.types }, regions, {});
  for (const key of WAR_KEYS) assert.deepEqual(again.world[key], seed.world[key], `a second save writes ${key} the same`);
});

test("every step of the round is wired: the document's fields, the save, the scenario and the reopening", () => {
  const mapEditor = read("./MapEditor.jsx");
  const library = read("../Game/GameUI/libraryBar.jsx");
  const document = read("./useMapDocument.js");
  for (const key of ["terrainAreas", "fortifications", "climateZones", "freezingRegions"]) {
    assert.match(mapEditor, new RegExp(`${key}: d\\.${key},`), `buildDocumentFields saves ${key}`);
    assert.match(document, new RegExp(`${key}: \\[\\],`), `a new document has ${key}`);
    assert.ok(Object.hasOwn(documentFieldsFromBody({}), key), `the stores create ${key}`);
  }
  assert.match(mapEditor, /Object\.assign\(base, warGeographyOf\(initialMap\)\)/, "the Workshop opens with the scenario's");
  assert.match(library, /\.\.\.warGeographyOf\(world\),/, "the scenario hands the Workshop its world's");
  assert.match(library, /\.\.\.warGeographyWorldPatch\(seed\.world\),/, "a Workshop save writes them into the scenario's world");
  assert.match(read("./exportPreset.js"), /\.\.\.warGeographyForGame\(doc, regionsFC\),/, "buildGameSeed writes them");
});

test("a map with none of it saves none, and a scenario saved before it existed opens with none", () => {
  const seed = buildGameSeed(createDocument(), { type: "FeatureCollection", features: [] }, {});
  for (const key of WAR_KEYS) assert.deepEqual(seed.world[key], [], key);
  assert.deepEqual(warGeographyOf({}), { terrainAreas: [], fortifications: [], climateZones: [], freezingRegions: [] });
  assert.deepEqual(warGeographyWorldPatch({ terrainAreas: [] }), { terrainAreas: [] }, "only what the save carries");
  assert.deepEqual(warGeographyWorldPatch(null), {});
});

test("frozen water is water on the map: by the type's Water switch or by its name", () => {
  const doc = { ...workshopDocument(), freezingRegions: ["lake_1", "sea_1", "field_1"] };
  assert.deepEqual(warGeographyForGame(doc, regions).freezingRegions, ["lake_1", "sea_1"]);
  // The lake's type switched to land is no longer water.
  const dried = { ...doc, types: doc.types.map((type) => (type.id === "lake" ? { ...type, water: false } : type)) };
  assert.deepEqual(warGeographyForGame(dried, regions).freezingRegions, ["sea_1"]);
});

test("new shapes are what the game keeps: named and numbered, at the middle levels", () => {
  const area = newTerrainArea("t1", [ring(0, 0, 1, 1)], [{ id: "t0" }]);
  assert.equal(area.name, "Terrain 2");
  assert.deepEqual(normalizeTerrainAreas([area]), [area]);
  const wall = newFortification("w1", [[0, 0], [1, 1]], "Aland", []);
  assert.deepEqual(normalizeFortifications([wall]), [wall]);
  assert.equal(wall.level, 5);
  const zone = newClimateZone("z1", [ring(0, 0, 1, 1)], []);
  assert.deepEqual(normalizeClimateZones([zone]), [zone], "a new zone is already in the world's form");
  assert.notEqual(newClimateZone("z2", [ring(0, 0, 1, 1)], [zone]).color, zone.color, "the next zone has another colour");
});

test("a zone can take its seasons from one of the game's climates", () => {
  const polar = seasonsOfClimate("polar");
  assert.deepEqual(polar.map((season) => [season.name, season.start, season.end]), [
    ["Winter", "12-01", "02-28"], ["Spring", "03-01", "05-31"], ["Summer", "06-01", "08-31"], ["Autumn", "09-01", "11-30"],
  ]);
  assert.deepEqual(polar[0].weather, { clear: 45, frost: 25, snow: 20, blizzard: 10 }, "clear skies the commonest, even in a polar winter");
  assert.equal(polar[0].effects.freezes, true, "a polar winter freezes the water");
  assert.equal(seasonsOfClimate("arid")[0].effects.freezes, undefined, "a desert winter does not");
  assert.deepEqual(seasonsOfClimate("nowhere"), seasonsOfClimate("continental"));
});

test("a season's day is a month and a day, February stopping at the 28th", () => {
  assert.deepEqual(monthDayParts("2-30"), { month: 2, day: 28 });
  assert.deepEqual(monthDayParts("12-01"), { month: 12, day: 1 });
  assert.deepEqual(monthDayParts("winter"), { month: 1, day: 1 });
  assert.equal(monthDayOf(4, 31), "04-30");
  assert.equal(monthDayOf(13, 0), "12-01");
});

test("a fortified line's first owner is the country it mostly crosses", () => {
  assert.equal(mostCommon(["Aland", "Borduria", "Borduria", null, ""]), "Borduria");
  assert.equal(mostCommon([]), null);
});

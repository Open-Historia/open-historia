/*! Open Historia — the scenario's maps in the Map Editor: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/scenarioMaps.test.js
//
// A scenario offers one list of maps: its starting map (★) and the ones players
// may switch to, built-in maps, the author's own basemaps and detailed maps
// alike (CONTEXT.md, docs/adr/0007). What has to hold:
//   - the list reads what the document holds, the old one-detailed-map form too;
//   - adding a map never replaces the starting map;
//   - making another map the starting map keeps the old one in the list;
//   - a detailed map is always shown over a drawn map of the scenario.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addBuiltinMap, addOwnMap, makeStartingMap, removeMap, scenarioMaps, setShownOver } from "./scenarioMaps.js";
import { DETAILED_MAP_PROJECTION_MESSAGE } from "./projectionConvert.js";
import { DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE } from "./exportPreset.js";

const PICTURE = { kind: "image", dataUrl: "data:image/png;base64,AA==" };
const drawn = (x) => ({
  kind: "vector",
  geojson: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [x, 0] } }] },
});
const WESTEROS = drawn(1);
const ESSOS = drawn(2);
const RELIEF = { id: "got-world", version: 2, name: "Westeros relief" };
const ALL_BUILTIN = 15;

const view = (metadata, options = { scenarioName: "Westeros" }) => scenarioMaps(metadata, options)
  .map((map) => `${map.starting ? "★ " : ""}${map.key} ${map.kind} "${map.name}"${map.over ? ` over ${map.over}` : ""}`);
// Applies an operation's patch, the way the Map Editor's d.patchMetadata does.
const apply = (metadata, result) => {
  assert.equal(result.refused, undefined, result.refused);
  return { ...metadata, ...result.patch };
};

test("a real-world scenario that never chose offers every built-in map", () => {
  const maps = scenarioMaps({ basemap: "topo" }, { scenarioName: "Europe 1914" });
  assert.equal(maps[0].key, "start");
  assert.equal(maps[0].kind, "builtin");
  assert.equal(maps[0].name, "Topographic");
  assert.equal(maps[0].starting, true);
  assert.equal(maps.length, ALL_BUILTIN, "the starting map and every other built-in map");
  assert.ok(maps.slice(1).every((map) => map.kind === "builtin" && !map.starting && map.key !== "builtin:topo"));
});

test("a made-up world that never chose offers its own map only", () => {
  assert.deepEqual(view({ customBackground: WESTEROS, ownBasemaps: [{ id: "essos", name: "Essos", background: ESSOS }] }), [
    '★ start vector "Westeros map"',
    'own:essos vector "Essos"',
  ]);
  assert.deepEqual(view({ customBackground: WESTEROS, startingMapName: "The Seven Kingdoms" }), ['★ start vector "The Seven Kingdoms"']);
});

test("a detailed starting map (the old form) is shown over its drawn map, which players may switch to", () => {
  assert.deepEqual(view({ customBackground: WESTEROS, tiledBasemap: RELIEF, allowedBasemaps: ["ocean"] }), [
    '★ start detailed "Westeros relief" over start:drawn',
    'start:drawn vector "Westeros map"',
    'builtin:ocean builtin "Ocean"',
  ]);
});

test("adding a map adds it to the list and never replaces the starting map", () => {
  let doc = { customBackground: WESTEROS };
  doc = apply(doc, addBuiltinMap(doc, "ocean"));
  doc = apply(doc, addOwnMap(doc, { id: "essos", name: "Essos", background: ESSOS }));
  doc = apply(doc, addOwnMap(doc, { id: "essos", name: "Essos", background: ESSOS }));
  assert.deepEqual(view(doc), ['★ start vector "Westeros map"', 'own:essos vector "Essos"', 'builtin:ocean builtin "Ocean"']);
  assert.equal(doc.customBackground, WESTEROS);
});

test("a detailed map is added shown over the first drawn map, and refused without one or off Mercator", () => {
  const detailed = { id: "relief", name: "Westeros relief", detailed: { id: "got-world", version: 2 } };
  let doc = { customBackground: PICTURE, ownBasemaps: [{ id: "essos", name: "Essos", background: ESSOS }] };
  doc = apply(doc, addOwnMap(doc, detailed));
  assert.deepEqual(view(doc).slice(-1), ['own:relief detailed "Westeros relief" over own:essos']);
  assert.equal(addOwnMap({ customBackground: PICTURE }, detailed).refused, DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE);
  assert.equal(addOwnMap({ customBackground: WESTEROS, projection: { type: "equirectangular" } }, detailed).refused, DETAILED_MAP_PROJECTION_MESSAGE);
});

test("making a built-in map the starting map keeps the scenario's own map and its detailed map in the list", () => {
  let doc = { customBackground: WESTEROS, tiledBasemap: RELIEF, allowedBasemaps: ["ocean"] };
  doc = apply(doc, makeStartingMap(doc, "builtin:ocean", { scenarioName: "Westeros" }));
  assert.equal(doc.customBackground, null);
  assert.equal(doc.tiledBasemap, null);
  assert.equal(doc.basemap, "ocean");
  const maps = scenarioMaps(doc, { scenarioName: "Westeros" });
  assert.deepEqual(maps.map((map) => `${map.starting ? "★ " : ""}${map.kind} "${map.name}"`), [
    '★ builtin "Ocean"',
    'vector "Westeros map"',
    'detailed "Westeros relief"',
  ]);
  assert.equal(maps[2].over, maps[1].key, "the detailed map is still shown over the Westeros map");
});

test("making a detailed map the starting map puts its drawn map under it", () => {
  let doc = { basemap: "ocean", allowedBasemaps: [], ownBasemaps: [
    { id: "westeros", name: "Westeros map", background: WESTEROS },
    { id: "relief", name: "Westeros relief", detailed: { id: "got-world", version: 2 }, over: "westeros" },
  ] };
  doc = apply(doc, makeStartingMap(doc, "own:relief", { scenarioName: "Westeros" }));
  assert.deepEqual(doc.customBackground, WESTEROS);
  assert.deepEqual(doc.tiledBasemap, RELIEF);
  assert.deepEqual(view(doc), [
    '★ start detailed "Westeros relief" over start:drawn',
    'start:drawn vector "Westeros map"',
    'builtin:ocean builtin "Ocean"',
  ]);
  // And back: nothing is lost either way.
  doc = apply(doc, makeStartingMap(doc, "builtin:ocean", { scenarioName: "Westeros" }));
  assert.deepEqual(view(doc).map((line) => line.replace(/own:\S+/g, "own:*")), [
    '★ start builtin "Ocean"',
    'own:* vector "Westeros map"',
    'own:* detailed "Westeros relief" over own:*',
  ]);
});

test("making another drawn map the starting map keeps a real-world scenario's built-in maps as they were", () => {
  let doc = { basemap: "topo" };
  doc = apply(doc, addOwnMap(doc, { id: "essos", name: "Essos", background: ESSOS }));
  doc = apply(doc, makeStartingMap(doc, "own:essos", { scenarioName: "Europe" }));
  const maps = scenarioMaps(doc, { scenarioName: "Europe" });
  assert.equal(maps[0].name, "Essos");
  assert.equal(maps.filter((map) => map.kind === "builtin").length, ALL_BUILTIN, "every built-in map is still offered, Topographic too");
});

test("removing a drawn map moves the detailed maps shown over it, and is refused when there is no other", () => {
  const base = { customBackground: PICTURE, ownBasemaps: [
    { id: "westeros", name: "Westeros map", background: WESTEROS },
    { id: "essos", name: "Essos", background: ESSOS },
    { id: "relief", name: "Westeros relief", detailed: { id: "got-world", version: 2 }, over: "westeros" },
  ] };
  const doc = apply(base, removeMap(base, "own:westeros"));
  assert.deepEqual(view(doc).slice(1), ['own:essos vector "Essos"', 'own:relief detailed "Westeros relief" over own:essos']);
  const refused = removeMap(doc, "own:essos").refused;
  assert.match(refused, /Westeros relief/);
  assert.equal(removeMap(doc, "start").refused !== undefined, true, "the starting map is never removed");
});

test("removing the drawn map under a detailed starting map puts another drawn map under it", () => {
  const base = { customBackground: WESTEROS, tiledBasemap: RELIEF, ownBasemaps: [{ id: "essos", name: "Essos", background: ESSOS }] };
  const doc = apply(base, removeMap(base, "start:drawn"));
  assert.deepEqual(doc.customBackground, ESSOS);
  assert.deepEqual(view(doc), ['★ start detailed "Westeros relief" over start:drawn', 'start:drawn vector "Essos"']);
  assert.match(removeMap(doc, "start:drawn").refused, /Westeros relief/);
});

test("removing a built-in map stops offering it", () => {
  const doc = apply({ basemap: "topo" }, removeMap({ basemap: "topo" }, "builtin:ocean"));
  const keys = scenarioMaps(doc, {}).map((map) => map.key);
  assert.ok(!keys.includes("builtin:ocean"));
  assert.equal(keys.length, ALL_BUILTIN - 1);
});

test("a detailed map can be shown over another drawn map", () => {
  const base = { customBackground: WESTEROS, ownBasemaps: [
    { id: "essos", name: "Essos", background: ESSOS },
    { id: "relief", name: "Relief", detailed: { hash: "a".repeat(64) }, over: "" },
  ] };
  const doc = apply(base, setShownOver(base, "own:relief", "own:essos"));
  assert.deepEqual(view(doc).slice(-1), ['own:relief detailed "Relief" over own:essos']);
  assert.ok(setShownOver(base, "own:relief", "builtin:ocean").refused, "only over a drawn map");
});

test("the detailed starting map moved over another drawing names the old one as the list does", () => {
  const base = { customBackground: WESTEROS, tiledBasemap: RELIEF, ownBasemaps: [{ id: "essos", name: "Essos", background: ESSOS }] };
  const doc = apply(base, setShownOver(base, "start", "own:essos", { scenarioName: "Westeros" }));
  assert.ok(view(doc).includes(`own:westeros-map vector "Westeros map"`), view(doc).join("\n"));
});

test("making the drawn map under a detailed starting map the starting one, with no drawing left, changes nothing", () => {
  const base = { basemap: "ocean" };
  assert.deepEqual(apply(base, makeStartingMap(base, "start:drawn", { scenarioName: "Westeros" })), apply(base, makeStartingMap(base, "start")));
});

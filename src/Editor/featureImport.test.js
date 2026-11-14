import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeImportedFeatures, parseFeatureImport } from "./featureImport.js";
import { MAP_FEATURE_FAMILIES, buildMarkersForGame, isMapFeature, mapFeatureFamily, markerToFeature, newMapFeature } from "./mapFeatures.js";
import { MARKER_FAMILIES } from "../runtime/markerFamily.js";

test("a Workshop document's bases, ports and landmarks stay map features", () => {
  const base = { ...newMapFeature({ id: "feat_1", coord: [30.5, 50.4], owner: "Ukraine" }), name: "Hostomel", kind: "airfield", status: "damaged", note: "Contested since morning", markerId: "m-7", markerExtra: { builtBy: "ai", createdAt: "2022-02-24T00:00:00.000Z" } };
  const city = { id: "feat_2", name: "Kyiv", type: "Coordinate", symbol: "star", coord: [30.52, 50.45], country: "Ukraine", owner: null, population: 2900000, tags: ["city", "capital"], tier: 3 };
  const { features, format } = parseFeatureImport(JSON.stringify({ name: "Doc", features: [base, city] }));
  assert.equal(format, "document");
  const [feature, town] = features;
  assert.equal(isMapFeature(feature), true);
  assert.equal(feature.kind, "airfield");
  assert.equal(feature.status, "damaged");
  assert.equal(feature.note, "Contested since morning");
  assert.equal(feature.owner, "Ukraine");
  assert.equal(feature.symbol, "diamond");
  assert.equal(feature.markerId, "m-7");
  // What the game gets back is the marker it gave.
  const [marker] = buildMarkersForGame(features);
  assert.equal(marker.id, "m-7");
  assert.equal(marker.kind, "airfield");
  assert.equal(marker.ownerCode, "Ukraine");
  assert.equal(marker.builtBy, "ai");
  // A city stays a city, and keeps its size.
  assert.equal(isMapFeature(town), false);
  assert.equal(town.tier, 3);
  assert.equal(town.symbol, "star");
});

// How the game draws a Workshop structure is its family (runtime/markerFamily.js):
// its kind's for one the tool offers, the author's pick ("Drawn as") for a kind
// of their own, and never a family left over from before the kind changed.
test("a Workshop structure goes to the game with the family it is drawn as", () => {
  const at = { coord: [30.5, 50.4] };
  const listed = { ...newMapFeature({ id: "feat_1", ...at }), name: "Hostomel", kind: "airfield" };
  const own = { ...newMapFeature({ id: "feat_2", ...at }), name: "Severodvinsk", kind: "shipyard", family: "industry-science" };
  // The same, typed in Russian: drawn alike.
  const ownRu = { ...newMapFeature({ id: "feat_3", ...at }), name: "Северодвинск", kind: "верфь", family: "industry-science" };
  const unpicked = { ...newMapFeature({ id: "feat_4", ...at }), name: "Monastery", kind: "monastery" };
  // An AI-built silo, its kind since changed to a port by the author.
  const changed = { ...newMapFeature({ id: "feat_5", ...at }), name: "Old Silo", kind: "port", family: "military", markerExtra: { family: "military", strategic: true } };
  const markers = buildMarkersForGame([listed, own, ownRu, unpicked, changed]);
  assert.deepEqual(markers.map((marker) => marker.family), ["military", "industry-science", "industry-science", undefined, "infrastructure"]);
  assert.equal(markers[4].strategic, true, "what the Workshop does not edit goes back as it was");
  // A marker from the world comes into the Workshop with its family, and back out with it.
  const [fromWorld] = buildMarkersForGame([markerToFeature({ id: "m-9", name: "Base", kind: "база", family: "military", lng: 30, lat: 50 }, "feat_9")]);
  assert.equal(fromWorld.family, "military");
  // A document read back from a file keeps the pick.
  const { features } = parseFeatureImport(JSON.stringify({ name: "Doc", features: [own] }));
  assert.equal(features[0].family, "industry-science");
  assert.equal(mapFeatureFamily(features[0]), "industry-science");
});

test("the Workshop's popup offers a family for a kind of the author's own, and its map draws by it", () => {
  const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const popup = read("./MarkerPopup.jsx");
  assert.match(popup, /\{customKind && \(\n\s*<label[^>]*>\n\s*<span[^>]*>Drawn as<\/span>/);
  assert.match(popup, /onChange=\{\(e\) => onChange\(\{ family: e\.target\.value \}\)\}/);
  assert.match(popup, /MAP_FEATURE_FAMILIES\.map\(\(entry\) =>/);
  const map = read("./OlMap.jsx");
  assert.match(map, /family: isMapFeature\(f\) \? mapFeatureFamily\(f\) : ""/);
  assert.match(map, /getMarkerPresentation\(\{ kind: feature\.get\("kind"\), family: feature\.get\("family"\), status: feature\.get\("status"\) \}\)/);
  // Every family the game has can be picked, and nothing else.
  assert.deepEqual(MAP_FEATURE_FAMILIES.map((entry) => entry.id).sort(), [...MARKER_FAMILIES].sort());
});

test("a GeoJSON 'kind' is only a tag: a file of towns imports as cities", () => {
  const { features } = parseFeatureImport({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: "Arles", kind: "town", tier: 2 }, geometry: { type: "Point", coordinates: [4.63, 43.68] } }],
  });
  assert.deepEqual(features[0].tags, ["town"]);
  assert.equal(features[0].kind, undefined);
  assert.equal(isMapFeature(features[0]), false);
  assert.equal(features[0].tier, 2);
});

test("a list of rows with `coord` and a 'kind' is not taken for a Workshop document: its towns import as cities", () => {
  const { features, format } = parseFeatureImport([{ name: "Arles", coord: [4.63, 43.68], kind: "town" }]);
  assert.equal(format, "rows");
  assert.deepEqual(features[0].tags, ["town"]);
  assert.equal(features[0].kind, undefined);
  assert.equal(isMapFeature(features[0]), false);
});

test("GeoJSON points become features; other geometries are counted as skipped", () => {
  const { features, skipped, format } = parseFeatureImport(JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [2.35, 48.86] }, properties: { name: "Paris", symbol: "star", tags: "capital, city", country: "France", population: "2100000" } },
      { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }, properties: { title: "Buoys", kind: "sea" } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { name: "An area" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [999, 0] }, properties: { name: "Off the map" } },
    ],
  }));
  assert.equal(format, "geojson");
  assert.equal(skipped, 2);
  assert.equal(features.length, 3);
  assert.deepEqual(features[0].coord, [2.35, 48.86]);
  assert.equal(features[0].name, "Paris");
  assert.equal(features[0].symbol, "star");
  assert.deepEqual(features[0].tags, ["capital", "city"]);
  assert.equal(features[0].country, "France");
  assert.equal(features[0].population, 2100000);
  assert.equal(features[0].type, "Coordinate");
  assert.match(features[0].id, /^feat_/);
  assert.equal(features[1].name, "Buoys");
  assert.deepEqual(features[1].tags, ["sea"]);
  assert.deepEqual(features[2].coord, [1, 1]);
  assert.notEqual(features[0].id, features[1].id);
});

test("a Workshop document and plain rows import too", () => {
  const doc = parseFeatureImport({ name: "My map", features: [{ name: "Fort", coord: [10, 20], symbol: "triangle", tags: ["fort"] }, { name: "Nowhere" }] });
  assert.equal(doc.format, "document");
  assert.equal(doc.features.length, 1);
  assert.equal(doc.skipped, 1);
  assert.equal(doc.features[0].symbol, "triangle");

  const rows = parseFeatureImport([{ name: "Harbour", lng: "12.5", lat: "-3.25" }, { label: "Peak", longitude: 7, latitude: 46 }, "not a row", { name: "No place" }]);
  assert.equal(rows.format, "rows");
  assert.deepEqual(rows.features.map((f) => f.name), ["Harbour", "Peak"]);
  assert.deepEqual(rows.features[0].coord, [12.5, -3.25]);
  assert.equal(rows.skipped, 2);
  // A nameless feature is still named.
  assert.equal(parseFeatureImport([{ lon: 1, lat: 2 }]).features[0].name, "Feature 1");
});

test("files without any point refuse with a reason", () => {
  assert.throws(() => parseFeatureImport("{}"), /holds no features/);
  assert.throws(() => parseFeatureImport("not json"), SyntaxError);
  assert.throws(() => parseFeatureImport([{ name: "x", lon: 500, lat: 0 }]), /usable point/);
});

test("merging drops exact duplicates of what is already there", () => {
  const existing = [{ id: "a", name: "Paris", coord: [2.35, 48.86] }];
  const { imported } = { imported: parseFeatureImport([{ name: "Paris", lon: 2.35, lat: 48.86 }, { name: "Lyon", lon: 4.83, lat: 45.76 }]).features };
  const merged = mergeImportedFeatures(existing, imported);
  assert.equal(merged.added, 1);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.features.length, 2);
  assert.equal(merged.features[1].name, "Lyon");
});

/*! Open Historia — reviewing a suggestion's map changes: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/suggestionReview.test.js
//
// The Workshop applies a suggestion's map changes one at a time, as the author
// accepts them. What has to hold, against a map and a document that behave like
// OlMap's api and useMapDocument's setters:
//   - a change is "open" while the map still has the post's value, "applied"
//     once it has the suggested one, and a "conflict" when the author changed
//     it themselves; a region the map no longer has is "missing";
//   - accepting makes the map say what the change says, and Undo puts back
//     what was there — regions, countries, cities, units, features, puppets;
//   - a change that names a country or group the suggestion adds needs that
//     addition first.

import test from "node:test";
import assert from "node:assert/strict";

import { renamePolityInDocument } from "../../server/polityRename.js";
import { applyMapChange, changeDependencies, changeTargets, inSuggestedProjection, mapChangeStatus } from "./suggestionReview.js";
import { convertDisplayPoint, moveGeojson, normalizeProjection, sheetBounds } from "../../server/mapProjection.js";
import { moveFeatureCoords, moveUnits } from "./projectionConvert.js";
import { measureGeometry } from "../runtime/scenarioChanges.js";

const square = (x, y, size = 1) => ({ type: "Polygon", coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] });
const clone = (value) => JSON.parse(JSON.stringify(value));

// OlMap's api, over plain GeoJSON.
const fakeMap = (features) => {
  const regions = new Map(features.map((feature) => [feature.properties.id, clone(feature)]));
  const summary = (feature) => ({
    id: feature.properties.id,
    name: feature.properties.name || "",
    owner: feature.properties.owner || null,
    typeId: feature.properties.typeId || "land",
    claimants: feature.properties.claimants || [],
    group: feature.properties.group || "",
  });
  const api = {
    regions,
    getRegionSummary: (id) => (regions.has(id) ? summary(regions.get(id)) : null),
    setRegionAttrs: (ids, patch) => {
      for (const id of ids) {
        const feature = regions.get(String(id));
        if (!feature) continue;
        for (const [key, value] of Object.entries(patch)) feature.properties[key] = key === "claimants" ? (value?.length ? value : null) : value;
      }
    },
    exportRegions: (ids) => ({ type: "FeatureCollection", features: ids.map((id) => regions.get(String(id))).filter(Boolean).map(clone) }),
    applyRegionPatch: ({ upsert = [], remove = [], withAttributes = false }) => {
      for (const feature of upsert) {
        const id = String(feature.properties.id);
        const existing = regions.get(id);
        if (existing && !withAttributes) existing.geometry = clone(feature.geometry);
        else regions.set(id, clone(feature));
      }
      for (const id of remove) regions.delete(String(id));
    },
    renameOwner: (from, to) => {
      for (const feature of regions.values()) {
        if (feature.properties.owner === from) feature.properties.owner = to;
        if (Array.isArray(feature.properties.claimants)) feature.properties.claimants = feature.properties.claimants.map((key) => (key === from ? to : key));
      }
    },
    removeOwners: (keys) => {
      for (const feature of regions.values()) {
        if (keys.includes(feature.properties.owner)) feature.properties.owner = null;
      }
    },
    listOwnerRegions: (key) => [...regions.values()].filter((feature) => feature.properties.owner === key).map((feature) => ({ id: feature.properties.id })),
    queryRegions: () => [...regions.values()].map(summary),
    retagGroup: (from, to) => {
      for (const feature of regions.values()) if (feature.properties.group === from) feature.properties.group = to;
    },
  };
  return api;
};

// useMapDocument's setters over a plain document.
const fakeDocument = (doc) => {
  const state = { doc: clone(doc) };
  const set = (patch) => { state.doc = { ...state.doc, ...patch(state.doc) }; };
  const keyed = (field) => (key, value) => set((d) => {
    const next = { ...(d[field] || {}) };
    if (value && (!Array.isArray(value) || value.length)) next[key] = value; else delete next[key];
    return { [field]: next };
  });
  const d = {
    upsertPolity: (key, patch) => set((current) => ({ polities: { ...current.polities, [key]: { ...(current.polities[key] || {}), ...patch, name: patch.name ?? current.polities[key]?.name ?? key } } })),
    setPolities: (updater) => set((current) => ({ polities: updater(current.polities) })),
    removePolity: (key) => set((current) => {
      const polities = { ...current.polities };
      delete polities[key];
      return { polities };
    }),
    renamePolity: (from, to) => { state.doc = renamePolityInDocument(state.doc, from, to); },
    setColorOverride: keyed("colorOverrides"),
    setFlag: keyed("flags"),
    setTags: keyed("tags"),
    setGroups: (updater) => set((current) => ({ groups: updater(current.groups) })),
    setFeatures: (updater) => set((current) => ({ features: updater(current.features) })),
    setUnits: (updater) => set((current) => ({ units: updater(current.units) })),
    setPuppets: (updater) => set((current) => ({ puppets: updater(current.puppets) })),
    patchMetadata: (patch) => set((current) => ({ metadata: { ...current.metadata, ...patch } })),
  };
  return { state, d };
};

const setup = () => {
  const api = fakeMap([
    { type: "Feature", geometry: square(0, 0), properties: { id: "r1", name: "West", owner: "Alpha" } },
    { type: "Feature", geometry: square(1, 0), properties: { id: "r2", name: "East", owner: "Alpha" } },
    { type: "Feature", geometry: square(10, 10), properties: { id: "r3", name: "Far", owner: "Beta" } },
  ]);
  const { state, d } = fakeDocument({
    polities: { Alpha: { name: "Alpha", aliases: [] }, Beta: { name: "Beta", aliases: [] } },
    colorOverrides: {},
    flags: {},
    tags: {},
    groups: {},
    features: [{ id: "feat1", name: "Alphaville", type: "Coordinate", coord: [0.5, 0.5], population: 1000, tags: ["city"] }],
    units: [{ id: "u1", name: "1st Army", type: "infantry", ownerCode: "Alpha", lng: 0.5, lat: 0.5, strength: 100 }],
    puppets: [],
    metadata: { author: "Ann", basemap: "ocean" },
  });
  const ctx = { api, d, get doc() { return state.doc; } };
  return { api, state, d, ctx };
};

test("an ownership change: open, applied once accepted, and taken back by Undo", () => {
  const { api, ctx } = setup();
  const change = { id: "region-owner:r2", area: "map", kind: "region-owner", regionId: "r2", regionName: "East", from: "Alpha", to: "Beta" };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.equal(api.getRegionSummary("r2").owner, "Beta");
  assert.equal(mapChangeStatus(change, ctx), "applied");
  undo();
  assert.equal(api.getRegionSummary("r2").owner, "Alpha");
  api.setRegionAttrs(["r2"], { owner: "Gamma" });
  assert.equal(mapChangeStatus(change, ctx), "conflict", "the author gave it to someone else meanwhile");
  assert.equal(mapChangeStatus({ ...change, regionId: "gone" }, ctx), "missing");
});

test("a border change puts its whole cluster at once, and Undo restores every shape", () => {
  const { api, ctx } = setup();
  const r1 = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1.4, 0], [1.4, 1], [0, 1], [0, 0]]] }, properties: { id: "r1", owner: "Alpha", name: "West" } };
  const r2 = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[1.4, 0], [2, 0], [2, 1], [1.4, 1], [1.4, 0]]] }, properties: { id: "r2", owner: "Alpha", name: "East" } };
  const drawn = { type: "Feature", geometry: square(2, 0), properties: { id: "reg_new", owner: "Alpha", name: "New East" } };
  const change = {
    id: "borders:r1,r2,reg_new",
    area: "map",
    kind: "borders",
    regions: [
      { id: "r1", op: "reshape", feature: r1, fromShape: measureGeometry(square(0, 0)), toShape: measureGeometry(r1.geometry) },
      { id: "r2", op: "reshape", feature: r2, fromShape: measureGeometry(square(1, 0)), toShape: measureGeometry(r2.geometry) },
      { id: "reg_new", op: "add", feature: drawn, toShape: measureGeometry(drawn.geometry) },
    ],
  };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.deepEqual(api.regions.get("r1").geometry, r1.geometry);
  assert.ok(api.regions.has("reg_new"));
  assert.equal(api.regions.get("r1").properties.name, "West", "a reshape keeps the region's own attributes");
  assert.equal(mapChangeStatus(change, ctx), "applied");
  undo();
  assert.deepEqual(api.regions.get("r1").geometry, square(0, 0));
  assert.deepEqual(api.regions.get("r2").geometry, square(1, 0));
  assert.equal(api.regions.has("reg_new"), false);
});

test("a change that hands land to a country the suggestion adds needs that country first", () => {
  const { api, state, ctx } = setup();
  const add = { id: "polity-add:Gamma", area: "map", kind: "polity-add", key: "Gamma", record: { name: "Gamma", note: "New." }, color: [1, 2, 3], flag: null, tags: ["republic"] };
  const owner = { id: "region-owner:r3", area: "map", kind: "region-owner", regionId: "r3", from: "Beta", to: "Gamma" };
  assert.deepEqual(changeDependencies(owner, [add, owner], ctx), ["polity-add:Gamma"]);
  const undoAdd = applyMapChange(add, ctx);
  assert.equal(state.doc.polities.Gamma.note, "New.");
  assert.deepEqual(state.doc.colorOverrides.Gamma, [1, 2, 3]);
  assert.deepEqual(state.doc.tags.Gamma, ["republic"]);
  assert.deepEqual(changeDependencies(owner, [add, owner], ctx), [], "met once the country exists");
  assert.deepEqual(changeTargets(add, ctx, { changes: [add, owner] }).regionIds, ["r3"], "the country is shown where it will be");
  applyMapChange(owner, ctx);
  assert.equal(api.getRegionSummary("r3").owner, "Gamma");
  undoAdd();
  assert.equal(state.doc.polities.Gamma, undefined);
});

test("a rename re-keys the country on the map and in the document, and Undo renames it back", () => {
  const { api, state, ctx } = setup();
  const rename = { id: "polity-rename:Beta", area: "map", kind: "polity-rename", from: "Beta", to: "Beta Republic", record: { name: "Beta Republic" }, color: null, flag: null, tags: null };
  assert.equal(mapChangeStatus(rename, ctx), "open");
  const undo = applyMapChange(rename, ctx);
  assert.equal(api.getRegionSummary("r3").owner, "Beta Republic");
  assert.ok(state.doc.polities["Beta Republic"]);
  assert.equal(state.doc.polities.Beta, undefined);
  assert.equal(mapChangeStatus(rename, ctx), "applied");
  // A change written against the old name still lands on the renamed country.
  const later = { id: "region-owner:r1", area: "map", kind: "region-owner", regionId: "r1", from: "Alpha", to: "Beta" };
  applyMapChange(later, ctx, { renames: { Beta: "Beta Republic" } });
  assert.equal(api.getRegionSummary("r1").owner, "Beta Republic");
  undo();
  assert.equal(api.getRegionSummary("r3").owner, "Beta");
  assert.ok(state.doc.polities.Beta);
});

test("cities and units: applied and taken back", () => {
  const { state, ctx } = setup();
  const cityChange = { id: "city-change:x", area: "map", kind: "city-change", name: "Alphaville", from: { name: "Alphaville", coord: [0.5, 0.5], population: 1000, capital: false }, to: { name: "Alphaville", coord: [0.5, 0.5], population: 5000, capital: true } };
  assert.equal(mapChangeStatus(cityChange, ctx), "open");
  const undoCity = applyMapChange(cityChange, ctx);
  assert.equal(state.doc.features[0].population, 5000);
  assert.deepEqual(state.doc.features[0].tags, ["city", "capital"]);
  assert.equal(mapChangeStatus(cityChange, ctx), "applied");
  undoCity();
  assert.equal(state.doc.features[0].population, 1000);

  const unit = { id: "unit-change:u1", area: "map", kind: "unit-change", key: "u1", from: state.doc.units[0], to: { ...state.doc.units[0], strength: 60 } };
  const undoUnit = applyMapChange(unit, ctx);
  assert.equal(state.doc.units[0].strength, 60);
  undoUnit();
  assert.equal(state.doc.units[0].strength, 100);
});

// ---- a suggestion that changes the projection ----------------------------------

// A map with places far enough from the equator for a projection to move them,
// and MapEditor's convertForReview over the fakes: every region, city, feature
// and unit moved by the one rule, the picture laid on the bounds it is given.
const projectionSetup = () => {
  const { api, state, d } = setup();
  d.setFeatures((list) => [...list, { id: "feat2", name: "Northport", type: "Coordinate", coord: [20, 60], population: 5000, tags: ["city"] }]);
  d.setUnits((list) => [...list, { id: "u2", name: "Northern Army", type: "infantry", ownerCode: "Alpha", lng: 20, lat: 60, strength: 100 }]);
  d.patchMetadata({ customBackground: { kind: "image", dataUrl: "data:image/png;base64,AAAA" } });
  api.applyRegionPatch({ upsert: [{ type: "Feature", geometry: square(20, 59, 2), properties: { id: "r9", name: "North", owner: "Alpha" } }] });
  const calls = [];
  const convertProjection = (from, to, bounds) => {
    calls.push({ from: normalizeProjection(from).type, to: normalizeProjection(to).type, bounds });
    const move = (lon, lat) => convertDisplayPoint(from, to, lon, lat);
    for (const feature of api.regions.values()) feature.geometry = moveGeojson(feature.geometry, move);
    d.setFeatures((list) => moveFeatureCoords(list, from, to));
    d.setUnits((list) => moveUnits(list, from, to));
    d.patchMetadata({ projection: normalizeProjection(to), customBackground: { ...state.doc.metadata.customBackground, bounds } });
  };
  const ctx = { api, d, convertProjection, get doc() { return state.doc; } };
  return { api, state, d, ctx, calls };
};
const FLAT = { type: "equirectangular", globe: false };
const flatPlace = (lon, lat) => convertDisplayPoint("mercator", FLAT, lon, lat);

test("a change of projection is the Workshop's own conversion, and Undo converts back", () => {
  const { api, state, ctx, calls } = projectionSetup();
  const change = { id: "map:projection", area: "map", kind: "projection", from: { type: "mercator" }, to: FLAT, bounds: sheetBounds(FLAT) };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.deepEqual(calls, [{ from: "mercator", to: "equirectangular", bounds: sheetBounds(FLAT) }]);
  assert.deepEqual(state.doc.metadata.projection, FLAT);
  assert.deepEqual(state.doc.units[1].lat, flatPlace(20, 60)[1]);
  assert.ok(Math.abs(state.doc.units[1].lat - 60) > 5, "the unit moved with the map");
  assert.equal(mapChangeStatus(change, ctx), "applied");
  // The two switches count: the same projection with the globe allowed is not what was suggested.
  assert.equal(mapChangeStatus({ ...change, to: { type: "equirectangular" } }, ctx), "conflict");
  undo();
  assert.equal(calls[1].to, "mercator");
  assert.equal(calls[1].bounds, null, "the picture goes back where it lay");
  assert.deepEqual(state.doc.metadata.projection, { type: "mercator" });
  assert.ok(Math.abs(state.doc.units[1].lat - 60) < 1e-4);
  assert.ok(Math.abs(api.exportRegions(["r9"]).features[0].geometry.coordinates[0][0][1] - 59) < 1e-4);
  assert.equal(mapChangeStatus(change, ctx), "open");
  // Without the Workshop's conversion there is nothing to accept it with.
  assert.equal(applyMapChange(change, { ...ctx, convertProjection: undefined, doc: state.doc }), null);
});

test("the rest of such a suggestion is read where the new projection puts the map, and accepted after the map is moved", () => {
  const { api, state, ctx, calls } = projectionSetup();
  const [lng, lat] = flatPlace(20, 60);
  const projection = { id: "map:projection", area: "map", kind: "projection", from: { type: "mercator" }, to: FLAT, bounds: sheetBounds(FLAT) };
  // Written for the map in its new projection, as scenarioChanges.js writes them.
  const unitNow = { id: "u2", name: "Northern Army", type: "infantry", ownerCode: "Alpha", lng, lat, strength: 100 };
  const unit = { id: "unit-change:u2", area: "map", kind: "unit-change", key: "u2", label: "Northern Army", from: unitNow, to: { ...unitNow, name: "Arctic Army" } };
  const cityNow = { name: "Northport", coord: [lng, lat], population: 5000, capital: false };
  const city = { id: "city-change:northport", area: "map", kind: "city-change", name: "Northport", from: cityNow, to: { ...cityNow, population: 9000 } };
  const movedSquare = moveGeojson(square(20, 59, 2), (x, y) => flatPlace(x, y));
  const grown = moveGeojson(square(20, 59, 3), (x, y) => flatPlace(x, y));
  const borders = {
    id: "borders:r9", area: "map", kind: "borders",
    regions: [{ id: "r9", name: "North", op: "change", feature: { type: "Feature", geometry: grown, properties: { id: "r9", name: "North", owner: "Alpha" } }, fromShape: measureGeometry(movedSquare), toShape: measureGeometry(grown) }],
  };
  const changes = [projection, unit, city, borders];

  // Against the map as it is, still in the old projection, they would read as
  // the author's own edits; through the suggested projection they are open.
  assert.equal(mapChangeStatus(unit, ctx), "conflict");
  const placed = inSuggestedProjection(ctx, changes);
  assert.equal(mapChangeStatus(unit, placed), "open");
  assert.equal(mapChangeStatus(city, placed), "open");
  assert.equal(mapChangeStatus(borders, placed), "open");
  assert.deepEqual(state.doc.metadata.projection, undefined, "reading it that way moves nothing");
  assert.equal(state.doc.units[1].lat, 60);

  // Each needs the map moved first.
  assert.deepEqual(changeDependencies(unit, changes, ctx), ["map:projection"]);
  assert.deepEqual(changeDependencies(borders, changes, ctx), ["map:projection"]);

  // The panel's batch: the projection, then the rest against the document as
  // the conversion leaves it (the batch still holds the document it began with).
  const began = { ...ctx, doc: state.doc };
  applyMapChange(projection, began);
  const live = inSuggestedProjection(began, [projection], { regions: false });
  applyMapChange(borders, live);
  applyMapChange(city, live);
  applyMapChange(unit, live);
  assert.equal(calls.length, 1);
  assert.deepEqual(state.doc.metadata.projection, FLAT);
  // The city and the unit were found where the conversion had put them: edited, not added again.
  assert.equal(state.doc.units.length, 2);
  assert.deepEqual(state.doc.units[1], { ...state.doc.units[1], name: "Arctic Army", lng, lat });
  assert.equal(state.doc.features.filter((feature) => feature.name === "Northport").length, 1);
  assert.equal(state.doc.features.find((feature) => feature.name === "Northport").population, 9000);
  assert.deepEqual(measureGeometry(api.exportRegions(["r9"]).features[0].geometry).bbox, measureGeometry(grown).bbox);
  for (const change of changes) assert.equal(mapChangeStatus(change, inSuggestedProjection(ctx, changes)), "applied", change.id);
  // Once the map is there, nothing waits on the projection any more.
  assert.deepEqual(changeDependencies(unit, changes, ctx), []);
});

test("a suggested basemap is laid on the bounds the suggestion gives", () => {
  const { state, ctx } = setup();
  let shown = null;
  const data = { dataUrl: "data:image/png;base64,BBBB" };
  const change = { id: "map:background", area: "map", kind: "background", from: null, to: { kind: "image", hash: "h", data, bounds: sheetBounds("equirectangular") } };
  applyMapChange(change, { ...ctx, doc: state.doc, setBackground: (saved) => { shown = saved; } });
  assert.deepEqual(shown, { kind: "image", dataUrl: data.dataUrl, bounds: sheetBounds("equirectangular") });
});

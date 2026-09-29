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
//     addition first;
//   - a list is accepted in that order, ownership rows after every rename, and
//     a save counts what the map already has as accepted.

import test from "node:test";
import assert from "node:assert/strict";

import { renamePolityInDocument } from "../../server/polityRename.js";
import { acceptMapChanges, applyMapChange, changeDependencies, changeTargets, decisionOf, decisionsFor, mapChangeStatus, planAccept } from "./suggestionReview.js";
import { canonicalJson, hashText, measureGeometry } from "../runtime/scenarioChanges.js";
import { withoutPolities } from "./scenarioPuppets.js";

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
      return { polities, puppets: withoutPolities(current.puppets, key) };
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

test("undoing a rename puts back the country's own colour, flag, tags and record", () => {
  const { api, state, d, ctx } = setup();
  d.upsertPolity("Beta", { note: "The old kingdom." });
  d.setColorOverride("Beta", [9, 9, 9]);
  d.setFlag("Beta", "data:image/png;base64,OLD");
  d.setTags("Beta", ["monarchy"]);
  const before = clone({ polity: state.doc.polities.Beta, color: state.doc.colorOverrides.Beta, flag: state.doc.flags.Beta, tags: state.doc.tags.Beta });
  const rename = {
    id: "polity-rename:Beta", area: "map", kind: "polity-rename", from: "Beta", to: "Beta Republic",
    record: { name: "Beta Republic", note: "The new republic." }, color: [1, 2, 3], flag: "data:image/png;base64,NEW", tags: ["republic"],
  };
  const undo = applyMapChange(rename, ctx);
  assert.equal(state.doc.polities["Beta Republic"].note, "The new republic.");
  assert.deepEqual(state.doc.colorOverrides["Beta Republic"], [1, 2, 3]);
  undo();
  assert.equal(api.getRegionSummary("r3").owner, "Beta");
  assert.deepEqual(
    { polity: state.doc.polities.Beta, color: state.doc.colorOverrides.Beta, flag: state.doc.flags.Beta, tags: state.doc.tags.Beta },
    before,
    "the suggestion's values do not stay on the old country",
  );
  assert.equal(state.doc.polities["Beta Republic"], undefined);
  assert.equal(state.doc.colorOverrides["Beta Republic"], undefined);
  assert.equal(state.doc.flags["Beta Republic"], undefined);
  assert.equal(state.doc.tags["Beta Republic"], undefined);
  assert.equal(mapChangeStatus(rename, ctx), "open", "the row is open again, not quietly changed");
});

test("undoing a country's removal brings its puppet rows back and keeps a puppet accepted since", () => {
  const { state, d, ctx } = setup();
  d.setPuppets(() => [
    { id: "p-beta", overlord: "Alpha", puppet: "Beta", kind: "satellite", secrecy: "open", loyalty: 40, status: "active" },
  ]);
  const remove = { id: "polity-remove:Beta", area: "map", kind: "polity-remove", key: "Beta", record: { name: "Beta" } };
  const undoRemove = applyMapChange(remove, ctx);
  assert.equal(state.doc.polities.Beta, undefined);
  assert.deepEqual(state.doc.puppets, [], "the removal takes the rows naming the country");
  d.upsertPolity("Gamma", { name: "Gamma" });
  const puppet = { id: "puppet-add:p-gamma", area: "map", kind: "puppet-add", key: "p-gamma", to: { id: "p-gamma", overlord: "Alpha", puppet: "Gamma", kind: "satellite", secrecy: "open", loyalty: 60, status: "active" } };
  applyMapChange(puppet, ctx);
  undoRemove();
  assert.ok(state.doc.polities.Beta);
  assert.deepEqual(state.doc.puppets.map((row) => row.id).sort(), ["p-beta", "p-gamma"]);
  assert.equal(mapChangeStatus(puppet, ctx), "applied", "the later puppet change is still on the map");
});

test("a new set of cities is a conflict when the author's cities changed since, and applied once taken", () => {
  const { state, d, ctx } = setup();
  const suggested = [
    { name: "Newtown", coord: [0.2, 0.2], population: 20000, capital: true },
    { name: "Farport", coord: [10.5, 10.5], population: 3000, capital: false },
  ];
  const replace = { id: "cities-replace", area: "map", kind: "cities-replace", from: 1, to: suggested };
  assert.equal(mapChangeStatus(replace, ctx), "open", "the author still has the post's one city");
  d.setFeatures((list) => [...list, { id: "feat2", name: "Added", type: "Coordinate", coord: [5, 5], population: 10, tags: ["city"] }]);
  assert.equal(mapChangeStatus(replace, ctx), "conflict", "a city added since would be thrown away");
  const undo = applyMapChange(replace, ctx);
  assert.equal(mapChangeStatus(replace, ctx), "applied");
  undo();
  assert.equal(state.doc.features.length, 2);

  // Back to the built-in cities: the map stops carrying a set of its own.
  const builtIn = { id: "cities-replace", area: "map", kind: "cities-replace", from: 2, to: null };
  assert.equal(mapChangeStatus(builtIn, ctx), "open");
  const undoBuiltIn = applyMapChange(builtIn, ctx);
  assert.equal(state.doc.metadata.citiesAuthored, false);
  assert.equal(mapChangeStatus(builtIn, ctx), "applied");
  undoBuiltIn();
  assert.equal(state.doc.features.length, 2);
  assert.equal(state.doc.metadata.citiesAuthored, undefined);

  // The post had the built-in cities: any the author has now are their own.
  assert.equal(mapChangeStatus({ ...replace, from: null }, ctx), "conflict");
});

test("a new custom basemap is open, applied or a conflict by what the map has now", () => {
  const { d, ctx } = setup();
  const setBackground = (saved) => d.patchMetadata({ customBackground: saved });
  ctx.setBackground = setBackground;
  const hashOf = (data) => hashText(canonicalJson(data));
  const ours = { kind: "image", dataUrl: "data:image/png;base64,T1VSUw==" };
  const theirs = { dataUrl: "data:image/png;base64,VEhFSVJT" };
  setBackground(ours);
  const change = {
    id: "map:background", area: "map", kind: "background",
    from: { kind: "image", hash: hashOf({ dataUrl: ours.dataUrl }) },
    to: { kind: "image", hash: hashOf(theirs), data: theirs },
  };
  assert.equal(mapChangeStatus(change, ctx), "open");
  const undo = applyMapChange(change, ctx);
  assert.equal(mapChangeStatus(change, ctx), "applied");
  undo();
  assert.equal(mapChangeStatus(change, ctx), "open");
  setBackground({ kind: "image", dataUrl: "data:image/png;base64,T1RIRVI=" });
  assert.equal(mapChangeStatus(change, ctx), "conflict", "the author put another basemap on since");
  setBackground(null);
  assert.equal(mapChangeStatus({ ...change, to: null }, ctx), "applied", "no basemap is what the suggestion asks for");
});

test("cities, units, map features, puppets and groups: applied and taken back", () => {
  const { api, state, ctx } = setup();
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

  const marker = { id: "marker-add:m9", area: "map", kind: "marker-add", key: "m9", label: "Port", to: { id: "m9", name: "Port", kind: "port", ownerCode: "Beta", lng: 10.5, lat: 10.5, status: "active" } };
  applyMapChange(marker, ctx);
  assert.equal(mapChangeStatus(marker, ctx), "applied");
  assert.equal(state.doc.features.find((feature) => feature.markerId === "m9")?.kind, "port");

  const puppet = { id: "puppet-add:p1", area: "map", kind: "puppet-add", key: "p1", to: { id: "p1", overlord: "Alpha", puppet: "Beta", kind: "satellite", secrecy: "open", loyalty: 40, status: "active" } };
  const undoPuppet = applyMapChange(puppet, ctx);
  assert.equal(state.doc.puppets.length, 1);
  undoPuppet();
  assert.equal(state.doc.puppets.length, 0);

  const group = { id: "group-add:Raiders", area: "map", kind: "group-add", key: "Raiders", to: { name: "Raiders", description: "Bandits.", color: "#e11d48" } };
  const area = { id: "region-group:r1", area: "map", kind: "region-group", regionId: "r1", from: null, to: "Raiders" };
  assert.deepEqual(changeDependencies(area, [group, area], ctx), ["group-add:Raiders"]);
  applyMapChange(group, ctx);
  applyMapChange(area, ctx);
  assert.equal(api.getRegionSummary("r1").group, "Raiders");
  assert.equal(mapChangeStatus(area, ctx), "applied");
});

test("accepting a list: what it needs first, countries before regions, rows batched after the renames", () => {
  const { api, state, ctx } = setup();
  const addGamma = { id: "polity-add:Gamma", area: "map", kind: "polity-add", key: "Gamma", record: { name: "Gamma" }, color: null, flag: null, tags: null };
  const rename = { id: "polity-rename:Beta", area: "map", kind: "polity-rename", from: "Beta", to: "Beta Republic", record: { name: "Beta Republic" }, color: null, flag: null, tags: null };
  const toGamma = { id: "region-owner:r3", area: "map", kind: "region-owner", regionId: "r3", from: "Beta", to: "Gamma" };
  // Written against the old name, accepted in the same list as the rename.
  const toBeta = { id: "region-owner:r1", area: "map", kind: "region-owner", regionId: "r1", from: "Alpha", to: "Beta" };
  const toBeta2 = { id: "region-owner:r2", area: "map", kind: "region-owner", regionId: "r2", from: "Alpha", to: "Beta" };
  const puppet = { id: "puppet-add:p1", area: "map", kind: "puppet-add", key: "p1", to: { id: "p1", overlord: "Gamma", puppet: "Alpha", kind: "satellite", secrecy: "open", loyalty: 50, status: "active" } };
  const changes = [toBeta, toGamma, puppet, toBeta2, rename, addGamma];

  // A change pulls in what it needs, however it is reached, once.
  assert.deepEqual(planAccept([puppet, toGamma], ctx, { changes }).map((change) => change.id), ["polity-add:Gamma", "puppet-add:p1", "region-owner:r3"]);
  assert.deepEqual(planAccept([toGamma], ctx, { changes, accepted: new Set(["polity-add:Gamma"]) }).map((change) => change.id), ["region-owner:r3"]);

  const calls = [];
  const setRegionAttrs = api.setRegionAttrs;
  api.setRegionAttrs = (ids, patch) => { calls.push([...ids]); setRegionAttrs(ids, patch); };
  const result = acceptMapChanges([toBeta, toBeta2, toGamma, rename], ctx, { changes });
  assert.deepEqual(result.accepted.slice(0, 2), ["polity-rename:Beta", "polity-add:Gamma"], "the rename and the country the rows need go first");
  assert.deepEqual(new Set(result.accepted), new Set(["polity-rename:Beta", "polity-add:Gamma", "region-owner:r1", "region-owner:r2", "region-owner:r3"]));
  assert.deepEqual(result.renames, { Beta: "Beta Republic" });
  assert.equal(api.getRegionSummary("r1").owner, "Beta Republic", "a row written against the old name lands on the new one");
  assert.equal(api.getRegionSummary("r2").owner, "Beta Republic");
  assert.equal(api.getRegionSummary("r3").owner, "Gamma");
  assert.ok(state.doc.polities.Gamma);
  assert.deepEqual(calls, [["r1", "r2"], ["r3"]], "one map step per country the rows go to");
  assert.ok(result.accepted.every((id) => result.undoers.has(id)), "everything accepted here can be undone here");
  const gone = { id: "city-remove:nowhere", area: "map", kind: "city-remove", name: "Nowhere", from: { name: "Nowhere", coord: [50, 50] } };
  const nothing = acceptMapChanges([gone], ctx, { changes: [gone] });
  assert.equal(typeof nothing.undoers.get(gone.id), "function", "even a change with nothing to take back");

  // Each row's undo puts back its own owner from before.
  result.undoers.get("region-owner:r1")();
  assert.equal(api.getRegionSummary("r1").owner, "Alpha");
  assert.equal(api.getRegionSummary("r2").owner, "Beta Republic");

  // A rename accepted earlier in the review still applies to a later list.
  const later = acceptMapChanges([toBeta], ctx, { changes, accepted: new Set(result.accepted.filter((id) => id !== "region-owner:r1")), renames: result.renames });
  assert.deepEqual(later.accepted, ["region-owner:r1"]);
  assert.equal(api.getRegionSummary("r1").owner, "Beta Republic");
});

test("a save records what the map already has as accepted and what it lost as rejected", () => {
  const changes = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const decisions = { accepted: new Set(["c"]), rejected: new Set(["e"]) };
  const statuses = { a: "applied", b: "missing", c: "applied", d: "conflict", e: "applied" };
  assert.deepEqual(decisionsFor(changes, decisions, statuses), { accepted: ["c", "a"], rejected: ["e", "b"] }, "the author's own decision stands over the map's");
  assert.deepEqual(changes.map((change) => decisionOf(change, decisions, statuses)), ["accepted", "rejected", "accepted", null, "rejected"]);
});

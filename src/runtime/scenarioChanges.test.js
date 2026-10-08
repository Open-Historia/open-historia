/*! Open Historia — what changed between two versions of a scenario: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioChanges.test.js
//
// A suggestion is the difference between a community scenario's post and a
// player's edited copy. What has to hold:
//   - a scenario compared with itself has no changes, and neither does one a
//     save only re-wrote (rounding, the border cleanup's hairlines, a default
//     written out);
//   - every kind of edit shows up once, under the change an author would name;
//   - a border moved between two regions is ONE change, so accepting it cannot
//     leave half a border;
//   - a renamed country is a rename, not a deletion and a founding;
//   - a copy of a stock-world scenario (whose post ships no geometry) reports
//     only the regions its player drew or reshaped.

import test from "node:test";
import assert from "node:assert/strict";

import { countChanges, diffScenarioBundles, measureGeometry, sameShape, summarizeChangesForComment } from "./scenarioChanges.js";
import { layOutScenarioBundle, sheetBounds } from "../../server/mapProjection.js";

const square = (x, y, size = 1) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});
const region = (id, owner, geometry, extra = {}) => ({ type: "Feature", geometry, properties: { id, owner, name: `Region ${id}`, typeId: "land", ...extra } });
const embedded = (data) => ({ mode: "embedded", data });

const baseBundle = () => ({
  schema: "open-historia-scenario-bundle/2",
  scenario: { name: "Old World", heroTitle: "Old World", heroSubtitle: "A world.", description: "A world.", subtitle: "Base", features: {} },
  data: {
    game: { country: "Alpha", startDate: "1900-01-01", gameDate: "1900-01-01", language: "English" },
    prompts: { promptModel: 2, guidance: {} },
    world: {
      regionOwnershipOverrides: { r1: "Alpha", r2: "Alpha", r3: "Beta", r4: "Beta" },
      polityOverrides: {
        Alpha: { name: "Alpha", aliases: ["Alpha"], code: "Alpha", status: "active", note: "", color: "#112233" },
        Beta: { name: "Beta", aliases: [], status: "active", note: "", color: "#445566" },
      },
      regionClaimants: {},
      groups: { Raiders: { name: "Raiders", description: "Bandits.", color: "#e11d48" } },
      groupAreas: { r2: "Raiders" },
      units: [{ id: "u1", name: "1st Army", type: "infantry", ownerCode: "Alpha", lng: 0.5, lat: 0.5, strength: 100 }],
      markers: [{ id: "m1", name: "Fort", kind: "fortress", ownerCode: "Alpha", lng: 0.4, lat: 0.4, status: "active" }],
      puppets: [],
      simulationRules: "",
      author: "Ann",
    },
  },
  assets: {
    regionsGeojson: embedded({
      type: "FeatureCollection",
      features: [
        region("r1", "Alpha", square(0, 0)),
        region("r2", "Alpha", square(1, 0)),
        region("r3", "Beta", square(10, 10)),
        region("r4", "Beta", square(11, 10)),
      ],
    }),
    citiesGeojson: embedded({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { city: "Alphaville", population: 1000, capital: "primary", tier: 1 } }],
    }),
    colors: embedded({ Alpha: [17, 34, 51], Beta: [68, 85, 102] }),
    cover: { mode: "default" },
  },
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const featuresOf = (bundle) => bundle.assets.regionsGeojson.data.features;
const ids = (changes) => changes.map((change) => change.id).sort();

test("a scenario compared with itself, or re-saved, has no changes", () => {
  assert.deepEqual(diffScenarioBundles(baseBundle(), baseBundle()), []);
  const resaved = clone(baseBundle());
  // A save rounds to five decimals and writes defaults the post left out.
  for (const feature of featuresOf(resaved)) {
    feature.geometry.coordinates = feature.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x + 0.000001, y - 0.000001]));
  }
  resaved.data.world.polityOverrides.Beta = { ...resaved.data.world.polityOverrides.Beta, aliases: ["Beta"], code: "Beta", verbatim: true };
  resaved.data.world.ownerCodes = ["Alpha", "Beta"];
  resaved.data.world.customRegions = true;
  resaved.scenario.features = { espionage: { enabled: true } };
  // The store reads an empty hero title as the name, and a retired accent as today's.
  resaved.scenario.heroTitle = "Old World";
  resaved.scenario.accentColor = "#2BC1F3";
  const post = baseBundle();
  post.scenario.accentColor = "#7c3aed";
  assert.deepEqual(diffScenarioBundles(post, resaved), []);
});

test("the scenario's details: each edited field is one change with the post's value and the new one", () => {
  const next = clone(baseBundle());
  next.scenario.name = "New World";
  next.scenario.description = "A new world, fixed.";
  next.data.game.startDate = "1901-01-01";
  next.data.world.simulationRules = "No airships.";
  next.scenario.features = { espionage: { enabled: false }, worldDirection: { eventPace: 150 } };
  next.data.prompts = { promptModel: 2, guidance: { advisor: { role: "You are a gruff general." } } };
  const changes = diffScenarioBundles(baseBundle(), next);
  assert.deepEqual(ids(changes), [
    "features:espionage.enabled",
    "features:worldDirection.eventPace",
    "game:startDate",
    "meta:description",
    "meta:name",
    "prompts:advisor.role",
    "world:simulationRules",
  ]);
  const name = changes.find((change) => change.id === "meta:name");
  assert.equal(name.area, "details");
  assert.equal(name.from, "Old World");
  assert.equal(name.to, "New World");
  assert.equal(changes.find((change) => change.id === "prompts:advisor.role").text, true);
  assert.deepEqual(countChanges(changes), { details: 7, map: 0, byKind: { field: 7 } });
});

test("a border moved between two regions is one change, and a hairline is none", () => {
  const next = clone(baseBundle());
  const [r1, r2, r3] = featuresOf(next);
  // r1 grows east into r2: both reshape, and they touch.
  r1.geometry = { type: "Polygon", coordinates: [[[0, 0], [1.4, 0], [1.4, 1], [0, 1], [0, 0]]] };
  r2.geometry = { type: "Polygon", coordinates: [[[1.4, 0], [2, 0], [2, 1], [1.4, 1], [1.4, 0]]] };
  // r3, far away, moved by less than a save's cleanup would.
  r3.geometry = square(10.00001, 10.00001);
  const changes = diffScenarioBundles(baseBundle(), next).filter((change) => change.kind === "borders");
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].regions.map((entry) => `${entry.op}:${entry.id}`).sort(), ["reshape:r1", "reshape:r2"]);
  assert.ok(changes[0].regions.every((entry) => entry.feature && entry.fromShape && entry.toShape), "each carries its new shape and both measures");
  assert.equal(sameShape(measureGeometry(square(0, 0)), measureGeometry(square(0.000002, 0))), true);
  assert.equal(sameShape(measureGeometry(square(0, 0)), measureGeometry(square(0.2, 0))), false);
});

test("what a save's own border cleanup does to a region is no change", () => {
  // Every Workshop save runs the cleanup over the whole map (topologySweep.js),
  // and on a region the player never touched it made each of these.
  const shape = (geometry) => measureGeometry(geometry);
  const base = square(0, 0);
  // A speck: a stray triangle of a few metres, far away.
  const speck = { type: "MultiPolygon", coordinates: [base.coordinates, [[[3, 3], [3.001, 3], [3.001, 3.001], [3, 3]]]] };
  assert.equal(sameShape(shape(base), shape(speck)), true);
  // A spike: half a degree out and straight back.
  const spike = { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [0.5005, -0.5], [0.501, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  assert.equal(sameShape(shape(base), shape(spike)), true);
  // A stray part that is only a sliver, a few kilometres long.
  const sliver = { type: "MultiPolygon", coordinates: [base.coordinates, [[[2, 2], [2.02, 2.002], [2.03, 1.95], [2.0245, 2.0015], [2, 2]]]] };
  assert.equal(sameShape(shape(base), shape(sliver)), true);
  // A crack filled along the whole south border.
  const filled = { type: "Polygon", coordinates: [[[0, -0.001], [1, -0.001], [1, 1], [0, 1], [0, -0.001]]] };
  assert.equal(sameShape(shape(base), shape(filled)), true);
  // And one 1.3 km wide: the cleanup reaches 1.5 km (0.0135°), where it used
  // to stop at 500 m. On the built-in map it fills a triangle that moves
  // Freiburg's outline 0.0099° and a crack that adds 0.28% to Gillette.
  const filledWide = { type: "Polygon", coordinates: [[[0, -0.012], [1, -0.012], [1, 1], [0, 1], [0, -0.012]]] };
  assert.equal(sameShape(shape(base), shape(filledWide)), true);
});

test("a border the player redrew is a change, even a thin corridor out of a large region", () => {
  const base = square(0, 0, 3);
  // A corridor about a kilometre wide and half a degree long: next to no area
  // on a region this size, but the region now reaches much further east.
  const corridor = { type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 1.5], [3.5, 1.5], [3.5, 1.51], [3, 1.51], [3, 3], [0, 3], [0, 0]]] };
  assert.equal(sameShape(measureGeometry(base), measureGeometry(corridor)), false);
  assert.equal(sameShape(measureGeometry(base), measureGeometry(square(0, 0, 3.1))), false);
  // A whole border moved two kilometres: further than a cleanup reaches.
  const pushed = { type: "Polygon", coordinates: [[[0, -0.02], [1, -0.02], [1, 1], [0, 1], [0, -0.02]]] };
  assert.equal(sameShape(measureGeometry(square(0, 0)), measureGeometry(pushed)), false);
});

test("regions drawn and removed travel whole, with their owner, claims and group", () => {
  const next = clone(baseBundle());
  featuresOf(next).push(region("reg_new", "Gamma", square(20, 20)));
  next.data.world.regionOwnershipOverrides.reg_new = "Gamma";
  next.data.world.regionClaimants = { reg_new: ["Alpha"] };
  next.data.world.groupAreas.reg_new = "Raiders";
  next.data.world.polityOverrides.Gamma = { name: "Gamma", aliases: [], status: "active", note: "New." };
  next.assets.regionsGeojson.data.features = featuresOf(next).filter((feature) => feature.properties.id !== "r4");
  delete next.data.world.regionOwnershipOverrides.r4;
  const changes = diffScenarioBundles(baseBundle(), next);
  const borders = changes.filter((change) => change.kind === "borders");
  const added = borders.flatMap((change) => change.regions).find((entry) => entry.id === "reg_new");
  assert.equal(added.op, "add");
  assert.equal(added.feature.properties.owner, "Gamma");
  assert.deepEqual(added.feature.properties.claimants, ["Alpha"]);
  assert.equal(added.feature.properties.group, "Raiders");
  assert.ok(borders.flatMap((change) => change.regions).some((entry) => entry.id === "r4" && entry.op === "remove"));
  assert.ok(changes.some((change) => change.id === "polity-add:Gamma"));
  assert.ok(!changes.some((change) => change.kind === "region-owner"), "no ownership row for a region that travels whole");
});

test("ownership, names, claims and group areas of the regions both versions have", () => {
  const next = clone(baseBundle());
  next.data.world.regionOwnershipOverrides.r2 = "Beta";
  featuresOf(next)[0].properties.name = "Capital District";
  next.data.world.regionClaimants = { r3: ["Alpha"] };
  next.data.world.groupAreas = { r1: "Raiders" };
  const changes = diffScenarioBundles(baseBundle(), next);
  assert.deepEqual(ids(changes), ["region-claims:r3", "region-group:r1", "region-group:r2", "region-name:r1", "region-owner:r2"]);
  const owner = changes.find((change) => change.kind === "region-owner");
  assert.deepEqual([owner.from, owner.to, owner.regionName], ["Alpha", "Beta", "Region r2"]);
});

test("a renamed country is a rename, even when a region also changed hands", () => {
  const next = clone(baseBundle());
  const world = next.data.world;
  world.polityOverrides["Beta Republic"] = { ...world.polityOverrides.Beta, name: "Beta Republic" };
  delete world.polityOverrides.Beta;
  world.regionOwnershipOverrides.r3 = "Beta Republic";
  world.regionOwnershipOverrides.r4 = "Beta Republic";
  next.assets.colors.data["Beta Republic"] = next.assets.colors.data.Beta;
  delete next.assets.colors.data.Beta;
  for (const feature of featuresOf(next)) if (feature.properties.owner === "Beta") feature.properties.owner = "Beta Republic";
  const changes = diffScenarioBundles(baseBundle(), next);
  assert.deepEqual(ids(changes), ["polity-rename:Beta"]);
  assert.deepEqual(changes[0].regionIds.sort(), ["r3", "r4"]);

  // Renamed, and one of its regions went elsewhere in the same edit.
  world.regionOwnershipOverrides.r4 = "Alpha";
  featuresOf(next)[3].properties.owner = "Alpha";
  world.regionOwnershipOverrides.r5 = "Beta Republic";
  const second = diffScenarioBundles(baseBundle(), next);
  assert.ok(second.some((change) => change.id === "polity-rename:Beta"), "still a rename");
  assert.ok(second.some((change) => change.id === "region-owner:r4" && change.from === "Beta" && change.to === "Alpha"));
});

test("a country's own record, colour, flag and tags; a colour only where both versions chose one", () => {
  const next = clone(baseBundle());
  next.data.world.polityOverrides.Alpha.note = "The first power.";
  next.assets.colors.data.Alpha = [200, 0, 0];
  next.assets.flags = embedded({ Alpha: "data:image/png;base64,AAAA" });
  next.assets.tags = embedded({ Alpha: ["monarchy"] });
  // A colour written out for a country the post never coloured: a default, not a choice.
  next.assets.colors.data.Delta = [1, 2, 3];
  const [change] = diffScenarioBundles(baseBundle(), next);
  assert.equal(change.id, "polity-change:Alpha");
  assert.deepEqual(Object.keys(change.fields).sort(), ["color", "flag", "note", "tags"]);
  assert.deepEqual(change.fields.color.to, [200, 0, 0]);
});

test("cities by name and place, units, map features, groups and puppets by id", () => {
  const next = clone(baseBundle());
  next.assets.citiesGeojson.data.features[0].properties.population = 5000;
  next.assets.citiesGeojson.data.features.push({ type: "Feature", geometry: { type: "Point", coordinates: [10.5, 10.5] }, properties: { city: "Betaburg", population: 300 } });
  next.data.world.units[0].strength = 60;
  next.data.world.units.push({ id: "u2", name: "Fleet", type: "naval", ownerCode: "Beta", lng: 11, lat: 11 });
  next.data.world.markers = [];
  next.data.world.groups.Raiders.description = "Bandits of the hills.";
  next.data.world.groups.Rebels = { name: "Rebels", description: "Up in arms.", color: "#3b82f6" };
  next.data.world.puppets = [{ id: "puppet-beta", overlord: "Alpha", puppet: "Beta", kind: "satellite", secrecy: "open", loyalty: 40, status: "active" }];
  const changes = diffScenarioBundles(baseBundle(), next);
  assert.deepEqual(ids(changes), [
    "city-add:betaburg@10.50,10.50",
    "city-change:alphaville@0.50,0.50",
    "group-add:Rebels",
    "group-change:Raiders",
    "marker-remove:m1",
    "puppet-add:puppet-beta",
    "unit-add:u2",
    "unit-change:u1",
  ]);
});

test("a copy of a stock-world scenario reports only what its player drew, reshaped or re-owned", () => {
  const post = baseBundle();
  post.assets.regionsGeojson = { mode: "default" };
  post.data.world.regionOwnershipOverrides = { "USA.1_1": "Alpha" };
  post.data.world.polityOverrides = { Alpha: { name: "Alpha", aliases: [], status: "active" } };
  post.data.world.groupAreas = {};
  const copy = clone(post);
  copy.assets.regionsGeojson = embedded({
    type: "FeatureCollection",
    features: [
      region("USA.1_1", "Alpha", square(0, 0), { gid0: "USA" }),
      region("USA.2_1", "Mexico", square(1, 0), { gid0: "USA" }),
      region("USA.3_1", "United States", square(2, 0), { gid0: "USA", edited: true }),
      region("USA.4_1", "United States", square(3, 0), { gid0: "USA" }),
      region("reg_abc", "Alpha", square(9, 9)),
    ],
  });
  copy.data.world.regionOwnershipOverrides = { "USA.1_1": "Alpha", "USA.2_1": "Mexico", "USA.3_1": "United States", "USA.4_1": "United States", reg_abc: "Alpha" };
  const changes = diffScenarioBundles(post, copy);
  assert.deepEqual(ids(changes.filter((change) => change.kind === "region-owner")), ["region-owner:USA.2_1"], "USA.2_1 moved from its stock owner; the rest are the stock map");
  assert.equal(changes.find((change) => change.kind === "region-owner").from, "United States");
  const shaped = changes.filter((change) => change.kind === "borders").flatMap((change) => change.regions.map((entry) => `${entry.op}:${entry.id}`)).sort();
  assert.deepEqual(shaped, ["add:reg_abc", "reshape:USA.3_1"]);
});

test("a post keyed by codes is read the way the stores migrate it, landless leftovers aside", () => {
  const post = baseBundle();
  delete post.data.world.ownerSchema;
  post.data.world.regionOwnershipOverrides = { r1: "RUS", r2: "RUS", r3: "Beta", r4: "Beta" };
  post.data.world.polityOverrides = { Beta: post.data.world.polityOverrides.Beta, Z01: { name: "Z01", aliases: [] } };
  featuresOf(post)[0].properties.owner = "RUS";
  featuresOf(post)[1].properties.owner = "RUS";
  delete post.assets.colors;
  const copy = clone(baseBundle());
  copy.data.world.ownerSchema = 4;
  copy.data.world.regionOwnershipOverrides = { r1: "Russia", r2: "Russia", r3: "Beta", r4: "Beta" };
  copy.data.world.polityOverrides = { Beta: copy.data.world.polityOverrides.Beta, China: { name: "China", aliases: [] } };
  featuresOf(copy)[0].properties.owner = "Russia";
  featuresOf(copy)[1].properties.owner = "Russia";
  delete copy.assets.colors;
  assert.deepEqual(diffScenarioBundles(post, copy), [], "RUS is Russia, and a technical record with no land is the migration's");
  copy.data.world.regionOwnershipOverrides.r2 = "Beta";
  assert.deepEqual(ids(diffScenarioBundles(post, copy)), ["region-owner:r2"]);
});

test("the comment's summary says what changed in a few plain lines", () => {
  const next = clone(baseBundle());
  next.scenario.name = "New World";
  next.data.world.regionOwnershipOverrides.r2 = "Beta";
  next.data.world.regionOwnershipOverrides.r1 = "Beta";
  const lines = summarizeChangesForComment(diffScenarioBundles(baseBundle(), next));
  assert.deepEqual(lines, ["Name changed", "2 regions change owner"]);
});

// ---- a map moved to another projection ---------------------------------------------

const withPicture = (bundle) => {
  bundle.data.world.background = { kind: "image" };
  bundle.assets.backgroundData = embedded({ dataUrl: "data:image/png;base64,AAAA" });
  return bundle;
};

test("a map moved to another projection is one change, and what else changed is told apart from the move", () => {
  const post = withPicture(baseBundle());
  // The copy is the same map laid out as a flat sheet: every region, the city,
  // the unit and the map feature are somewhere else now.
  const declared = clone(post);
  declared.data.world.projection = "equirectangular";
  const copy = layOutScenarioBundle(declared);
  const moved = featuresOf(copy)[2].geometry.coordinates[0][2];
  assert.ok(Math.abs(moved[1] - 11) > 0.05, "the far region really moved");
  const changes = diffScenarioBundles(post, copy);
  assert.deepEqual(ids(changes), ["map:projection"]);
  assert.equal(changes[0].kind, "projection");
  assert.deepEqual(changes[0].from, { type: "mercator" });
  assert.deepEqual(changes[0].to, { type: "equirectangular" });
  // Where the picture lies goes with it, and the picture itself is not a change.
  assert.deepEqual(changes[0].bounds, sheetBounds("equirectangular"));
  assert.deepEqual(summarizeChangesForComment(changes), ["Map projection changed"]);

  // Something else changed on top: it is told apart, and written for the map
  // in its new projection.
  copy.data.world.units[0].name = "First Army";
  const both = diffScenarioBundles(post, copy);
  assert.deepEqual(ids(both), ["map:projection", "unit-change:u1"]);
  const unit = both.find((change) => change.kind === "unit-change");
  assert.ok(Math.abs(unit.from.lat - unit.to.lat) < 1e-4, "only the name differs");
  assert.ok(Math.abs(unit.to.lat - copy.data.world.units[0].lat) < 1e-4, "at its place on the flat map");
  assert.equal(unit.to.name, "First Army");
});

test("a file that only declares its projection reads as its laid-out copy, and the two switches are a change of their own", () => {
  const declared = withPicture(baseBundle());
  declared.data.world.projection = "equirectangular";
  assert.deepEqual(diffScenarioBundles(declared, layOutScenarioBundle(declared)), []);

  const post = baseBundle();
  const flat = clone(post);
  flat.data.world.projection = { type: "mercator", globe: false, wrap: false };
  const changes = diffScenarioBundles(post, flat);
  assert.deepEqual(ids(changes), ["map:projection"]);
  assert.deepEqual(changes[0].to, { type: "mercator", globe: false, wrap: false });
  assert.equal(changes[0].bounds, undefined);
});

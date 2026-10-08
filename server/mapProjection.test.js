/*! Open Historia — map projection tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/mapProjection.test.js
//
// Runs without node_modules: mapProjection.js imports nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROJECTION,
  FREEFORM,
  MERCATOR_MAX_LAT,
  PROJECTIONS,
  boundsFillSquare,
  convertBounds,
  convertDisplayPoint,
  convertPlane,
  declareFlatMapFromPost,
  declaredProjectionOf,
  displayToGeo,
  geoToDisplay,
  imageQuad,
  isWorldProjection,
  layOutScenarioBundle,
  moveGeojson,
  movePlaces,
  normalizeImageBounds,
  normalizeProjection,
  postSaysFlatMap,
  projectionIsLaidOut,
  sameProjection,
  sheetAspect,
  sheetBounds,
} from "./mapProjection.js";

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} is not within ${tolerance} of ${expected}`);
const WORLD = PROJECTIONS.map((entry) => entry.id).filter((id) => id !== FREEFORM);

test("the list the Workshop offers: Mercator first, freeform last, each one known", () => {
  assert.equal(PROJECTIONS[0].id, "mercator");
  assert.equal(PROJECTIONS.at(-1).id, FREEFORM);
  assert.equal(DEFAULT_PROJECTION, "mercator");
  for (const id of WORLD) assert.equal(isWorldProjection(id), true, id);
  assert.equal(isWorldProjection(FREEFORM), false, "freeform is a sheet, not a projection of a globe");
  assert.equal(new Set(PROJECTIONS.map((entry) => entry.id)).size, PROJECTIONS.length);
});

test("a projection is read from a name or an object, and anything unknown is Mercator", () => {
  assert.deepEqual(normalizeProjection("equirectangular"), { type: "equirectangular" });
  assert.deepEqual(normalizeProjection("Equal Earth"), { type: "equal-earth" });
  assert.deepEqual(normalizeProjection({ type: "robinson", laidOut: true }), { type: "robinson" });
  assert.deepEqual(normalizeProjection({ type: "freeform", aspect: 1.5 }), { type: "freeform", aspect: 1.5 });
  assert.deepEqual(normalizeProjection("freeform"), { type: "freeform", aspect: 2 });
  for (const value of [undefined, null, "", "peirce quincuncial", 7, [], { type: 3 }]) assert.deepEqual(normalizeProjection(value), { type: "mercator" });
  assert.equal(sameProjection("mercator", undefined), true);
  assert.equal(sameProjection({ type: "freeform", aspect: 2 }, { type: "freeform", aspect: 1 }), false);
  assert.equal(projectionIsLaidOut({ type: "robinson", laidOut: true }), true);
  assert.equal(projectionIsLaidOut("robinson"), false);
  assert.equal(projectionIsLaidOut({ type: "robinson" }), false);
});

test("Mercator stores a place where it is: every map made before this is unchanged", () => {
  for (const [lon, lat] of [[0, 0], [13.4, 52.5], [-122.4, 37.8], [151.2, -33.9], [-70.6, -80]]) {
    const [x, y] = geoToDisplay("mercator", lon, lat);
    near(x, lon, 1e-6);
    near(y, lat, 1e-6);
  }
  assert.deepEqual(sheetBounds("mercator"), { west: -180, south: -85.051129, east: 180, north: 85.051129 });
  assert.equal(boundsFillSquare(sheetBounds("mercator")), true);
  near(sheetAspect("mercator"), 1, 1e-9);
});

test("every world projection: a place goes onto its sheet and comes back", () => {
  for (const type of WORLD) {
    for (const [lon, lat] of [[0, 0], [10, 45], [-120, 30], [170, -60], [-45, 80], [90, -15], [-179, 5]]) {
      if (type === "mercator" && Math.abs(lat) > MERCATOR_MAX_LAT) continue;
      const [x, y] = geoToDisplay(type, lon, lat);
      assert.ok(Math.abs(x) <= 180 && Math.abs(y) <= MERCATOR_MAX_LAT, `${type}: ${lon},${lat} lands on the square`);
      const [backLon, backLat] = displayToGeo(type, x, y);
      near(backLon, lon, 2e-4, `${type} longitude of ${lon},${lat}`);
      near(backLat, lat, 2e-4, `${type} latitude of ${lon},${lat}`);
    }
    // The equator spans the whole width, and the centre stays the centre.
    near(geoToDisplay(type, 180, 0)[0], 180, 1e-5, `${type} east edge`);
    assert.deepEqual(geoToDisplay(type, 0, 0), [0, 0], type);
  }
});

test("each sheet has the shape its projection is known for", () => {
  near(sheetAspect("equirectangular"), 2, 1e-9);
  near(sheetAspect("gall-peters"), Math.PI / 2, 1e-9);
  near(sheetAspect("mollweide"), 2, 1e-9);
  near(sheetAspect("sinusoidal"), 2, 1e-9);
  near(sheetAspect("miller"), 1.3639, 1e-3);
  near(sheetAspect("robinson"), 1.9716, 1e-3);
  near(sheetAspect("equal-earth"), 2.0546, 1e-3);
  near(sheetAspect("natural-earth"), 1.9231, 2e-3);
  near(sheetAspect({ type: FREEFORM, aspect: 16 / 9 }), 16 / 9, 1e-9);
  near(sheetAspect({ type: FREEFORM, aspect: 0.5 }), 0.5, 1e-9);
  // An equirectangular sheet is the middle half of the square: 66.51 degrees.
  assert.deepEqual(sheetBounds("equirectangular"), { west: -180, south: -66.51326, east: 180, north: 66.51326 });
  // A tall freeform sheet is the square's height and less than its width.
  assert.deepEqual(sheetBounds({ type: FREEFORM, aspect: 0.5 }), { west: -90, south: -85.051129, east: 90, north: 85.051129 });
});

test("on an evenly spaced sheet a circle stays a circle wherever it is", () => {
  // A scenario laid out on a 2:1 picture: a planet 6 degrees across near the
  // bottom of the sheet (Lothal, at -58.7) and one at the middle.
  const size = (lat) => {
    const [west] = geoToDisplay("equirectangular", 39.7, lat);
    const [east] = geoToDisplay("equirectangular", 45.7, lat);
    const south = geoToDisplay("equirectangular", 42.7, lat - 3)[1];
    const north = geoToDisplay("equirectangular", 42.7, lat + 3)[1];
    // Heights compared on the Mercator plane, where the screen draws them.
    const plane = (value) => Math.asinh(Math.tan((value * Math.PI) / 180)) * (180 / Math.PI);
    return { width: east - west, height: plane(north) - plane(south) };
  };
  for (const lat of [0, -58.7, 45]) {
    const { width, height } = size(lat);
    near(width, 6, 1e-4, `width at ${lat}`);
    near(height, 6, 1e-4, `height at ${lat}`);
  }
  // And it lies where the picture shows it: 58.7 of 90 down the sheet's half.
  const y = geoToDisplay("equirectangular", 42.7, -58.725)[1];
  const fraction = Math.asinh(Math.tan((y * Math.PI) / 180)) / (Math.PI / 2);
  near(fraction, -58.725 / 90, 1e-6);
});

test("between two world projections a place keeps its place on the globe", () => {
  const paris = [2.35, 48.85];
  const asRobinson = geoToDisplay("robinson", ...paris);
  const moved = convertDisplayPoint("robinson", "mollweide", ...asRobinson);
  const direct = geoToDisplay("mollweide", ...paris);
  near(moved[0], direct[0], 2e-4);
  near(moved[1], direct[1], 2e-4);
  // There and back again.
  const back = convertDisplayPoint("mollweide", "robinson", ...moved);
  near(back[0], asRobinson[0], 5e-4);
  near(back[1], asRobinson[1], 5e-4);
  assert.deepEqual(convertPlane("miller", "miller", 0.5, -0.25), [0.5, -0.25]);
});

test("to and from freeform the sheet is stretched, not sent round a globe", () => {
  // A map drawn in the Workshop over a 2:1 picture squeezed onto the square,
  // moved to a freeform sheet of the picture's own shape: widths stay, heights
  // halve on the plane, so the picture is itself again and the map still on it.
  const wide = { type: FREEFORM, aspect: 2 };
  assert.deepEqual(convertPlane("mercator", wide, 1, 2), [1, 1]);
  assert.deepEqual(convertPlane(wide, "mercator", 1, 1), [1, 2]);
  assert.deepEqual(convertPlane(wide, { type: FREEFORM, aspect: 1 }, 1, 1), [1, 2]);
  // A tall sheet loses width instead.
  assert.deepEqual(convertPlane("mercator", { type: FREEFORM, aspect: 0.5 }, 2, 1), [1, 1]);
  // The four corners of the old sheet are the four corners of the new one.
  const corner = convertDisplayPoint("mercator", wide, 180, MERCATOR_MAX_LAT);
  near(corner[0], 180, 1e-6);
  near(corner[1], sheetBounds(wide).north, 1e-5);
});

test("a picture's bounds: read, refused, and what an image source is given", () => {
  assert.deepEqual(normalizeImageBounds({ west: -180, south: -66.5, east: 180, north: 66.5 }), { west: -180, south: -66.5, east: 180, north: 66.5 });
  assert.deepEqual(normalizeImageBounds({ west: -500, south: -99, east: 500, north: 99 }), { west: -180, south: -MERCATOR_MAX_LAT, east: 180, north: MERCATOR_MAX_LAT });
  for (const value of [null, undefined, [], "x", {}, { west: 1, south: 0, east: 1, north: 5 }, { west: 0, south: 5, east: 9, north: 5 }, { west: "a", south: 0, east: 1, north: 1 }]) {
    assert.equal(normalizeImageBounds(value), null, JSON.stringify(value));
  }
  // No bounds: the square, as every picture was always drawn.
  assert.deepEqual(imageQuad(null), [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]]);
  assert.deepEqual(imageQuad(undefined, { globe: true }), [[-180, 89.9], [180, 89.9], [180, -89.9], [-180, -89.9]]);
  assert.deepEqual(imageQuad(sheetBounds("mercator"), { globe: true })[0], [-180, 89.9], "the square's own bounds are the same thing");
  assert.deepEqual(imageQuad({ west: -180, south: -66.5, east: 180, north: 66.5 }, { globe: true }), [[-180, 66.5], [180, 66.5], [180, -66.5], [-180, -66.5]]);
  // Bounds follow their map.
  near(convertBounds("mercator", { type: FREEFORM, aspect: 2 }, null).north, 66.51326, 1e-5);
  assert.deepEqual(convertBounds("equirectangular", "equirectangular", sheetBounds("equirectangular")), sheetBounds("equirectangular"));
});

test("geometry and plain game data are moved whole, and nothing else is touched", () => {
  const up = (lon, lat) => [lon, lat + 1];
  const collection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "a", lat: 5 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1, 99], [0, 0]]] } },
      { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]] } },
      { type: "Feature", properties: {}, geometry: null },
    ],
  };
  const moved = moveGeojson(collection, up);
  assert.deepEqual(moved.features[0].geometry.coordinates, [[[0, 1], [1, 1], [1, 2, 99], [0, 1]]]);
  assert.deepEqual(moved.features[0].properties, { id: "a", lat: 5 }, "a feature's properties are not places");
  assert.deepEqual(moved.features[1].geometry.coordinates[0][0][0], [5, 6]);
  assert.equal(moved.features[2].geometry, null);
  assert.deepEqual(collection.features[0].geometry.coordinates[0][0], [0, 0], "the original is not changed");

  const world = {
    basemap: "ocean",
    units: [{ id: "u1", lng: 10, lat: 20, strength: 90 }, { id: "u2", lon: 1, lat: 2 }, { id: "u3", lat: 7 }],
    markers: [{ id: "m", longitude: 3, latitude: 4, area: { type: "Point", coordinates: [8, 9] } }],
    background: { kind: "image", bounds: { west: -180, south: -60, east: 180, north: 60 } },
    names: ["a", "b"],
  };
  const next = movePlaces(world, up);
  assert.deepEqual(next.units, [{ id: "u1", lng: 10, lat: 21, strength: 90 }, { id: "u2", lon: 1, lat: 3 }, { id: "u3", lat: 7 }]);
  assert.deepEqual(next.markers, [{ id: "m", longitude: 3, latitude: 5, area: { type: "Point", coordinates: [8, 10] } }]);
  assert.deepEqual(next.background, world.background);
  assert.deepEqual(next.names, ["a", "b"]);
});

const bundleOf = (world, extra = {}) => ({
  schema: "open-historia-scenario-bundle/2",
  scenario: { id: "s", name: "S" },
  data: { world, events: [{ id: "e", lng: 0, lat: 45 }], game: { country: "A" } },
  assets: {
    regionsGeojson: { contentType: "application/json", mode: "embedded", data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "r" }, geometry: { type: "Polygon", coordinates: [[[40, -60], [46, -60], [46, -57], [40, -60]]] } }] } },
    citiesGeojson: { mode: "embedded", data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { city: "Lothal" }, geometry: { type: "Point", coordinates: [42.705, -58.725] } }] } },
    backgroundData: { mode: "embedded", data: { dataUrl: "data:image/jpeg;base64,AAAA" } },
    cover: { mode: "embedded", data: "AAAA" },
    ...extra,
  },
});

test("a file that declares its projection is laid out once on import", () => {
  const bundle = bundleOf({ projection: "equirectangular", background: { kind: "image" }, units: [{ id: "u", lng: 0, lat: -0.18 }, { id: "v", lng: 42.7, lat: -58.725 }], basemap: "ocean" });
  assert.deepEqual(declaredProjectionOf(bundle), { type: "equirectangular" });
  const laid = layOutScenarioBundle(bundle);
  assert.notEqual(laid, bundle);
  assert.deepEqual(laid.data.world.projection, { type: "equirectangular", laidOut: true });
  assert.deepEqual(laid.data.world.background, { kind: "image", bounds: sheetBounds("equirectangular") });
  const expected = geoToDisplay("equirectangular", 42.705, -58.725);
  assert.deepEqual(laid.assets.citiesGeojson.data.features[0].geometry.coordinates, expected);
  near(expected[1], -50.5224, 0.001, "58.7 down the sheet is drawn at 50.5 south");
  assert.deepEqual(laid.assets.regionsGeojson.data.features[0].geometry.coordinates[0][0], geoToDisplay("equirectangular", 40, -60));
  assert.deepEqual(laid.data.world.units[1], { id: "v", lng: 42.7, lat: geoToDisplay("equirectangular", 42.7, -58.725)[1] });
  assert.deepEqual(laid.data.events[0], { id: "e", lng: 0, lat: geoToDisplay("equirectangular", 0, 45)[1] });
  assert.equal(laid.data.world.basemap, "ocean");
  assert.deepEqual(laid.assets.backgroundData, bundle.assets.backgroundData, "the picture is not touched");
  assert.equal(laid.assets.cover, bundle.assets.cover);
  assert.equal(bundle.data.world.projection, "equirectangular", "the bundle handed in is not changed");

  // Imported again (an export of the imported scenario): nothing more is done.
  assert.equal(declaredProjectionOf(laid), null);
  assert.equal(layOutScenarioBundle(laid), laid);
});

test("a file that declares nothing, or Mercator, is imported as it always was", () => {
  for (const world of [{ background: { kind: "image" } }, { projection: "mercator", background: { kind: "image" } }, { projection: "no such thing" }, {}]) {
    const bundle = bundleOf(world);
    assert.equal(layOutScenarioBundle(bundle), bundle);
  }
  assert.equal(layOutScenarioBundle(null), null);
  assert.equal(layOutScenarioBundle({ schema: "x" }).schema, "x");
});

test("geometry that travelled as base64 is laid out too, and unreadable data is left for the importer", () => {
  const data = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [10, 60] } }] };
  const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  const bundle = bundleOf({ projection: "equirectangular" }, { citiesGeojson: { mode: "embedded", encoding: "base64", data: encoded }, regionsGeojson: { mode: "embedded", data: "not base64 json" }, stats: { mode: "default" } });
  const laid = layOutScenarioBundle(bundle);
  assert.deepEqual(laid.assets.citiesGeojson, { mode: "embedded", data: { ...data, features: [{ ...data.features[0], geometry: { type: "Point", coordinates: geoToDisplay("equirectangular", 10, 60) } }] } });
  assert.equal(laid.assets.regionsGeojson, bundle.assets.regionsGeojson);
  assert.deepEqual(laid.assets.stats, { mode: "default" });
});

test("a freeform file spreads its x and y evenly over a sheet of its own shape", () => {
  const bundle = bundleOf({ projection: { type: "freeform", aspect: 1 }, background: { kind: "image" }, units: [{ id: "u", lng: 90, lat: 45 }] });
  const laid = layOutScenarioBundle(bundle);
  assert.deepEqual(laid.data.world.projection, { type: "freeform", aspect: 1, laidOut: true });
  // A square sheet is the whole square: half way across, half way up the plane.
  assert.equal(laid.data.world.units[0].lng, 90);
  near(Math.asinh(Math.tan((laid.data.world.units[0].lat * Math.PI) / 180)), Math.PI / 2, 1e-5);
  assert.equal(boundsFillSquare(laid.data.world.background.bounds), true);
});

test("a vector basemap is geometry on the same globe and moves with the map", () => {
  const geojson = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#123" }, geometry: { type: "Polygon", coordinates: [[[0, 60], [10, 60], [10, 70], [0, 60]]] } }] };
  const laid = layOutScenarioBundle(bundleOf({ projection: "robinson", background: { kind: "vector" } }, { backgroundData: { mode: "embedded", data: { geojson } } }));
  assert.deepEqual(laid.assets.backgroundData.data.geojson.features[0].geometry.coordinates[0][1], geoToDisplay("robinson", 10, 60));
  assert.deepEqual(laid.data.world.background, { kind: "vector" });
});

test("a hub post labelled flat map is imported as an evenly spaced sheet, and only then", () => {
  assert.equal(postSaysFlatMap({ labels: [{ name: "scenario" }, { name: "Flat Map" }] }), true);
  assert.equal(postSaysFlatMap({ labels: ["flat map"] }), true);
  assert.equal(postSaysFlatMap({ labels: [{ name: "scenario" }] }), false);
  assert.equal(postSaysFlatMap(null), false);

  const post = { labels: [{ name: "scenario" }, { name: "flat map" }] };
  const bundle = bundleOf({ background: { kind: "image" } });
  const declared = declareFlatMapFromPost(bundle, post);
  assert.equal(declared.data.world.projection, "equirectangular");
  assert.equal(bundle.data.world.projection, undefined);
  assert.deepEqual(layOutScenarioBundle(declared).data.world.projection, { type: "equirectangular", laidOut: true });

  // Not labelled; a file that speaks for itself; one already laid out; no picture.
  assert.equal(declareFlatMapFromPost(bundle, { labels: [{ name: "scenario" }] }), bundle);
  for (const world of [{ projection: "mercator", background: { kind: "image" } }, { projection: { type: "robinson", laidOut: true }, background: { kind: "image" } }, { background: { kind: "image", bounds: sheetBounds("equirectangular") } }, { background: { kind: "vector" } }, {}]) {
    const other = bundleOf(world);
    assert.equal(declareFlatMapFromPost(other, post), other, JSON.stringify(world));
  }
});

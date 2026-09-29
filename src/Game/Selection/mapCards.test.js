/*! Open Historia — what the map's selection cards share: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/mapCards.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { cardScreenPoint, isBehindGlobe, isSameFeatureSelection, isSameRegionSelection, regionControlStatus } from "./mapCards.js";

// A stand-in for MapLibre: a flat map projects longitude straight across the
// screen, `pixelsPerDegree` to the degree, centred on `center`.
const fakeMap = ({ projection = "mercator", center = { lng: 20, lat: 0 }, width = 1600, height = 900, pixelsPerDegree = 1600 / 284 } = {}) => ({
  getProjection: () => ({ type: projection }),
  getCenter: () => center,
  getContainer: () => ({ clientWidth: width, clientHeight: height }),
  project: ({ lng, lat }) => ({
    x: width / 2 + (lng - center.lng) * pixelsPerDegree,
    y: height / 2 - (lat - center.lat) * pixelsPerDegree,
  }),
});

const TOKYO = { lng: 139.7, lat: 35.7 };

test("on the flat map a place more than 90 degrees from the centre still gets its card", () => {
  // Zoomed out over Africa, about 284 degrees of longitude across the screen.
  const map = fakeMap();
  assert.equal(isBehindGlobe(map.getCenter(), TOKYO), true, "the globe's horizon test would have hidden it");
  const point = cardScreenPoint(map, TOKYO);
  assert.ok(point, "Japan is on screen, so its card is too");
  assert.ok(point.x > 800 && point.x < 1600);
});

test("on the globe a place on the far side has no card", () => {
  const map = fakeMap({ projection: "globe" });
  assert.equal(cardScreenPoint(map, TOKYO), null);
  assert.ok(cardScreenPoint(map, { lng: 30, lat: 10 }), "the near side keeps its card");
});

test("a place off the edge of the screen has no card until it comes back", () => {
  const map = fakeMap({ pixelsPerDegree: 40 });
  assert.equal(cardScreenPoint(map, TOKYO), null);
  assert.ok(cardScreenPoint(map, { lng: 25, lat: 5 }));
});

test("the flat map's copy of the world that is on screen is the one pointed at", () => {
  // Centred on the Pacific: a place clicked at lng -170 is shown just east of
  // the antimeridian, and a click reported a whole turn round lands there too.
  const map = fakeMap({ center: { lng: 175, lat: 0 }, pixelsPerDegree: 20 });
  const direct = cardScreenPoint(map, { lng: -175, lat: 0 });
  assert.ok(direct);
  assert.equal(Math.round(direct.x), 800 + 10 * 20);
});

test("no map or no place, no card", () => {
  assert.equal(cardScreenPoint(null, TOKYO), null);
  assert.equal(cardScreenPoint(fakeMap(), null), null);
  assert.equal(cardScreenPoint(fakeMap(), { lng: Number.NaN, lat: 0 }), null);
});

test("a second structure of the same name is another structure", () => {
  const base = { source: "marker", id: "marker-1", name: "Naval Base", lng: 10, lat: 50 };
  assert.equal(isSameFeatureSelection(base, { ...base }), true, "the same marker closes its card");
  assert.equal(isSameFeatureSelection(base, { ...base, id: "marker-2", lng: 20 }), false);
});

test("two towns of one name are told apart by where they are", () => {
  const springfield = { source: "city", name: "Springfield", lng: -89.65, lat: 39.8 };
  assert.equal(isSameFeatureSelection(springfield, { ...springfield }), true);
  assert.equal(isSameFeatureSelection(springfield, { ...springfield, lng: -72.59, lat: 42.1 }), false);
  assert.equal(isSameFeatureSelection(springfield, { ...springfield, source: "marker" }), false, "a city is never a structure");
  assert.equal(isSameFeatureSelection(null, springfield), false);
});

test("two drawn regions of one name are two regions", () => {
  const first = { COUNTRY: "", NAME_1: "New Region", GID_1: "reg_1" };
  assert.equal(isSameRegionSelection(first, { ...first }), true);
  assert.equal(isSameRegionSelection(first, { ...first, GID_1: "reg_2" }), false);
  assert.equal(
    isSameRegionSelection({ COUNTRY: "France", NAME_1: "Bretagne" }, { COUNTRY: "France", NAME_1: "Bretagne" }),
    true,
    "without ids, the country and the name",
  );
  assert.equal(isSameRegionSelection(null, first), false);
});

test("a claim on unowned land is named on the region card", () => {
  const name = (code) => ({ FRA: "France", ESP: "Spain" }[code] ?? code);
  assert.equal(regionControlStatus({ claimants: ["FRA"], displayName: name }).status, "Unclaimed, claimed by France");
  assert.equal(regionControlStatus({ claimants: ["FRA", "ESP"], displayName: name }).status, "Unclaimed, contested");
  assert.equal(regionControlStatus({}).status, null, "unowned land nobody claims has no status");
});

test("owned land keeps its occupied and contested statuses", () => {
  assert.equal(regionControlStatus({ controllerCode: "A", sovereignCode: "A" }).status, null, "held the normal way");
  assert.equal(regionControlStatus({ controllerCode: "A", sovereignCode: "B" }).status, "Occupied");
  assert.equal(regionControlStatus({ controllerCode: "A", sovereignCode: "A", claimants: ["B"] }).status, "Contested");
  assert.equal(regionControlStatus({ controllerCode: "A", sovereignCode: "B", claimants: ["C"] }).status, "Occupied / contested");
});

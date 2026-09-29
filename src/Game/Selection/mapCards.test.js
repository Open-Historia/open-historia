/*! Open Historia — what the map's selection cards share: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/mapCards.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { cardScreenPoint, isBehindGlobe } from "./mapCards.js";

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

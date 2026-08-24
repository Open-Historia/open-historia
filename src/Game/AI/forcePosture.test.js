/*! Open Historia — force posture digest tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/forcePosture.test.js
//
// Runs without node_modules: forcePosture.js imports only runtime/unitMotion.js,
// which is itself import-free. The PMTiles side lives in territoryOutlines.js.

import test from "node:test";
import assert from "node:assert/strict";
import { buildForcePostureText, createTerritoryIndex } from "./forcePosture.js";

const unit = (over = {}) => ({
  id: "u1",
  name: "51st Guards Tank Army",
  type: "armor",
  ownerCode: "Russia",
  strength: 94,
  composition: "3 tank regiments",
  note: "",
  posture: "massing",
  covert: false,
  status: "idle",
  lng: 30.2,
  lat: 52.1,
  ...over,
});

// A stand-in for territoryOutlines.js's index: the digest only ever calls locate().
const territories = {
  locate: (point) =>
    point.lat > 51
      ? { inside: "Belarus", nearest: "Ukraine", nearestKm: 70 }
      : { inside: "", nearest: "Ukraine", nearestKm: 300 },
};

test("an empty map says so rather than returning nothing", () => {
  assert.match(buildForcePostureText([], [], territories, "Ukraine"), /No military forces/);
});

test("units are grouped by owner, with the player's own forces first and labelled", () => {
  const text = buildForcePostureText(
    [unit(), unit({ id: "u2", ownerCode: "Ukraine", name: "1st Brigade", lng: 30.5, lat: 50.4 })],
    [],
    territories,
    "Ukraine",
  );
  const lines = text.split("\n");
  assert.match(lines[0], /^Ukraine \(your own forces\):$/);
  assert.ok(text.indexOf("Ukraine (your own forces)") < text.indexOf("Russia:"));
});

test("a formation reports which territory it is in and how far from whose border", () => {
  const text = buildForcePostureText([unit()], [], territories, "Ukraine");
  assert.match(text, /inside Belarus, about 70 km from the Ukraine border/);
});

test("a force at sea is described relative to the nearest coast", () => {
  const text = buildForcePostureText(
    [unit({ type: "naval", lat: 45, posture: "patrol" })],
    [],
    territories,
    "Ukraine",
  );
  assert.match(text, /at sea, about 300 km off Ukraine/);
});

test("posture is spelled out in words the advisor can quote back", () => {
  assert.match(buildForcePostureText([unit()], [], territories, "Ukraine"), /massing/);
  assert.match(
    buildForcePostureText([unit({ posture: "withdrawing" })], [], territories, "Ukraine"),
    /withdrawing/,
  );
});

test("a unit with no posture falls back to its lifecycle status", () => {
  const text = buildForcePostureText([unit({ posture: "" , status: "engaged" })], [], territories, "Ukraine");
  assert.match(text, /engaged/);
});

test("composition and strength appear so the reader knows what the counter is", () => {
  const text = buildForcePostureText([unit()], [], territories, "Ukraine");
  assert.match(text, /3 tank regiments · 94% strength/);
});

test("a standing move order reports its objective and the distance left", () => {
  const text = buildForcePostureText(
    [unit()],
    [{ unitId: "u1", kind: "move", toLng: 30.5, toLat: 50.4, targetLabel: "the Dnieper", radiusKm: 0 }],
    territories,
    "Ukraine",
  );
  assert.match(text, /under orders to the Dnieper, about \d+ km still to go/);
});

test("a patrol reports its station rather than a destination", () => {
  const text = buildForcePostureText(
    [unit({ type: "naval", posture: "patrol" })],
    [{ unitId: "u1", kind: "patrol", toLng: 30.2, toLat: 52.1, radiusKm: 250 }],
    territories,
    "Ukraine",
  );
  assert.match(text, /working a 250 km station/);
});

test("the nearest force of another power is named, with distance and bearing", () => {
  const text = buildForcePostureText(
    [unit(), unit({ id: "u2", ownerCode: "Ukraine", name: "1st Brigade", lng: 30.2, lat: 50.4 })],
    [],
    territories,
    "Ukraine",
  );
  assert.match(text, /nearest Ukraine force \d+ km S/);
});

test("a friendly formation is not reported as its own nearest rival", () => {
  const text = buildForcePostureText(
    [unit(), unit({ id: "u2", name: "2nd Army", lng: 30.3, lat: 52.2 })],
    [],
    territories,
    "Ukraine",
  );
  assert.doesNotMatch(text, /nearest Russia force/);
});

test("a rival on the far side of the world is not worth reporting", () => {
  const text = buildForcePostureText(
    [unit(), unit({ id: "u2", ownerCode: "Chile", lng: -70, lat: -33 })],
    [],
    territories,
    "Ukraine",
  );
  assert.doesNotMatch(text, /nearest Chile force/);
});

test("an unconfirmed force is flagged as such", () => {
  const text = buildForcePostureText([unit({ covert: true })], [], territories, "Ukraine");
  assert.match(text, /\[unconfirmed — no known line of support\]/);
});

test("the formation's own sentence is quoted when it has one", () => {
  const text = buildForcePostureText(
    [unit({ note: "Concentrating north of the Pripyat marshes" })],
    [],
    territories,
    "Ukraine",
  );
  assert.match(text, /"Concentrating north of the Pripyat marshes"/);
});

test("a missing territory index drops the place clauses instead of failing", () => {
  const text = buildForcePostureText([unit()], [], null, "Ukraine");
  assert.match(text, /51st Guards Tank Army/);
  assert.doesNotMatch(text, /inside/);
});

test("units without usable coordinates are skipped", () => {
  const text = buildForcePostureText(
    [unit({ id: "bad", lng: Number.NaN, lat: Number.NaN })],
    [],
    territories,
    "Ukraine",
  );
  assert.match(text, /No military forces/);
});

// ---- createTerritoryIndex --------------------------------------------------
// The border geometry, tested against hand-built rings rather than the region
// PMTiles — which is the whole reason it lives in this module and not in
// territoryOutlines.js.

const square = (west, south, east, north) => [
  [west, south], [east, south], [east, north], [west, north], [west, south],
];

// Two adjacent 10-degree boxes meeting at longitude 0.
const outlines = new Map([
  ["A.1", { country: "Westland", countryCode: "WST", rings: [square(-10, 0, 0, 10)] }],
  ["B.1", { country: "Eastland", countryCode: "EST", rings: [square(0, 0, 10, 10)] }],
]);

const index = () => createTerritoryIndex(outlines, {}, { owners: ["Westland", "Eastland"] });

test("createTerritoryIndex returns null when there is no geometry to index", () => {
  assert.equal(createTerritoryIndex(new Map(), {}, { owners: ["Westland"] }), null);
  assert.equal(createTerritoryIndex(null, {}, { owners: ["Westland"] }), null);
});

test("createTerritoryIndex returns null when no owner was asked for", () => {
  assert.equal(createTerritoryIndex(outlines, {}, { owners: [] }), null);
});

test("createTerritoryIndex only indexes the owners it was asked about", () => {
  const only = createTerritoryIndex(outlines, {}, { owners: ["Westland"] });
  assert.deepEqual(only.owners, ["Westland"]);
});

test("locate names the territory a point sits inside", () => {
  assert.equal(index().locate({ lng: -5, lat: 5 }).inside, "Westland");
  assert.equal(index().locate({ lng: 5, lat: 5 }).inside, "Eastland");
});

test("locate reports the distance to the OTHER power's border, not its own", () => {
  // 2 degrees west of the shared meridian, at the equator: ~222 km.
  const placed = index().locate({ lng: -2, lat: 5 });
  assert.equal(placed.inside, "Westland");
  assert.equal(placed.nearest, "Eastland");
  assert.ok(placed.nearestKm > 180 && placed.nearestKm < 260, `got ${placed.nearestKm} km`);
});

test("a point at sea has no containing territory but still names the nearest coast", () => {
  const placed = index().locate({ lng: -14, lat: 5 });
  assert.equal(placed.inside, "");
  assert.equal(placed.nearest, "Westland");
});

test("a point on the far side of the world reports no border at all", () => {
  assert.equal(index().locate({ lng: 170, lat: -60 }), null);
});

test("locate rejects unusable coordinates", () => {
  assert.equal(index().locate({ lng: Number.NaN, lat: 5 }), null);
});

test("ownership follows the live map, so a re-owned region moves with its new holder", () => {
  const world = { regionOwnershipOverrides: { "B.1": "Westland" } };
  const reowned = createTerritoryIndex(outlines, world, { owners: ["Westland", "Eastland"] });
  assert.deepEqual(reowned.owners, ["Westland"]);
  assert.equal(reowned.locate({ lng: 5, lat: 5 }).inside, "Westland");
});

test("the digest turns a locate() result into the clause the advisor reads", () => {
  const massing = {
    id: "x", name: "III Corps", type: "armor", ownerCode: "Westland", strength: 90,
    composition: "2 divisions", posture: "massing", status: "idle", covert: false, note: "",
    lng: -2, lat: 5,
  };
  const text = buildForcePostureText([massing], [], index(), "Eastland");
  assert.match(text, /inside Westland, about \d+ km from the Eastland border/);
});

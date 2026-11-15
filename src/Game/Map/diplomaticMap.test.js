/*! Open Historia — the diplomatic map's drawing, tested © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fillStateOperations } from "./vnext/fillStateDiff.js";
import { buildDiplomaticView } from "../../runtime/diplomaticViews.js";
import {
  DEFAULT_DIPLOMATIC_SETTINGS,
  getDiplomaticMapState,
  loadDiplomaticMapStateForGame,
  normalizeDiplomaticSettings,
  readDiplomaticSettings,
  setDiplomaticMapState,
  writeDiplomaticSettings,
} from "../../runtime/diplomaticMapSettings.js";
import { diplomaticViewFor } from "./useDiplomaticView.js";
import { HATCH_STYLE, buildHatchImage, hatchImageId, parseHatchImageId } from "./diplomaticHatch.js";
import { diplomaticLineFeatures, greatCircle, seatsByCountry } from "./diplomaticSeats.js";
import { frontFilter, focusFilter } from "./diplomaticBorderFilters.js";
import { DIPLOMATIC_FILL_OPACITY_STOPS, POLITICAL_FILL_OPACITY_STOPS } from "./vnext/presentationPolicy.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};

// A small map: each country a few regions.
const REGIONS = new Map([
  ["FRA.1", "France"], ["FRA.2", "France"], ["DEU.1", "Germany"], ["DEU.2", "Germany"],
  ["ITA.1", "Italy"], ["ESP.1", "Spain"], ["POL.1", "Poland"], ["POL.2", "Poland"],
]);
const fillsFor = (view) => new Map([...REGIONS].map(([id, owner]) => [id, view.colorOf(owner)]));
const WORLD = {
  wars: [{ id: "w", status: "active", sideA: ["Germany"], sideB: ["Poland"] }],
  agreements: [{ status: "active", type: "alliance", parties: ["France", "Spain"] }],
};

test("a change of focus writes only the regions whose colour changed", () => {
  const landedOwners = [...new Set(REGIONS.values())];
  const before = fillsFor(buildDiplomaticView({ playerCountry: "France", landedOwners, world: WORLD }));
  const applied = new Map(before);
  const after = fillsFor(buildDiplomaticView({ playerCountry: "France", focusCountry: "Germany", landedOwners, world: WORLD }));
  const operations = fillStateOperations(after, applied);
  const written = operations.map((op) => op.regionId).sort();
  const changed = [...REGIONS.keys()].filter((id) => before.get(id) !== after.get(id)).sort();
  assert.deepEqual(written, changed);
  assert.ok(written.length < REGIONS.size, "regions whose colour is the same are not written again");
  assert.deepEqual(fillStateOperations(after, new Map(after)), [], "the same colours write nothing");
  // A region held by its hand-over sweep waits, and one no longer wanted is cleared.
  assert.deepEqual(fillStateOperations(new Map([["a", "#000000"]]), new Map([["b", "#111111"]]), new Set(["a"])), [{ kind: "remove", regionId: "b" }]);
});

test("one view for the whole map: the same inputs give the same view, built once", () => {
  const inputs = { view: "relations", focus: "", player: "France", landed: ["France", "Germany"], wars: WORLD.wars, agreements: WORLD.agreements };
  const first = diplomaticViewFor(inputs);
  assert.equal(diplomaticViewFor({ ...inputs }), first);
  assert.notEqual(diplomaticViewFor({ ...inputs, focus: "Germany" }), first);
  // Nations.jsx and FrontLayers.jsx ask the same hook; neither builds a stance map of its own.
  for (const file of ["./Nations.jsx", "./FrontLayers.jsx"]) {
    const source = read(file);
    assert.match(source, /useDiplomaticView\(\)/, file);
    assert.doesNotMatch(source, /buildDiplomaticStanceMap|buildDiplomaticView\(/, file);
  }
});

test("the choices are kept for each game, and a new game opens on the political map", () => {
  const storage = memoryStorage();
  assert.deepEqual(readDiplomaticSettings(storage, "g1"), normalizeDiplomaticSettings(null));
  assert.equal(readDiplomaticSettings(storage, "g1").mode, "political");
  writeDiplomaticSettings(storage, "g1", { mode: "diplomatic", view: "blocs", focus: "Germany", institution: "nato", axis: "ideology", legendOpen: false });
  assert.deepEqual(readDiplomaticSettings(storage, "g1"), { mode: "diplomatic", view: "blocs", focus: "Germany", institution: "nato", axis: "ideology", legendOpen: false });
  assert.deepEqual(readDiplomaticSettings(storage, "g2"), { ...DEFAULT_DIPLOMATIC_SETTINGS });
  // Rubbish in storage reads as the defaults.
  storage.setItem("map_diplomatic:g3", "{not json");
  assert.equal(readDiplomaticSettings(storage, "g3").view, "relations");
  assert.equal(normalizeDiplomaticSettings({ view: "nonsense", axis: "colour" }).axis, "regime");

  // The live store: opening a game reads its choices; a change is written at once.
  loadDiplomaticMapStateForGame("g1", { storage });
  assert.equal(getDiplomaticMapState().view, "blocs");
  setDiplomaticMapState({ view: "wars", focusWar: "w1" }, { storage });
  assert.equal(readDiplomaticSettings(storage, "g1").view, "wars");
  setDiplomaticMapState({ highlight: { id: "war", colors: ["#a51c1c"] } }, { storage });
  setDiplomaticMapState({ view: "relations" }, { storage });
  assert.equal(getDiplomaticMapState().highlight, null, "a highlight belongs to the legend it was picked from");
  assert.equal(getDiplomaticMapState().focusWar, "");
  loadDiplomaticMapStateForGame("g2", { storage });
  assert.equal(getDiplomaticMapState().mode, "political");
  assert.equal(getDiplomaticMapState().focus, "");
});

test("hatching: an image a marking, drawn again from its id alone", () => {
  for (const kind of Object.keys(HATCH_STYLE)) {
    const id = hatchImageId(kind);
    const parsed = parseHatchImageId(id);
    assert.ok(parsed, kind);
    const image = buildHatchImage(parsed);
    assert.equal(image.data.length, image.width * image.height * 4);
    const alphas = new Set();
    for (let at = 3; at < image.data.length; at += 4) alphas.add(image.data[at]);
    assert.deepEqual([...alphas].sort((a, b) => a - b), [0, 220], "lines on a clear ground");
  }
  assert.equal(parseHatchImageId("oh-stripes-1_2_3-4_5_6"), null);
  assert.equal(parseHatchImageId("oh-hatch-wavy-1_2_3"), null);
});

test("seats: a capital in the smallest region box that holds it, else the largest region's middle", () => {
  const records = [
    { id: "ITA.1", bounds: [[6, 36], [19, 47]], lng: 12, lat: 42, territoryWeight: 30 },
    { id: "VAT.1", bounds: [[12.44, 41.9], [12.46, 41.91]], lng: 12.45, lat: 41.905, territoryWeight: 0.001 },
    { id: "DEU.1", bounds: [[5, 47], [15, 55]], lng: 10, lat: 51, territoryWeight: 35 },
    { id: "DEU.2", bounds: [[11, 52], [14, 54]], lng: 12.5, lat: 53, territoryWeight: 5 },
  ];
  const owners = { "ITA.1": "Italy", "VAT.1": "Vatican City", "DEU.1": "Germany", "DEU.2": "Germany" };
  const cities = [
    { name: "Rome", lng: 12.49, lat: 41.89, capital: true, population: 2800000 },
    { name: "Vatican City", lng: 12.453, lat: 41.903, capital: true, population: 800 },
    { name: "Milan", lng: 9.19, lat: 45.46, capital: false, population: 1300000 },
  ];
  const seats = seatsByCountry({ cities, records, ownerOf: (id) => owners[id] });
  assert.equal(seats.get("italy").name, "Rome");
  assert.equal(seats.get("vaticancity").name, "Vatican City");
  assert.deepEqual(seats.get("germany"), { lng: 10, lat: 51, name: "" });
  const line = diplomaticLineFeatures([{ kind: "war", from: "Italy", to: "Germany" }, { kind: "ally", from: "Italy", to: "Atlantis" }], seats);
  assert.equal(line.features.length, 1, "a country with no seat draws no line");
  assert.equal(line.features[0].properties.kind, "war");
});

test("a line takes the short way round, across the date line", () => {
  const points = greatCircle({ lng: 170, lat: 0 }, { lng: -170, lat: 0 }, 8);
  assert.equal(points.length, 9);
  for (let i = 1; i < points.length; i += 1) assert.ok(Math.abs(points[i][0] - points[i - 1][0]) < 10);
  assert.ok(Math.abs(points.at(-1)[0] - 190) < 1e-6);
});

test("fronts and the focus's border come from the sovereign borders already drawn", () => {
  assert.deepEqual(frontFilter(["France\u001fGermany"]), ["in", ["get", "ownerKey"], ["literal", ["France\u001fGermany"]]]);
  assert.deepEqual(focusFilter(["France"]), ["any", ["in", "France", ["get", "ownerList"]]]);
  assert.deepEqual(frontFilter([]), ["==", ["get", "ownerKey"], "\u0000"]);
  for (const id of ["diplomatic-hatch", "diplomatic-fronts", "diplomatic-focus-outline", "diplomatic-bloc-outline", "diplomatic-lines-war", "diplomatic-lines-ally", "diplomatic-seat"]) {
    assert.ok(MAP_LAYER_ORDER.includes(id), id);
  }
  assert.ok(MAP_LAYER_ORDER.indexOf("diplomatic-hatch") > MAP_LAYER_ORDER.indexOf("custom-regions-fill"));
  assert.ok(MAP_LAYER_ORDER.indexOf("diplomatic-fronts") > MAP_LAYER_ORDER.indexOf("polity-boundaries"));
  assert.ok(MAP_LAYER_ORDER.indexOf("diplomatic-lines-war") < MAP_LAYER_ORDER.indexOf("country-curved-labels"));
});

test("the diplomatic fills are stronger than the political, never past its closest stop", () => {
  const strongest = Math.max(...POLITICAL_FILL_OPACITY_STOPS.map(([, opacity]) => opacity));
  assert.equal(DIPLOMATIC_FILL_OPACITY_STOPS.length, POLITICAL_FILL_OPACITY_STOPS.length);
  DIPLOMATIC_FILL_OPACITY_STOPS.forEach(([zoom, opacity], index) => {
    assert.equal(zoom, POLITICAL_FILL_OPACITY_STOPS[index][0]);
    assert.ok(opacity >= POLITICAL_FILL_OPACITY_STOPS[index][1] && opacity <= strongest);
  });
  assert.ok(DIPLOMATIC_FILL_OPACITY_STOPS[0][1] >= 0.75);
  // A legend entry picked dims the rest by one expression on the fill colour, no write per region.
  const nations = read("./Nations.jsx");
  assert.match(nations, /\["in", \["to-string", \["feature-state", "fillColor"\]\], \["literal", highlight\]\]/);
  // Stripes of a dispute follow the view's colours.
  assert.match(nations, /stripeRgbs\.push\(stripeRgbOf\(key\)\)/);
  assert.doesNotMatch(nations, /stripeRgbs\.push\(resolveOwnerRgb/);
});

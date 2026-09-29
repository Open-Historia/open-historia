// Run: node --test src/runtime/placeSearch.test.js
//
// The map's place search (placeSearch.js): the places this world invented or
// renamed, how a typed query ranks them, how one place found twice is shown
// once, and how geocoder results are ordered and framed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCityPlaceEntries,
  buildCustomCityIndex,
  buildLocalPlaceEntries,
  buildPolityIndex,
  buildPolityPlaceEntries,
  buildRenamePlaceEntries,
  dedupeGeocodedPlaces,
  formatGeocodedPlace,
  geocodedPlaceFraming,
  normalizePlaceText,
  rankGeocodedPlaces,
  scorePlaceName,
  searchLocalPlaces,
} from "./placeSearch.js";

const cityFeature = (name, lng, lat, properties = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { city: name, ...properties },
});

const labelSite = (owner, lng, lat, properties = {}) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { owner, labelSiteRole: "sovereign", ...properties },
});

const photon = (name, osmValue, properties = {}) => ({
  geometry: { coordinates: [0, 0] },
  properties: { name, osm_value: osmValue, ...properties },
});

test("place text is folded for matching: accents, case and punctuation", () => {
  assert.equal(normalizePlaceText("São Paulo"), "sao paulo");
  assert.equal(normalizePlaceText("  Saint-Denis!  "), "saint denis");
  assert.equal(normalizePlaceText(null), "");
});

test("the city index keeps named points only, with tiers clamped", () => {
  const rows = buildCustomCityIndex({
    features: [
      cityFeature("Rome", 12.5, 41.9, { tier: 9, capital: "primary", population: 2_800_000 }),
      cityFeature("", 0, 0),
      { geometry: { coordinates: ["x", 1] }, properties: { city: "Nowhere" } },
      { properties: { city: "No geometry" } },
      cityFeature("Ostia", 12.3, 41.7, { name: "ignored", tier: 0 }),
    ],
  });
  assert.deepEqual(rows.map((row) => [row.name, row.tier, row.capital]), [["Rome", 4, true], ["Ostia", 1, false]]);
  assert.deepEqual(buildCustomCityIndex(null), []);
});

test("a renamed city is found by both names and says what it was", () => {
  const [entry] = buildCityPlaceEntries(
    [{ name: "Constantinople", lng: 28.97, lat: 41.01, tier: 3, capital: false, population: 500_000 }],
    { constantinople: "Istanbul" },
  );
  assert.equal(entry.name, "Istanbul");
  assert.deepEqual(entry.aliases, ["istanbul", "constantinople"]);
  assert.equal(entry.detail, "Major city · 500k people · formerly Constantinople");
});

test("a rename of a city with no local point geocodes the old name", () => {
  const entries = buildRenamePlaceEntries(
    { "saint petersburg": "Leningrad", rome: "Roma" },
    [{ name: "Rome" }],
  );
  assert.equal(entries.length, 1, "a city the map already holds needs no rename entry");
  assert.equal(entries[0].name, "Leningrad");
  assert.equal(entries[0].lookup, "saint petersburg");
  assert.equal(entries[0].detail, "formerly Saint Petersburg");
  assert.deepEqual(entries[0].aliases, ["leningrad", "saint petersburg"]);
});

test("each polity is placed at its most prominent sovereign label site", () => {
  const rows = buildPolityIndex([
    labelSite("Avalon", 1, 1, { priorityScale: 2 }),
    labelSite("Avalon", 5, 5, { priorityScale: 9 }),
    labelSite("Avalon", 7, 7, { labelSiteRole: "exclave", priorityScale: 99 }),
    labelSite("", 3, 3),
    { geometry: {}, properties: { owner: "Lyonesse", labelKind: "polity", anchorLng: 2, anchorLat: 3 } },
    { geometry: { coordinates: [0, 0] }, properties: { owner: "Water", labelKind: "sea" } },
  ]);
  assert.deepEqual(rows, [
    { owner: "Avalon", lng: 5, lat: 5, weight: 9 },
    { owner: "Lyonesse", lng: 2, lat: 3, weight: 0 },
  ]);
});

test("a polity is found by its current name, its key and its former names", () => {
  const [entry] = buildPolityPlaceEntries(
    [{ owner: "Avalon", lng: 5, lat: 5 }],
    { Avalon: { name: "Kingdom of Avalon", aliases: ["The Isle"], formerNames: ["Old Avalon"] } },
  );
  assert.equal(entry.name, "Kingdom of Avalon");
  assert.deepEqual(entry.aliases, ["kingdom of avalon", "avalon", "the isle", "old avalon"]);
  assert.equal(entry.key, "polity:Avalon");
});

test("a renamed real country with no label site is geocoded by its key; others are not added", () => {
  const entries = buildPolityPlaceEntries([], {
    France: { name: "Gaul" },
    Germany: { name: "Germany" },
    "Invented Land": { name: "Somewhere Else" },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Gaul");
  assert.equal(entries[0].lookup, "France");
  assert.equal(entries[0].lng, undefined);
});

test("one place found twice nearby is shown once; the same name far away is kept", () => {
  const entries = buildLocalPlaceEntries({
    markers: [{ id: "m1", name: "Kyiv", kind: "fortress", lng: 30.5, lat: 50.45 }],
    cities: [
      { name: "Kyiv", lng: 30.52, lat: 50.45, tier: 4, capital: true, population: 0 },
      { name: "Springfield", lng: -89.6, lat: 39.8, tier: 2, capital: false, population: 0 },
      { name: "Springfield", lng: -72.6, lat: 42.1, tier: 2, capital: false, population: 0 },
    ],
  });
  const kyiv = entries.filter((entry) => entry.name === "Kyiv");
  assert.equal(kyiv.length, 1);
  assert.equal(kyiv[0].source, "marker", "the first one found is kept");
  assert.equal(entries.filter((entry) => entry.name === "Springfield").length, 2);
});

test("search ranks exact, then prefix, then word, then any match", () => {
  const entries = [
    { name: "Newport", aliases: ["newport"], weight: 0 },
    { name: "Old Port", aliases: ["old port"], weight: 0 },
    { name: "Port", aliases: ["port"], weight: 0 },
    { name: "Airport", aliases: ["airport"], weight: 0 },
    { name: "Porto", aliases: ["porto"], weight: 0 },
  ];
  assert.deepEqual(
    searchLocalPlaces(entries, "Port", 10).map((entry) => entry.name),
    ["Port", "Porto", "Old Port", "Airport", "Newport"],
  );
  assert.deepEqual(searchLocalPlaces(entries, "port", 2).map((entry) => entry.name), ["Port", "Porto"]);
  assert.deepEqual(searchLocalPlaces(entries, "  ", 4), []);
  assert.deepEqual(searchLocalPlaces(entries, "port", 0), []);
  assert.deepEqual(searchLocalPlaces(entries, "zzz", 4), []);
});

test("prominence breaks a tie between equally good matches, never a better match", () => {
  const entries = [
    { name: "Paris Village", aliases: ["paris village"], weight: 0 },
    { name: "Paris Hub", aliases: ["paris hub"], weight: 100 },
    { name: "Paris", aliases: ["paris"], weight: 0 },
  ];
  assert.deepEqual(searchLocalPlaces(entries, "paris", 3).map((entry) => entry.name), ["Paris", "Paris Hub", "Paris Village"]);
  assert.equal(scorePlaceName("Kyōto", "kyo"), 800);
  assert.equal(scorePlaceName("Kyoto Prefecture", "prefecture"), 600);
});

test("geocoder results keep their order among places and sink what is not a place", () => {
  const ranked = rankGeocodedPlaces([
    photon("Kyoto Station", "station"),
    photon("Kyoto", "city"),
    photon("Kyoto Prefecture", "state"),
    photon("Kyoto Hospital", "hospital"),
  ]);
  assert.deepEqual(ranked.map((feature) => feature.properties.name), ["Kyoto", "Kyoto Prefecture", "Kyoto Station", "Kyoto Hospital"]);
});

test("a geocoded place names at most two parts above it, and the same place once", () => {
  assert.deepEqual(
    formatGeocodedPlace(photon("Springfield", "city", { state: "Illinois", country: "United States" })),
    { primary: "Springfield", region: "Illinois, United States" },
  );
  assert.deepEqual(formatGeocodedPlace(photon("France", "country", { country: "France" })), { primary: "France", region: "Country" });
  const deduped = dedupeGeocodedPlaces([
    photon("Lyon", "city", { country: "France" }),
    photon("Lyon", "city", { country: "France" }),
    photon("", "city"),
    photon("Lyon", "city", { state: "Iowa", country: "United States" }),
  ]);
  assert.equal(deduped.length, 2);
});

test("a geocoded extent is fitted unless it wraps most of the globe", () => {
  const city = photon("Lyon", "city", { extent: [4.7, 45.8, 4.9, 45.7] });
  assert.deepEqual(geocodedPlaceFraming(city).bounds, [[4.7, 45.7], [4.9, 45.8]]);
  assert.equal(geocodedPlaceFraming(city).zoom, 7);
  const wrapped = photon("France", "country", { extent: [-178, 51, 170, -50] });
  assert.equal(geocodedPlaceFraming(wrapped).bounds, null);
  assert.equal(geocodedPlaceFraming(wrapped).zoom, 4);
  assert.equal(geocodedPlaceFraming(photon("Somewhere", "cafe")).zoom, 9);
});

/*! Open Historia — event camera focus tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/GameUI/eventFocus.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFocusContext,
  combineFocusBounds,
  deriveEventFocusBounds,
  findNameMentions,
  mergeFeatureParts,
  resolvePolityBounds,
  tileGeometryParts,
} from "./eventFocus.js";

const COUNTRY_BOXES = {
  GBR: [[-8.6, 49.9], [1.8, 58.7]],
  GIN: [[-15.1, 7.1], [-7.6, 12.7]],
  IRL: [[-10.5, 51.4], [-6.0, 55.4]],
  MLI: [[-12.2, 10.1], [4.2, 25.0]],
  NER: [[0.1, 11.7], [16.0, 23.5]],
  NGA: [[2.6, 4.2], [14.7, 13.9]],
  OMN: [[52.0, 16.6], [59.8, 26.4]],
  PNG: [[140.8, -11.7], [155.9, -1.3]],
  ROU: [[20.2, 43.6], [29.7, 48.3]],
  SOM: [[40.9, -1.7], [51.4, 12.0]],
  UKR: [[22.1, 44.3], [40.2, 52.4]],
};

const COUNTRIES = [
  { code: "GBR", name: "United Kingdom" },
  { code: "GIN", name: "Guinea" },
  { code: "IRL", name: "Ireland" },
  { code: "MLI", name: "Mali" },
  { code: "NER", name: "Niger" },
  { code: "NGA", name: "Nigeria" },
  { code: "OMN", name: "Oman" },
  { code: "PNG", name: "Papua New Guinea" },
  { code: "ROU", name: "Romania" },
  { code: "SOM", name: "Somalia" },
  { code: "UKR", name: "Ukraine" },
];

const REGION_BOXES = {
  "GBR.2_1": [[-8.2, 54.0], [-5.4, 55.3]],
  "IRL.4_1": [[-8.7, 53.2], [-6.0, 54.2]],
  "IRL.7_1": [[-10.2, 51.4], [-7.8, 52.4]],
  "UKR.5_1": [[36.6, 46.8], [39.0, 49.3]],
  "UKR.9_1": [[29.2, 45.2], [31.3, 47.4]],
  "USA.11_1": [[-85.6, 30.3], [-80.8, 35.0]],
  "GEO.3_1": [[43.4, 41.5], [45.0, 42.4]],
};

const REGIONS = [
  { country: "United Kingdom", countryCode: "GBR", id: "GBR.2_1", name: "Northern Ireland" },
  { country: "Ireland", countryCode: "IRL", id: "IRL.4_1", name: "Connacht" },
  { country: "Ireland", countryCode: "IRL", id: "IRL.7_1", name: "Kerry" },
  { country: "Ukraine", countryCode: "UKR", id: "UKR.5_1", name: "Donetsk" },
  { country: "Ukraine", countryCode: "UKR", id: "UKR.9_1", name: "Odessa" },
  // Same name, two places: never usable for localising anything.
  { country: "United States", countryCode: "USA", id: "USA.11_1", name: "Georgia" },
  { country: "Georgia", countryCode: "GEO", id: "GEO.3_1", name: "Georgia" },
];

const makeContext = (world = null) => buildFocusContext({
  countries: COUNTRIES,
  countryBounds: new Map(Object.entries(COUNTRY_BOXES)),
  regionBounds: new Map(Object.entries(REGION_BOXES)),
  regions: REGIONS,
  world,
});

const context = makeContext();

const near = (actual, expected, tolerance = 0.001) => {
  assert.ok(actual, "expected bounds, got none");
  assert.ok(
    Math.abs(actual[0][0] - expected[0][0]) <= tolerance
    && Math.abs(actual[0][1] - expected[0][1]) <= tolerance
    && Math.abs(actual[1][0] - expected[1][0]) <= tolerance
    && Math.abs(actual[1][1] - expected[1][1]) <= tolerance,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

// ---- Group A: polity names resolve to bounds -------------------------------
// The bug: impacts carry FULL COUNTRY NAMES while the bounds table is keyed by
// GADM code, so every one of these lookups used to miss.

test("a polity change named 'Ireland' focuses the land Ireland holds", () => {
  const event = {
    title: "A vote in Dublin",
    description: "The government falls.",
    impacts: { polityChanges: [{ code: "Ireland", name: "Ireland" }] },
  };

  // The live map wins over GADM's: here the fixture gives Ireland two regions,
  // in the real catalog it is every province the polity currently owns.
  near(deriveEventFocusBounds(event, context), [[-10.2, 51.4], [-6.0, 54.2]]);
});

test("a polity with no catalogued regions falls back to its country geometry", () => {
  near(resolvePolityBounds("Somalia", context), COUNTRY_BOXES.SOM);
});

test("a GADM code still resolves, for legacy saves", () => {
  near(resolvePolityBounds("SOM", context), COUNTRY_BOXES.SOM);
  near(resolvePolityBounds("IRL", context), [[-10.2, 51.4], [-6.0, 54.2]]);
});

test("a chat participant named by country focuses that country", () => {
  const event = {
    title: "An approach",
    description: "Talks open.",
    impacts: { createdChats: [{ countries: [{ code: "Romania", name: "Romania" }] }] },
  };

  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.ROU);
});

test("an invented polity focuses the regions it actually holds", () => {
  const world = {
    polityOverrides: { "Free Ireland": { code: "Free Ireland", name: "Free Ireland" } },
    regionOwnershipOverrides: { "IRL.4_1": "Free Ireland", "IRL.7_1": "Free Ireland" },
  };
  const event = { title: "Proclamation", description: "", impacts: { polityChanges: [{ code: "Free Ireland" }] } };

  near(deriveEventFocusBounds(event, makeContext(world)), [[-10.2, 51.4], [-6.0, 54.2]]);
});

// ---- Group B: text fallback no longer matches substrings -------------------

test("Somalia does not drag the camera to Mali", () => {
  const event = { title: "Drought in Somalia", description: "Herders move south." };
  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.SOM);
});

test("Nigeria is not read as Niger", () => {
  const event = { title: "Elections in Nigeria", description: "A new coalition forms." };
  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.NGA);
});

test("Romania is not read as Oman", () => {
  const event = { title: "Romania joins the pact", description: "Bucharest signs." };
  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.ROU);
});

test("Papua New Guinea beats the Guinea inside it", () => {
  const event = { title: "Unrest in Papua New Guinea", description: "Port Moresby responds." };
  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.PNG);
});

test("Northern Ireland is not read as Ireland", () => {
  const mentions = findNameMentions(
    "Marches across Northern Ireland",
    [context.polityIndex, context.regionIndex],
  );
  assert.deepEqual(mentions.map((match) => match.token), ["GBR.2_1"]);
});

test("an event about Northern Ireland does not focus the Republic", () => {
  const event = { title: "Marches across Northern Ireland", description: "Belfast tenses." };
  near(deriveEventFocusBounds(event, context), REGION_BOXES["GBR.2_1"]);
});

test("a named region inside a named country wins over the whole country", () => {
  const event = { title: "Ukraine loses Donetsk", description: "The front collapses." };
  near(deriveEventFocusBounds(event, context), REGION_BOXES["UKR.5_1"]);
});

test("an ambiguous region name never localises anything", () => {
  const event = { title: "Storms hit Georgia", description: "Power is out." };
  assert.equal(deriveEventFocusBounds(event, context), null);
});

test("the title outranks the description", () => {
  const event = { title: "Ireland mobilises", description: "Somalia and Nigeria watch." };
  near(deriveEventFocusBounds(event, context), [[-10.2, 51.4], [-6.0, 54.2]]);
});

// ---- Group C: impacts outrank prose ---------------------------------------

test("a region transfer pins the exact region", () => {
  const event = {
    title: "Somalia and Nigeria condemn the seizure",
    description: "Fighting spreads.",
    impacts: { regionTransfers: [{ regionId: "UKR.5_1", toCode: "Ukraine" }] },
  };

  near(deriveEventFocusBounds(event, context), REGION_BOXES["UKR.5_1"]);
});

test("a transfer that names a unique region instead of its id still resolves", () => {
  const event = {
    title: "The east falls",
    description: "",
    impacts: { regionTransfers: [{ regionId: "Donetsk", regionName: "Donetsk", toCode: "Ukraine" }] },
  };

  near(deriveEventFocusBounds(event, context), REGION_BOXES["UKR.5_1"]);
});

test("a transfer we cannot place falls back to the polities that fought over it", () => {
  const event = {
    title: "The border moves",
    description: "",
    impacts: { regionTransfers: [{ regionId: "no-such-region", toCode: "Somalia" }] },
  };

  near(deriveEventFocusBounds(event, context), COUNTRY_BOXES.SOM);
});

test("unit and marker coordinates focus the spot the event names", () => {
  const event = {
    title: "Landing",
    description: "",
    impacts: { unitOps: [{ op: "spawn", unit: { lat: 53.0, lng: -6.5 } }] },
  };

  near(deriveEventFocusBounds(event, context), [[-7.1, 52.55], [-5.9, 53.45]]);
});

test("an event with nothing to go on leaves the camera alone", () => {
  assert.equal(deriveEventFocusBounds({ title: "A quiet week", description: "" }, context), null);
});

// ---- Group D: combining several candidates --------------------------------

test("neighbouring candidates merge into one frame", () => {
  near(
    combineFocusBounds([REGION_BOXES["UKR.5_1"], REGION_BOXES["UKR.9_1"]]),
    [[29.2, 45.2], [39.0, 49.3]],
  );
});

test("a far-flung candidate cannot drag the frame off the primary one", () => {
  // Two unrelated places: framing both centres the camera on the ocean between
  // them, which is the "completely different country" the report describes.
  near(combineFocusBounds([COUNTRY_BOXES.IRL, COUNTRY_BOXES.PNG]), COUNTRY_BOXES.IRL);
});

test("the larger group of candidates wins over a lone outlier", () => {
  near(
    combineFocusBounds([COUNTRY_BOXES.PNG, COUNTRY_BOXES.IRL, COUNTRY_BOXES.GBR]),
    [[-10.5, 49.9], [1.8, 58.7]],
  );
});

// ---- Group E: feature geometry --------------------------------------------

// Tile x/y for a lng/lat at the overview tile (z0, extent 4096).
const tilePoint = (lng, lat) => {
  const x = ((lng + 180) / 360) * 4096;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 4096;
  return { x, y };
};

const ring = ([[west, south], [east, north]]) => [
  tilePoint(west, south),
  tilePoint(east, south),
  tilePoint(east, north),
  tilePoint(west, north),
];

test("a country split by the antimeridian keeps its real, narrow frame", () => {
  // Fiji: one island group either side of 180. Read naively this is -180..180
  // and the camera fits the whole globe instead of one island group.
  const merged = mergeFeatureParts([
    { bounds: [[177.0, -18.5], [180.0, -16.1]], weight: 60 },
    { bounds: [[-180.0, -17.0], [-179.7, -16.2]], weight: 40 },
  ]);

  assert.ok(merged[1][0] - merged[0][0] < 5, `expected a narrow box, got ${JSON.stringify(merged)}`);
  near(merged, [[177.0, -18.5], [180.3, -16.1]]);
});

test("an outlying island does not drag a country's frame out to sea", () => {
  // Portugal: the mainland plus the Azores, 1,400 km into the Atlantic.
  const merged = mergeFeatureParts([
    { bounds: [[-9.5, 36.9], [-6.2, 42.2]], weight: 89000 },
    { bounds: [[-31.3, 36.9], [-25.0, 39.7]], weight: 2300 },
  ]);

  near(merged, [[-9.5, 36.9], [-6.2, 42.2]]);
});

test("a genuinely multi-part country keeps every substantial part", () => {
  const merged = mergeFeatureParts([
    { bounds: [[130.0, 30.9], [141.0, 37.5]], weight: 60 },
    { bounds: [[139.3, 34.9], [141.9, 41.5]], weight: 30 },
    { bounds: [[139.6, 41.4], [145.8, 45.5]], weight: 25 },
  ]);

  near(merged, [[130.0, 30.9], [145.8, 45.5]]);
});

test("decoded tile rings become lng/lat bounds, weighted by area", () => {
  const [big, small] = tileGeometryParts([
    ring([[-10.5, 51.4], [-6.0, 55.4]]),
    ring([[-11.0, 51.0], [-10.9, 51.1]]),
  ]);

  near(big.bounds, COUNTRY_BOXES.IRL, 0.05);
  assert.ok(big.weight > small.weight * 100, "the mainland ring must outweigh the islet");
  // The islet is well under the mainland-share threshold, so it is dropped.
  near(mergeFeatureParts([big, small]), COUNTRY_BOXES.IRL, 0.05);
});

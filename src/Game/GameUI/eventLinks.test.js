/*! Open Historia — event links tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/eventLinks.test.js
//
// The invariants: an event links to the places it names with their kind, to what
// its operations touched and to the polities its structured fields name, and to
// nothing its words merely mention; every link can be flown to; a power is shown
// by the name it has now; nothing is linked twice; and a busy event is capped.

import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_LINKS_MAX, buildFocusContext, deriveEventLinks } from "./eventFocus.js";

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
};

const REGIONS = [
  { country: "United Kingdom", countryCode: "GBR", id: "GBR.2_1", name: "Northern Ireland" },
  { country: "Ireland", countryCode: "IRL", id: "IRL.4_1", name: "Connacht" },
  { country: "Ireland", countryCode: "IRL", id: "IRL.7_1", name: "Kerry" },
  { country: "Ukraine", countryCode: "UKR", id: "UKR.5_1", name: "Donetsk" },
  { country: "Ukraine", countryCode: "UKR", id: "UKR.9_1", name: "Odessa" },
];

const makeContext = (world = null) => buildFocusContext({
  countries: COUNTRIES,
  countryBounds: new Map(Object.entries(COUNTRY_BOXES)),
  regionBounds: new Map(Object.entries(REGION_BOXES)),
  regions: REGIONS,
  world,
});

const context = makeContext();
const summary = (links) => links.map((link) => `${link.kind}:${link.label}`);

test("an event links to the places it names, then to what it changed, and never to what its words mention", () => {
  const event = {
    title: "Fighting spreads beyond Donetsk",
    description: "Guinea and Ireland call for restraint.",
    places: [
      { kind: "city", name: "Mariupol", lng: 37.5, lat: 47.1 },
      { kind: "country", name: "Ukraine" },
    ],
    impacts: {
      regionTransfers: [{ regionId: "UKR.9_1", fromCode: "Ukraine", toCode: "Romania" }],
      unitOps: [{ op: "spawn", unit: { name: "3rd Guards Brigade", lng: 37.8, lat: 48.0 } }],
    },
  };
  assert.deepEqual(summary(deriveEventLinks(event, context)), [
    "city:Mariupol",
    "polity:Ukraine",
    "region:Odessa",
    "polity:Romania",
    "unit:3rd Guards Brigade",
  ]);
});

// The owner's case. The map of the built-in world has a region called Salmon.
test("an event about salmon does not link to the place called Salmon", () => {
  const withSalmon = buildFocusContext({
    countries: COUNTRIES,
    countryBounds: new Map(Object.entries(COUNTRY_BOXES)),
    regionBounds: new Map([...Object.entries(REGION_BOXES), ["3301", [[-115.4, 44.4], [-113.4, 45.7]]]]),
    regions: [...REGIONS, { country: "United States", countryCode: "USA", id: "3301", name: "Salmon" }],
  });
  const catch_ = {
    title: "A scout tribe lands a great catch of salmon",
    description: "Salmon fill the smokehouses, and Ireland sends buyers.",
  };
  assert.deepEqual(deriveEventLinks(catch_, withSalmon), []);
  // Said to be a place, with its kind, it is one.
  const there = { ...catch_, places: [{ kind: "region", name: "Salmon", regionId: "3301" }] };
  assert.deepEqual(summary(deriveEventLinks(there, withSalmon)), ["region:Salmon"]);
});

test("an event from before events named their places links to its operations and its structured fields only", () => {
  const old = {
    title: "Romania and Ukraine open talks over Odessa",
    description: "Guinea offers to host.",
    combatants: [],
    impacts: { createdChats: [{ countries: [{ code: "Romania", name: "Romania" }, "Ukraine"] }] },
  };
  assert.deepEqual(summary(deriveEventLinks(old, context)), ["polity:Romania", "polity:Ukraine"]);
  assert.deepEqual(summary(deriveEventLinks({ title: "Border clashes near Odessa", combatants: ["Ukraine", "Romania"] }, context)), ["polity:Ukraine", "polity:Romania"]);
  assert.deepEqual(deriveEventLinks({ title: "Romania and Ukraine trade accusations over Odessa" }, context), []);
});

test("a place still in the model's words, or of no kind the map has, is not linked", () => {
  const event = { title: "A summit", places: ["city: Kyiv, country: Ukraine", { kind: "salmon", name: "Salmon", lng: 1, lat: 1 }, { kind: "city", name: "Nowhere" }, { kind: "region", name: "Donetsk" }] };
  assert.deepEqual(deriveEventLinks(event, context), []);
});

test("the regions a group moves into are linked, after the ones the event fought over", () => {
  const event = {
    title: "A quiet spread",
    impacts: {
      regionControlOps: [{ op: "contest", regionId: "UKR.5_1", actorCode: "Romania", fromCode: "Ukraine" }],
      groupOps: [
        { op: "take", name: "Green Cells", regionIds: ["IRL.4_1", "no-such-region"] },
        { op: "spread", group: "Green Cells", regionId: "IRL.7_1" },
      ],
    },
  };
  assert.deepEqual(summary(deriveEventLinks(event, context)), [
    "region:Donetsk",
    "polity:Romania",
    "region:Connacht",
    "region:Kerry",
  ]);
});

test("every link carries a frame to fly to, and a place the map cannot find is left out", () => {
  const links = deriveEventLinks({
    title: "Talks in Atlantis",
    impacts: { markerOps: [{ op: "build", marker: { name: "Kerry airfield", lng: -9.5, lat: 52.1 } }, { op: "build", marker: { name: "Nowhere depot" } }] },
  }, context);
  assert.deepEqual(summary(links), ["structure:Kerry airfield"]);
  assert.ok(links.every((link) => Array.isArray(link.bounds) && link.bounds.length === 2));
});

test("a power is shown by the name it has now, and a code resolves to it", () => {
  const renamed = makeContext({ polityOverrides: { UKR: { code: "UKR", name: "Ukrainian People's Republic", aliases: ["Ukraine"] } } });
  const links = deriveEventLinks({ title: "Kyiv changes its name", impacts: { polityChanges: [{ code: "UKR", name: "" }] } }, renamed);
  assert.deepEqual(summary(links), ["polity:Ukrainian People's Republic"]);
});

test("a unit moved by id is named through the resolver handed in", () => {
  const links = deriveEventLinks(
    { title: "A redeployment", impacts: { unitOps: [{ op: "move", unitId: "u-7", toLng: 30.5, toLat: 50.4 }] } },
    context,
    { unitName: (id) => (id === "u-7" ? "1st Tank Army" : "") },
  );
  assert.deepEqual(summary(links), ["unit:1st Tank Army"]);
});

test("on a drawn map, with no stock outlines at all, regions and polities are framed by the regions' centres", () => {
  const drawn = buildFocusContext({
    countries: [{ code: "Kingdom of Aldmere", name: "Kingdom of Aldmere" }],
    countryBounds: new Map(),
    regionBounds: new Map(),
    regions: [
      { country: "Kingdom of Aldmere", id: "r-1", name: "Westmarch", lng: 10, lat: 50 },
      { country: "Kingdom of Aldmere", id: "r-2", name: "Eastmarch", lng: 12, lat: 51 },
      { country: "Kingdom of Aldmere", id: "r-3", name: "Nowhere", lng: null, lat: null },
    ],
  });
  const links = deriveEventLinks({
    title: "Unrest in Westmarch spreads across the Kingdom of Aldmere",
    places: [{ kind: "region", name: "Westmarch", regionId: "r-1" }, { kind: "country", name: "Kingdom of Aldmere" }],
  }, drawn);
  assert.deepEqual(summary(links), ["region:Westmarch", "polity:Kingdom of Aldmere"]);
  const [westmarch, kingdom] = links;
  assert.deepEqual(westmarch.bounds, [[9.4, 49.55], [10.6, 50.45]]);
  assert.ok(kingdom.bounds[0][0] <= 9.4 && kingdom.bounds[1][0] >= 12.6, "the polity frames both of its regions");
  assert.equal(deriveEventLinks({ title: "Nowhere", places: [{ kind: "region", name: "Nowhere", regionId: "r-3" }] }, drawn).length, 0, "a region without a centre is not placed at 0,0");
});

test("the map's own records frame a drawn region by its box, and the stock outline still wins where there is one", () => {
  const drawn = [
    { id: "r-9", name: "Southmarch", bounds: [[20, 40], [22, 41]], lng: 21, lat: 40.5 },
    { id: "UKR.5_1", name: "Donetsk", bounds: [[0, 0], [1, 1]] },
  ];
  const withDrawn = buildFocusContext({
    countries: COUNTRIES,
    countryBounds: new Map(Object.entries(COUNTRY_BOXES)),
    regionBounds: new Map(Object.entries(REGION_BOXES)),
    regions: [...REGIONS, { country: "Ukraine", id: "r-9", name: "Southmarch" }],
    drawnRegions: drawn,
  });
  const links = deriveEventLinks({
    title: "Fighting in Southmarch and Donetsk",
    places: [{ kind: "region", name: "Southmarch", regionId: "r-9" }, { kind: "region", name: "Donetsk", regionId: "UKR.5_1" }],
  }, withDrawn);
  assert.deepEqual(links.map((link) => [link.label, link.bounds]), [
    ["Southmarch", [[20, 40], [22, 41]]],
    ["Donetsk", REGION_BOXES["UKR.5_1"]],
  ]);
});

test("nothing is linked twice, and a busy event is capped", () => {
  const event = {
    title: "Ukraine, Ukraine and Ukraine",
    impacts: { polityChanges: [{ name: "Ukraine" }, { code: "Ukraine" }] },
  };
  assert.deepEqual(summary(deriveEventLinks(event, context)), ["polity:Ukraine"]);
  const busy = { title: "Everybody at once", impacts: { polityChanges: COUNTRIES.map((country) => ({ code: country.name })) } };
  assert.equal(deriveEventLinks(busy, context).length, EVENT_LINKS_MAX);
  assert.equal(deriveEventLinks(busy, context, { max: 3 }).length, 3);
  assert.deepEqual(deriveEventLinks(null, context), []);
});

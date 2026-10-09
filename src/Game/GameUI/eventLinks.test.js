/*! Open Historia — event links tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/eventLinks.test.js
//
// The invariants: an event links to what its operations touched before what its
// words merely name; every link can be flown to; a power is shown by the name it
// has now; nothing is linked twice; and a busy event is capped.

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

test("an event links to what it changed first, then to what its words name", () => {
  const event = {
    title: "Fighting spreads beyond Donetsk",
    description: "Guinea and Ireland call for restraint.",
    impacts: {
      regionTransfers: [{ regionId: "UKR.9_1", fromCode: "Ukraine", toCode: "Romania" }],
      unitOps: [{ op: "spawn", unit: { name: "3rd Guards Brigade", lng: 37.8, lat: 48.0 } }],
    },
  };
  assert.deepEqual(summary(deriveEventLinks(event, context)), [
    "region:Odessa",
    "polity:Romania",
    "polity:Ukraine",
    "unit:3rd Guards Brigade",
    "region:Donetsk",
    "polity:Guinea",
    "polity:Ireland",
  ]);
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
  const links = deriveEventLinks({ title: "Unrest in Westmarch spreads across the Kingdom of Aldmere" }, drawn);
  assert.deepEqual(summary(links), ["region:Westmarch", "polity:Kingdom of Aldmere"]);
  const [westmarch, kingdom] = links;
  assert.deepEqual(westmarch.bounds, [[9.4, 49.55], [10.6, 50.45]]);
  assert.ok(kingdom.bounds[0][0] <= 9.4 && kingdom.bounds[1][0] >= 12.6, "the polity frames both of its regions");
  assert.equal(deriveEventLinks({ title: "Nowhere" }, drawn).length, 0, "a region without a centre is not placed at 0,0");
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
  const links = deriveEventLinks({ title: "Fighting in Southmarch and Donetsk" }, withDrawn);
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
  const busy = { title: COUNTRIES.map((country) => country.name).join(", ") };
  assert.equal(deriveEventLinks(busy, context).length, EVENT_LINKS_MAX);
  assert.equal(deriveEventLinks(busy, context, { max: 3 }).length, 3);
  assert.deepEqual(deriveEventLinks(null, context), []);
});

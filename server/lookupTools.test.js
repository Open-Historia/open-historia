// Run: node --test server/lookupTools.test.js
//
// The lookup functions answer from the rendered map and the live campaign,
// and every name they return is spelled as the map spells it. Owner names are
// exact: a world with a "Russian Federation" and nothing called "Russia" does
// not know "Russia", and asking for it is an error that lists the real names.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LOOKUP_DIRECTIVE,
  LOOKUP_TOOL_NAMES,
  LOOKUP_TOOLS,
  buildLookupContext,
  executeLookup,
  isLookupToolName,
} from "../src/Game/AI/lookupTools.js";

const square = (x, y) => ({ type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });

const REGIONS = [
  { id: "ukr-kharkiv", name: "Kharkiv", geometry: square(36, 49) },
  { id: "ukr-zap", name: "Zaporizhzhia", geometry: square(35, 47) },
  { id: "ukr-kn", name: "Kremenchuk North", geometry: square(33, 49) },
  { id: "ukr-ks", name: "Kremenchuk South", geometry: square(33, 48) },
  { id: "rus-belgorod", name: "Belgorod", geometry: square(36, 50) },
  { id: "rus-moscow", name: "Moscow", geometry: square(37, 55) },
];

const WORLD = {
  regionOwnershipOverrides: {
    "ukr-kharkiv": "Ukraine",
    "ukr-zap": "Russian Federation", // occupied
    "ukr-kn": "Ukraine",
    "ukr-ks": "Ukraine",
    "rus-belgorod": "Russian Federation",
    "rus-moscow": "Russian Federation",
  },
  regionSovereigntyOverrides: { "ukr-zap": "Ukraine" },
  regionClaimants: { "ukr-zap": ["Ukraine"] },
  polityOverrides: {
    Ukraine: { name: "Ukraine", aliases: ["UKR"], note: "Fighting for its eastern regions.", tags: ["defensive"] },
    RUS: { name: "Russian Federation", aliases: [] },
  },
  wars: [{ id: "w1", status: "active", title: "War in the east", sides: { aggressors: ["Russian Federation"], defenders: ["Ukraine"] }, startedAt: "2014-02-27" }],
  agreements: [{ id: "a1", kind: "ceasefire", title: "Minsk", status: "active", parties: ["Ukraine", "Russian Federation"] }],
  relations: [{ a: "Ukraine", b: "Russian Federation", stance: "hostile" }],
  internationalReputation: { Ukraine: 62 },
  intelligence: { Ukraine: 4 },
  units: [],
};

const CITIES = [
  { name: "Kharkiv", coordinates: [36.25, 49.99], population: 1430000, capital: "" },
  { name: "Belgorod", coordinates: [36.6, 50.6], population: 390000, capital: "" },
  { name: "Novomoskovsk", aliases: ["Samar"], coordinates: [37.5, 55.5], population: 12000, capital: "" },
];

const EVENTS = [
  { id: "e1", date: "2014-03-01", title: "Russian Federation moves on Zaporizhzhia", description: "Columns cross into the oblast.", impacts: { regionTransfers: [{ regionId: "ukr-zap", regionName: "Zaporizhzhia", fromCode: "Ukraine", toCode: "Russian Federation" }] } },
  { id: "e2", date: "2014-03-03", title: "Quiet in Moscow", description: "Nothing moves in the capital." },
  { id: "e3", date: "2014-03-05", title: "Kharkiv digs in", description: "Trenches around the city." },
];

const UNITS = [{ id: "u1", name: "3rd Army", type: "army", ownerCode: "Russian Federation", strength: 80, posture: "attack", regionId: "rus-belgorod", lng: 36.6, lat: 50.6 }];

const CHATS = [{ id: "c1", title: "Talks", countries: [{ name: "Russian Federation" }], messages: [{ speaker: "Ukraine", text: "Withdraw." }, { speaker: "Russian Federation", text: "No." }] }];

const context = () => buildLookupContext({ regions: REGIONS, world: WORLD, cities: CITIES, events: EVENTS, chats: CHATS, units: UNITS, player: "Ukraine" });
const run = (name, args) => executeLookup(context(), name, args);

test("the catalogue is well formed and the directive names the rules", () => {
  assert.equal(new Set(LOOKUP_TOOLS.map((tool) => tool.name)).size, LOOKUP_TOOLS.length);
  assert.deepEqual(LOOKUP_TOOLS.map((tool) => tool.name), [...LOOKUP_TOOL_NAMES]);
  for (const tool of LOOKUP_TOOLS) {
    assert.equal(tool.schema.type, "object", tool.name);
    assert.ok(tool.description.length > 40, tool.name);
  }
  assert.ok(isLookupToolName("find_region"));
  assert.ok(!isLookupToolName("submit_jump_result"));
  assert.match(LOOKUP_DIRECTIVE, /find_region/);
  assert.match(LOOKUP_DIRECTIVE, /exact name/);
});

test("list_powers: exact names, counts by current control, the player flagged", () => {
  const out = run("list_powers", {});
  assert.deepEqual(out.powers, [
    { name: "Russian Federation", regions: 3 },
    { name: "Ukraine", regions: 3, player: true },
  ]);
  assert.deepEqual(run("list_powers", { query: "russ" }).powers.map((power) => power.name), ["Russian Federation"]);
});

test("list_regions: one power's regions with ids, paged", () => {
  const all = run("list_regions", { owner: "Ukraine" });
  assert.equal(all.total, 3);
  assert.deepEqual(all.regions.map((region) => region.id), ["ukr-kharkiv", "ukr-kn", "ukr-ks"]);
  assert.equal(all.next, undefined);
  const page = run("list_regions", { owner: "Ukraine", limit: 2 });
  assert.equal(page.regions.length, 2);
  assert.equal(page.next, 2);
  assert.deepEqual(run("list_regions", { owner: "Ukraine", offset: 2 }).regions.map((region) => region.name), ["Kremenchuk South"]);
});

test("owner names are exact: Russia is not the Russian Federation", () => {
  const out = run("list_regions", { owner: "Russia" });
  assert.match(out.error, /"Russia" is not a power/);
  assert.deepEqual(out.powers, ["Russian Federation", "Ukraine"]);
  assert.equal(run("power_info", { name: "Russia" }).error !== undefined, true);
  // A declared alias and a legacy code both name the power the map spells out.
  assert.equal(run("list_regions", { owner: "UKR" }).owner, "Ukraine");
  assert.equal(run("power_info", { name: "RUS" }).name, "Russian Federation");
});

test("find_region: exact, with an administrative suffix, a transliteration off, or ambiguous", () => {
  const exact = run("find_region", { name: "Kharkiv" });
  assert.equal(exact.bestMatch.id, "ukr-kharkiv");
  assert.equal(exact.bestMatch.rule, "exact");
  assert.equal(exact.matches[0].confidence, 100);

  const suffixed = run("find_region", { name: "Kharkiv Oblast" });
  assert.equal(suffixed.bestMatch.id, "ukr-kharkiv");
  assert.equal(suffixed.bestMatch.rule, "affix");

  const spelled = run("find_region", { name: "Zaporizhzhya", owner: "Russian Federation" });
  assert.equal(spelled.owner, "Russian Federation");
  assert.equal(spelled.bestMatch.id, "ukr-zap");
  assert.equal(spelled.bestMatch.rule, "fuzzy");
  assert.equal(spelled.matches[0].owner, "Russian Federation");

  const ambiguous = run("find_region", { name: "Kremenchuk" });
  assert.equal(ambiguous.bestMatch, undefined);
  assert.deepEqual(ambiguous.matches.map((match) => match.id).sort(), ["ukr-kn", "ukr-ks"]);

  const nothing = run("find_region", { name: "Atlantis" });
  assert.deepEqual(nothing.matches, []);
  assert.match(nothing.hint, /No region/);

  assert.match(run("find_region", { name: "Kharkiv", owner: "Russia" }).error, /not a power/);
});

test("region_info: controller, sovereign, claimants, cities inside, neighbours with owners", () => {
  const kharkiv = run("region_info", { regionId: "ukr-kharkiv" });
  assert.equal(kharkiv.owner, "Ukraine");
  assert.equal(kharkiv.sovereign, "Ukraine");
  assert.deepEqual(kharkiv.cities.map((city) => city.name), ["Kharkiv"]);
  assert.deepEqual(kharkiv.neighbours.map((region) => [region.id, region.owner]).sort(), [["rus-belgorod", "Russian Federation"]]);

  const zap = run("region_info", { regionId: "ukr-zap" });
  assert.equal(zap.owner, "Russian Federation");
  assert.equal(zap.sovereign, "Ukraine");
  assert.deepEqual(zap.claimants, ["Ukraine"]);

  assert.match(run("region_info", { regionId: "nope" }).error, /No region with id/);
});

test("find_city: the region that contains the city, by name or by a former name", () => {
  const belgorod = run("find_city", { name: "Belgorod" });
  assert.deepEqual(belgorod.matches, [{ city: "Belgorod", population: 390000, regionId: "rus-belgorod", regionName: "Belgorod", owner: "Russian Federation" }]);
  assert.equal(run("find_city", { name: "Samar" }).matches[0].city, "Novomoskovsk");
  assert.match(run("find_city", { name: "Nowhere" }).hint, /No city/);
});

test("power_info: holdings, wars, claims each way, units, description, ratings", () => {
  const russia = run("power_info", { name: "Russian Federation" });
  assert.equal(russia.regions, 3);
  assert.deepEqual(russia.wars.map((war) => war.id), ["w1"]);
  assert.ok(russia.wars[0].participants.includes("Ukraine"));
  assert.deepEqual(russia.claimsAgainstIt.map((entry) => entry.id), ["ukr-zap"]);
  assert.deepEqual(russia.claimsAsserted, []);
  assert.equal(russia.units, 1);

  const ukraine = run("power_info", { name: "Ukraine" });
  assert.equal(ukraine.description, "Fighting for its eastern regions.");
  assert.deepEqual(ukraine.tags, ["defensive"]);
  assert.equal(ukraine.reputation, 62);
  assert.equal(ukraine.intelligence, 4);
  assert.deepEqual(ukraine.claimsAsserted.map((entry) => entry.id), ["ukr-zap"]);
  assert.equal(ukraine.relations.length, 1);
});

test("recent_events: newest last, bounded, filterable by a name, with what moved on the map", () => {
  const two = run("recent_events", { limit: 2 });
  assert.deepEqual(two.events.map((event) => event.id), ["e2", "e3"]);
  assert.equal(two.total, 3);
  const about = run("recent_events", { about: "Zaporizhzhia" });
  assert.deepEqual(about.events.map((event) => event.id), ["e1"]);
  assert.deepEqual(about.events[0].mapChanges, ["Zaporizhzhia -> Russian Federation"]);
  assert.deepEqual(run("recent_events", { about: "Ukraine" }).events.map((event) => event.id), ["e1"]);
});

test("war_ledger and chat_history read the ledgers as they are", () => {
  const ledger = run("war_ledger", {});
  assert.equal(ledger.wars[0].status, "active");
  assert.deepEqual(ledger.wars[0].participants.sort(), ["Russian Federation", "Ukraine"]);
  assert.deepEqual(ledger.agreements[0].parties, ["Ukraine", "Russian Federation"]);

  const chat = run("chat_history", { with: "Russian Federation", limit: 1 });
  assert.deepEqual(chat.messages, [{ from: "Russian Federation", date: "", text: "No." }]);
  assert.match(run("chat_history", { with: "Ukraine" }).hint, /No conversation/);
  assert.match(run("chat_history", { with: "Russia" }).error, /not a power/);
});

test("list_units and contested_regions", () => {
  assert.equal(run("list_units", {}).count, 1);
  assert.equal(run("list_units", { owner: "Ukraine" }).count, 0);
  assert.deepEqual(run("list_units", { owner: "Russian Federation" }).units[0], {
    id: "u1", name: "3rd Army", type: "army", owner: "Russian Federation", strength: 80, posture: "attack", regionId: "rus-belgorod", lng: 36.6, lat: 50.6,
  });
  const contested = run("contested_regions", {});
  assert.deepEqual(contested.regions, [{ id: "ukr-zap", name: "Zaporizhzhia", owner: "Russian Federation", sovereign: "Ukraine", claimants: ["Ukraine"] }]);
});

test("an unknown function is answered with the list of real ones", () => {
  assert.match(run("teleport", {}).error, /Unknown lookup "teleport"/);
  assert.match(run("find_region", {}).error, /name is required/);
});

test("events keyed by round and a region catalogue with baked owners both work", () => {
  const ctx = buildLookupContext({
    regions: [{ id: "a", name: "Alpha", country: "Ukraine" }, { id: "b", name: "Beta", owner: "Ukraine" }],
    world: { regionOwnershipOverrides: { a: "Russian Federation" } },
    events: { 1: [{ id: "x", title: "one" }], 2: [{ id: "y", title: "two" }] },
  });
  assert.deepEqual(executeLookup(ctx, "list_powers", {}).powers, [{ name: "Russian Federation", regions: 1 }, { name: "Ukraine", regions: 1 }]);
  assert.deepEqual(executeLookup(ctx, "recent_events", {}).events.map((event) => event.id), ["x", "y"]);
  // No geometry: no neighbours, and no city can be placed.
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "a" }).neighbours, []);
});

test("declared adjacencies beat bounding boxes, and count in both directions", () => {
  const ctx = buildLookupContext({
    regions: [
      { id: "a", name: "Alpha", lng: 10, lat: 10, adjacencies: ["b"] },
      { id: "b", name: "Beta", lng: 11, lat: 10 },
      { id: "c", name: "Gamma", lng: 10.5, lat: 10.2 }, // near, but not declared
    ],
    world: { regionOwnershipOverrides: { a: "Ukraine", b: "Ukraine", c: "Ukraine" } },
  });
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "a" }).neighbours.map((r) => r.id), ["b"]);
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "b" }).neighbours.map((r) => r.id), ["a"]);
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "c" }).neighbours, []);
});

test("a city with no containing polygon is placed by the nearest centroid, marked approximate", () => {
  const ctx = buildLookupContext({
    regions: [{ id: "a", name: "Alpha", lng: 10, lat: 10 }, { id: "b", name: "Beta", lng: 20, lat: 20 }],
    world: { regionOwnershipOverrides: { a: "Ukraine", b: "Ukraine" } },
    cities: [{ name: "Near Alpha", coordinates: [10.4, 9.8] }, { name: "Far Away", coordinates: [40, 40] }],
  });
  const near = executeLookup(ctx, "find_city", { name: "Near Alpha" }).matches[0];
  assert.equal(near.regionId, "a");
  assert.equal(near.approximate, true);
  assert.equal(executeLookup(ctx, "find_city", { name: "Far Away" }).matches[0].regionId, null);
});

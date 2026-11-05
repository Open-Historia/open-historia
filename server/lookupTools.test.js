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
import { viewerAudience } from "../src/Game/AI/audience.js";

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
  wars: [{ id: "w1", status: "active", title: "War in the east", sideA: ["Russian Federation"], sideB: ["Ukraine"], startedDate: "2014-02-27", cause: "Border crisis." }],
  agreements: [{ id: "a1", kind: "ceasefire", title: "Minsk", status: "active", parties: ["Ukraine", "Russian Federation"] }],
  relations: [{ id: "r1", a: "Russian Federation", b: "Ukraine", score: -70, status: "hostile", summary: "Open war.", lastUpdatedDate: "2014-03-01" }],
  projects: [
    { id: "p1", name: "Northern Shield", kind: "military", ownerCode: "Ukraine", status: "active", priority: "high", progress: 40, targetDate: "2014-06-01", lastUpdate: "Digging in.", nextMilestone: { title: "Second line", date: "2014-04-01", status: "pending" }, onComplete: { regionClaims: [{ regionId: "ukr-zap", regionName: "Zaporizhzhia", claimantCode: "Ukraine" }] } },
    { id: "p2", name: "Pipeline", kind: "industry", ownerCode: "Russian Federation", status: "completed", progress: 100 },
  ],
  storylines: [
    { id: "s1", kind: "war", title: "Eastern front", status: "active", participants: ["Ukraine", "Russian Federation"], pressure: 70, momentum: 20, startedDate: "2014-03-01", state: "Stalemate along the river." },
    { id: "s2", kind: "politics", title: "Moscow succession", status: "dormant", participants: ["Russian Federation"], pressure: 10, momentum: 0 },
  ],
  spies: [
    { id: "spy-1", owner: "Ukraine", target: "Russian Federation", status: "active", deployedAt: "2014-01-10", coverStory: "Trade attache", suspected: true },
    { id: "spy-2", owner: "Russian Federation", target: "Ukraine", status: "discovered" },
  ],
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
  // Every lookup the catalogue declares is one the directive can point the model at.
  assert.equal(LOOKUP_TOOL_NAMES.length, 23);
  for (const name of ["political_actor", "list_institutions", "institution_info"]) assert.match(LOOKUP_DIRECTIVE, new RegExp(name));
});

test("list_powers: exact names, counts by current control, the player flagged", () => {
  const out = run("list_powers", {});
  assert.deepEqual(out.powers, [
    { name: "Russian Federation", regions: 3 },
    { name: "Ukraine", regions: 3, player: true },
  ]);
  assert.deepEqual(run("list_powers", { query: "russ" }).powers.map((power) => power.name), ["Russian Federation"]);
});

test("list_powers: landless polities in the present are listed, the player's group polity marked", () => {
  const ctx = buildLookupContext({
    regions: REGIONS,
    world: {
      ...WORLD,
      polityOverrides: {
        ...WORLD.polityOverrides,
        "Free Kharkiv Brigades": { name: "Free Kharkiv Brigades", status: "active" },
        GXL: { name: "Government in Exile", aliases: [] },
        "Old Kingdom": { name: "Old Kingdom", status: "dissolved" },
        "Sleeping Khanate": { name: "Sleeping Khanate", status: "dormant" },
      },
      groups: { "Free Kharkiv Brigades": { description: "Partisans." } },
      groupAreas: { "ukr-kharkiv": "Free Kharkiv Brigades" },
    },
    player: "Free Kharkiv Brigades",
  });
  const out = executeLookup(ctx, "list_powers", {});
  assert.deepEqual(out.powers, [
    { name: "Russian Federation", regions: 3 },
    { name: "Ukraine", regions: 3 },
    { name: "Free Kharkiv Brigades", regions: 0, landless: true, player: true, alsoGroup: true },
    // Keyed by a legacy code: listed by the label every other function resolves.
    { name: "GXL", regions: 0, landless: true },
  ]);
  assert.equal(out.count, 4);
  // What list_powers names, power_info answers.
  assert.equal(executeLookup(ctx, "power_info", { name: "GXL" }).regions, 0);
  assert.equal(executeLookup(ctx, "power_info", { name: "Government in Exile" }).name, "GXL");
  // A landless polity is also a close name for an unknown one.
  assert.deepEqual(executeLookup(ctx, "list_regions", { owner: "Free Kharkiv" }).didYouMean, ["Free Kharkiv Brigades"]);
});

test("list_regions: one power's regions by name, paged", () => {
  const all = run("list_regions", { owner: "Ukraine" });
  assert.equal(all.total, 3);
  assert.deepEqual(all.regions.map((region) => region.name), ["Kharkiv", "Kremenchuk North", "Kremenchuk South"]);
  assert.equal(all.next, undefined);
  const page = run("list_regions", { owner: "Ukraine", limit: 2 });
  assert.equal(page.regions.length, 2);
  assert.equal(page.next, 2);
  assert.deepEqual(run("list_regions", { owner: "Ukraine", offset: 2 }).regions.map((region) => region.name), ["Kremenchuk South"]);
});

test("owner names are exact: Russia is not the Russian Federation", () => {
  const out = run("list_regions", { owner: "Russia" });
  assert.match(out.error, /"Russia" is not a power/);
  assert.deepEqual(out.didYouMean, ["Russian Federation"]);
  assert.equal(out.powers, undefined);
  assert.equal(run("power_info", { name: "Russia" }).error !== undefined, true);
  // A declared alias and a legacy code both name the power the map spells out.
  assert.equal(run("list_regions", { owner: "UKR" }).owner, "Ukraine");
  assert.equal(run("power_info", { name: "RUS" }).name, "Russian Federation");
});

test("an unknown power is answered with the closest exact names, else the alphabetical list", () => {
  const owners = {};
  const regions = [];
  for (const name of ["Albania", "Austria", "Australia", "Belarus", "Russian Federation", "Prussia", "Rwanda", "Tunisia", "Democratic Republic of the Congo", "Republic of the Congo"]) {
    const id = name.toLowerCase().replace(/\W+/g, "-");
    regions.push({ id, name: `${name} heartland` });
    owners[id] = name;
  }
  const ctx = buildLookupContext({ regions, world: { regionOwnershipOverrides: owners } });
  const ask = (owner) => executeLookup(ctx, "list_regions", { owner });
  // Containment first, a whole word ahead of a fragment; then a letter or two off.
  assert.deepEqual(ask("Russia").didYouMean, ["Russian Federation", "Prussia"]);
  assert.deepEqual(ask("Congo").didYouMean, ["Republic of the Congo", "Democratic Republic of the Congo"]);
  assert.deepEqual(ask("Austia").didYouMean, ["Austria"]);
  assert.equal(ask("Russia").powers, undefined);
  // Nothing close: the alphabetical list, as before.
  const far = ask("Zzyzx");
  assert.equal(far.didYouMean, undefined);
  assert.equal(far.powers[0], "Albania");
  assert.equal(far.powers.length, 10);
  // A suggestion never resolves: the near name still names nobody.
  assert.match(ask("Russia").error, /not a power/);
});

test("find_region: exact, with an administrative suffix, a transliteration off, or ambiguous", () => {
  const exact = run("find_region", { name: "Kharkiv" });
  assert.equal(exact.bestMatch.name, "Kharkiv");
  assert.equal(exact.bestMatch.rule, "exact");
  assert.equal(exact.matches[0].confidence, 100);

  const suffixed = run("find_region", { name: "Kharkiv Oblast" });
  assert.equal(suffixed.bestMatch.name, "Kharkiv");
  assert.equal(suffixed.bestMatch.rule, "affix");

  const spelled = run("find_region", { name: "Zaporizhzhya", owner: "Russian Federation" });
  assert.equal(spelled.owner, "Russian Federation");
  assert.equal(spelled.bestMatch.name, "Zaporizhzhia");
  assert.equal(spelled.bestMatch.rule, "fuzzy");
  assert.equal(spelled.matches[0].owner, "Russian Federation");

  const ambiguous = run("find_region", { name: "Kremenchuk" });
  assert.equal(ambiguous.bestMatch, undefined);
  assert.deepEqual(ambiguous.matches.map((match) => match.name).sort(), ["Kremenchuk North", "Kremenchuk South"]);

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
  assert.deepEqual(kharkiv.neighbours.map((region) => [region.name, region.owner]).sort(), [["Belgorod", "Russian Federation"]]);

  const zap = run("region_info", { regionId: "ukr-zap" });
  assert.equal(zap.owner, "Russian Federation");
  assert.equal(zap.sovereign, "Ukraine");
  assert.deepEqual(zap.claimants, ["Ukraine"]);

  assert.match(run("region_info", { regionId: "nope" }).error, /No region is called/);
});

test("find_city: the region that contains the city, by name or by a former name", () => {
  const belgorod = run("find_city", { name: "Belgorod" });
  assert.deepEqual(belgorod.matches, [{ city: "Belgorod", population: 390000, region: "Belgorod", owner: "Russian Federation" }]);
  assert.equal(run("find_city", { name: "Samar" }).matches[0].city, "Novomoskovsk");
  assert.match(run("find_city", { name: "Nowhere" }).hint, /No city/);
});

test("power_info: holdings, wars, claims each way, units, description, ratings", () => {
  const russia = run("power_info", { name: "Russian Federation" });
  assert.equal(russia.regions, 3);
  assert.deepEqual(russia.wars.map((war) => war.id), ["w1"]);
  assert.ok(russia.wars[0].participants.includes("Ukraine"));
  assert.deepEqual(russia.claimsAgainstIt.map((entry) => entry.name), ["Zaporizhzhia"]);
  assert.deepEqual(russia.claimsAsserted, []);
  assert.equal(russia.units, 1);

  const ukraine = run("power_info", { name: "Ukraine" });
  assert.equal(ukraine.description, "Fighting for its eastern regions.");
  assert.deepEqual(ukraine.tags, ["defensive"]);
  assert.equal(ukraine.reputation, 62);
  assert.equal(ukraine.intelligence, 4);
  assert.deepEqual(ukraine.claimsAsserted.map((entry) => entry.name), ["Zaporizhzhia"]);
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

test("chat_history: every thread with the power, the live one with the latest word read, chatId reads another", () => {
  // Stored newest-created first, as the save keeps them.
  const chats = [
    { id: "c-council", title: "Council table", institutionId: "rc", countries: [{ name: "Russian Federation" }, { name: "Belarus" }], messages: [{ speaker: "Belarus", text: "Order.", time: "2014-03-02" }] },
    { id: "c-old", title: "Old talks", status: "closed", countries: [{ name: "Russian Federation" }], messages: [{ speaker: "Russian Federation", text: "Done.", time: "2014-03-09" }] },
    { id: "c-live", title: "Ceasefire", countries: [{ name: "Russian Federation" }], messages: [{ speaker: "Ukraine", text: "Hold fire.", time: "2014-03-04" }, { speaker: "Russian Federation", text: "Agreed.", time: "" }] },
    { id: "c-bc", title: "Ancient", countries: [{ name: "Russian Federation" }], messages: [{ speaker: "Ukraine", text: "Old.", time: "300 BC" }] },
  ];
  const ctx = buildLookupContext({ regions: REGIONS, world: WORLD, chats, player: "Ukraine" });
  const out = executeLookup(ctx, "chat_history", { with: "Russian Federation" });
  assert.equal(out.chatId, "c-live");
  assert.equal(out.title, "Ceasefire");
  assert.deepEqual(out.messages.map((message) => message.text), ["Hold fire.", "Agreed."]);
  assert.equal(out.messages[0].date, "2014-03-04");
  assert.deepEqual(out.threads.map((thread) => thread.id), ["c-live", "c-council", "c-bc", "c-old"]);
  assert.deepEqual(out.threads[0], { id: "c-live", title: "Ceasefire", participants: ["Russian Federation"], messages: 2, lastMessageDate: "2014-03-04" });
  assert.equal(out.threads[1].institutionId, "rc");
  assert.equal(out.threads[3].status, "closed");

  const old = executeLookup(ctx, "chat_history", { with: "Russian Federation", chatId: "c-old" });
  assert.equal(old.chatId, "c-old");
  assert.deepEqual(old.messages.map((message) => message.text), ["Done."]);
  const missing = executeLookup(ctx, "chat_history", { with: "Russian Federation", chatId: "nope" });
  assert.deepEqual(missing.messages, []);
  assert.match(missing.hint, /No thread "nope"/);
  // A thread with someone else is not one of this power's.
  assert.match(executeLookup(ctx, "chat_history", { with: "Ukraine", chatId: "c-live" }).hint, /No conversation/);
});

test("list_units and contested_regions", () => {
  assert.equal(run("list_units", {}).count, 1);
  assert.equal(run("list_units", { owner: "Ukraine" }).count, 0);
  assert.deepEqual(run("list_units", { owner: "Russian Federation" }).units[0], {
    name: "3rd Army", type: "army", owner: "Russian Federation", strength: 80, posture: "attack", region: "Belgorod", lng: 36.6, lat: 50.6,
  });
  const contested = run("contested_regions", {});
  assert.deepEqual(contested.regions, [{ name: "Zaporizhzhia", owner: "Russian Federation", sovereign: "Ukraine", claimants: ["Ukraine"] }]);
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
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "a" }).neighbours.map((r) => r.name), ["Beta"]);
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "b" }).neighbours.map((r) => r.name), ["Alpha"]);
  assert.deepEqual(executeLookup(ctx, "region_info", { regionId: "c" }).neighbours, []);
});

test("a city with no containing polygon is placed by the nearest centroid, marked approximate", () => {
  const ctx = buildLookupContext({
    regions: [{ id: "a", name: "Alpha", lng: 10, lat: 10 }, { id: "b", name: "Beta", lng: 20, lat: 20 }],
    world: { regionOwnershipOverrides: { a: "Ukraine", b: "Ukraine" } },
    cities: [{ name: "Near Alpha", coordinates: [10.4, 9.8] }, { name: "Far Away", coordinates: [40, 40] }],
  });
  const near = executeLookup(ctx, "find_city", { name: "Near Alpha" }).matches[0];
  assert.equal(near.region, "Alpha");
  assert.equal(near.approximate, true);
  assert.equal(executeLookup(ctx, "find_city", { name: "Far Away" }).matches[0].region, null);
});

test("list_projects: the board by owner and status, with what completion moves on the map", () => {
  const open = run("list_projects", {});
  assert.deepEqual(open.projects.map((project) => project.id), ["p1"]);
  assert.equal(open.projects[0].owner, "Ukraine");
  assert.deepEqual(open.projects[0].onComplete, ["claim Zaporizhzhia by Ukraine"]);
  assert.equal(open.projects[0].nextMilestone.title, "Second line");
  assert.deepEqual(run("list_projects", { status: "all" }).projects.map((project) => project.id), ["p1", "p2"]);
  assert.deepEqual(run("list_projects", { owner: "Russian Federation", status: "closed" }).projects.map((project) => project.id), ["p2"]);
  assert.match(run("list_projects", { owner: "Russia" }).error, /not a power/);
});

test("list_projects: a proposed programme is open, and the board's statuses decide it", () => {
  const ctx = buildLookupContext({
    regions: REGIONS,
    world: {
      ...WORLD,
      projects: [
        { id: "q1", name: "Canal", ownerCode: "Ukraine", status: "proposed" },
        { id: "q2", name: "Dam", ownerCode: "Ukraine", status: "Stalled" },
        { id: "q3", name: "Bridge", ownerCode: "Ukraine", status: "complete" },
        { id: "q4", name: "Port", ownerCode: "Ukraine", status: "cancelled" },
        { id: "q5", name: "Rail", ownerCode: "Ukraine" },
      ],
    },
    player: "Ukraine",
  });
  assert.deepEqual(executeLookup(ctx, "list_projects", {}).projects.map((project) => project.id), ["q1", "q2", "q5"]);
  assert.deepEqual(executeLookup(ctx, "list_projects", { status: "closed" }).projects.map((project) => project.id), ["q3", "q4"]);
});

test("relations_between: the pairwise ledger, agreements and whether they are at war", () => {
  const pair = run("relations_between", { a: "Ukraine", b: "Russian Federation" });
  assert.equal(pair.relation.score, -70);
  assert.equal(pair.relation.status, "hostile");
  assert.deepEqual(pair.agreements.map((agreement) => agreement.id), ["a1"]);
  assert.equal(pair.atWar, true);
  assert.deepEqual(pair.wars[0].sideA, ["Russian Federation"]);
  assert.equal(pair.wars[0].cause, "Border crisis.");
  assert.equal(run("relations_between", { a: "Russian Federation", b: "Ukraine" }).relation.score, -70);
  assert.match(run("relations_between", { a: "Ukraine", b: "Russia" }).error, /not a power/);
});

test("storylines: filtered by participant and status", () => {
  assert.deepEqual(run("storylines", {}).storylines.map((storyline) => storyline.id), ["s1", "s2"]);
  const ukraine = run("storylines", { participant: "Ukraine" });
  assert.deepEqual(ukraine.storylines.map((storyline) => storyline.id), ["s1"]);
  assert.equal(ukraine.storylines[0].state, "Stalemate along the river.");
  assert.deepEqual(run("storylines", { status: "dormant" }).storylines.map((storyline) => storyline.id), ["s2"]);
});

test("region_history: every recorded change of hands, oldest first", () => {
  const zap = run("region_history", { regionId: "ukr-zap" });
  assert.deepEqual(zap.changes, [{ date: "2014-03-01", event: "Russian Federation moves on Zaporizhzhia", change: "transfer from Ukraine to Russian Federation" }]);
  assert.equal(zap.sovereign, "Ukraine");
  assert.match(run("region_history", { regionId: "ukr-kharkiv" }).hint, /No recorded change/);
  assert.match(run("region_history", { regionId: "nope" }).error, /No region is called/);
});

test("path_between: neighbouring chains, with whose land is crossed", () => {
  const one = run("path_between", { fromRegionId: "ukr-kharkiv", toRegionId: "rus-belgorod" });
  assert.equal(one.steps, 1);
  assert.deepEqual(one.path.map((entry) => entry.name), ["Kharkiv", "Belgorod"]);
  assert.equal(run("path_between", { fromRegionId: "ukr-kn", toRegionId: "ukr-ks" }).steps, 1);
  assert.equal(run("path_between", { fromRegionId: "ukr-kn", toRegionId: "ukr-kn" }).steps, 0);
  assert.match(run("path_between", { fromRegionId: "ukr-kharkiv", toRegionId: "rus-moscow" }).error, /No chain/);
  assert.match(run("path_between", { fromRegionId: "x", toRegionId: "rus-moscow" }).error, /No region/);
});

test("spy_network: agents abroad and foreign agents at home", () => {
  const ukraine = run("spy_network", { owner: "Ukraine" });
  assert.deepEqual(ukraine.agentsAbroad.map((spy) => [spy.target, spy.status, spy.suspected]), [["Russian Federation", "active", true]]);
  assert.equal(ukraine.agentsAbroad[0].cover, "Trade attache");
  assert.deepEqual(ukraine.foreignAgentsAtHome.map((spy) => spy.owner), ["Russian Federation"]);
  assert.equal(run("spy_network", {}).count, 2);
  assert.match(run("spy_network", { owner: "Russia" }).error, /not a power/);
});

test("list_cities: placed in regions, largest first, by owner", () => {
  const russia = run("list_cities", { owner: "Russian Federation" });
  assert.deepEqual(russia.cities.map((city) => [city.name, city.region]), [["Belgorod", "Belgorod"], ["Novomoskovsk", "Moscow"]]);
  assert.deepEqual(run("list_cities", { owner: "Ukraine" }).cities.map((city) => city.name), ["Kharkiv"]);
  assert.equal(run("list_cities", { limit: 1 }).cities.length, 1);
  assert.equal(run("list_cities", { capitalsOnly: true }).count, 0);
});

test("border_between: where two powers' regions touch, both sides named", () => {
  const front = run("border_between", { a: "Ukraine", b: "Russian Federation" });
  assert.equal(front.count, 1);
  assert.deepEqual(front.pairs[0], { Ukraine: "Kharkiv", "Russian Federation": "Belgorod" });
  assert.equal(run("border_between", { a: "Russian Federation", b: "Ukraine" }).pairs[0]["Russian Federation"], "Belgorod");
  assert.match(run("border_between", { a: "Ukraine", b: "Ukraine" }).error, /two different/);
  assert.match(run("border_between", { a: "Ukraine", b: "Russia" }).error, /not a power/);
});

test("map_around: the neighbourhood of a region grouped by owner, with sovereigns where they differ", () => {
  const around = run("map_around", { regionId: "ukr-kharkiv" });
  assert.equal(around.centre.name, "Kharkiv");
  assert.deepEqual(Object.keys(around.byOwner).sort(), ["Russian Federation", "Ukraine"]);
  assert.deepEqual(around.byOwner.Ukraine.map((entry) => [entry.name, entry.steps]), [["Kharkiv", 0]]);
  assert.deepEqual(around.byOwner["Russian Federation"].map((entry) => [entry.name, entry.steps]), [["Belgorod", 1]]);
  const wider = run("map_around", { regionId: "ukr-kn", steps: 2 });
  assert.equal(wider.regions, 2);
  const occupied = run("map_around", { regionId: "ukr-zap" });
  assert.equal(occupied.byOwner["Russian Federation"][0].sovereign, "Ukraine");
  assert.match(run("map_around", { regionId: "nope" }).error, /No region/);
});

const PUPPET_WORLD = {
  ...WORLD,
  polityOverrides: {
    ...WORLD.polityOverrides,
    Belarus: { name: "Belarus" },
    Moldova: { name: "Moldova" },
    Crimea: { name: "Crimea" },
  },
  puppets: [
    { id: "p-bel", overlord: "Russian Federation", puppet: "Belarus", kind: "satellite", secrecy: "open", loyalty: 70, status: "active", startedDate: "1994-07-20" },
    { id: "p-mda", overlord: "Russian Federation", puppet: "Moldova", kind: "client", secrecy: "covert", loyalty: 30, status: "active", startedDate: "2013-05-01", knownTo: [{ polity: "Ukraine", learnedDate: "2014-02-01" }] },
    { id: "p-crm", overlord: "Ukraine", puppet: "Crimea", kind: "protectorate", secrecy: "open", loyalty: 50, status: "released", startedDate: "1992-01-01", endedDate: "1995-01-01" },
  ],
};

test("power_info and relations_between: who directs whom, the truth for the narrator", () => {
  const ctx = buildLookupContext({ regions: REGIONS, world: PUPPET_WORLD, player: "Ukraine" });
  assert.deepEqual(executeLookup(ctx, "power_info", { name: "Russian Federation" }).subordinations, [
    { overlord: "Russian Federation", puppet: "Belarus", kind: "satellite", secrecy: "open", loyalty: 70, since: "1994-07-20" },
    { overlord: "Russian Federation", puppet: "Moldova", kind: "client", secrecy: "covert", loyalty: 30, since: "2013-05-01", alsoKnownTo: ["Ukraine"] },
  ]);
  // An arrangement that ended directs nobody.
  assert.deepEqual(executeLookup(ctx, "power_info", { name: "Ukraine" }).subordinations, []);
  const pair = executeLookup(ctx, "relations_between", { a: "Belarus", b: "Russian Federation" });
  assert.deepEqual(pair.subordinations.map((row) => `${row.overlord}>${row.puppet}`), ["Russian Federation>Belarus"]);
  assert.deepEqual(executeLookup(ctx, "relations_between", { a: "Belarus", b: "Moldova" }).subordinations, []);
});

test("subordinations as a viewer knows them", () => {
  const as = (polity) => buildLookupContext({ regions: REGIONS, world: PUPPET_WORLD, player: "Ukraine", audience: viewerAudience([polity]) });
  // Ukraine's service uncovered the covert client; the open satellite is public. No loyalty for another's puppet.
  assert.deepEqual(executeLookup(as("Ukraine"), "power_info", { name: "Russian Federation" }).subordinations, [
    { overlord: "Russian Federation", puppet: "Belarus", kind: "satellite", secrecy: "open", since: "1994-07-20" },
    { overlord: "Russian Federation", puppet: "Moldova", kind: "client", secrecy: "covert", since: "2013-05-01", fromIntelligence: true, asOf: "2014-02-01" },
  ]);
  // Belarus knows its own arrangement and nothing of the covert one.
  assert.deepEqual(executeLookup(as("Belarus"), "power_info", { name: "Russian Federation" }).subordinations.map((row) => row.puppet), ["Belarus"]);
  assert.deepEqual(executeLookup(as("Belarus"), "relations_between", { a: "Moldova", b: "Russian Federation" }).subordinations, []);
  // The overlord reads its puppet's loyalty as a band, never a number.
  assert.equal(executeLookup(as("Russian Federation"), "power_info", { name: "Moldova" }).subordinations[0].loyalty, "Restless");
});

test("list_regions with a group: its whole area with each region's owner, paged; map_around names the group", () => {
  const ctx = buildLookupContext({
    regions: REGIONS,
    world: {
      ...WORLD,
      groups: { "Kharkiv Partisans": { description: "Irregulars." } },
      groupAreas: { "ukr-kharkiv": "Kharkiv Partisans", "rus-belgorod": "Kharkiv Partisans" },
    },
    player: "Ukraine",
  });
  const area = executeLookup(ctx, "list_regions", { group: "Kharkiv Partisans" });
  assert.equal(area.group, "Kharkiv Partisans");
  assert.equal(area.total, 2);
  assert.deepEqual(area.regions, [
    { name: "Kharkiv", owner: "Ukraine" },
    { name: "Belgorod", owner: "Russian Federation" },
  ]);
  const page = executeLookup(ctx, "list_regions", { group: "Kharkiv Partisans", limit: 1 });
  assert.equal(page.next, 1);
  assert.deepEqual(executeLookup(ctx, "list_regions", { group: "Kharkiv Partisans", offset: 1 }).regions.map((region) => region.name), ["Belgorod"]);
  assert.match(executeLookup(ctx, "list_regions", { group: "Kharkov Partisans" }).error, /No group named/);
  assert.match(executeLookup(ctx, "list_regions", {}).error, /required/);
  // owner wins when both are given.
  assert.equal(executeLookup(ctx, "list_regions", { owner: "Ukraine", group: "Kharkiv Partisans" }).owner, "Ukraine");

  const around = executeLookup(ctx, "map_around", { regionId: "ukr-kharkiv" });
  assert.equal(around.byOwner.Ukraine[0].controlledByGroup, "Kharkiv Partisans");
  assert.equal(around.byOwner["Russian Federation"][0].controlledByGroup, "Kharkiv Partisans");
  assert.equal("controlledByGroup" in executeLookup(ctx, "map_around", { regionId: "ukr-zap" }).byOwner["Russian Federation"][0], false);
});

test("a region is asked for by its name, however it is written; the map's own key is still read", () => {
  const byName = run("region_info", { region: "Kharkiv" });
  assert.equal(byName.name, "Kharkiv");
  assert.equal("id" in byName, false, "no answer carries the map's key for a region");
  assert.equal(run("region_info", { region: "region: Kharkiv" }).name, "Kharkiv");
  assert.equal(run("region_info", { region: "Kharkiv (Ukraine)" }).name, "Kharkiv");
  assert.equal(run("region_info", { region: "kharkiv oblast" }).name, "Kharkiv", "a suffix or a letter off, when one region fits");
  assert.equal(run("region_info", { regionId: "ukr-kharkiv" }).name, "Kharkiv");
  assert.equal(run("map_around", { region: "Kharkiv" }).centre.name, "Kharkiv");
  assert.equal(run("path_between", { fromRegion: "Kharkiv", toRegion: "Belgorod" }).steps, 1);
  assert.match(run("region_history", { region: "Zaporizhzhia" }).name, /Zaporizhzhia/);
  assert.match(run("region_info", { region: "Atlantis" }).error, /No region is called "Atlantis"/);
  assert.match(run("region_info", {}).error, /Name the region/);
});

test("two regions of one name are told apart by their owner, never guessed", () => {
  const ctx = buildLookupContext({
    regions: [
      { id: "us-ga", name: "Georgia", owner: "United States" },
      { id: "ge-1", name: "Georgia", owner: "Georgia" },
    ],
    world: {},
  });
  assert.match(executeLookup(ctx, "region_info", { region: "Georgia" }).error, /2 regions are called "Georgia", held by United States, Georgia\. Say which, as "Georgia \(<owner>\)"/);
  assert.equal(executeLookup(ctx, "region_info", { region: "Georgia (United States)" }).owner, "United States");
  assert.equal(executeLookup(ctx, "region_info", { region: "region: Georgia (Georgia)" }).owner, "Georgia");
});

// A territory by its own name (src/Game/AI/namedAreas.js): Greenland is no
// power and no region of the built-in map, only the regions that belong to it.
test("list_regions names a power's territories beside its regions", () => {
  const context = buildLookupContext({
    regions: [
      { id: "50", name: "Copenhagen", country: "Denmark", countryCode: "DNK", geometry: square(12, 55) },
      { id: "4709", name: "Nuuk", country: "Denmark", countryCode: "GRL", geometry: square(-52, 64) },
      { id: "4710", name: "Sermersooq", country: "Denmark", countryCode: "GRL", geometry: square(-40, 66) },
    ],
    world: {},
  });
  const out = executeLookup(context, "list_regions", { owner: "Denmark" });
  assert.deepEqual(out.territories, [{ name: "Greenland", regions: 2 }]);
  assert.deepEqual(out.regions, [{ name: "Copenhagen" }, { name: "Nuuk", territory: "Greenland" }, { name: "Sermersooq", territory: "Greenland" }]);
  assert.match(out.note, /country: <its name>/);
  assert.deepEqual(context.areaNamed("Greenland").rows.map((row) => row.name), ["Nuuk", "Sermersooq"]);
  assert.equal(context.areaNamed("Atlantis"), null);
});

test("list_regions says nothing of territories for a power that has none", () => {
  const out = run("list_regions", { owner: "Ukraine" });
  assert.equal("territories" in out, false);
  assert.equal("note" in out, false);
});

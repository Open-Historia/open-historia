/*! Open Historia — who an event involves, by what it records: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/eventParties.test.js
//
// An event's parties are what it records, never its words: a name looked for
// in a title found "IRA" in "Iran" and never found "Allemagne" for Germany.
//
// Two of its readers live in gameplay.js, which cannot be imported without the
// whole app: they are sliced out of it and run with their real helpers, as
// placementPass.test.js runs the placement pass.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { eventPartyNames, eventPlaceCountries } from "./eventParties.js";
import { isPendingAction } from "./regionFocus.js";
import { findGroupKey, normalizeGroups } from "../../runtime/groups.js";
import { normalizeEvents } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const sliced = (from, to) => {
  const start = gameplay.indexOf(from);
  const end = gameplay.indexOf(to, start);
  assert.ok(start !== -1 && end > start, `could not find ${from} in gameplay.js`);
  return gameplay.slice(start, end);
};
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();

// gameplay.js groupInViewTest, and compactStorylineRepairHistory with its limit.
const groupInViewTest = new Function(
  "normalizeArray", "normalizeString", "findGroupKey", "eventPartyNames", "isPendingAction",
  `${sliced("const groupInViewTest = ", "// Groups (runtime/groups.js) as the model reads them")}\nreturn groupInViewTest;`,
)(asArray, asText, findGroupKey, eventPartyNames, isPendingAction);
const compactStorylineRepairHistory = new Function(
  "normalizeArray", "normalizeString", "normalizeEvents", "toCountryName", "eventPartyNames",
  `${sliced("const WORLD_MOTION_REPAIR_HISTORY_LIMIT = ", "const runTargetedWorldMotionRepair = ")}\nreturn compactStorylineRepairHistory;`,
)(asArray, asText, normalizeEvents, toCountryName, eventPartyNames);

const decidedBy = (polity) => ({
  principal: polity,
  principalKind: "polity",
  sovereignPolity: polity,
  authority: "autonomous",
  sovereignActors: [{ polity, authority: "autonomous" }],
});

test("an event's parties are every party its structure names", () => {
  const event = {
    actors: ["Austria"],
    combatants: ["France", "Prussia"],
    agency: {
      principal: "Irish Republican Army",
      principalKind: "organization",
      sovereignPolity: "Denmark",
      authority: "autonomous",
      sovereignActors: [{ polity: "Denmark", authority: "autonomous" }, { polity: "Norway", authority: "autonomous" }],
    },
    warId: "war-1",
    places: [{ kind: "country", name: "Belgium" }, { kind: "city", name: "Liège", lng: 5.57, lat: 50.63 }, "city: Lyon, country: Savoy"],
    impacts: {
      polityChanges: [{ code: "Bavaria", operation: "update" }],
      regionTransfers: [{ regionId: "r1", fromCode: "Saxony", toCode: "Hanover" }],
      regionControlOps: [{ op: "control", regionId: "r2", toCode: "Russia", actorCode: "Russia" }],
      createdChats: [{ speaker: "Sweden", countries: ["Sweden"] }],
      unitOps: [{ op: "spawn", unit: { ownerCode: "Italy" } }],
      markerOps: [{ op: "build", marker: { ownerCode: "Spain" } }],
      groupOps: [{ op: "update", name: "Fenian Brotherhood", newName: "Irish Brotherhood" }],
      institutionLifecycleOps: [{ actorPolity: "Portugal", targetPolity: "Greece" }],
    },
  };
  const wars = [{ id: "war-1", sideA: ["France", "Piedmont"], sideB: ["Prussia", "Württemberg"] }];
  assert.deepEqual(new Set(eventPartyNames(event, { wars })), new Set([
    "Austria", "France", "Prussia", "Irish Republican Army", "Denmark", "Norway", "Belgium", "Savoy", "Piedmont", "Württemberg",
    "Bavaria", "Saxony", "Hanover", "Russia", "Sweden", "Italy", "Spain", "Fenian Brotherhood", "Irish Brotherhood", "Portugal", "Greece",
  ]));
  // A found city or region keeps no country: its name is a place, not a party.
  assert.ok(!eventPartyNames(event, { wars }).includes("Liège"));
});

test("an event's words name nobody, and the same structure names the same parties in every language", () => {
  assert.deepEqual(eventPartyNames({ title: "Iran and the IRA", description: "Oman watches Romania; Germany and Poland are silent.", impacts: {} }), []);
  const structure = { combatants: ["Germany", "Poland"], places: [{ kind: "country", name: "Poland" }], impacts: {} };
  const english = eventPartyNames({ ...structure, title: "Germany invades Poland", description: "Panzers cross the border." });
  const french = eventPartyNames({ ...structure, title: "L'Allemagne envahit la Pologne", description: "Les panzers franchissent la frontière." });
  const chinese = eventPartyNames({ ...structure, title: "德国入侵波兰", description: "装甲部队越过边境。" });
  assert.deepEqual(english, ["Germany", "Poland"]);
  assert.deepEqual(french, english);
  assert.deepEqual(chinese, english);
});

test("a place's country: a found country, or the country a place not yet found was written with", () => {
  assert.deepEqual(eventPlaceCountries({ places: [
    { kind: "country", name: "Poland" },
    { kind: "region", name: "Crimea", regionId: "4441" },
    "city: Kharkiv, country: Ukraine",
    "country: Moldova",
    "the salmon run",
  ] }), ["Poland", "Ukraine", "Moldova"]);
  assert.deepEqual(eventPlaceCountries({}), []);
  assert.deepEqual(eventPartyNames(null), []);
  assert.deepEqual(eventPartyNames({ warId: "war-9", impacts: {} }, { wars: [] }), [], "a war the world does not have names nobody");
});

// ---- the groups a time skip describes in full (gameplay.js groupInViewTest) ----

// A group's whole description is shown when the turn is about it; the rest
// keep their first sentence. Its name used to be looked for (3+ letters) in
// the last twelve events' words, the orders' words and the wars and storylines
// written out whole: "IRA" was in view for every event about Iran, and a group
// a story told in another language named was never in view.
const GROUP_WORLD = () => ({
  groups: normalizeGroups({
    IRA: { description: "An Irish republican paramilitary." },
    Fenians: { description: "A brotherhood.", formerNames: ["Brotherhood of the Harp"] },
    Cartel: { description: "Smugglers." },
    Militia: { description: "Armed farmers." },
    Ghosts: { description: "Unseen." },
    Wardens: { description: "A league." },
  }),
  groupAreas: { r9: "Militia" },
  regionOwnershipOverrides: {},
  wars: [
    { id: "w1", status: "active", sideA: ["United Kingdom"], sideB: ["Brotherhood of the Harp"] },
    { id: "w2", status: "ended", sideA: ["Mexico"], sideB: ["Ghosts"] },
  ],
  storylines: [{ id: "s1", status: "active", participants: ["Wardens"] }],
});

test("a group is in view when a record of the turn names it as a party, never when words do", () => {
  const world = GROUP_WORLD();
  const bundle = {
    events: [
      { id: "e1", title: "Iran tests a missile", description: "The IRA is not involved; Cartel money is rumoured.", impacts: {} },
      { id: "e2", title: "Bombing in Belfast", description: "", combatants: ["United Kingdom", "IRA"], impacts: {} },
    ],
    actions: [{ id: "a1", status: "planned", text: "Negotiate with the Cartel and the Ghosts", participants: [] }],
  };
  const inView = groupInViewTest(bundle, world, [], new Set());
  assert.equal(inView("IRA", []), true, "a combatant of a recent event");
  assert.equal(inView("Fenians", []), true, "a side of a live war, under a former name");
  assert.equal(inView("Wardens", []), true, "a participant of a live storyline");
  assert.equal(inView("Cartel", []), false, "named in an event's and an order's words only");
  assert.equal(inView("Ghosts", []), false, "a side of an ended war, and named in an order's words");
  assert.equal(inView("Militia", ["r9"]), false);
  // The words that once found "IRA" inside "Iran" find nothing now.
  assert.equal(groupInViewTest({ events: [bundle.events[0]] }, { ...world, wars: [], storylines: [] }, [], new Set())("IRA", []), false);
});

test("an event's group operations, its places in a group's area, an order's parties and the land a group holds bring it into view", () => {
  const world = GROUP_WORLD();
  const quiet = { ...world, wars: [], storylines: [] };
  const viewOf = (bundle, inViewPowers = new Set(), catalog = []) => groupInViewTest(bundle, quiet, catalog, inViewPowers);
  assert.equal(viewOf({ events: [{ id: "g", title: "Raid", impacts: { groupOps: [{ op: "take", name: "Cartel", regionIds: ["r1"] }] } }] })("Cartel", []), true);
  assert.equal(viewOf({ events: [{ id: "p", title: "Ambush", places: [{ kind: "region", name: "Hills", regionId: "r9" }], impacts: {} }] })("Militia", ["r9"]), true);
  assert.equal(viewOf({ actions: [{ id: "a", status: "planned", text: "…", participants: ["Ghosts"] }] })("Ghosts", []), true);
  assert.equal(viewOf({ actions: [{ id: "a", status: "resolved", text: "…", participants: ["Ghosts"] }] })("Ghosts", []), false, "an order already answered");
  assert.equal(viewOf({}, new Set(["ruritania"]), [{ id: "r9", country: "Ruritania" }])("Militia", ["r9"]), true, "it holds land in a power in view");
});

test("the same event told in French or Chinese brings the same groups into view as in English", () => {
  const world = { ...GROUP_WORLD(), wars: [], storylines: [] };
  const structure = { combatants: ["United Kingdom", "IRA"], impacts: { groupOps: [{ op: "update", name: "Cartel", description: "x" }] } };
  const viewed = (event) => ["IRA", "Fenians", "Cartel", "Militia", "Ghosts", "Wardens"]
    .filter((name) => groupInViewTest({ events: [event] }, world, [], new Set())(name, []));
  const english = viewed({ ...structure, id: "en", title: "The IRA bombs a barracks; the Cartel pays", description: "" });
  assert.deepEqual(english, ["IRA", "Cartel"]);
  assert.deepEqual(viewed({ ...structure, id: "fr", title: "L'IRA fait sauter une caserne ; le cartel paie", description: "" }), english);
  assert.deepEqual(viewed({ ...structure, id: "zh", title: "爱尔兰共和军炸毁兵营，贩毒集团出资", description: "" }), english);
});

// ---- the events the storyline repair reads (gameplay.js compactStorylineRepairHistory) ----

// Its participants' names were looked for (4+ letters) in the events' titles
// and descriptions: "Oman" chose Romania's events, and a story told in another
// language gave the repair only the storyline's own events.
test("the storyline repair reads its own events and those whose structure names a participant, in every language", () => {
  const storyline = { id: "s-gulf", participants: ["Oman", "France"] };
  const bundle = {
    world: { wars: [{ id: "war-1", sideA: ["France"], sideB: ["Yemen"] }] },
    events: [
      { id: "e1", date: "2030-01-01", title: "Romania hosts a summit", description: "Bucharest welcomes Oman's envoy.", agency: decidedBy("Romania"), impacts: {} },
      { id: "e2", date: "2030-01-02", title: "Tanker seized", description: "", storylineIds: ["s-gulf"], impacts: {} },
      { id: "e3", date: "2030-01-03", title: "Oman closes the strait", description: "", agency: decidedBy("Oman"), impacts: {} },
      { id: "e4", date: "2030-01-04", title: "Oman ferme le détroit", description: "", agency: decidedBy("Oman"), impacts: {} },
      { id: "e5", date: "2030-01-05", title: "阿曼关闭海峡", description: "", agency: decidedBy("Oman"), impacts: {} },
      { id: "e6", date: "2030-01-06", title: "A frigate changes hands", description: "", impacts: { regionTransfers: [{ regionId: "r1", fromCode: "Yemen", toCode: "FRA" }] } },
      { id: "e7", date: "2030-01-07", title: "Naval clash", description: "", warId: "war-1", impacts: {} },
    ],
  };
  const titles = compactStorylineRepairHistory(bundle, storyline).split("\n\n").map((line) => line.split(" — ")[1]);
  assert.deepEqual(titles, ["Tanker seized", "Oman closes the strait", "Oman ferme le détroit", "阿曼关闭海峡", "A frigate changes hands", "Naval clash"]);
  assert.equal(compactStorylineRepairHistory({ events: [bundle.events[0]] }, storyline), "", "named in the words only");
});

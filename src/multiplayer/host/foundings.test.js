/*! Open Historia — a player's people founding a country: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/foundings.test.js
//
// The events are the two a Discord test game's time skips wrote (2026-10-26),
// where two players' groups each founded a country and both seats stayed on
// the group: the new countries' armies and wars were played by the AI.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEAT_KEYED_WORLD_RECORDS, formerNamesOf, groundHeldBy, polityEnded, seatFoundings, seatSuccessions, withSeatLetGo, withSeatMoved } from "./foundings.js";
import { advisorOfSeat, withSeatAdvisor } from "../../runtime/seatAdvisors.js";

const BURGHERS = "The Free Townsmen of Gullhaven";
const HILL = "Hill folk";

const saltport = {
  id: "event-ai-r0001-03540105-005",
  title: "The Free Townsmen of Gullhaven found the country of Saltport",
  impacts: {
    actionIds: ["order-mvpnke40-6"],
    polityChanges: [{ operation: "create", code: "Saltport", name: "Saltport", note: "Founded by the Free Townsmen of Gullhaven." }],
    regionTransfers: [
      { basis: "independence", fromCode: BURGHERS, regionId: "reg_mvoy42nk1k2i", toCode: "Saltport" },
      { basis: "independence", fromCode: BURGHERS, regionId: "reg_mvp0k6s938", toCode: "Saltport" },
    ],
    groupOps: [{ op: "release", name: BURGHERS, regionIds: ["reg_mvoy42nk1k2i", "reg_mvp0k6s938"] }],
  },
};
const hillKingdom = {
  id: "event-ai-r0004-03540115-001",
  title: "The hill folk's realm is founded as the country of Hill Kingdom",
  impacts: {
    actionIds: ["order-mvpo8u5k-f"],
    polityChanges: [{ operation: "create", code: "Hill Kingdom", name: "Hill Kingdom" }],
    regionTransfers: [{ basis: "independence", fromCode: HILL, regionId: "reg_mvp0kbey39", toCode: "Hill Kingdom" }],
  },
};
const actions = [
  { id: "order-mvpnke40-6", ownerCode: BURGHERS, status: "resolved", text: "Found a new country... Saltport" },
  // The host's order names no owner.
  { id: "order-mvpo8u5k-f", status: "resolved", text: "Hill Kingdom is founded as a new country" },
];
// The world after those two rounds: the burghers' area released, the hill folk's ground all the new kingdom's.
const founded = {
  groups: { [BURGHERS]: { name: BURGHERS }, [HILL]: { name: HILL } },
  groupAreas: { reg_mvp0kbey39: HILL },
  regionOwnershipOverrides: { reg_mvoy42nk1k2i: "Saltport", reg_mvp0k6s938: "Saltport", reg_mvp0kbey39: "Hill Kingdom" },
};

test("a seat follows its people to the country their own order founded with their land", () => {
  assert.deepEqual(seatFoundings({ events: [saltport, hillKingdom], actions, seated: [HILL, BURGHERS], host: HILL, world: founded }), [
    { from: BURGHERS, to: "Saltport", eventId: saltport.id },
    { from: HILL, to: "Hill Kingdom", eventId: hillKingdom.id },
  ]);
  // Without the world after the round, nothing says the old polity ended: nobody moves.
  assert.deepEqual(seatFoundings({ events: [saltport, hillKingdom], actions, seated: [HILL, BURGHERS], host: HILL }), []);
});

test("no seat moves for a country founded on someone else's land, by someone else's order, or already played", () => {
  const puppet = { ...saltport, impacts: { ...saltport.impacts, regionTransfers: [{ fromCode: "Kestrelmark", toCode: "Saltport", regionId: "r" }] } };
  assert.deepEqual(seatFoundings({ events: [puppet], actions, seated: [BURGHERS], host: HILL, world: founded }), []);
  assert.deepEqual(seatFoundings({ events: [saltport], actions: [{ ...actions[0], ownerCode: "Kestrelmark" }], seated: [BURGHERS], host: HILL, world: founded }), []);
  assert.deepEqual(seatFoundings({ events: [saltport], actions, seated: [BURGHERS, "Saltport"], host: HILL, world: founded }), []);
  const update = { ...saltport, impacts: { ...saltport.impacts, polityChanges: [{ operation: "update", code: "Saltport" }] } };
  assert.deepEqual(seatFoundings({ events: [update], actions, seated: [BURGHERS], host: HILL, world: founded }), []);
});

// France released Corsica as a puppet, and its player was moved to one-region Corsica with France's whole army and
// spy service; France, which goes on with all its other land, was left to the AI (the review of 2026-11-18, wars 1).
test("a player who releases a colony or sets up a puppet from their own land keeps their seat, and nothing moves", () => {
  const corsica = {
    id: "event-1",
    impacts: {
      actionIds: ["order-1"],
      polityChanges: [{ operation: "create", code: "Corsica", name: "Corsica" }],
      regionTransfers: [{ basis: "independence", fromCode: "France", regionId: "FRA.5_1", toCode: "Corsica" }],
    },
  };
  const orders = [{ id: "order-1", ownerCode: "France", status: "resolved", text: "Release Corsica as a puppet state" }];
  const after = { polityOverrides: { France: { name: "France", status: "active" }, Corsica: { name: "Corsica", status: "active" } }, regionOwnershipOverrides: { "FRA.5_1": "Corsica" } };
  assert.deepEqual(seatFoundings({ events: [corsica], actions: orders, seated: ["France", "Germany"], host: "Germany", world: after, countries: ["France", "Corsica", "Germany"] }), []);
  // France goes on without a record of its own too, as long as the game counts it among its countries.
  assert.deepEqual(seatFoundings({ events: [corsica], actions: orders, seated: ["France"], world: { regionOwnershipOverrides: { "FRA.5_1": "Corsica" } }, countries: ["France", "Corsica"] }), []);
  // A France that ends with it, its record dissolved, is the new country: its seat follows.
  const ended = { ...after, polityOverrides: { ...after.polityOverrides, France: { name: "France", status: "dissolved" } } };
  assert.deepEqual(seatFoundings({ events: [corsica], actions: orders, seated: ["France"], world: ended, countries: ["Corsica"] }), [{ from: "France", to: "Corsica", eventId: "event-1" }]);
  // A group that keeps ground of its own beside the state it set up keeps its seat.
  const faction = "The Narva Committee";
  const breakaway = { id: "ev-2", impacts: { actionIds: ["order-2"], polityChanges: [{ operation: "create", code: "Narva Republic" }], regionTransfers: [{ regionId: "reg-narva", fromCode: "Estonia", toCode: "Narva Republic" }] } };
  const areas = { "reg-narva": faction, "reg-tartu": faction };
  const kept = { groups: { [faction]: { name: faction } }, groupAreas: areas, regionOwnershipOverrides: { "reg-narva": "Narva Republic" } };
  assert.deepEqual(seatFoundings({ events: [breakaway], actions: [{ id: "order-2", ownerCode: faction }], seated: [faction], areas, world: kept }), []);
});

test("a seat's own polity has ended by the world after the round, never by what the event says", () => {
  const world = {
    polityOverrides: { France: { name: "France", status: "active" }, Prussia: { name: "Prussia", status: "dissolved" } },
    groups: { "Hill folk": { name: "Hill folk" }, Burghers: { name: "Burghers" } },
    groupAreas: { r1: "Hill folk", r2: "Burghers", r3: "Burghers" },
    regionOwnershipOverrides: { r1: "Hill Kingdom", r2: "Saltport" },
  };
  assert.equal(polityEnded({ world, country: "France", to: "Corsica", countries: ["France"] }), false, "a country with a living record goes on");
  assert.equal(polityEnded({ world, country: "Prussia", to: "Germany" }), true, "one dissolved has ended");
  assert.equal(polityEnded({ world, country: "Burgundy", to: "Dijon", countries: ["France"] }), true, "one the game no longer counts has ended");
  assert.equal(polityEnded({ world, country: "Burgundy", to: "Dijon" }), false, "without the game's list, one with no record goes on");
  assert.equal(polityEnded({ world, country: "Hill folk", to: "Hill Kingdom" }), true, "a group whose ground is all the new country's");
  assert.equal(polityEnded({ world, country: "Burghers", to: "Saltport" }), false, "a group that keeps ground of its own");
  assert.equal(polityEnded({ world, country: "Riders", to: "Steppe Khanate", areas: { r9: "Riders" } }), true, "a group that is gone");
  assert.equal(polityEnded({ country: "Prussia", to: "Germany" }), false, "nothing without the world");
});

test("what was the old seat's goes with it: queued orders, its board, its agents and its threads; what was done stays", () => {
  const moved = withSeatMoved({
    actions: [{ id: "a", ownerCode: HILL, status: "planned" }, { id: "b", ownerCode: HILL, status: "resolved" }, { id: "c", ownerCode: BURGHERS }, { id: "d", status: "resolved" }],
    world: { seatBoards: { [HILL]: [{ id: "p" }] }, spies: [{ id: "s", owner: HILL, target: BURGHERS }] },
    chats: [{ id: "t", player: HILL }, { id: "u", player: BURGHERS }],
  }, { from: HILL, to: "Hill Kingdom", host: true });
  assert.deepEqual(moved.actions.map((action) => action.ownerCode), ["Hill Kingdom", HILL, BURGHERS, HILL]);
  assert.equal(moved.world.spies[0].owner, "Hill Kingdom");
  assert.deepEqual(Object.keys(moved.world.seatBoards), ["Hill Kingdom"]);
  assert.deepEqual(moved.chats.map((chat) => chat.player), ["Hill Kingdom", BURGHERS]);
});

// A founder kept its orders, board and agents, and lost everything else kept under its name: its seal and its
// agents' reports, its standing goal, the advice a round brings it (the gap audit of 2026-11-18). Every record the
// world keeps for a seat is on one list, and the move takes every one of them.
test("every record the game keeps for a seat follows it, its agents' traffic too; what is the country's stays", () => {
  const seal = "a".repeat(64);
  const moved = withSeatMoved({
    world: {
      seatSeals: { [HILL]: seal, [BURGHERS]: "b".repeat(64) },
      playerGoals: { [HILL]: { text: "Rule the hills" } },
      seatAdvice: { [HILL]: [{ title: "Raise levies" }] },
      treatyOffers: [{ id: "t1", from: HILL, to: BURGHERS }],
    },
    intercepts: { France: { exchanges: [{ id: "host" }] }, "@seats": { [HILL]: { [BURGHERS]: { exchanges: [{ id: "hill-on-burghers" }] } } } },
  }, { from: HILL, to: "Hill Kingdom", host: false });
  assert.equal(moved.world.seatSeals["Hill Kingdom"], seal);
  assert.equal(moved.world.seatSeals[BURGHERS], "b".repeat(64), "another seat's is its own");
  assert.equal(moved.world.playerGoals["Hill Kingdom"].text, "Rule the hills");
  assert.equal(moved.world.seatAdvice["Hill Kingdom"][0].title, "Raise levies");
  assert.equal(moved.world.treatyOffers[0].from, HILL, "an offer the country made stays the country's");
  assert.deepEqual(Object.keys(moved.intercepts["@seats"]), ["Hill Kingdom"]);
  assert.equal(moved.intercepts.France.exchanges[0].id, "host", "the host's table is the game country's");
  // The host's own table is the file's top, and follows game.country without moving.
  const host = withSeatMoved({ intercepts: { France: { exchanges: [] } } }, { from: HILL, to: "Hill Kingdom", host: true });
  assert.deepEqual(host.intercepts, { France: { exchanges: [] } });
  // And its advisor's conversation (runtime/seatAdvisors.js); the host's is the file itself, which follows game.country.
  const counsel = withSeatAdvisor([{ role: "user", text: "France asks." }], HILL, [{ role: "user", text: "The hills ask." }]);
  const followed = withSeatMoved({ advisor: counsel }, { from: HILL, to: "Hill Kingdom", host: false });
  assert.deepEqual(advisorOfSeat(followed.advisor, "Hill Kingdom").map((entry) => entry.text), ["The hills ask."]);
  assert.deepEqual(advisorOfSeat(followed.advisor, HILL), []);
  assert.equal(withSeatMoved({ advisor: counsel }, { from: HILL, to: "Hill Kingdom", host: true }).advisor, counsel);
});

// A founder played its new country with none of its army: the formations, their standing orders and the strikes it
// had ordered stayed under a name nobody played, and the AI moved them (the gap audit of 2026-11-18, D14).
test("a founder's forces go with its seat; what it built goes where it stands on the new country's ground", async () => {
  const { airArmId } = await import("../../runtime/fronts/airStrike.js");
  const world = {
    units: [
      { id: "u1", name: "Townsmen's Guard", ownerCode: BURGHERS, source: "player" },
      { id: "u2", name: "Hill Levy", ownerCode: HILL, source: "ai" },
    ],
    // Kept by formation, so it follows its formation by itself.
    pendingUnitOrders: [{ id: "o1", unitId: "u1", kind: "move", toLng: 1, toLat: 1 }],
    airStrikeOrders: [
      { id: "s1", unit: "air-1", owner: BURGHERS, kind: "city" },
      { id: "s2", unit: airArmId("The Gullhaven Front", BURGHERS), owner: BURGHERS, kind: "troops" },
      { id: "s3", unit: airArmId("The Gullhaven Front", HILL), owner: HILL, kind: "troops" },
    ],
    markers: [
      { id: "m-new", name: "Harbour fort", ownerCode: BURGHERS, lng: 10, lat: 10 },
      { id: "m-old", name: "Old keep", ownerCode: BURGHERS, lng: 20, lat: 20 },
      { id: "m-sea", name: "Sea tower", ownerCode: BURGHERS, lng: 30, lat: 30 },
    ],
    fortifications: [
      { id: "w-new", owner: BURGHERS, points: [[10, 10], [11, 11]] },
      // Half of it on ground the old country keeps: it stays the old country's.
      { id: "w-split", owner: BURGHERS, points: [[10, 10], [20, 20]] },
    ],
  };
  // The new country's ground about (10, 10); the old one's about (20, 20); the sea about (30, 30).
  const chart = {
    holds: (country, lng) => (lng >= 30 ? null : (lng < 15) === (country === "Saltport")),
  };
  const moved = withSeatMoved({
    world,
    actions: [{ id: "a1", ownerCode: BURGHERS, status: "planned", unitRevert: { unitId: "u9", restore: { id: "u9", ownerCode: BURGHERS } } }],
  }, { from: BURGHERS, to: "Saltport", onNewGround: groundHeldBy(chart, "Saltport") });
  assert.deepEqual(moved.world.units.map((unit) => unit.ownerCode), ["Saltport", HILL]);
  assert.deepEqual(moved.world.pendingUnitOrders, world.pendingUnitOrders);
  assert.deepEqual(moved.world.airStrikeOrders.map((order) => [order.owner, order.unit]), [
    ["Saltport", "air-1"],
    ["Saltport", airArmId("The Gullhaven Front", "Saltport")],
    [HILL, airArmId("The Gullhaven Front", HILL)],
  ], "a front's air arm is named the new country's");
  assert.deepEqual(moved.world.markers.map((marker) => [marker.id, marker.ownerCode]), [["m-new", "Saltport"], ["m-old", BURGHERS], ["m-sea", BURGHERS]]);
  assert.deepEqual(moved.world.fortifications.map((line) => [line.id, line.owner]), [["w-new", "Saltport"], ["w-split", BURGHERS]]);
  assert.equal(moved.actions[0].unitRevert.restore.ownerCode, "Saltport", "a stand-down withdrawn brings the formation back as the new country's");
  // Without the map's chart nothing that stands moves; what the government commands still does.
  const blind = withSeatMoved({ world }, { from: BURGHERS, to: "Saltport" });
  assert.equal(blind.world.markers.every((marker) => marker.ownerCode === BURGHERS), true);
  assert.equal(blind.world.units[0].ownerCode, "Saltport");
  assert.equal(groundHeldBy(null, "Saltport")("markers", world.markers[0]), false);
});

// What a guest's services know of other countries' work is kept on each entry by the knower's name (knownBy), on
// the game's board and on every seat's; a founder's or a renamed country's knowledge stayed under the old name, and
// its services knew nothing of what its agents had found (FOLLOWUPS A7).
test("what the seat's government knows of others' work goes with it, wherever that work is kept", async () => {
  const { knowledgeOf } = await import("../../runtime/projects.js");
  const world = {
    projects: [
      { id: "p-host", name: "Coastal forts", ownerCode: "", knownBy: { [BURGHERS]: { spyIds: ["spy-1"], verification: "doubted" }, Kestrelmark: { spyIds: ["spy-9"] } } },
      { id: "p-ai", name: "Grain levy", ownerCode: "Kestrelmark" },
    ],
    seatBoards: {
      [HILL]: [{ id: "p-hill", name: "Hill roads", knownBy: { [BURGHERS]: { spyIds: ["spy-2"] }, Saltport: { spyIds: ["spy-3"] } } }],
      [BURGHERS]: [{ id: "p-own", name: "Harbour", knownBy: { [HILL]: { spyIds: ["spy-4"] } } }],
    },
  };
  const moved = withSeatMoved({ world }, { from: BURGHERS, to: "Saltport" }).world;
  const entry = (id) => [...moved.projects, ...Object.values(moved.seatBoards).flat()].find((row) => row.id === id);
  assert.deepEqual(knowledgeOf(entry("p-host"), "Saltport"), { spyIds: ["spy-1"], verification: "doubted" }, "on the game's board");
  assert.equal(knowledgeOf(entry("p-host"), BURGHERS), null, "nothing is left under the old name");
  assert.deepEqual(knowledgeOf(entry("p-host"), "Kestrelmark"), { spyIds: ["spy-9"], verification: "" }, "another's knowledge stays its own");
  assert.deepEqual(knowledgeOf(entry("p-hill"), "Saltport"), { spyIds: ["spy-3", "spy-2"], verification: "" }, "what the new name knew already is one knowledge with it");
  assert.deepEqual(Object.keys(moved.seatBoards), [HILL, "Saltport"], "its own board followed it");
  assert.deepEqual(knowledgeOf(entry("p-own"), HILL), { spyIds: ["spy-4"], verification: "" }, "what others know of its own work stays theirs");
  assert.equal(entry("p-ai"), world.projects[1], "an entry nobody knew of is the same entry");
});

// FOLLOWUPS A3: a gone country's player's queued orders stayed planned under the gone name, and the next skip read
// them among the live orders.
test("a seat whose country is gone has its queued orders withdrawn; what was done stays", async () => {
  const { withSeatGone } = await import("./foundings.js");
  const queue = [
    { id: "a", ownerCode: BURGHERS, status: "planned" },
    { id: "b", ownerCode: BURGHERS, status: "resolved" },
    { id: "c", ownerCode: HILL, status: "planned" },
    { id: "d", status: "planned" },
  ];
  const out = withSeatGone({ actions: queue }, { country: BURGHERS, host: HILL });
  assert.deepEqual(out.withdrawn.map((action) => action.id), ["a"]);
  assert.deepEqual(out.actions.map((action) => action.id), ["b", "c", "d"]);
  // The host's orders that name no owner are the game country's.
  assert.deepEqual(withSeatGone({ actions: queue }, { country: HILL, host: HILL }).withdrawn.map((action) => action.id), ["c", "d"]);
});

test("the list of a seat's records holds every record a view keeps per seat", async () => {
  const { HOST_ONLY_WORLD_KEYS } = await import("./projection.js");
  const projection = fs.readFileSync(new URL("./projection.js", import.meta.url), "utf8");
  const perSeat = [...HOST_ONLY_WORLD_KEYS.filter((key) => /^seat[A-Z]/.test(key)), ...[...projection.matchAll(/^ {2}(seat[A-Z]\w*|playerGoals): \(world, viewer\)/gm)].map((match) => match[1])];
  assert.ok(perSeat.length >= 4);
  for (const key of perSeat) assert.ok(SEAT_KEYED_WORLD_RECORDS.includes(key), `${key} is kept per seat and must follow a seat that moves`);
});

test("a faction founds a state on its area, whose land is still its countries'; a country with no area does not", () => {
  const faction = "The Narva Committee";
  const event = {
    id: "ev-narva",
    impacts: {
      actionIds: ["order-narva"],
      polityChanges: [{ operation: "create", code: "Narva Republic" }],
      regionTransfers: [{ regionId: "reg-narva", fromCode: "Estonia", toCode: "Narva Republic" }],
    },
  };
  const areas = { "reg-narva": faction };
  // After the round its whole area is the new state's.
  const world = { groups: { [faction]: { name: faction } }, groupAreas: areas, regionOwnershipOverrides: { "reg-narva": "Narva Republic" } };
  assert.deepEqual(seatFoundings({ events: [event], actions: [{ id: "order-narva", ownerCode: faction }], seated: [faction], areas, world }), [
    { from: faction, to: "Narva Republic", eventId: "ev-narva" },
  ]);
  assert.deepEqual(seatFoundings({ events: [event], actions: [{ id: "order-narva", ownerCode: "Russia" }], seated: ["Russia"], areas, world }), []);
});

test("a state brought back counts as founded", () => {
  const event = { ...hillKingdom, impacts: { ...hillKingdom.impacts, polityChanges: [{ operation: "restore", code: "Hill Kingdom" }] } };
  assert.equal(seatFoundings({ events: [event], actions, seated: [HILL], host: HILL, world: founded })[0]?.to, "Hill Kingdom");
});

test("a seat reads under every name its government had", () => {
  const game = { seatFoundings: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "X", to: "Y" }] };
  assert.deepEqual(formerNamesOf(game, "C"), ["C", "B", "A"]);
  assert.deepEqual(formerNamesOf(game, "Z"), ["Z"]);
  assert.deepEqual(formerNamesOf({ seatFoundings: [{ from: "A", to: "B" }, { from: "B", to: "A" }] }, "A"), ["A", "B"]);
});

test("what became of the countries people play is read from the world's own records and its list of countries: renamed, gone, or as it was", () => {
  const world = {
    polityOverrides: {
      // Renamed in play: the old name is kept among its former names (server/polityRename.js).
      "Russian Empire": { name: "Russian Empire", status: "active", formerNames: ["Russian Federation"] },
      // Dissolved: annexed or broken up (runtime/gameState.js).
      Latvia: { name: "Latvia", status: "dissolved" },
      France: { name: "France", status: "active" },
      // Two that both claim an old name settle nothing.
      "Eastern Ukraine": { name: "Eastern Ukraine", status: "active", formerNames: ["Ukraine"] },
      "Western Ukraine": { name: "Western Ukraine", status: "active", formerNames: ["Ukraine"] },
    },
    // A group renamed keeps its old name too, and a group is played as it stands (runtime/groups.js).
    groups: { "Northern Resistance": { name: "Northern Resistance", formerNames: ["Righteous Armies"] }, [HILL]: { name: HILL } },
  };
  // The game's countries now. Kestrelmark and Burgundy are countries of the
  // map with no record of their own, as most are: Kestrelmark still holds its
  // land, Burgundy was annexed whole.
  const countries = ["Russian Empire", "France", "Eastern Ukraine", "Western Ukraine", "Kestrelmark"];
  const seated = ["Russian Federation", "Latvia", "France", "Ukraine", "Righteous Armies", HILL, "Kestrelmark", "Burgundy"];
  const found = seatSuccessions({ world, seated, countries });
  assert.deepEqual(found.renamed, [{ from: "Russian Federation", to: "Russian Empire" }, { from: "Righteous Armies", to: "Northern Resistance" }]);
  assert.deepEqual(found.gone, ["Latvia", "Ukraine", "Burgundy"]);
  // Without the game's list, a country with no record of its own is never taken for gone.
  assert.deepEqual(seatSuccessions({ world: {}, seated: ["Kestrelmark", "Burgundy"] }), { renamed: [], gone: [] });
});

// A released seat handed the next player of its country the last player's private letters and queued orders, which
// the next skip carried out in the newcomer's name (the gap audit of 2026-11-18).
test("a seat let go takes its person's own with it, and leaves its government's own to the next player", () => {
  const out = withSeatLetGo({
    actions: [{ id: "a", ownerCode: HILL, status: "planned" }, { id: "b", ownerCode: HILL, status: "resolved" }, { id: "c", ownerCode: BURGHERS, status: "planned" }],
    world: { playerGoals: { [HILL]: { text: "Rule the hills" }, [BURGHERS]: { text: "Trade" } }, seatAdvice: { [HILL]: [{ title: "Raise levies" }] }, seatBoards: { [HILL]: [{ id: "p" }] }, seatSeals: { [HILL]: "a".repeat(64) } },
    chats: [
      { id: "t1", player: HILL, countries: [{ name: BURGHERS }] },
      { id: "t2", player: BURGHERS, countries: [{ name: HILL }, { name: "Lowland Republic" }] },
      { id: "t3", player: HILL, countries: [{ name: "Lowland Republic" }] },
    ],
  }, { country: HILL, people: [HILL, BURGHERS] });
  assert.deepEqual(out.withdrawn.map((action) => action.id), ["a"], "its queued orders, never what was done");
  assert.deepEqual(out.actions.map((action) => action.id), ["b", "c"]);
  assert.deepEqual(Object.keys(out.world.playerGoals), [BURGHERS]);
  assert.deepEqual(out.world.seatAdvice, {});
  assert.deepEqual(out.world.seatBoards[HILL], [{ id: "p" }], "the government's board stays");
  assert.equal(out.world.seatSeals[HILL], "a".repeat(64), "and its service's seal");
  assert.deepEqual(out.chats.map((chat) => chat.status ?? "open"), ["closed", "closed", "open"], "its letters with people closed; with the AI's governments, the state's");
  // Its player's counsel goes with them: the next player of the country starts their own.
  const counsel = withSeatAdvisor(withSeatAdvisor([{ role: "user", text: "Host asks." }], HILL, [{ role: "user", text: "The hills ask." }]), BURGHERS, [{ role: "user", text: "Burghers ask." }]);
  const advisor = withSeatLetGo({ advisor: counsel }, { country: HILL, people: [HILL, BURGHERS] }).advisor;
  assert.deepEqual(advisorOfSeat(advisor, HILL), []);
  assert.deepEqual(advisorOfSeat(advisor, BURGHERS).map((entry) => entry.text), ["Burghers ask."]);
  assert.deepEqual(advisorOfSeat(advisor, "").map((entry) => entry.text), ["Host asks."]);
});

// Two players wrote privately; one dropped and the AI minded their country; then the host let the other go: the
// thread stayed open for whoever played France next, with both players' letters (the review of 2026-11-18, views 3).
test("a conversation with other people is told by its own record, whoever plays now", () => {
  const chats = [
    { id: "t1", player: "France", countries: [{ code: "Germany", name: "Germany" }], messages: [
      { id: "m1", role: "user", speaker: "France", code: "France", text: "We strike Belgium in May." },
      { id: "m2", role: "user", speaker: "Germany", code: "Germany", text: "Agreed, keep it quiet." },
    ] },
    // The host's own thread (its owner not named), in which France's player wrote to the host.
    { id: "t2", countries: [{ name: "France" }], messages: [{ id: "m3", role: "user", text: "London asks." }, { id: "m4", role: "user", speaker: "France", text: "Paris answers." }] },
    // France's player with a government the AI plays: the state's, for the next player.
    { id: "t3", player: "France", countries: [{ name: "Italy" }], messages: [{ id: "m5", role: "user", speaker: "France", text: "Rome?" }, { id: "m6", role: "leader", speaker: "Italy", text: "Paris." }] },
    // The host wrote to France before France was a person's, and France's player never answered: the state's.
    { id: "t4", countries: [{ name: "France" }], messages: [{ id: "m7", role: "user", text: "London to Paris." }, { id: "m8", role: "leader", speaker: "France", text: "Noted." }] },
  ];
  // Germany's player is gone (the AI minds Germany): only England and France are people now.
  const out = withSeatLetGo({ chats }, { country: "France", people: ["England", "France"] }).chats;
  assert.deepEqual(out.map((chat) => [chat.id, chat.status ?? "open", chat.retiredFor ?? []]), [
    ["t1", "closed", ["France"]],
    ["t2", "closed", ["France"]],
    ["t3", "open", []],
    ["t4", "open", []],
  ]);
});

// A let-go player's alliance offer to the host was signed after they were gone, binding whoever played France next
// (the review of 2026-11-18, views 4).
test("what a let-go player put to other people and nobody answered lapses with them", () => {
  const world = {
    treatyOffers: [
      { id: "tr-1", from: "France", to: "England", type: "alliance", status: "open", round: 3 },
      { id: "tr-2", from: "Spain", to: "France", type: "non_aggression", status: "open", round: 3 },
      { id: "tr-3", from: "Spain", to: "England", type: "alliance", status: "open", round: 3 },
      { id: "tr-4", from: "France", to: "England", type: "alliance", status: "signed", round: 2 },
    ],
    peaceOffers: [
      { id: "pe-1", warId: "w1", from: "France", to: "Germany", status: "open", source: "player" },
      { id: "pe-2", warId: "w2", from: "Spain", to: "France", status: "open", source: "player" },
      // Terms an AI government put to France stand for whoever plays it next.
      { id: "pe-3", warId: "w1", from: "Germany", to: "France", status: "open", source: "chat" },
    ],
  };
  const out = withSeatLetGo({ world }, { country: "France", people: ["England", "France", "Spain"], round: 4 }).world;
  assert.deepEqual(out.treatyOffers.map((offer) => [offer.id, offer.status]), [["tr-1", "lapsed"], ["tr-2", "lapsed"], ["tr-3", "open"], ["tr-4", "signed"]]);
  assert.equal(out.treatyOffers[0].answeredRound, 4);
  assert.deepEqual(out.peaceOffers.map((offer) => [offer.id, offer.status]), [["pe-1", "lapsed"], ["pe-2", "lapsed"], ["pe-3", "open"]]);
});

test("a treaty or terms of peace a person put are taken only while that person plays their country", async () => {
  const { answerTreaty } = await import("../../runtime/treatyOffers.js");
  const { playerDiplomacy } = await import("../../Game/AI/warAndPeace.js");
  const world = {
    treatyOffers: [{ id: "tr-1", from: "France", to: "England", type: "alliance", status: "open", round: 3 }],
    wars: [{ id: "w1", status: "active", sideA: ["France"], sideB: ["England"] }],
    peaceOffers: [{ id: "pe-1", warId: "w1", from: "France", to: "England", status: "open", source: "player", round: 3 }],
  };
  assert.equal(answerTreaty(world, { op: "sign", ref: "tr-1", country: "England", players: ["England"] }).error, "maker-gone");
  assert.equal(answerTreaty(world, { op: "decline", ref: "tr-1", country: "England", players: ["England"] }).error, "", "declining is always the answerer's");
  assert.equal(playerDiplomacy(world, { op: "accept", ref: "pe-1", country: "England", players: ["England"] }).error, "maker-gone");
  assert.equal(playerDiplomacy(world, { op: "decline", ref: "pe-1", country: "England", players: ["England"] }).error, "");
});

/*! Open Historia — a turn's land war through the real front engine: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontTurnApply.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// frontTurn.test.js checks each step of the turn's side with a stand-in for
// the engine. This is the whole of it with the engine itself, on a drawn map,
// and with the game's own way of applying events: what the world says after a
// turn, after the first few events of one, after the same turn applied again,
// and after a round the player stopped part-way.

import test from "node:test";
import assert from "node:assert/strict";

import { MAX_UNITS_PER_POLITY, applyEventImpactsToWorld, enforceUnitVolume, normalizeEvents } from "../../runtime/gameState.js";
import { WEIGHT_UNKNOWN } from "../../runtime/countryWeight.js";
import { deployLinesOf } from "../../runtime/fronts/deploy.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { applyWarRoomOp } from "../../runtime/fronts/warRoomOps.js";
import { holderAt } from "../../runtime/fronts/record.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { diffGameDays } from "../../runtime/gameDates.js";
import { journalTurn, truncateTurn } from "./intervene.js";
import { filterBoundLedgerUpdatesToKeptEvents } from "./ledgerEventBinding.js";
import { sanitizeDirectorOrders } from "./nativeTerritoryDirector.js";
import {
  FRONT_MARK,
  STATED_REF,
  applyFrontUnitChanges,
  battlefieldRegionTest,
  countryWeight,
  engineNamer,
  engineRegionsOf,
  frontWorldReaders,
  planFrontMoments,
  runTurnFronts,
  statedCaptures,
  turnRenames,
  withoutCommittedMoves,
} from "./frontTurn.js";

// Aland in the west, Borduria in the east, the sea to the south: ninety-six
// regions, and a border some 220 km long.
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.4, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Mid", lng: 21.7, lat: 50.9 },
];
const sheet = (layout = ["AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "~~~~~~~~~~"]) =>
  syntheticMap({ layout: enlarge(layout, 2), legend, west: 20, north: 52, step: 0.25, cities });

const FROM = "2024-03-01";
const TO = "2024-03-31";
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };

// The world as the game keeps it: every region's holder written down, the two
// countries known, Aland the larger.
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: {
    Aland: { code: "Aland", name: "Aland", aliases: [], color: "", note: "" },
    Borduria: { code: "Borduria", name: "Borduria", aliases: [], color: "", note: "" },
  },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [WAR],
  battlefields: [],
  units: [],
  ...extra,
});

const event = (id, date, impacts = {}, extra = {}) => ({ id, date, title: `The ${id} of the war`, description: "The fighting goes on along the border.", source: "ai", impacts, ...extra });
const fiveEvents = (impactsOf = () => ({})) => normalizeEvents([
  event("e1", "2024-03-04", impactsOf("e1")),
  event("e2", "2024-03-09", impactsOf("e2")),
  event("e3", "2024-03-15", impactsOf("e3")),
  event("e4", "2024-03-22", impactsOf("e4")),
  event("e5", "2024-03-29", impactsOf("e5")),
]);
const advance = { id: "front-0", battlefield: "The Border", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] };

const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  // (Every side is left to the orders this test gives it: a side's own staff is tested in frontStaff.test.js.)
  staff: false,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  fromDate: FROM,
  toDate: TO,
  map: { key: "the sheet", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  seed: "campaign|2|2024-03-01",
  ...overrides,
});

// The engine with a day-by-day look inside: what a run cut after each day
// would have given, and what it was handed.
const watched = () => {
  const days = [];
  const inputs = [];
  const create = (input) => {
    inputs.push(input);
    const run = createFrontRun(input);
    const look = () => {
      const now = run.snapshot();
      if (!now.needsRegions) days[now.stats.days] = now;
    };
    look();
    return {
      advance(maxDays = Infinity) {
        let done = false;
        for (let step = 0; step < maxDays && !done; step += 1) {
          done = run.advance(1);
          look();
        }
        return done;
      },
      snapshot: () => run.snapshot(),
      finish: () => run.finish(),
    };
  };
  return { create, days, inputs };
};

const withoutReplay = (battlefields) => battlefields.map(({ replay: _replay, ...rest }) => rest);
const frontOps = (events) => events.flatMap((entry) => (entry.impacts?.regionControlOps ?? []).filter((op) => op.by === FRONT_MARK).map((op) => `${entry.id}:${op.regionId}:${op.toCode}`));
const applied = (world, events, battlefields = world.battlefields) => applyEventImpactsToWorld({ colors: {}, events, world: { ...world, battlefields } }).world;
const dayOf = (entry) => diffGameDays(FROM, entry.date);

test("a war between two countries that touch opens a battlefield, and the regions it takes ride on the events of their days", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = fiveEvents();
  let reads = 0;
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], loadRegions: async () => { reads += 1; return map.regions; } }));

  assert.equal(reads, 1, "the map's shapes are read once");
  assert.equal(run.battlefields.length, 1);
  const [record] = run.battlefields;
  assert.equal(record.name, "The Border", "a battlefield that opened this turn takes the name its first order gives it");
  assert.equal(record.status, "active");
  assert.deepEqual(record.sides, [["Aland"], ["Borduria"]]);
  assert.deepEqual(record.orders.map(({ s, order }) => [s, order]), [[0, "advance"]]);
  // (Half of what it fielded before troops were halved by default: a draft brings the rest, frontDraft.test.js.)
  assert.ok(record.brief.strength[0].n >= 15, `Aland fields ${record.brief.strength[0].n} formations`);
  assert.deepEqual(run.notes, []);
  assert.equal(run.stats.days, 30);

  // Every change of hands is an ordinary control operation marked as the engine's.
  assert.ok(run.flips.length >= 10, `${run.flips.length} regions changed hands`);
  const carried = run.events.flatMap((entry) => entry.impacts.regionControlOps ?? []);
  assert.equal(carried.length, run.flips.length);
  for (const op of carried) {
    assert.deepEqual([op.op, op.fromCode, op.toCode, op.basis, op.by, op.note], ["control", "Borduria", "Aland", "occupation", FRONT_MARK, "The Border"]);
  }
  // Each on an event of its day or later, never earlier, and before the story's next event: these name no place, so
  // the engine tells them itself, in an event of its own for each stretch of days between the story's.
  for (const flip of run.flips) {
    const carrier = run.events.find((entry) => (entry.impacts.regionControlOps ?? []).some((op) => op.regionId === flip.regionId));
    assert.equal(carrier.source, FRONT_MARK);
    const before = run.events.slice(0, run.events.indexOf(carrier)).filter((entry) => entry.source !== FRONT_MARK).at(-1);
    assert.ok(dayOf(carrier) >= flip.day, `${flip.regionId} taken on day ${flip.day} is told on day ${dayOf(carrier)}`);
    assert.ok(!before || dayOf(before) < flip.day, "and before the story's next event");
  }
  assert.deepEqual(run.events.filter((entry) => entry.source !== FRONT_MARK).map((entry) => entry.id), events.map((entry) => entry.id));
  assert.equal(events.every((entry) => entry.impacts.regionControlOps.length === 0), true, "the events handed in are not written to");

  // The world the game ends the turn with says what the engine said.
  const after = applied(world, run.events, run.battlefields);
  for (const flip of run.flips) assert.equal(after.regionOwnershipOverrides[flip.regionId], "Aland");
  assert.equal(after.battlefields.length, 1);
  assert.equal(after.battlefields[0].name, "The Border");
});

test("replaying the first k events gives the ownership the engine had on that date, and a round stopped there is those days and no more", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = fiveEvents();
  const engine = watched();
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], createFrontRun: engine.create }));
  assert.ok(run.flips.length >= 10);
  assert.ok(new Set(run.flips.map((flip) => flip.day)).size >= 3, "the regions fell on several days");

  const base = world.regionOwnershipOverrides;
  // (Every event, the story's and the engine's own reports of what fell between them: frontReportEvents.)
  for (let k = 1; k <= run.events.length; k += 1) {
    // (The last event is the last that carries anything: nothing fell on the days after it.)
    const day = k === run.events.length ? run.stats.days : dayOf(run.events[k - 1]);
    const expected = { ...base };
    for (const flip of engine.days[day].flips) expected[flip.regionId] = flip.to;
    // What the reveal, and a view of the world as seen, do: the restore point
    // with the events shown so far applied to it.
    const seen = applied(world, run.events.slice(0, k));
    assert.deepEqual(seen.regionOwnershipOverrides, expected, `after ${k} event(s), on day ${day}`);
  }
  // By the end of the turn everything the engine took is told, the last days' on the last event.
  const whole = { ...base };
  for (const flip of run.flips) whole[flip.regionId] = flip.to;
  assert.deepEqual(applied(world, run.events).regionOwnershipOverrides, whole);

  // Intervene after the third event: the journal's kept events, with the first
  // run's operations still on them, applied again for the days up to that event.
  const journal = journalTurn({ events: run.events, frontOrders: [advance], stopDate: TO });
  // (After e3, the story's third event, with the engine's reports before it.)
  const kept = run.events.findIndex((entry) => entry.id === "e3") + 1;
  const cut = truncateTurn(journal, kept, { originDate: FROM });
  assert.equal(cut.closingDate, "2024-03-15");
  const stopped = await runTurnFronts(turn(map, world, { events: cut.result.events, frontOrders: cut.result.frontOrders, toDate: cut.result.stopDate }));
  const then = engine.days[dayOf(events[2])];
  assert.equal(stopped.stats.days, 14);
  assert.deepEqual(stopped.flips, then.flips, "the same regions on the same days");
  assert.equal(JSON.stringify(withoutReplay(stopped.battlefields)), JSON.stringify(withoutReplay(then.battlefields)), "and the battlefield as the whole turn had it that day");
  assert.equal(JSON.stringify(stopped.events), JSON.stringify(run.events.slice(0, kept)), "the kept events carry what they carried");
  assert.deepEqual(applied(world, stopped.events).regionOwnershipOverrides, applied(world, run.events.slice(0, kept)).regionOwnershipOverrides);
});

test("a turn applied twice is one turn", async () => {
  const map = sheet();
  const world = worldOn(map, {
    units: [{ id: "unit-1", name: "1st Guards Tank Army", type: "armor", ownerCode: "Aland", strength: 80, lng: 21.1, lat: 51.3 }],
  });
  const events = fiveEvents();
  const first = await runTurnFronts(turn(map, world, { events, frontOrders: [advance] }));
  assert.ok(first.flips.length > 0);
  assert.deepEqual(first.unitChanges, [{ unitId: "unit-1", committedTo: "The Border" }]);

  // The same arguments again (a held turn retried, a kept turn written later).
  const retried = await runTurnFronts(turn(map, world, { events, frontOrders: [advance] }));
  assert.equal(JSON.stringify(retried), JSON.stringify(first));

  // From the events as they were applied, the engine's operations still on
  // them (the journal a round is stopped from, carried to its end).
  const again = await runTurnFronts(turn(map, world, { events: first.events, frontOrders: [advance] }));
  assert.equal(JSON.stringify(again), JSON.stringify(first), "the first run's operations were taken out, not added to");
  assert.equal(frontOps(again.events).length, first.flips.length);

  // Whether the ground was kept from an earlier turn or drawn now, and whether
  // the shapes were in hand or had to be asked for, changes nothing.
  const arenas = new Map();
  await runTurnFronts(turn(map, world, { events, frontOrders: [advance], arenas }));
  let reads = 0;
  const warm = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], arenas, loadRegions: async () => { reads += 1; return map.regions; } }));
  assert.equal(JSON.stringify(warm), JSON.stringify(first));
  assert.equal(reads <= 1, true);
  // Nor does reading the map's own facts only once the turn is known to need them.
  const given = turn(map, world, { events, frontOrders: [advance] });
  const lazy = await runTurnFronts({
    ...given,
    map: undefined,
    baseOwners: undefined,
    regionIds: undefined,
    arenas: undefined,
    readMap: async () => ({ map: given.map, baseOwners: given.baseOwners, regionIds: given.regionIds, arenas: new Map() }),
  });
  assert.equal(JSON.stringify(lazy), JSON.stringify(first));

  // And the world it leaves is the same world.
  const once = applied(world, first.events, first.battlefields);
  const twice = applied(world, again.events, again.battlefields);
  assert.deepEqual(twice.regionOwnershipOverrides, once.regionOwnershipOverrides);
  assert.deepEqual(twice.battlefields, once.battlefields);
});

test("a country renamed during the turn is renamed on its battlefield, and what it takes afterwards is its own", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = fiveEvents((id) => (id === "e2" ? { polityChanges: [{ code: "Aland", name: "Great Aland" }] } : {}));
  const orders = [
    advance,
    // Written after the rename, under the name the story now uses, with its kind.
    { id: "front-1", battlefield: "The Border", side: "country: Great Aland", order: "blitz", sector: "north", eventIds: ["e3"] },
  ];
  // Twelve days of it, so that Borduria still stands when the turn ends.
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders, toDate: "2024-03-12" }));
  assert.deepEqual(run.notes, [], "the new name is no stranger to the battlefield");
  assert.deepEqual(run.battlefields[0].sides, [["Aland"], ["Borduria"]], "the engine ran under the names the turn began with");
  assert.deepEqual(run.battlefields[0].orders.map(({ s, sector, order, by }) => [s, sector, order, by]), [[0, "all", "advance", "Aland"], [0, "north", "blitz", "Aland"]]);
  const late = run.flips.filter((flip) => flip.day > dayOf(events[1]));
  assert.ok(late.length > 0, "regions fell after the rename too");

  const after = applied(world, run.events, run.battlefields);
  assert.deepEqual(after.battlefields[0].sides, [["Great Aland"], ["Borduria"]]);
  assert.deepEqual([...new Set(after.battlefields[0].orders.map((order) => order.by))], ["Great Aland"]);
  assert.equal(Object.values(after.regionOwnershipOverrides).includes("Aland"), false, "nothing is left under the old name");
  for (const flip of run.flips) assert.equal(after.regionOwnershipOverrides[flip.regionId], "Great Aland");
  assert.ok(after.polityOverrides["Great Aland"] && !after.polityOverrides.Aland);

  // The next turn finds the battlefield under the new name and carries on.
  const next = await runTurnFronts(turn(map, { ...after, countryStats: { "Great Aland": { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } } }, {
    events: normalizeEvents([event("n1", "2024-03-14")]),
    warStages: [after.wars],
    fromDate: "2024-03-12",
    toDate: "2024-03-15",
    baseOwners: new Map(),
  }));
  assert.deepEqual(next.battlefields.map((record) => [record.status, record.sides]), [["active", [["Great Aland"], ["Borduria"]]]]);
  assert.deepEqual(next.notes, []);
  assert.equal(next.flips.every((flip) => flip.to === "Great Aland"), true);

  // The names the engine is told are turned back to the ones it knows; a name
  // somebody else already has is nobody's new name.
  assert.deepEqual(turnRenames(events), [{ from: "Aland", to: "Great Aland" }]);
  const nameOf = engineNamer([{ from: "Aland", to: "Great Aland" }, { from: "Great Aland", to: "The Alandic Empire" }], ["Aland", "Borduria"]);
  assert.deepEqual(["The Alandic Empire", "great aland", "Aland", "Borduria"].map(nameOf), ["Aland", "Aland", "Aland", "Borduria"]);
  assert.equal(engineNamer([{ from: "Aland", to: "Borduria" }], ["Aland", "Borduria"])("Borduria"), "Borduria");
});

test("an event the curator drops takes its order with it", async () => {
  const map = sheet();
  const world = worldOn(map);
  const events = fiveEvents();
  const order = { ...advance, eventIds: ["e2"] };

  const told = await runTurnFronts(turn(map, world, { events, frontOrders: filterBoundLedgerUpdatesToKeptEvents([order], events, events) }));
  assert.deepEqual(told.battlefields[0].orders.map(({ order: word, since }) => [word, since]), [["advance", "2024-03-09"]], "from the day of the event it rests on");
  assert.ok(told.flips.length > 0);

  const kept = events.filter((entry) => entry.id !== "e2");
  const orders = filterBoundLedgerUpdatesToKeptEvents([order], events, kept);
  assert.deepEqual(orders, []);
  const untold = await runTurnFronts(turn(map, world, { events: kept, frontOrders: orders }));
  assert.equal(untold.battlefields.length, 1, "the war still has its battlefield");
  assert.deepEqual(untold.battlefields[0].orders, [], "and nobody on it was ordered anywhere");
  assert.deepEqual(untold.flips, []);
  assert.deepEqual(frontOps(untold.events), []);
});

// "if that minimum is not met then the region transfer fails" (the owner, 2026-10-28).
test("a region the story takes far from any of the taker's troops is not taken: the operation comes off its event, and the receipt says why", async () => {
  const map = sheet();
  const world = worldOn(map);
  const arenas = new Map();
  const opened = await runTurnFronts(turn(map, world, { events: normalizeEvents([event("o1", "2024-02-27")]), fromDate: "2024-02-25", toDate: FROM, arenas }));
  const before = { ...world, battlefields: opened.battlefields };
  // Deep in Borduria, some 200 km from where Aland's troops stand.
  const target = map.regions.find((region) => region.id === "r18-2");
  const written = { op: "control", regionId: target.id, regionName: target.name, fromCode: "Borduria", toCode: "Aland", basis: "occupation", note: "Taken, as the event tells." };
  const events = fiveEvents((id) => (id === "e2" ? { regionControlOps: [written] } : {}));
  const run = await runTurnFronts(turn(map, before, { events, arenas, loadRegions: async () => { throw new Error("the ground was kept: no shapes are read"); } }));
  assert.deepEqual(run.events[1].impacts.regionControlOps.filter((op) => op.regionId === target.id), [], "the event keeps no operation for it");
  assert.equal(run.events[1].title, events[1].title, "and the event itself stays");
  assert.ok(run.notes.some((note) => /Aland could not take .+: too few of its troops near/.test(note.text)), JSON.stringify(run.notes));
  assert.equal(applied(before, run.events, run.battlefields).regionOwnershipOverrides[target.id], "Borduria");
});

test("a change of control an event writes inside a battlefield is a capture stated: troops walk there, and the operation stands", async () => {
  const map = sheet();
  const world = worldOn(map);
  // A battlefield from an earlier turn, nobody ordered anywhere.
  const arenas = new Map();
  const opened = await runTurnFronts(turn(map, world, { events: normalizeEvents([event("o1", "2024-02-27")]), fromDate: "2024-02-25", toDate: FROM, arenas }));
  assert.deepEqual(opened.flips, []);
  const before = { ...world, battlefields: opened.battlefields };
  const [record] = opened.battlefields;

  // The story takes a Bordurian region on the border for Aland, with no order written.
  const target = map.regions.find((region) => region.id === "r6-2");
  const middle = [(target.bbox[0] + target.bbox[2]) / 2, (target.bbox[1] + target.bbox[3]) / 2];
  assert.equal(holderAt(record, ...middle), 1, "Borduria's before");
  const written = { op: "control", regionId: target.id, regionName: target.name, fromCode: "Borduria", toCode: "Aland", basis: "occupation", note: "Taken, as the event tells." };
  const events = fiveEvents((id) => (id === "e2" ? { regionControlOps: [written] } : {}));
  const engine = watched();
  const run = await runTurnFronts(turn(map, before, { events, arenas, createFrontRun: engine.create, loadRegions: async () => { throw new Error("the ground was kept: no shapes are read"); } }));

  const moments = engine.inputs.at(-1).moments;
  assert.deepEqual(moments, [
    { day: 8, type: "control", regionId: target.id, to: "Aland", ref: "e2", capture: true },
    { day: 8, type: "order", battlefield: record.name, side: "Aland", order: "", sector: "all", ref: `${STATED_REF}e2:${target.id}`, objective: `region: ${target.name}`, result: "captured" },
  ]);
  assert.deepEqual(run.notes, []);
  const [after] = run.battlefields;
  assert.equal(holderAt(after, ...middle), 0, "the ground is Aland's on the battlefield");
  assert.deepEqual(after.orders, [], "a result changes no standing order");
  // The model's own operation is what moves the region: it stays, and the engine adds none beside it.
  assert.deepEqual(run.events[1].impacts.regionControlOps.filter((op) => op.regionId === target.id).map((op) => op.by ?? "the event"), ["the event"]);
  assert.equal(run.flips.some((flip) => flip.regionId === target.id), false);
  assert.equal(applied(before, run.events, run.battlefields).regionOwnershipOverrides[target.id], "Aland");

  // To a country outside the war, or back to the side that holds it already, it is no capture.
  const arenaOf = () => [...arenas.values()].find((kept) => kept?.indexOf instanceof Map);
  const readers = frontWorldReaders(before, {});
  const states = (ops) => statedCaptures({ events: normalizeEvents([event("x1", "2024-03-05", { regionControlOps: ops })]), battlefields: before.battlefields, arenaOf, readers });
  assert.deepEqual(states([{ ...written, toCode: "Neutralia" }]), []);
  assert.deepEqual(states([{ ...written, regionId: "r2-2", fromCode: "Aland", toCode: "Aland2" }]), []);
  assert.deepEqual(states([{ op: "control", regionId: "r4-2", fromCode: "Aland", toCode: "Borduria" }]).map((order) => [order.side, order.objective, order.result]), [["Borduria", "region: Aland 4.2", "captured"]]);
  assert.deepEqual(states([{ ...written, by: FRONT_MARK }]), [], "the engine's own are never read back");
  assert.deepEqual(states([{ ...written, wholeCountry: true }]), []);
  // Taken, then retaken by a later event of the same turn: each from whoever held it by then.
  const twice = statedCaptures({
    events: normalizeEvents([event("x1", "2024-03-05", { regionControlOps: [written] }), event("x2", "2024-03-12", { regionControlOps: [{ ...written, fromCode: "Aland", toCode: "Borduria" }] })]),
    battlefields: before.battlefields,
    arenaOf,
    readers,
  });
  assert.deepEqual(twice.map((order) => [order.side, order.eventIds[0]]), [["Aland", "x1"], ["Borduria", "x2"]]);
});

test("formations taken onto a battlefield leave the caps and the moves an event still writes for them are left out", async () => {
  const map = sheet();
  const stamp = "2024-01-01T00:00:00.000Z";
  const land = Array.from({ length: 20 }, (_, index) => ({
    id: `land-${index}`, name: `${index + 1}th Rifle Division`, type: "infantry", ownerCode: "Aland", source: "ai", strength: 60,
    lng: 21.2, lat: 50.2 + index * 0.08, createdAt: stamp, updatedAt: stamp,
  }));
  const fleet = Array.from({ length: MAX_UNITS_PER_POLITY + 3 }, (_, index) => ({
    id: `fleet-${index}`, name: `${index + 1}th Flotilla`, type: "naval", ownerCode: "Aland", source: "ai", strength: 50 + index,
    lng: 20.4, lat: 49.9, createdAt: stamp, updatedAt: stamp,
  }));
  const world = worldOn(map, { units: [...land, ...fleet], pendingUnitOrders: [] });
  const run = await runTurnFronts(turn(map, world, { events: fiveEvents(), toDate: "2024-03-05" }));
  assert.equal(run.unitChanges.length, 20, "every land formation near the line is taken in");
  assert.equal(run.unitChanges.every((change) => change.committedTo === run.battlefields[0].name), true);

  const units = applyFrontUnitChanges(world.units, run.unitChanges);
  const capped = enforceUnitVolume({ ...world, units }, { playerCode: "Neutralia" });
  const kept = new Set(capped.units.map((unit) => unit.id));
  assert.equal(land.every((unit) => kept.has(unit.id)), true, "twenty formations on a battlefield, where twelve is the most a country may show");
  assert.equal(capped.units.filter((unit) => unit.type === "naval").length, MAX_UNITS_PER_POLITY, "and they take none of the room the fleets have");

  // Next turn an event still marches one of them off, and moves a flotilla.
  const committed = { ...world, units, battlefields: run.battlefields };
  const moves = normalizeEvents([event("m1", "2024-03-08", { unitOps: [
    { op: "move", unitId: "land-3", toLng: 20.2, toLat: 51.8 },
    { op: "strength", unitId: "land-3", strength: 40 },
    { op: "move", unitId: "fleet-1", toLng: 20.3, toLat: 49.8 },
  ] })]);
  const cleared = withoutCommittedMoves(moves, committed.units);
  assert.deepEqual(cleared.events[0].impacts.unitOps.map((op) => `${op.op}:${op.unitId}`), ["strength:land-3", "move:fleet-1"]);
  assert.deepEqual(cleared.ignored, ["4th Rifle Division"]);
  assert.equal(withoutCommittedMoves(moves, world.units).events, moves, "nothing on a battlefield, nothing to look at");
  const next = await runTurnFronts(turn(map, committed, { events: moves, fromDate: "2024-03-05", toDate: "2024-03-10" }));
  assert.deepEqual(next.events[0].impacts.unitOps.map((op) => `${op.op}:${op.unitId}`), ["strength:land-3", "move:fleet-1"]);
  assert.deepEqual(next.notes.map((note) => note.kind), ["dropped"]);
  assert.match(next.notes[0].text, /^Unit operations moved a formation that is fighting on a battlefield \(4th Rifle Division\); the moves were left out\./);
  assert.doesNotMatch(next.notes[0].text, /land-3/);
});

test("a scenario's ceiling on how fast the map moves brakes the engine too, after what the events themselves moved", async () => {
  const map = sheet();
  const world = worldOn(map);
  // One region handed over by an event's own operation counts against the ceiling first.
  const events = fiveEvents((id) => (id === "e1" ? { regionControlOps: [{ op: "control", regionId: "r11-0", fromCode: "Borduria", toCode: "Neutralia" }] } : {}));
  const spans = [];
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], tempoAllowance: (days) => { spans.push(days); return 6; } }));
  assert.deepEqual(spans, [30], "asked once, for the days the turn covers");
  assert.equal(run.flips.length, 5, "six a period, less the one the event moved");
  assert.deepEqual(run.notes, [{ kind: "adjusted", text: "The fronts stopped moving for the rest of the period: this scenario's ceiling on how fast the map may change was reached." }]);
  const free = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], tempoAllowance: () => null }));
  assert.ok(free.flips.length > 5, "with no ceiling the advance goes on");
  assert.deepEqual(free.notes, []);
});

test("the wars are told a record at a time, each change on its own day", () => {
  const before = [WAR];
  const joined = [{ ...WAR, sideA: ["Aland", "Cisland"], lastUpdatedDate: "2024-03-05" }];
  const frozen = [{ ...joined[0], status: "ceasefire", lastUpdatedDate: "2024-03-20" }];
  const staged = planFrontMoments({ warStages: [before, joined, frozen], fromDate: FROM, days: 30 });
  assert.deepEqual(staged, [
    { day: 4, type: "war", warId: "war-1", op: "join-a", names: ["Cisland"] },
    { day: 19, type: "war", warId: "war-1", op: "ceasefire", names: [] },
  ]);
  // Read off the first and the last alone, both would fall on the day of the later.
  assert.deepEqual(planFrontMoments({ warsBefore: before, warsAfter: frozen, fromDate: FROM, days: 30 }).map((moment) => moment.day), [19, 19]);
  assert.deepEqual(planFrontMoments({ warStages: [before], fromDate: FROM, days: 30 }), [], "no record, nothing told");
});

// "the deployment tool in the war room doesnt seem to work. it does draw the line, but the troops are never actually
// deployed" (the owner, 2026-10-24).
test("a deployment drawn in the war room calls up its troops on the next time skip, and the world keeps what came of it", async () => {
  const map = sheet();
  const world = worldOn(map);
  const opened = await runTurnFronts(turn(map, world, { events: fiveEvents(), frontOrders: [advance] }));
  const first = applied(world, opened.events, opened.battlefields);
  const [record] = first.battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  // Far back in Aland, from north to south: as many as Aland can call up (runtime/fronts/engine.js callUpSize).
  const drawn = applyWarRoomOp(first.battlefields, { op: "deploy", battlefield: record.name, way: [[20.2, 51.9], [20.2, 51.2]] }, { player: "Aland" });
  assert.equal(drawn.error, undefined);
  const before = { ...first, battlefields: drawn.battlefields };
  const april = normalizeEvents([event("f1", "2024-04-05"), event("f2", "2024-04-15"), event("f3", "2024-04-28")]);
  const next = await runTurnFronts(turn(map, before, { events: april, fromDate: TO, toDate: "2024-04-30", seed: "campaign|3|2024-03-31" }));
  const after = applied(before, next.events, next.battlefields);
  const [kept] = after.battlefields;
  const [line] = deployLinesOf(kept, side);
  assert.equal(line.call, undefined, "called up once");
  assert.ok(line.last.n >= 1, `${line.last.n} called up`);
  assert.deepEqual([line.last.why, line.last.d], ["", TO]);
  assert.deepEqual(next.notes.filter((note) => /^reinforce|side-not/.test(note.kind)), []);
});

test("with no war, no battlefield and no order there is nothing to run, and a map that cannot be read leaves the battlefields as they were", async () => {
  const map = sheet();
  const peace = worldOn(map, { wars: [] });
  const events = fiveEvents((id) => (id === "e2" ? { regionControlOps: [{ op: "control", regionId: "r6-2", fromCode: "Borduria", toCode: "Aland", by: FRONT_MARK }] } : {}));
  const refuse = () => { throw new Error("the engine is not run, and the map is not read"); };
  const idle = await runTurnFronts(turn(map, peace, { events, createFrontRun: refuse, loadRegions: refuse, readMap: refuse }));
  assert.equal(idle.battlefields, null, "the world's list is left alone");
  assert.deepEqual(idle.flips, []);
  assert.deepEqual(frontOps(idle.events), [], "but an earlier run's operations are still taken out");
  // A battlefield that closed last turn has had its turn on the map.
  const closed = { name: "An old front", warId: "war-0", status: "closed", sides: [["Aland"], ["Borduria"]], openedDate: "2023-01-01", asOf: "2023-06-01", closedDate: "2023-06-01", frame: { lng0: 20, lat0: 50, cell: 0.1, cols: 30, rows: 20, km: 8 } };
  assert.deepEqual((await runTurnFronts(turn(map, { ...peace, battlefields: [closed] }, { events, createFrontRun: refuse, loadRegions: refuse }))).battlefields, []);

  // A war, and the regions file is not there: no battlefield can open.
  const world = worldOn(map);
  const blind = await runTurnFronts(turn(map, world, { events, frontOrders: [advance], loadRegions: async () => null }));
  assert.equal(blind.battlefields, null);
  assert.deepEqual(blind.unitChanges, []);
  assert.deepEqual(frontOps(blind.events), []);
});

test("the old stand-ins keep clear of a battlefield's regions", async () => {
  const map = sheet(["AAABBB", "AAABBB", "NNNBBB", "NNNBBB", "~~~~~~"]);
  const world = worldOn(map);
  const run = await runTurnFronts(turn(map, world, { events: fiveEvents(), toDate: "2024-03-03" }));
  const rows = map.regions.map((region) => ({ id: region.id, name: region.name, lng: (region.bbox[0] + region.bbox[2]) / 2, lat: (region.bbox[1] + region.bbox[3]) / 2 }));
  const readers = frontWorldReaders(world, {});
  const onBattlefield = battlefieldRegionTest({ battlefields: run.battlefields, rows, readers });
  assert.equal(onBattlefield("r6-0"), true);
  assert.equal(onBattlefield("Borduria 6.0"), true, "by its name as well");
  assert.equal(onBattlefield("region: borduria 6.0"), true);
  assert.equal(onBattlefield("r0-5"), false, "Neutralia is in no war");
  assert.equal(onBattlefield("Atlantis"), false);
  assert.equal(battlefieldRegionTest({ battlefields: [], rows, readers }), null);
  assert.equal(battlefieldRegionTest({ battlefields: run.battlefields.map((record) => ({ ...record, status: "closed" })), rows, readers }), null);

  // The territory Director's marks on such a region are left out; the rest stand.
  const events = [{ title: "Aland captures the border towns", description: "Aland's columns capture Borduria 6.0 and seize Neutralia 0.5 after heavy fighting.", impacts: {} }];
  const orders = [{ eventIndex: 0, regionControlOps: [
    { op: "control", regionId: "Borduria 6.0", fromCode: "Borduria", toCode: "Aland" },
    { op: "contest", regionId: "r6-1", fromCode: "Borduria", actorCode: "Aland" },
    { op: "control", regionId: "r0-5", fromCode: "Neutralia", toCode: "Aland" },
  ] }];
  const gated = sanitizeDirectorOrders({ events, orders, onBattlefield });
  assert.deepEqual(gated.acceptedByEvent.get(0).map((op) => op.regionId), ["r0-5"]);
  assert.equal(gated.diagnostics.filter((entry) => /on a battlefield/.test(entry.reason)).length, 2);
  // With fronts off no test is handed in, and the Director's marks stand as they always did.
  assert.deepEqual(sanitizeDirectorOrders({ events, orders }).acceptedByEvent.get(0).map((op) => op.regionId), ["Borduria 6.0", "r6-1", "r0-5"]);
});

test("the map's regions are handed to the engine as it takes them, and the world answers its questions", () => {
  const geojson = { features: [
    { properties: { id: "r1", name: "Upper Marches", typeId: "hills", owner: "Aland" }, geometry: { type: "Polygon", coordinates: [[[20, 50], [21, 50], [21, 51], [20, 51], [20, 50]]] } },
    { properties: { GID_1: "UKR.4_1", NAME_1: "Chernihiv" }, geometry: { type: "MultiPolygon", coordinates: [[[[30, 50], [31, 50], [31, 52], [30, 50]]], [[[32, 50], [33, 50], [33, 51], [32, 50]]]] } },
    { properties: { id: "r3" }, geometry: { type: "Polygon", coordinates: [[[179, 60], [-179, 60], [-179, 61], [179, 61], [179, 60]]] } },
    { properties: { id: "r4", name: "A point" }, geometry: { type: "Point", coordinates: [1, 1] } },
    { properties: { name: "No id" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ] };
  const regions = engineRegionsOf(geojson, { nameOf: (id) => (id === "UKR.4_1" ? "Chernihiv Oblast" : "") });
  assert.deepEqual(regions.map(({ id, name, bbox, typeId }) => [id, name, bbox, typeId]), [
    ["r1", "Upper Marches", [20, 50, 21, 51], "hills"],
    ["UKR.4_1", "Chernihiv Oblast", [30, 50, 33, 52], undefined],
    ["r3", "r3", undefined, undefined],
  ]);
  assert.equal(regions[0].geometry, geojson.features[0].geometry, "the shape itself, not a copy");
  assert.deepEqual(engineRegionsOf(null), []);

  const world = {
    regionOwnershipOverrides: { r1: "Borduria", r2: "Aland", r5: "" },
    regionSovereigntyOverrides: { r1: "Aland" },
    groups: { "The Free Company": { name: "The Free Company" } },
    groupAreas: { r2: "The Free Company", r3: "The Free Company" },
    countryStats: { Aland: { population: { total: 25e6 } } },
  };
  const readers = frontWorldReaders(world, { baseOwners: new Map([["r3", "Aland"], ["r4", "Borduria"], ["r5", "Aland"]]) });
  assert.deepEqual(["r1", "r2", "r3", "r4", "r5", "r9"].map(readers.controllerOf), ["Borduria", "Aland", "Aland", "Borduria", "", ""], "what an event moved, else the map as drawn");
  assert.deepEqual(["r1", "r3"].map(readers.sovereignOf), ["Aland", "Aland"]);
  assert.equal(readers.isGroup("the free company"), true);
  assert.equal(readers.isGroup("Aland"), false);
  assert.equal(readers.strengthOf("Aland"), 10, "its people, where its sheet counts them");
  // Never the land it holds ("remove region count power entirely", the owner, 2026-10-16): one whose people nobody
  // knows yet weighs what the middle of those known weighs, until the AI rates it (militaryRating.js).
  assert.equal(readers.strengthOf("Borduria"), 10);
  assert.equal(readers.strengthOf("The Free Company"), 10, "a group too");
  assert.equal(readers.strengthOf("Syldavia"), 10);
  assert.equal(frontWorldReaders({}).strengthOf("Syldavia"), WEIGHT_UNKNOWN, "nobody's people known: an ordinary state");
  // Its rated spending, where the scenario counts countries' figures, over what its economy pays for.
  const rated = { ...world, polityOverrides: { Aland: { name: "Aland", military: { spending: 100 } } } };
  assert.equal(frontWorldReaders(rated).strengthOf("Aland"), countryWeight({ population: 25e6, funding: 1.5 }));
  // Groups switched off for the game: the world is read without them.
  const without = frontWorldReaders(world, { groups: false });
  assert.deepEqual(without.groupAreas, {});
  assert.equal(without.isGroup("The Free Company"), false);
});

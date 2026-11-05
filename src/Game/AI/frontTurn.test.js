/*! Open Historia — a turn's land war, handed to the front engine and brought back: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontTurn.test.js
//
// With a stand-in for the engine: what the turn tells it and what the turn
// does with its answer. The engine itself is tested where it lives
// (src/runtime/fronts/).

import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_SLICE_MS,
  FRONT_MARK,
  applyFrontUnitChanges,
  attachFrontFlips,
  countryWeight,
  describeFrontNotes,
  frontFlipAllowance,
  frontRunSpan,
  leaveCapturesToTroops,
  planFrontMoments,
  runFrontTurn,
  stripFrontOps,
} from "./frontTurn.js";

const event = (id, date, impacts = {}, extra = {}) => ({ id, date, title: id, description: "x", impacts, ...extra });
const frontControl = (regionId) => ({ op: "control", regionId, fromCode: "Ukraine", toCode: "Russia", basis: "occupation", note: "Eastern Ukraine", by: FRONT_MARK });

test("a capture the events state of a battlefield's ground is left to its troops (Pt.2), and nothing else is", () => {
  const capture = { op: "control", regionId: "3475", regionName: "Matamoros", fromCode: "Mexico", toCode: "United States", basis: "occupation" };
  const elsewhere = { op: "control", regionId: "r9", fromCode: "Mexico", toCode: "United States" };
  const events = [
    event("e1", "2016-03-06", { regionControlOps: [capture, elsewhere, frontControl("r1")] }),
    event("e2", "2016-03-07", { regionControlOps: [elsewhere] }),
  ];
  const stated = [{ id: "stated:e1:3475", battlefield: "United States - Mexico front", side: "United States", objective: "region: Matamoros", result: "captured" }];
  const kept = leaveCapturesToTroops(events, stated);
  assert.deepEqual(kept.events[0].impacts.regionControlOps, [elsewhere, frontControl("r1")], "only the stated capture goes");
  assert.equal(kept.events[1], events[1], "an event with none is the same object");
  assert.deepEqual(kept.left, ["Matamoros"], "named, never by id");
  assert.equal(leaveCapturesToTroops(events, []).events, events);
});

test("the engine's own changes are taken out of the events, and nothing else is", () => {
  const written = { op: "control", regionId: "r9", fromCode: "Ukraine", toCode: "Russia" };
  const events = [
    event("e1", "2024-03-02", { regionControlOps: [frontControl("r1"), written], groupOps: [{ op: "take", name: "Wagner", regionIds: ["r2"], by: FRONT_MARK }] }),
    event("e2", "2024-03-05", { regionControlOps: [written] }),
    event("e3", "2024-03-06"),
  ];
  const stripped = stripFrontOps(events);
  assert.deepEqual(stripped[0].impacts.regionControlOps, [written]);
  assert.deepEqual(stripped[0].impacts.groupOps, []);
  assert.equal(stripped[1], events[1], "an event with none of them is the same object");
  assert.equal(stripped[2], events[2]);
  assert.deepEqual(stripFrontOps(null), []);
});

test("the run is as long as the calendar says, and an event falls on its own day", () => {
  const events = [event("e1", "2024-03-01"), event("e2", "2024-03-11"), event("e3", "2024-04-15")];
  const { days, dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  assert.equal(days, 30);
  assert.deepEqual(events.map(dayOf), [0, 10, 30], "a date past the end is the last day");
  // A year before AD 1, where the text of a date does not sort.
  const ancient = frontRunSpan({ fromDate: "-0219-12-20", toDate: "-0218-01-19", events: [] });
  assert.equal(ancient.days, 30);
  assert.equal(ancient.dayOf(event("e", "-0218-01-04")), 15);
});

test("a calendar the game cannot read: as long as the skip asked for, events spread through it in order", () => {
  const events = [event("e1", "3rd of Afteryule"), event("e2", "9th of Afteryule"), event("e3", "1st of Solmath")];
  const { days, dayOf } = frontRunSpan({ fromDate: "Third Age 3019", toDate: "Third Age 3019, later", requestedDays: 40, events });
  assert.equal(days, 40);
  assert.deepEqual(events.map(dayOf), [10, 20, 30]);
  assert.equal(frontRunSpan({ fromDate: "x", toDate: "y" }).days, 0);
});

test("orders take effect on the day of the earliest event they rest on", () => {
  const events = [event("e1", "2024-03-03"), event("e2", "2024-03-10"), event("e3", "2024-03-20")];
  const { days, dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  const moments = planFrontMoments({
    events,
    fromDate: "2024-03-01",
    days,
    dayOf,
    frontOrders: [
      { id: "front-0", battlefield: "Eastern Ukraine", side: "Russia", order: "spearhead", sector: "north", eventIds: ["e3", "e2"], objective: "city: Kharkiv", effort: "major" },
      { id: "front-1", battlefield: "Eastern Ukraine", side: "Ukraine", order: "dig in", sector: "", eventIds: [] },
      { id: "front-2", battlefield: "Eastern Ukraine", side: "Russia", order: "", sector: "centre", eventIds: ["e3"], result: "repulsed" },
      { id: "front-3", battlefield: "", side: "Russia", order: "advance", eventIds: [] },
      { id: "front-4", battlefield: "Eastern Ukraine", side: "Russia", order: "charge", problem: "\"charge\" is not an order", eventIds: [] },
    ],
  });
  assert.deepEqual(moments, [
    // (One that rests on no event says so: it opens no war by itself and does not end a posture a scenario set.)
    { day: 0, type: "order", battlefield: "Eastern Ukraine", side: "Ukraine", order: "dig in", sector: "all", ref: "front-1", unbound: true },
    { day: 9, type: "order", battlefield: "Eastern Ukraine", side: "Russia", order: "spearhead", sector: "north", ref: "front-0", objective: "city: Kharkiv", effort: "major" },
    { day: 19, type: "order", battlefield: "Eastern Ukraine", side: "Russia", order: "", sector: "centre", ref: "front-2", result: "repulsed" },
  ]);
});

test("the wars are told as the ledger left them, not as the model wrote them", () => {
  const before = [
    { id: "war-1", status: "active", sideA: ["Russia"], sideB: ["Ukraine"], startedDate: "2024-02-01" },
    { id: "war-2", status: "ceasefire", sideA: ["India"], sideB: ["Pakistan"], startedDate: "2023-01-01" },
    { id: "war-3", status: "active", sideA: ["Ethiopia"], sideB: ["Eritrea"], startedDate: "2023-05-01" },
    { id: "war-4", status: "ended", sideA: ["Peru"], sideB: ["Chile"], startedDate: "2020-01-01", endedDate: "2020-06-01" },
  ];
  const after = [
    { id: "war-1", status: "active", sideA: ["Russia", "Belarus"], sideB: ["ukraine"], startedDate: "2024-02-01", lastUpdatedDate: "2024-03-12" },
    { id: "war-2", status: "active", sideA: ["India"], sideB: ["Pakistan"], startedDate: "2023-01-01", lastUpdatedDate: "2024-03-20" },
    { id: "war-3", status: "ended", sideA: ["Ethiopia"], sideB: ["Eritrea"], startedDate: "2023-05-01", endedDate: "2024-03-25", lastUpdatedDate: "2024-03-25" },
    { id: "war-4", status: "ended", sideA: ["Peru"], sideB: ["Chile"], startedDate: "2020-01-01", endedDate: "2020-06-01" },
    { id: "war-5", status: "active", title: "The Baltic War", sideA: ["Russia"], sideB: ["Estonia", "Latvia"], startedDate: "2024-03-08", lastUpdatedDate: "2024-03-08" },
  ];
  const moments = planFrontMoments({ warsBefore: before, warsAfter: after, fromDate: "2024-03-01", days: 30 });
  assert.deepEqual(moments, [
    { day: 7, type: "war", warId: "war-5", op: "start", names: ["Russia"], opponents: ["Estonia", "Latvia"], title: "The Baltic War" },
    { day: 11, type: "war", warId: "war-1", op: "join-a", names: ["Belarus"] },
    { day: 19, type: "war", warId: "war-2", op: "resume", names: [] },
    { day: 24, type: "war", warId: "war-3", op: "end", names: [] },
  ]);
  assert.deepEqual(planFrontMoments({ warsBefore: before, warsAfter: before, fromDate: "2024-03-01", days: 30 }), [], "nothing changed, nothing told");
});

test("a change of control the model wrote itself is told on its event's day; the engine's own never are", () => {
  const events = [
    event("e1", "2024-03-06", {
      regionControlOps: [
        { op: "control", regionId: "r1", fromCode: "Ukraine", toCode: "Russia" },
        { op: "contest", regionId: "r2", fromCode: "Ukraine", actorCode: "Russia" },
        frontControl("r3"),
        { op: "control", regionId: "Ukraine", fromCode: "Ukraine", toCode: "Russia", wholeCountry: true },
      ],
      regionTransfers: [{ regionId: "r4", toCode: "Poland", fromCode: "Ukraine" }, { regionId: "Ukraine", toCode: "Russia", wholeCountry: true }],
    }),
  ];
  const { days, dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  assert.deepEqual(planFrontMoments({ events, fromDate: "2024-03-01", days, dayOf }), [
    { day: 5, type: "control", regionId: "r1", to: "Russia", ref: "e1", capture: true },
    { day: 5, type: "control", regionId: "r4", to: "Poland", ref: "e1" },
  ]);
});

test("a country's weight: its people by the square root and what its forces have to spend, never the land it holds", () => {
  assert.equal(countryWeight({ population: 100e6 }), 20);
  assert.equal(countryWeight({ population: 1e6 }), 2);
  assert.ok(countryWeight({ population: 1.4e9 }) / countryWeight({ population: 14e6 }) < 11, "a hundred times the people is ten times the weight");
  assert.equal(countryWeight({ population: 1000 }), 1, "never less than one");
  assert.equal(countryWeight({ population: 100e6, funding: 1.5 }), 30);
  // "remove region count power entirely" (the owner, 2026-10-16): nobody knows its people, it has no weight of its
  // own (the engine counts it as the middle of those it knows until the AI rates it: militaryRating.js).
  assert.equal(countryWeight({ regions: 341 }), null, "the land it holds is no weight");
  assert.equal(countryWeight({}), null);
});

test("the engine may move what a scenario's ceiling leaves after the model's own changes", () => {
  const events = [event("e1", "2024-03-06", {
    regionTransfers: [{ regionId: "r1", toCode: "Poland" }],
    regionControlOps: [{ op: "control", regionId: "r2", fromCode: "A", toCode: "B" }, { op: "contest", regionId: "r3" }, frontControl("r4")],
  })];
  assert.equal(frontFlipAllowance({ allowance: 6, events }), 4);
  assert.equal(frontFlipAllowance({ allowance: 1, events }), 0);
  assert.equal(frontFlipAllowance({ allowance: Infinity, events }), null, "no ceiling");
  assert.equal(frontFlipAllowance({ events }), null);
});

test("the engine is run with what it has, and again with the map when it asks for it", async () => {
  const calls = [];
  const createFrontRun = (input) => {
    calls.push(input.map.regions);
    let left = 40;
    return {
      advance(maxDays) { left -= maxDays; return left <= 0 || input.map.regions === null; },
      finish: () => (input.map.regions === null ? { needsRegions: true } : { battlefields: ["ok"], flips: [], unitChanges: [], notes: [] }),
    };
  };
  let pauses = 0;
  const result = await runFrontTurn({
    createFrontRun,
    input: { map: { cities: [], key: "m" } },
    loadRegions: async () => [{ id: "r1" }],
    pause: async () => { pauses += 1; },
  });
  assert.deepEqual(result.battlefields, ["ok"]);
  assert.deepEqual(calls, [null, [{ id: "r1" }]]);
  assert.equal(pauses, 2, "forty days in chunks of fifteen: two pauses between three chunks");
  // The map cannot be read: the turn goes on without the engine.
  assert.equal(await runFrontTurn({ createFrontRun, input: { map: {} }, loadRegions: async () => null }), null);
  assert.equal(await runFrontTurn({ createFrontRun, input: { map: {} } }), null);
  assert.equal(await runFrontTurn({ input: { map: {} } }), null);
});

test("a step that is something to wait for is waited for, and what it came to is handed back to the run", async () => {
  // "do the multi-core rehearsals too" (the owner, 2026-10-16): a staff's plans fought on other cores
  // (runtime/fronts/mind/rehearsers.js) are waited for as a step of the run's own; a wait that fails hands back nothing.
  const heard = [];
  const createFrontRun = () => {
    let done = false;
    function* steps() {
      heard.push(yield { wait: async () => 42 });
      heard.push(yield);
      heard.push(yield { wait: async () => { throw new Error("the cores are gone"); } });
      done = true;
    }
    return { steps, advance: () => true, finished: () => done, finish: () => ({ battlefields: [], flips: [], unitChanges: [], notes: [] }) };
  };
  const result = await runFrontTurn({ createFrontRun, input: { map: {} }, pause: async () => {} });
  assert.deepEqual(heard, [42, undefined, undefined]);
  assert.deepEqual(result.battlefields, []);
});

test("a run that gives its days as steps is taken in slices, the page let draw between them", async () => {
  // "its SOO LAGGY while in war" (the owner, 2026-10-15): a staff that thinks for seconds no longer holds the page.
  const busy = (ms) => {
    const until = performance.now() + ms;
    while (performance.now() < until) { /* thinking */ }
  };
  let taken = 0;
  const createFrontRun = () => ({
    advance: () => { throw new Error("taken whole"); },
    steps: function* steps() {
      for (let step = 0; step < 6; step += 1) {
        busy(ENGINE_SLICE_MS + 4);
        taken += 1;
        yield;
      }
    },
    finished: () => taken >= 6,
    finish: () => ({ battlefields: ["ok"], flips: [], unitChanges: [], notes: [] }),
  });
  let pauses = 0;
  const result = await runFrontTurn({ createFrontRun, input: { map: { regions: [] } }, pause: async () => { pauses += 1; } });
  assert.deepEqual(result.battlefields, ["ok"]);
  assert.ok(pauses >= 5, `${pauses} pauses over six long steps`);
  // Without a pause it is taken whole, as ever.
  assert.equal(await runFrontTurn({ createFrontRun: () => ({ advance: () => true, finish: () => ({ battlefields: ["whole"] }) }), input: { map: {} } }).then((run) => run.battlefields[0]), "whole");
});

test("a change of hands goes on the first event of its day or later, never on one told to some governments only", () => {
  const events = [
    event("e1", "2024-03-03"),
    event("e2", "2024-03-10", {}, { audience: ["Russia"] }),
    event("e3", "2024-03-12", { regionControlOps: [{ op: "contest", regionId: "r0", fromCode: "A", actorCode: "B" }] }),
    event("e4", "2024-03-25"),
  ];
  const { dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  const flips = [
    { day: 1, date: "2024-03-02", battlefield: "Eastern Ukraine", regionId: "r1", from: "Ukraine", to: "Russia", kind: "control" },
    { day: 8, date: "2024-03-09", battlefield: "Eastern Ukraine", regionId: "r2", from: "Ukraine", to: "Russia", kind: "control" },
    { day: 29, date: "2024-03-30", battlefield: "Eastern Ukraine", regionId: "r3", from: "Russia", to: "Ukraine", kind: "control" },
    { day: 9, date: "2024-03-10", battlefield: "Donbas", regionId: "r4", from: "Ukraine", to: "Wagner", kind: "groupTake" },
    { day: 9, date: "2024-03-10", battlefield: "Donbas", regionId: "r5", from: "Wagner", to: "Ukraine", kind: "groupRelease" },
    { day: 3, regionId: "", from: "A", to: "B", kind: "control" },
  ];
  const { events: next, unattached } = attachFrontFlips(events, flips, { dayOf });
  assert.deepEqual(unattached, []);
  assert.deepEqual(next[0].impacts.regionControlOps, [frontControl("r1")]);
  assert.equal(next[1], events[1], "the event told to one government carries nothing");
  assert.deepEqual(next[2].impacts.regionControlOps.map((op) => op.regionId), ["r0", "r2"], "after what the event already had");
  assert.deepEqual(next[2].impacts.groupOps, [
    { op: "take", name: "Wagner", regionIds: ["r4"], note: "Donbas", by: FRONT_MARK },
    { op: "release", name: "Wagner", regionIds: ["r5"], note: "Donbas", by: FRONT_MARK },
  ]);
  assert.deepEqual(next[3].impacts.regionControlOps.map((op) => `${op.regionId}:${op.toCode}`), ["r3:Ukraine"], "later than every event: on the last");
  assert.equal(events[0].impacts.regionControlOps, undefined, "the events handed in are not written to");
  // Stripping gives back exactly what went in.
  assert.deepEqual(stripFrontOps(next).map((kept) => kept.impacts.regionControlOps ?? []), [[], [], [events[2].impacts.regionControlOps[0]], []]);
  assert.equal(attachFrontFlips([], flips.slice(0, 1), { dayOf }).unattached.length, 1);
});

test("formations come back from a battlefield with where they stand, or do not come back", () => {
  const units = [
    { id: "u1", name: "1st Guards Tank Army", ownerCode: "Russia", strength: 100, lng: 36, lat: 50 },
    { id: "u2", name: "2nd Army", ownerCode: "Russia", strength: 80, lng: 37, lat: 49, committedTo: "Eastern Ukraine" },
    { id: "u3", name: "3rd Army", ownerCode: "Russia", strength: 60, lng: 38, lat: 48, committedTo: "Eastern Ukraine" },
    { id: "u4", name: "Black Sea Fleet", ownerCode: "Russia", strength: 90, lng: 33, lat: 44 },
  ];
  const next = applyFrontUnitChanges(units, [
    { unitId: "u1", committedTo: "Eastern Ukraine" },
    { unitId: "u2", committedTo: "", lng: 35.5, lat: 49.5, strength: 41.6 },
    { unitId: "u3", remove: true },
    { unitId: "nobody", committedTo: "Eastern Ukraine" },
  ]);
  assert.deepEqual(next.map((unit) => unit.id), ["u1", "u2", "u4"]);
  assert.equal(next[0].committedTo, "Eastern Ukraine");
  assert.deepEqual([next[0].lng, next[0].lat, next[0].strength], [36, 50, 100], "taken in: it keeps its own record");
  assert.deepEqual([next[1].lng, next[1].lat, next[1].strength, "committedTo" in next[1]], [35.5, 49.5, 42, false]);
  assert.equal(next[2], units[3], "a formation the run did not touch is the same object");
  assert.equal(applyFrontUnitChanges(units, []), units);
});

test("what the engine could not do as told is said once a kind, and carries no id", () => {
  const notes = describeFrontNotes([
    { kind: "unknown-battlefield", battlefield: "The Eastern Front", side: "Russia", ref: "front-0" },
    { kind: "unknown-battlefield", battlefield: "The Eastern Front", side: "Ukraine", ref: "front-1" },
    { kind: "sector-read-as-all", battlefield: "Eastern Ukraine", detail: "west on Eastern Ukraine; it has north, centre, south", ref: "front-2" },
    { kind: "tempo" },
    { kind: "something the turn has no words for" },
  ]);
  assert.deepEqual(notes.map((note) => note.kind), ["dropped", "dropped", "adjusted"]);
  assert.match(notes[0].text, /^Front orders named a battlefield that does not exist \(The Eastern Front\)\./);
  assert.equal(notes[0].text.split("The Eastern Front").length, 2, "named once");
  assert.equal(notes.some((note) => /front-\d/.test(note.text)), false);
  assert.deepEqual(describeFrontNotes([]), []);
});

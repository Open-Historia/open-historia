/*! Open Historia — the board pass carries a completion's rename and colour © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/Game/AI/boardPassApply.test.js
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
import test from "node:test";
import assert from "node:assert/strict";

import { applyBoardCarriers } from "./boardPassApply.js";
import { applyProjectOps, normalizeWorldState } from "../../runtime/gameState.js";
import { normalizeCountryStatSheet } from "../../runtime/countryStats.js";

// The board's ops ride on the events that caused them: since the engine runs
// every project (runtime/projectEngine.js), they are what an event did to one —
// opened it, set it back, brought it on, ended it — never its progress.
const PLAN = { durationDays: 300, monthlyCost: 1e8, milestones: [{ title: "Proclamation", atProgress: 90 }] };
const project = {
  op: "create",
  name: "Unification",
  summary: "Proclaim the empire.",
  plan: PLAN,
};

const worldWith = () => normalizeWorldState({
  polityOverrides: { Prussia: { name: "Prussia" } },
  projects: applyProjectOps([], [project]),
});

const carrier = (over = {}) => ({
  onTimeline: true,
  eventIndex: 0,
  stampsActivity: true,
  fallback: false,
  ops: [{ op: "setback", name: "Unification", days: 30, lastUpdate: "Bavaria balks." }],
  ...over,
});

const events = [{ id: "event-1", date: "1871-01-18", title: "Bavaria balks at the terms" }];

test("a setback rides on its event, recorded for the next period, and changes no colour and no name", () => {
  const colors = { Prussia: "#1f2937" };
  const pass = applyBoardCarriers({ world: worldWith(), colors, carriers: [carrier()], visibleEvents: events, date: "1871-01-18", round: 4 });
  const [entry] = pass.world.projects;
  assert.equal(entry.progress, 0, "nothing moves now");
  assert.deepEqual(entry.adjustments.map(({ kind, days, round }) => ({ kind, days, round })), [{ kind: "setback", days: 30, round: 4 }]);
  assert.equal(entry.lastUpdate, "Bavaria balks.");
  assert.deepEqual(pass.renamedPolities, []);
  assert.deepEqual(pass.colors, colors);
});

test("an ending rides on its event, and an event can no longer complete a project: that is the engine's", () => {
  const ended = applyBoardCarriers({ world: worldWith(), colors: {}, carriers: [carrier({ ops: [{ op: "cancel", name: "Unification", note: "The princes refuse." }] })], visibleEvents: events, date: "1871-01-18", round: 4 });
  assert.equal(ended.world.projects[0].status, "cancelled");
  const notDone = applyBoardCarriers({ world: worldWith(), colors: {}, carriers: [carrier({ ops: [{ op: "complete", name: "Unification" }] })], visibleEvents: events, date: "1871-01-18", round: 4 });
  assert.equal(notDone.world.projects[0].status, "active");
});

test("a provisional event whose own ops moved nothing is unbacked", () => {
  const pass = applyBoardCarriers({
    world: worldWith(),
    colors: {},
    carriers: [carrier({ ops: [{ op: "note", name: "No such entry" }] })],
    visibleEvents: events,
    provisionalIndexes: new Set([0]),
    date: "1871-01-18",
    round: 4,
  });
  assert.ok(pass.unbackedIds.has("event-1"));
});

test("a provisional event backed by a setback it really recorded stays", () => {
  const pass = applyBoardCarriers({ world: worldWith(), colors: {}, carriers: [carrier()], visibleEvents: events, provisionalIndexes: new Set([0]), date: "1871-01-18", round: 4 });
  assert.equal(pass.unbackedIds.has("event-1"), false);
});

test("a provisional event the board pass left no ops on is unbacked before anything is applied", () => {
  const pass = applyBoardCarriers({
    world: worldWith(),
    colors: {},
    carriers: [],
    visibleEvents: events,
    provisionalIndexes: new Set([0]),
  });
  assert.ok(pass.unbackedIds.has("event-1"));
});

test("a Hidden event that sets back an entry is counted", () => {
  const pass = applyBoardCarriers({
    world: worldWith(),
    colors: {},
    carriers: [carrier({ onTimeline: false, hiddenIndex: 0, eventIndex: -1, stampsActivity: false })],
    hiddenEvents: [{ id: "hidden-1", date: "1871-01-10", title: "Quiet negotiations" }],
    date: "1871-01-18",
    round: 4,
  });
  assert.equal(pass.hiddenEventsThatMoved, 1);
  assert.equal(pass.movedByHidden.size, 1);
  assert.equal(pass.world.projects[0].eventIds.includes("hidden-1"), false, "a Hidden event is never stamped into an entry's activity");
});

test("a timeline event's ops are stamped into the entry's activity", () => {
  const pass = applyBoardCarriers({ world: worldWith(), colors: {}, carriers: [carrier()], visibleEvents: events, date: "1871-01-18", round: 4 });
  assert.equal(pass.world.projects[0].eventIds.includes("event-1"), true);
});

// A project's focus is the place its event happens (its places field, as found on the map), where its ops
// give none: for an operation, what the war room sends its troops at (runtime/fronts/plans.js operationsOn);
// for any project, where a structure its plan builds stands. Never a city its name or summary mentions, in
// English or in any other language (the owner, 2026-11-13: no keywording anywhere).
test("a project opened with no focus takes the place of the event that opens it", () => {
  const world = normalizeWorldState({ projects: [] });
  const opened = (event, ops) => applyBoardCarriers({ world, colors: {}, carriers: [{ ...carrier(), ops }], visibleEvents: [event], date: "2024-03-01", round: 4 }).world.projects;
  const op = (extra = {}) => ({ op: "create", name: "Operation Kingfisher", kind: "operation", summary: "Three corps drive east to take Brod.", status: "active", ...extra });
  const brod = { id: "event-1", date: "2024-03-01", title: "Kingfisher begins", places: [{ kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  const brodFr = { ...brod, title: "Kingfisher commence", places: [{ kind: "region", name: "Lowmark", regionId: "r7" }, { kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  assert.deepEqual(opened(brod, [op()])[0].focus, { lng: 22.6, lat: 50 });
  assert.deepEqual(opened(brodFr, [op({ summary: "Trois corps foncent vers l'est pour prendre Brod." })])[0].focus, { lng: 22.6, lat: 50 }, "the first of its places that is a point");
  assert.deepEqual(opened(brod, [op({ focus: { lng: 23.4, lat: 49.4 } })])[0].focus, { lng: 23.4, lat: 49.4 }, "an op's own focus stands");
  assert.deepEqual(opened(brod, [op({ project: undefined }), { op: "create", project: { name: "Operation Heron", kind: "operation", summary: "s" } }])[1].focus, { lng: 22.6, lat: 50 }, "a nested create too");
  assert.deepEqual(opened(brod, [op({ kind: "project" })])[0].focus, { lng: 22.6, lat: 50 }, "a project stands where its event happened");
  assert.equal(opened({ ...brod, places: undefined, description: "The corps drive on Brod." }, [op()])[0].focus, null, "an event's words are no place");
});

test("an update gives an operation that has no focus its event's place, and leaves one that has its own", () => {
  const world = normalizeWorldState({ projects: applyProjectOps([], [{ op: "create", name: "Operation Kingfisher", kind: "operation", summary: "s", status: "active" }, { op: "create", name: "Operation Heron", kind: "operation", summary: "s", status: "active", focus: { lng: 1, lat: 1 } }]) });
  const event = { id: "event-2", date: "2024-03-05", title: "The operation moves on", places: [{ kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  const moved = applyBoardCarriers({ world, colors: {}, carriers: [{ ...carrier(), ops: [{ op: "update", name: "Operation Kingfisher", lastUpdate: "On." }, { op: "update", name: "Operation Heron", lastUpdate: "On." }] }], visibleEvents: [event], date: "2024-03-05", round: 5 }).world.projects;
  assert.deepEqual(moved.find((entry) => entry.name === "Operation Kingfisher").focus, { lng: 22.6, lat: 50 });
  assert.deepEqual(moved.find((entry) => entry.name === "Operation Heron").focus, { lng: 1, lat: 1 });
  // A fallback rides on an event it did not come from: that event's places are not the operation's.
  const fallback = applyBoardCarriers({ world, colors: {}, carriers: [{ ...carrier(), fallback: true, stampsActivity: false, ops: [{ op: "update", name: "Operation Kingfisher", lastUpdate: "On." }] }], visibleEvents: [event], date: "2024-03-05", round: 5 }).world.projects;
  assert.equal(fallback.find((entry) => entry.name === "Operation Kingfisher").focus, null);
});

test("board-only completion pauses the stock-map donor without a narrated transfer", () => {
  const state = worldWith({
    regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
  });
  const stat = normalizeCountryStatSheet({
    territorialComponents: [{ geography: "Mainland", group: "core", population: 1_000_000, gdpPerCapita: 12000 }],
    economy: { gdpGrowth: 2 },
  });
  state.countryStats = { Aland: stat, Borduria: stat };
  state.polityOverrides.Aland = { code: "Aland", name: "Aland" };
  state.polityOverrides.Borduria = { code: "Borduria", name: "Borduria" };
  const pass = applyBoardCarriers({
    world: state,
    colors: {},
    carriers: [completing()],
    visibleEvents: events,
    regionCatalog: [{ id: "region-A", country: "Geographic Aland", bakedOwner: "Aland" }],
    date: "1871-01-18",
    round: 4,
  });
  assert.equal(pass.world.regionOwnershipOverrides["region-A"], "Borduria");
  assert.equal(pass.world.countryStats.Aland.continuity.progressionBlocked, true);
  assert.equal(pass.world.countryStats.Borduria.continuity.progressionBlocked, true);
});

test("board-only completion refuses a map region absent from an explicit authoritative catalog", () => {
  const state = worldWith({ regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }] });
  assert.throws(() => applyBoardCarriers({
    world: state,
    colors: {},
    carriers: [completing()],
    visibleEvents: events,
    regionCatalog: [{ id: "some-other-region", country: "Aland", bakedOwner: "Aland" }],
    date: "1871-01-18",
    round: 4,
  }), /no matching region in the authoritative map catalog/);
});

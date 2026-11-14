/*! Open Historia — the board pass carries a completion's rename and colour © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/Game/AI/boardPassApply.test.js
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
import test from "node:test";
import assert from "node:assert/strict";

import { applyBoardCarriers } from "./boardPassApply.js";
import { applyProjectOps, normalizeWorldState } from "../../runtime/gameState.js";

const project = (onComplete) => ({
  op: "create",
  name: "Unification",
  summary: "Proclaim the empire.",
  status: "active",
  progress: 90,
  onComplete,
});

const worldWith = (onComplete) => normalizeWorldState({
  polityOverrides: { Prussia: { name: "Prussia" } },
  projects: applyProjectOps([], [project(onComplete)]),
});

const completing = (over = {}) => ({
  onTimeline: true,
  eventIndex: 0,
  stampsActivity: true,
  fallback: false,
  ops: [{ op: "complete", name: "Unification", note: "Proclaimed at Versailles." }],
  ...over,
});

const events = [{ id: "event-1", date: "1871-01-18", title: "The empire is proclaimed" }];

test("a completion's rename comes back with the world, for the caller to re-key", () => {
  const pass = applyBoardCarriers({
    world: worldWith({ polityChanges: [{ code: "Prussia", name: "German Empire" }] }),
    colors: { Prussia: "#1f2937" },
    carriers: [completing()],
    visibleEvents: events,
    date: "1871-01-18",
    round: 4,
  });
  assert.deepEqual(pass.renamedPolities, [{ from: "Prussia", to: "German Empire" }]);
  assert.ok(pass.world.polityOverrides["German Empire"], "the world is keyed by the new name");
  assert.equal(pass.colors["German Empire"], "#1f2937", "the colour follows the rename");
  assert.equal("Prussia" in pass.colors, false);
  assert.equal(pass.world.projects[0].status, "complete");
});

test("a completion that changes nothing about polities returns the colours it was given and no renames", () => {
  const colors = { Prussia: "#1f2937" };
  const pass = applyBoardCarriers({
    world: worldWith(null),
    colors,
    carriers: [completing()],
    visibleEvents: events,
    date: "1871-01-18",
    round: 4,
  });
  assert.deepEqual(pass.renamedPolities, []);
  assert.deepEqual(pass.colors, colors);
});

test("a provisional event whose own ops moved nothing is unbacked", () => {
  const pass = applyBoardCarriers({
    world: worldWith(null),
    colors: {},
    carriers: [completing({ ops: [{ op: "note", name: "No such entry" }] })],
    visibleEvents: events,
    provisionalIndexes: new Set([0]),
    date: "1871-01-18",
    round: 4,
  });
  assert.ok(pass.unbackedIds.has("event-1"));
});

test("a provisional event the board pass left no ops on is unbacked before anything is applied", () => {
  const pass = applyBoardCarriers({
    world: worldWith(null),
    colors: {},
    carriers: [],
    visibleEvents: events,
    provisionalIndexes: new Set([0]),
  });
  assert.ok(pass.unbackedIds.has("event-1"));
});

test("a Hidden event that moves an entry is counted", () => {
  const pass = applyBoardCarriers({
    world: worldWith(null),
    colors: {},
    carriers: [completing({ onTimeline: false, hiddenIndex: 0, eventIndex: -1, stampsActivity: false })],
    hiddenEvents: [{ id: "hidden-1", date: "1871-01-10", title: "Quiet negotiations" }],
    date: "1871-01-18",
    round: 4,
  });
  assert.equal(pass.hiddenEventsThatMoved, 1);
  assert.equal(pass.movedByHidden.size, 1);
  assert.equal(pass.world.projects[0].status, "complete");
  assert.equal(pass.world.projects[0].eventIds.includes("hidden-1"), false, "a Hidden event is never stamped into an entry's activity");
});

test("a timeline event's ops are stamped into the entry's activity", () => {
  const pass = applyBoardCarriers({
    world: worldWith(null),
    colors: {},
    carriers: [completing()],
    visibleEvents: events,
    date: "1871-01-18",
    round: 4,
  });
  assert.equal(pass.world.projects[0].eventIds.includes("event-1"), true);
});

// An operation's focus is the place its event happens (its places field, as found on the map), where its ops
// give none: what the war room sends its troops at (runtime/fronts/plans.js operationsOn). Never a city its
// name or summary mentions, in English or in any other language (the owner, 2026-11-13: no keywording anywhere).
test("an operation opened with no focus takes the place of the event that opens it; a project does not", () => {
  const world = normalizeWorldState({ projects: [] });
  const opened = (event, ops) => applyBoardCarriers({ world, colors: {}, carriers: [{ ...completing(), ops }], visibleEvents: [event], date: "2024-03-01", round: 4 }).world.projects;
  const op = (extra = {}) => ({ op: "create", name: "Operation Kingfisher", kind: "operation", summary: "Three corps drive east to take Brod.", status: "active", ...extra });
  const brod = { id: "event-1", date: "2024-03-01", title: "Kingfisher begins", places: [{ kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  const brodFr = { ...brod, title: "Kingfisher commence", places: [{ kind: "region", name: "Lowmark", regionId: "r7" }, { kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  assert.deepEqual(opened(brod, [op()])[0].focus, { lng: 22.6, lat: 50 });
  assert.deepEqual(opened(brodFr, [op({ summary: "Trois corps foncent vers l'est pour prendre Brod." })])[0].focus, { lng: 22.6, lat: 50 }, "the first of its places that is a point");
  assert.deepEqual(opened(brod, [op({ focus: { lng: 23.4, lat: 49.4 } })])[0].focus, { lng: 23.4, lat: 49.4 }, "an op's own focus stands");
  assert.deepEqual(opened(brod, [op({ project: undefined }), { op: "create", project: { name: "Operation Heron", kind: "operation", summary: "s" } }])[1].focus, { lng: 22.6, lat: 50 }, "a nested create too");
  assert.equal(opened(brod, [op({ kind: "project" })])[0].focus, null, "a project is not sent anywhere");
  assert.equal(opened({ ...brod, places: undefined, description: "The corps drive on Brod." }, [op()])[0].focus, null, "an event's words are no place");
});

test("an update gives an operation that has no focus its event's place, and leaves one that has its own", () => {
  const world = normalizeWorldState({ projects: applyProjectOps([], [{ op: "create", name: "Operation Kingfisher", kind: "operation", summary: "s", status: "active" }, { op: "create", name: "Operation Heron", kind: "operation", summary: "s", status: "active", focus: { lng: 1, lat: 1 } }]) });
  const event = { id: "event-2", date: "2024-03-05", title: "The operation moves on", places: [{ kind: "city", name: "Brod", lng: 22.6, lat: 50 }] };
  const moved = applyBoardCarriers({ world, colors: {}, carriers: [{ ...completing(), ops: [{ op: "update", name: "Operation Kingfisher", progress: 20 }, { op: "update", name: "Operation Heron", progress: 20 }] }], visibleEvents: [event], date: "2024-03-05", round: 5 }).world.projects;
  assert.deepEqual(moved.find((entry) => entry.name === "Operation Kingfisher").focus, { lng: 22.6, lat: 50 });
  assert.deepEqual(moved.find((entry) => entry.name === "Operation Heron").focus, { lng: 1, lat: 1 });
  // A fallback rides on an event it did not come from: that event's places are not the operation's.
  const fallback = applyBoardCarriers({ world, colors: {}, carriers: [{ ...completing(), fallback: true, stampsActivity: false, ops: [{ op: "update", name: "Operation Kingfisher", progress: 20 }] }], visibleEvents: [event], date: "2024-03-05", round: 5 }).world.projects;
  assert.equal(fallback.find((entry) => entry.name === "Operation Kingfisher").focus, null);
});

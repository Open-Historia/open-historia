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

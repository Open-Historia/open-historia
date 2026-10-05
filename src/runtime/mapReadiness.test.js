/*! Open Historia — map readiness marks, and whether the borders fell back © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

const events = [];
globalThis.window = { dispatchEvent: (event) => events.push(event) };

const {
  MAP_POLITIES_READY_EVENT,
  announceMapRerender,
  markMapIdle,
  markPolitiesReady,
  politiesFailed,
  politiesReady,
  politiesSettled,
  setReadinessGame,
} = await import("./mapReadiness.js");

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 170));
  markMapIdle();
};

test("a ready map has not failed; a final failure is recorded and announced", async () => {
  setReadinessGame("game-a");
  markPolitiesReady("regions.geojson");
  assert.equal(politiesReady(), true);
  assert.equal(politiesFailed(), false);

  events.length = 0;
  markPolitiesReady("regions.geojson", { failed: true });
  assert.equal(politiesFailed(), true);
  assert.equal(events.at(-1).type, MAP_POLITIES_READY_EVENT);
  assert.equal(events.at(-1).detail.failed, true);
  await settle();
  assert.equal(politiesSettled(), true);
});

test("a failure belongs to its game", () => {
  setReadinessGame("game-b");
  markPolitiesReady("regions.geojson", { failed: true });
  assert.equal(politiesFailed(), true);
  setReadinessGame("game-c");
  assert.equal(politiesFailed(), false, "the last game's failure is not this one's");
  assert.equal(politiesReady(), false);
});

test("a redraw starts over, and a map that then draws is not failed", () => {
  setReadinessGame("game-d");
  markPolitiesReady("regions.geojson", { failed: true });
  announceMapRerender();
  assert.equal(politiesFailed(), false);
  markPolitiesReady("regions.geojson");
  assert.equal(politiesFailed(), false);
});

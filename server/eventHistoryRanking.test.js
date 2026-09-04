// Run: npm ci && node --test server/eventHistoryRanking.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// The recent-events window a task is shown is a fixed budget; what changed
// (ported from the abdulrahman-2005 fork) is WHICH events fill it. A flat
// recency cut let a major war turning point age out in favour of yesterday's
// parade; ranking keeps major and map-moving events longer, and the selection
// still reads chronologically.
import test from "node:test";
import assert from "node:assert/strict";

import { buildEventHistoryText, selectRankedEvents } from "../src/Game/AI/promptContext.js";
import { normalizeEvents } from "../src/runtime/gameState.js";

const event = (date, title, extra = {}) => ({ date, title, description: "", ...extra });

test("a major event survives the window over newer minor ones, in chronological order", () => {
  const events = normalizeEvents([
    event("2014-01-05", "Border skirmish", { importance: "minor" }),
    event("2014-02-01", "War declared", { importance: "major" }),
    event("2014-04-01", "Parade in the capital", { importance: "minor" }),
    event("2014-04-10", "Harvest festival", { importance: "minor" }),
    event("2014-04-20", "Minor cabinet reshuffle", { importance: "minor" }),
  ]);
  const selected = selectRankedEvents(events, { limit: 3, currentDate: "2014-04-21" });
  assert.deepEqual(selected.map((entry) => entry.title), ["War declared", "Harvest festival", "Minor cabinet reshuffle"]);
  // The rendered text follows the same selection and keeps the date order.
  const text = buildEventHistoryText(events, { limit: 3, currentDate: "2014-04-21" });
  assert.ok(text.indexOf("War declared") < text.indexOf("Harvest festival"));
  assert.ok(!text.includes("Parade in the capital"));
});

test("without a budget pressure nothing is reordered or dropped", () => {
  const events = normalizeEvents([event("2014-01-01", "A"), event("2014-02-01", "B")]);
  assert.deepEqual(selectRankedEvents(events, { limit: 5, currentDate: "2014-03-01" }).map((entry) => entry.title), ["A", "B"]);
  assert.deepEqual(selectRankedEvents(events, { limit: 0 }).map((entry) => entry.title), ["A", "B"]);
});

test("a transfer between polities not on the map ranks below one that involves them", () => {
  const world = {
    regionOwnershipOverrides: { r1: "France" },
    units: [],
  };
  const events = normalizeEvents([
    event("2014-03-01", "Far-off cession", {
      importance: "minor",
      impacts: { regionTransfers: [{ regionId: "x", fromCode: "Ruritania", toCode: "Freedonia" }] },
    }),
    event("2014-03-01", "France takes a province", {
      importance: "minor",
      impacts: { regionTransfers: [{ regionId: "r2", fromCode: "Belgium", toCode: "France" }] },
    }),
  ]);
  const selected = selectRankedEvents(events, { limit: 1, world, currentDate: "2014-03-02" });
  assert.deepEqual(selected.map((entry) => entry.title), ["France takes a province"]);
});

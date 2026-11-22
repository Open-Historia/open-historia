/*! Open Historia — world director storyline date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeWorldDirector.test.js
//
// Storyline dates follow the calendar, not the text: in a BC campaign
// "-0217-01-20" sorts before "-0218-12-10" as a string, yet 217 BC comes after
// 218 BC, and a storyline whose newest event is read as the older one looks
// stalled while it is plainly moving.

import test from "node:test";
import assert from "node:assert/strict";

import { applyWorldStorylineUpdates, buildWorldInitiativeContext, directorRegionIds } from "./nativeWorldDirector.js";

const storyline = (overrides = {}) => ({
  id: "st-hannibal",
  title: "Hannibal's march on Italy",
  kind: "war",
  status: "active",
  participants: ["Carthage", "Rome"],
  pressure: 60,
  momentum: 50,
  startedDate: "-0218-04-01",
  lastVisibleEventDate: "-0218-12-10",
  lastUpdatedDate: "-0218-12-10",
  ...overrides,
});

const event = (id, date, storylineIds) => ({ id, date, title: `Event ${id}`, description: "Something happens.", storylineIds });

test("a storyline's last visible event moves on into the next BC year", () => {
  const { storylines } = applyWorldStorylineUpdates({
    world: { storylines: [storyline()] },
    updates: [],
    events: [event("e1", "-0217-01-20", ["st-hannibal"])],
    stopDate: "-0217-01-31",
    round: 3,
  });
  assert.equal(storylines[0].lastVisibleEventDate, "-0217-01-20");
});

test("an older linked event does not move a storyline's last visible event back", () => {
  const { storylines } = applyWorldStorylineUpdates({
    world: { storylines: [storyline({ lastVisibleEventDate: "-0217-01-20" })] },
    updates: [],
    events: [event("e1", "-0218-12-28", ["st-hannibal"])],
    stopDate: "-0217-01-31",
    round: 3,
  });
  assert.equal(storylines[0].lastVisibleEventDate, "-0217-01-20");
});

test("merged duplicates keep the earliest start and the latest visible event by the calendar", () => {
  const { storylines } = applyWorldStorylineUpdates({
    world: {
      storylines: [
        storyline({ id: "st-a", startedDate: "-0219-03-01", lastVisibleEventDate: "-0218-12-10" }),
        storyline({ id: "st-b", startedDate: "-0218-04-01", lastVisibleEventDate: "-0217-01-20" }),
      ],
    },
    updates: [],
    events: [],
    stopDate: "-0217-01-31",
    round: 3,
  });
  assert.equal(storylines.length, 1);
  assert.equal(storylines[0].startedDate, "-0219-03-01");
  assert.equal(storylines[0].lastVisibleEventDate, "-0217-01-20");
});

// Names, never ids: a pressure and a unit's whereabouts read "Active
// territorial pressure: GEO.11_1" and "region 2104" until the caller handed
// the names over (gameplay.js, from the region catalog).
test("the director's pressures and units name their regions, never an id", () => {
  const world = {
    regionOwnershipOverrides: { 2104: "Russia" },
    regionClaimants: { 2104: ["Ukraine"], "GEO.11_1": ["Georgia"] },
    units: [{ id: "u1", name: "1st Army", ownerCode: "Russia", status: "moving", regionId: "2104" }],
  };
  assert.deepEqual(directorRegionIds(world).sort(), ["2104", "GEO.11_1"]);
  const { text } = buildWorldInitiativeContext(
    { game: { country: "Ukraine", gameDate: "2026-03-01" }, world, events: [], chats: [] },
    { targetDate: "2026-04-01", regionNames: { 2104: "Zaporizhzhia" } },
  );
  assert.match(text, /Active territorial pressure: Zaporizhzhia/);
  assert.match(text, /Active territorial pressure: an unnamed region/, "a region with no name is not shown by its id");
  assert.match(text, /status moving; in Zaporizhzhia/);
  assert.doesNotMatch(text, /2104|GEO\.11_1/);
});

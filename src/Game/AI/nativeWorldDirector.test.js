/*! Open Historia — world director storyline date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeWorldDirector.test.js
//
// Storyline dates follow the calendar, not the text: in a BC campaign
// "-0217-01-20" sorts before "-0218-12-10" as a string, yet 217 BC comes after
// 218 BC, and a storyline whose newest event is read as the older one looks
// stalled while it is plainly moving.

import test from "node:test";
import assert from "node:assert/strict";

import { applyWorldStorylineUpdates } from "./nativeWorldDirector.js";

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

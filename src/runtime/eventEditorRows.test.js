/*! Open Historia — Event Editor row edits tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/eventEditorRows.test.js
//
// The invariant: a save from the Event Editor changes the one row it is for
// and nothing else, whatever was written to the ledger after the editor read
// it — above all, a time skip's new events survive it.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventRowChange, locateEventRow } from "./eventEditorRows.js";

const event = (id, title, extra = {}) => ({ id, createdAt: `2026-09-01T00:00:0${id.length % 10}Z`, date: "1914-06-28", title, ...extra });

// What the editor read when it opened.
const shownList = () => [event("e1", "Old one"), event("e2", "Typo hre"), event("e3", "Third")];
// The ledger after a time skip wrote twelve events.
const afterSkip = () => [
  ...shownList(),
  ...Array.from({ length: 12 }, (_, index) => event(`skip-${index}`, `From the skip ${index}`)),
];

test("fixing a typo keeps the events a time skip wrote meanwhile", () => {
  const shown = shownList();
  const next = applyEventRowChange(afterSkip(), {
    shown: shown[1],
    index: 1,
    update: (row) => ({ ...row, title: "Typo here" }),
  });
  assert.equal(next.length, 15);
  assert.equal(next[1].title, "Typo here");
  assert.deepEqual(next.filter((row) => row.id.startsWith("skip-")).length, 12);
});

test("adding keeps the fresh ledger and appends", () => {
  const added = event("event-manual-x", "By hand");
  const next = applyEventRowChange(afterSkip(), { add: added });
  assert.equal(next.length, 16);
  assert.equal(next.at(-1), added);
});

test("deleting removes the row the editor showed, even after it moved", () => {
  const shown = shownList();
  // Another write sorted a new event in ahead of it.
  const fresh = [event("new", "Earlier"), ...afterSkip()];
  const next = applyEventRowChange(fresh, { shown: shown[2], index: 2, remove: true });
  assert.equal(next.length, fresh.length - 1);
  assert.equal(next.some((row) => row.id === "e3"), false);
  assert.equal(next.some((row) => row.id === "e2"), true);
});

test("the edit lands on the fresh row, so fields written meanwhile are kept", () => {
  const shown = shownList();
  const fresh = afterSkip();
  fresh[0] = { ...fresh[0], npcReaction: { enabled: true, result: "sent", evaluatedAt: "2026-09-01T00:01:00Z" } };
  const next = applyEventRowChange(fresh, {
    shown: shown[0],
    index: 0,
    update: (row) => ({ ...row, title: "Retitled" }),
  });
  assert.equal(next[0].title, "Retitled");
  assert.equal(next[0].npcReaction.result, "sent");
});

test("a row no longer in the ledger is reported, not guessed", () => {
  const shown = shownList();
  const fresh = afterSkip().filter((row) => row.id !== "e2");
  assert.equal(applyEventRowChange(fresh, { shown: shown[1], index: 1, remove: true }), null);
  assert.equal(applyEventRowChange(fresh, { shown: shown[1], index: 1, update: (row) => row }), null);
});

test("rows that share an id are told apart by what the editor showed", () => {
  const twinA = { id: "dup", createdAt: "", title: "First twin" };
  const twinB = { id: "dup", createdAt: "", title: "Second twin" };
  const fresh = [event("lead", "Lead"), twinA, twinB];
  // Shown at index 1 when the list was [twinA, twinB]; both have moved one on.
  assert.equal(locateEventRow(fresh, twinB, 1), 2);
  assert.equal(locateEventRow(fresh, twinA, 0), 1);
  // Still where it was shown: that index wins.
  assert.equal(locateEventRow([twinA, twinB], twinB, 1), 1);
  assert.equal(locateEventRow(fresh, { id: "gone" }, 0), -1);
});

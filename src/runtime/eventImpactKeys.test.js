/*! Open Historia — shared event impact list tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/eventImpactKeys.test.js
//
// One list of what an event can change, shared by the Event Editor's badge,
// the GM console, the turn receipt and the timeline curator.

import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationReceipt, normalizeApplicationReceipt, tallyAppliedEvents } from "./applicationReceipt.js";
import { EVENT_IMPACT_KEYS, eventHasImpacts, eventImpactCounts } from "./eventImpactKeys.js";
import { normalizeEvents } from "./gameState.js";

test("the list names every impact array a saved event keeps", () => {
  const [event] = normalizeEvents([{ title: "Nothing happened", date: "1915-06-01" }]);
  assert.deepEqual([...EVENT_IMPACT_KEYS].sort(), Object.keys(event.impacts).sort());
});

test("an event's impacts are counted for every family, groups and governments included", () => {
  const event = {
    impacts: {
      groupOps: [{ op: "create", name: "Free Corps" }],
      politicalActorOps: [{ op: "set-government" }, { op: "replace-leader" }],
      institutionLifecycleOps: [{ op: "found" }],
      spyOps: [{ op: "deploy" }],
      projectOps: [{ op: "advance" }],
      unitOps: [],
      notAnImpact: [1, 2, 3],
    },
  };
  assert.deepEqual(eventImpactCounts(event), [
    ["groupOps", 1],
    ["politicalActorOps", 2],
    ["institutionLifecycleOps", 1],
    ["spyOps", 1],
    ["projectOps", 1],
  ]);
  assert.equal(eventHasImpacts(event), true);
  assert.equal(eventHasImpacts(event, ["unitOps", "markerOps"]), false);
  assert.deepEqual(eventImpactCounts({}), []);
  assert.equal(eventHasImpacts(null), false);
});

test("the turn receipt counts every family but the resolved orders", () => {
  const receipt = createApplicationReceipt();
  tallyAppliedEvents(receipt, [
    { impacts: { institutionLifecycleOps: [{}], spyOps: [{}, {}], groupOps: [{}], actionIds: ["a1"] } },
  ]);
  const applied = normalizeApplicationReceipt(receipt).applied;
  assert.equal(applied.events, 1);
  assert.equal(applied.institutionLifecycleOps, 1);
  assert.equal(applied.spyOps, 2);
  assert.equal(applied.groupOps, 1);
  assert.equal("actionIds" in applied, false);
  assert.deepEqual(Object.keys(applied), ["events", ...EVENT_IMPACT_KEYS.filter((key) => key !== "actionIds")]);
});

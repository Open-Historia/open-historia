/*! Open Historia — political cartography lifecycle regression tests © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOwnershipPresentationDelta,
  createPoliticalCartographyScheduler,
  diffPoliticalOwnership,
} from "./politicalCartographyLifecycle.js";

const manualTimers = () => {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(fn) {
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fire(id) {
      const fn = timers.get(id);
      timers.delete(id);
      fn?.();
    },
    ids() {
      return [...timers.keys()];
    },
  };
};

test("political cartography coalesces intermediate world revisions", () => {
  const dispatched = [];
  const timers = manualTimers();
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const r1 = scheduler.enqueue({ ownership: "A" });
  const r2 = scheduler.enqueue({ ownership: "B" });
  const r3 = scheduler.enqueue({ ownership: "C" });

  assert.equal(r1, 1);
  assert.equal(r2, 2);
  assert.equal(r3, 3);
  assert.deepEqual(dispatched.map((entry) => entry.revision), [1]);

  const firstCompletion = scheduler.complete(1);
  assert.equal(firstCompletion.accepted, false);
  assert.equal(firstCompletion.superseded, true);
  assert.equal(firstCompletion.supersededBy.revision, 3);
  assert.deepEqual(dispatched.map((entry) => entry.revision), [1, 3]);
  assert.equal(dispatched[1].payload.ownership, "C");

  assert.equal(scheduler.complete(2).accepted, false, "obsolete response cannot become presentation truth");
  assert.equal(scheduler.complete(3).accepted, true);
});

test("political cartography watchdog reports the stalled and latest desired revisions", () => {
  const dispatched = [];
  const timeouts = [];
  const timers = manualTimers();
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    onTimeout: (details) => timeouts.push(details),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  scheduler.enqueue({ ownership: "old" }, { timeoutMs: 25 });
  scheduler.enqueue({ ownership: "new" }, { timeoutMs: 25 });
  const [timerId] = timers.ids();
  timers.fire(timerId);

  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].stalled.revision, 1);
  assert.equal(timeouts[0].latestDesired.revision, 2);
  assert.equal(scheduler.snapshot().inFlight, null);
  assert.equal(scheduler.snapshot().latestDesired.revision, 2);
  assert.deepEqual(dispatched.map((entry) => entry.revision), [1]);
});

test("ownership presentation delta is canonical current state minus acknowledged worker snapshot", () => {
  const records = [
    { id: "A.1", owner: "Old" },
    { id: "A.2", owner: "Old" },
    { id: "island", owner: "Old" },
  ];

  const delta = buildOwnershipPresentationDelta(
    records,
    { "A.1": "New", island: "New" },
    { "A.1": "Old", "A.2": "Old", island: "Old" },
  );

  assert.deepEqual(delta, [
    { id: "A.1", fromOwner: "Old", toOwner: "New" },
    { id: "island", fromOwner: "Old", toOwner: "New" },
  ]);
});

test("ownership presentation delta disappears when worker catches up", () => {
  const records = [{ id: "r1", owner: "A" }];
  assert.deepEqual(buildOwnershipPresentationDelta(records, { r1: "B" }, { r1: "A" }), [
    { id: "r1", fromOwner: "A", toOwner: "B" },
  ]);
  assert.deepEqual(buildOwnershipPresentationDelta(records, { r1: "B" }, { r1: "B" }), []);
  assert.deepEqual(buildOwnershipPresentationDelta(records, { r1: "B" }, null), []);
});
test("a claim-only refresh cannot erase a queued ownership rebuild", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = scheduler.enqueue({ type: "initialize", ownershipOverrides: { A: "One" } });
  scheduler.enqueue({ type: "update-ownership", ownershipOverrides: { A: "Two" }, regionClaimants: {} });
  scheduler.enqueue({ type: "update-claims", ownershipOverrides: { A: "Two" }, regionClaimants: { A: ["Three"] } });

  scheduler.complete(first);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-ownership");
  assert.deepEqual(dispatched[1].payload.ownershipOverrides, { A: "Two" });
  assert.deepEqual(dispatched[1].payload.regionClaimants, { A: ["Three"] });
});



test("political ownership diff returns exact changed ids and both affected owners", () => {
  const result = diffPoliticalOwnership(
    [{ id: "a", owner: "Old" }, { id: "b", owner: "Old" }],
    { a: "Old", b: "Other" },
    { a: "New" },
  );
  assert.deepEqual(result.changedRegionIds.sort(), ["a", "b"]);
  assert.deepEqual(new Set(result.affectedOwners), new Set(["Old", "New", "Other"]));
});


test("superseding initialize with a labels/claims refresh still publishes one complete current snapshot", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const initial = scheduler.enqueue({
    type: "initialize",
    ownershipOverrides: { a: "A" },
    labelNames: {},
  });
  scheduler.enqueue({
    type: "update-labels",
    ownershipOverrides: { a: "A" },
    labelNames: { A: "Alpha" },
    affectedOwners: ["A"],
  });

  const completion = scheduler.complete(initial);
  assert.equal(completion.accepted, false);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-ownership");
  assert.equal(dispatched[1].payload.forceFullSnapshot, true);
  assert.deepEqual(dispatched[1].payload.labelNames, { A: "Alpha" });
});

test("superseded ownership revision forces the next accepted revision to publish a complete snapshot", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = scheduler.enqueue({
    type: "update-ownership",
    ownershipOverrides: { a: "B" },
    changedRegionIds: ["a"],
    affectedOwners: ["A", "B"],
  });
  scheduler.enqueue({
    type: "update-ownership",
    ownershipOverrides: { a: "C" },
    changedRegionIds: ["a"],
    affectedOwners: ["B", "C"],
  });

  const completion = scheduler.complete(first);
  assert.equal(completion.accepted, false);
  assert.equal(completion.superseded, true);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-ownership");
  assert.equal(dispatched[1].payload.forceFullSnapshot, true,
    "the UI discarded the first worker patch, so the next patch must be self-contained");
});

test("claim refresh that supersedes an unpublished ownership result also forces a complete current snapshot", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = scheduler.enqueue({
    type: "update-ownership",
    ownershipOverrides: { a: "B" },
    changedRegionIds: ["a"],
    affectedOwners: ["A", "B"],
    regionClaimants: {},
  });
  scheduler.enqueue({
    type: "update-claims",
    ownershipOverrides: { a: "B" },
    regionClaimants: { a: ["C"] },
  });

  const completion = scheduler.complete(first);
  assert.equal(completion.accepted, false);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-ownership",
    "the queued claims refresh must preserve the unpublished ownership rebuild");
  assert.equal(dispatched[1].payload.forceFullSnapshot, true);
  assert.deepEqual(dispatched[1].payload.regionClaimants, { a: ["C"] });
});


test("specialized cartography revisions also force a complete snapshot after an unpublished result", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = scheduler.enqueue({
    type: "update-labels",
    ownershipOverrides: { a: "A" },
    regionClaimants: {},
    labelNames: { A: "Alpha" },
    affectedOwners: ["A"],
  });
  scheduler.enqueue({
    type: "update-claims",
    ownershipOverrides: { a: "A" },
    regionClaimants: { a: ["B"] },
    labelNames: { A: "Alpha" },
  });

  const completion = scheduler.complete(first);
  assert.equal(completion.accepted, false);
  assert.equal(completion.superseded, true);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-claims");
  assert.equal(dispatched[1].payload.forceFullSnapshot, true,
    "discarding a label-only result also advances worker caches, so the next specialized result must be self-contained");
});

test("queued ownership revisions merge changed ids instead of dropping an unpublished intermediate delta", () => {
  const dispatched = [];
  const scheduler = createPoliticalCartographyScheduler({
    dispatch: (request) => dispatched.push(request),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const first = scheduler.enqueue({
    type: "update-labels",
    ownershipOverrides: {},
    labelNames: { A: "A" },
    affectedOwners: ["A"],
  });
  scheduler.enqueue({
    type: "update-ownership",
    ownershipOverrides: { a: "B" },
    changedRegionIds: ["a"],
    affectedOwners: ["A", "B"],
  });
  scheduler.enqueue({
    type: "update-ownership",
    ownershipOverrides: { a: "B", c: "D" },
    changedRegionIds: ["c"],
    affectedOwners: ["C", "D"],
  });

  scheduler.complete(first);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].payload.type, "update-ownership");
  assert.deepEqual(new Set(dispatched[1].payload.changedRegionIds), new Set(["a", "c"]));
  assert.deepEqual(new Set(dispatched[1].payload.affectedOwners), new Set(["A", "B", "C", "D"]));
  assert.equal(dispatched[1].payload.forceFullSnapshot, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createOwnershipPresentationState } from "./ownershipPresentationHolds.js";

const SWEEP = { type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "r1" } }] };
const CARTOGRAPHY = { boundaryPatch: {}, disputedData: null, labels: null };

// What Nations.jsx does with a "publish": publishOwnershipPresentation, which
// releases the entry's holds.
const publish = (state, entry) => state.releaseEntry(entry);

const setup = () => {
  let changes = 0;
  const state = createOwnershipPresentationState({ onHoldsChanged: () => { changes += 1; } });
  return { state, changes: () => changes };
};

test("holds count, and each release takes one", () => {
  const { state, changes } = setup();
  state.hold(["r1", "r1", 7, "", null]);
  assert.equal(state.holds.get("r1"), 2);
  assert.equal(state.isHeld(7), true);
  state.release(["r1"]);
  assert.equal(state.holds.get("r1"), 1);
  state.release(["r1", "r1", "nope"]);
  assert.equal(state.isHeld("r1"), false);
  assert.equal(changes(), 3);
  assert.equal(state.release(["r1"]), false, "releasing what is not held changes nothing");
});

test("cartography that lands mid-sweep publishes when the sweep ends", () => {
  const { state } = setup();
  state.hold(["r1"]);
  assert.equal(state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] }).added, true);
  const sweep = state.nextTransition();
  const accepted = state.acceptCartography({ revision: 1, cartographyResult: CARTOGRAPHY, changedRegionIds: ["r1"] });
  assert.equal(accepted.publishNow, false);
  assert.equal(accepted.entry, sweep);
  assert.equal(state.isHeld("r1"), true, "the old colour stays while the sweep plays");

  assert.equal(state.finishTransition(sweep), "publish");
  publish(state, sweep);
  assert.equal(state.isHeld("r1"), false);
  assert.deepEqual(state.pendingRevisions(), []);
});

test("cartography that lands after the sweep publishes on arrival, and releases nothing twice", () => {
  const { state } = setup();
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const sweep = state.nextTransition();
  assert.equal(state.finishTransition(sweep), "released");
  assert.equal(state.isHeld("r1"), false, "the fill hands over when the sweep ends");

  // A later change to the same region is held on its own account.
  state.hold(["r1"]);
  const accepted = state.acceptCartography({ revision: 1, cartographyResult: CARTOGRAPHY });
  assert.equal(accepted.publishNow, true);
  publish(state, accepted.entry);
  assert.equal(state.holds.get("r1"), 1, "the earlier revision's late publish did not take the later hold");
  assert.deepEqual(state.pendingRevisions(), []);
});

test("an accepted result without an early sweep message queues its own sweep", () => {
  const { state } = setup();
  state.hold(["r1"]);
  const { entry, added, publishNow } = state.acceptCartography({
    revision: 4,
    transitionData: SWEEP,
    cartographyResult: CARTOGRAPHY,
    changedRegionIds: ["r1"],
  });
  assert.equal(added, true);
  assert.equal(publishNow, false);
  assert.equal(state.nextTransition(), entry);
  assert.equal(state.finishTransition(entry), "publish");
  publish(state, entry);
  assert.equal(state.holds.size, 0);
});

test("A -> B -> C: the coalesced revision keeps the region on A until both sweeps end", () => {
  const { state } = setup();
  // A -> B, revision 1, starts sweeping.
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const first = state.nextTransition();
  // B -> C, revision 2, before revision 1's cartography: the scheduler drops 1.
  state.hold(["r1"]);
  state.discardCartography(1, { supersededByChangedRegionIds: ["r1"] });
  assert.equal(state.holds.get("r1"), 2, "one for the running sweep, one for revision 2");

  assert.equal(state.finishTransition(first), "released");
  assert.equal(state.isHeld("r1"), true, "C is not revealed under the finished A -> B sweep");
  assert.deepEqual(state.pendingRevisions(), [], "the discarded revision is forgotten once its sweep ends");

  state.addTransition({ revision: 2, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const second = state.nextTransition();
  state.acceptCartography({ revision: 2, cartographyResult: CARTOGRAPHY, changedRegionIds: ["r1"] });
  assert.equal(state.finishTransition(second), "publish");
  publish(state, second);
  assert.equal(state.holds.size, 0);
});

test("changes coalesced with no sweep playing leave one hold for the survivor", () => {
  const { state } = setup();
  state.hold(["r1"]);
  state.hold(["r1"]);
  state.hold(["r1", "r2"]);
  state.discardCartography(1, { supersededByChangedRegionIds: ["r1", "r2", "r3"] });
  assert.equal(state.holds.get("r1"), 1);
  assert.equal(state.holds.get("r2"), 1);
  assert.equal(state.isHeld("r3"), false, "a region nobody held is not held by a discard");
  state.release(["r1", "r2"]);
  assert.equal(state.holds.size, 0);
});

test("a failed revision releases its holds, now or when its sweep ends", () => {
  const { state } = setup();
  // No sweep: at once.
  state.hold(["r9"]);
  assert.equal(state.failCartography(9, ["r9"]), null);
  assert.equal(state.isHeld("r9"), false);

  // Mid-sweep: when the sweep ends.
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const sweep = state.nextTransition();
  state.failCartography(1, ["r1"]);
  assert.equal(state.isHeld("r1"), true);
  assert.equal(state.finishTransition(sweep), "released");
  assert.equal(state.isHeld("r1"), false);
  assert.deepEqual(state.pendingRevisions(), []);

  // After the sweep: the entry goes.
  state.hold(["r2"]);
  state.addTransition({ revision: 2, transitionData: SWEEP, changedRegionIds: ["r2"] });
  state.finishTransition(state.nextTransition());
  state.failCartography(2, ["r2"]);
  assert.equal(state.holds.size, 0);
  assert.deepEqual(state.pendingRevisions(), []);
});

test("a discarded revision's sweep still releases what it held", () => {
  const { state } = setup();
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const sweep = state.nextTransition();
  state.discardCartography(1);
  assert.equal(state.finishTransition(sweep), "released");
  assert.equal(state.holds.size, 0);
  assert.deepEqual(state.pendingRevisions(), []);
});

test("after every hold is dropped, a pending sweep's end takes no later hold", () => {
  const { state } = setup();
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const sweep = state.nextTransition();
  state.releaseAll(); // the cartography worker stalled and was restarted
  state.hold(["r1"]); // a new change to the same region
  assert.equal(state.finishTransition(sweep), "released");
  assert.equal(state.holds.get("r1"), 1);
});

test("a sweep whose holds were dropped claims no extra hold when its revision is superseded", () => {
  const { state } = setup();
  state.hold(["r1"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  const sweep = state.nextTransition();
  state.releaseAll();
  state.hold(["r1"]);
  state.discardCartography(1, { supersededByChangedRegionIds: ["r1"] });
  assert.equal(state.holds.get("r1"), 1);
  state.finishTransition(sweep);
  state.release(["r1"]); // revision 2 publishes
  assert.equal(state.holds.size, 0, "nothing stays held for the session");
});

test("a geometry change or teardown drops every queued sweep", () => {
  const { state } = setup();
  state.hold(["r1", "r2"]);
  state.addTransition({ revision: 1, transitionData: SWEEP, changedRegionIds: ["r1"] });
  state.addTransition({ revision: 2, transitionData: SWEEP, changedRegionIds: ["r2"] });
  assert.equal(state.addTransition({ revision: 2, transitionData: SWEEP }).added, false);
  assert.equal(state.queuedCount(), 2);
  state.reset({ releaseHolds: false });
  assert.equal(state.queuedCount(), 0);
  assert.deepEqual(state.pendingRevisions(), []);
  assert.equal(state.holds.size, 2, "teardown leaves the holds to the unmounting map");
  state.reset();
  assert.equal(state.holds.size, 0);
  assert.equal(state.nextTransition(), null);
});

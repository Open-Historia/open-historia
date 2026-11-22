/*! Open Historia — what a player has only ordered, kept from the others until the skip: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/onlyOrdered.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  fleetAsSeen,
  huntSeenBy,
  isOwnOrder,
  linesGivenUpSeenBy,
  opaqueId,
  transportSeenBy,
  withFleetOrdered,
  withLineGivenUp,
  withOrdersSeen,
  withRenamed,
} from "./onlyOrdered.js";
import { projectForViewer } from "./projection.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

const LATVIA = "Republic of Latvia"; // the host
const RUSSIA = "Russian Federation";
const TODAY = "2014-04-01";
const fleet = (extra = {}) => ({ id: "ru-fleet", name: "Baltic Fleet", type: "naval", ownerCode: RUSSIA, strength: 90, lng: 20, lat: 58, posture: "patrol", status: "idle", updatedAt: "2014-03-01T00:00:00.000Z", ...extra });

test("an order with no owner is the host's, in every view and in the queue alike (wars 12)", () => {
  assert.equal(isOwnOrder({ ownerCode: "" }, LATVIA, LATVIA), true);
  assert.equal(isOwnOrder({ ownerCode: "" }, RUSSIA, LATVIA), false);
  assert.equal(isOwnOrder({ ownerCode: RUSSIA }, RUSSIA, LATVIA), true);
  // A formation the host stood down in single player before sharing: its order has no owner. The host's own view
  // showed it still standing (the review of 2026-11-18, wars 12); Russia's still sees it until the skip.
  const gone = { id: "lv-gone", name: "lv-gone", type: "infantry", ownerCode: LATVIA, strength: 50, lng: 24, lat: 57, status: "idle" };
  const docs = {
    game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA], gameDate: TODAY },
    world: { units: [] },
    actions: [{ id: "a-1", status: "planned", text: "Disband order", ownerCode: "", unitRevert: { unitId: "lv-gone", restore: gone } }],
  };
  assert.deepEqual(projectForViewer(docs, LATVIA).world.units.map((unit) => unit.id), []);
  assert.deepEqual(projectForViewer(docs, RUSSIA).world.units.map((unit) => unit.id), ["lv-gone"]);
});

test("a fleet ordered today is seen by the others as it stood before the first order, until the date moves on (wars 5, views 10)", () => {
  const before = { units: [fleet()] };
  const ordered = { units: [fleet({ posture: "blockade", status: "moving", updatedAt: "2014-04-01T10:00:00.000Z" })] };
  const after = withFleetOrdered(before, ordered, "ru-fleet", TODAY);
  const seen = fleetAsSeen(after.units[0], after, TODAY);
  assert.deepEqual([seen.posture, seen.status, seen.updatedAt], ["patrol", "idle", "2014-03-01T00:00:00.000Z"], "nothing about it says it was given an order");
  // A second order the same day: still as it stood before the first.
  const again = withFleetOrdered(after, { units: [fleet({ posture: "holding", status: "idle" })] }, "ru-fleet", TODAY);
  assert.equal(fleetAsSeen(again.units[0], again, TODAY).posture, "patrol");
  // The date moved on (a skip; or a session taken up after the host played alone): the fleet is the world's.
  assert.equal(fleetAsSeen(after.units[0], after, "2014-05-01").posture, "blockade");
  // Something public changed it since (the Game Master's command, told to everyone): it is seen as it is.
  assert.equal(fleetAsSeen(fleet({ posture: "withdrawing" }), after, TODAY).posture, "withdrawing");
  // Ordered back to how it was seen: nothing is kept.
  assert.equal("ru-fleet" in withFleetOrdered(after, before, "ru-fleet", TODAY).seenFleetPostures, false);
  // Records of another date are let go with the next order.
  const stale = { ...before, seenFleetPostures: { "other-fleet": { posture: "patrol", status: "idle", since: "2014-01-01", ordered: { posture: "blockade", status: "idle" } } } };
  assert.deepEqual(Object.keys(withFleetOrdered(stale, ordered, "ru-fleet", TODAY).seenFleetPostures), ["ru-fleet"]);
  // The game keeps all of it with the world.
  assert.deepEqual(normalizeWorldState({ seenFleetPostures: after.seenFleetPostures }).seenFleetPostures, after.seenFleetPostures);
});

test("through the views: a fleet ordered in the lobby or today is its owner's until a skip, whatever moment sharing began", () => {
  const docs = {
    game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA], gameDate: TODAY },
    world: withFleetOrdered({ units: [fleet()] }, { units: [fleet({ posture: "blockade" })] }, "ru-fleet", TODAY),
  };
  assert.equal(projectForViewer(docs, LATVIA).world.units[0].posture, "patrol");
  assert.equal(projectForViewer(docs, RUSSIA).world.units[0].posture, "blockade", "its own as ordered");
  assert.equal("seenFleetPostures" in projectForViewer(docs, LATVIA).world, false, "the host's bookkeeping");
  // The round lands: everything ordered is the world's, and the records go.
  const landed = { ...docs, world: withOrdersSeen(docs.world), game: { ...docs.game, gameDate: "2014-05-01" } };
  assert.equal(projectForViewer(landed, LATVIA).world.units[0].posture, "blockade");
  assert.equal(withOrdersSeen(landed.world), null, "nothing to clear: no write");
});

test("a line given up that the others had seen is still theirs to see until the skip; one only ordered today is not (wars 6)", () => {
  const line = (id, since) => ({ id, name: id, owner: RUSSIA, level: 5, points: [[24, 57], [25, 58]], building: { since, days: 60 } });
  const old = line("ru-rising", "2014-03-01");
  let world = withLineGivenUp({ fortifications: [] }, old, TODAY);
  world = withLineGivenUp(world, line("ru-today", TODAY), TODAY);
  assert.deepEqual(linesGivenUpSeenBy(world, LATVIA, TODAY).map((entry) => entry.id), ["ru-rising"]);
  assert.deepEqual(linesGivenUpSeenBy(world, RUSSIA, TODAY), [], "its owner gave it up");
  assert.deepEqual(linesGivenUpSeenBy(world, LATVIA, "2014-05-01"), [], "after the skip it is gone for everyone");
  const docs = { game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA], gameDate: TODAY }, world };
  assert.deepEqual(projectForViewer(docs, LATVIA).world.fortifications.map((entry) => entry.id), ["ru-rising"]);
  assert.deepEqual(projectForViewer(docs, RUSSIA).world.fortifications, []);
  assert.equal("linesGivenUp" in projectForViewer(docs, LATVIA).world, false, "the host's bookkeeping");
  assert.deepEqual(withOrdersSeen(world).linesGivenUp, []);
});

test("a hunt names only a convoy its hunter can see, and what a player sends has an id that tells nothing (wars 4)", () => {
  const transports = [{ id: "t1", owner: RUSSIA, status: "ordered" }, { id: "t2", owner: RUSSIA, status: "moving" }];
  assert.equal(transportSeenBy(transports[0], LATVIA), false);
  assert.equal(transportSeenBy(transports[0], RUSSIA), true);
  assert.equal(transportSeenBy(transports[1], LATVIA), true);
  assert.equal(huntSeenBy({ op: "hunt", id: "t1" }, transports, LATVIA).id, "", "as if there were none");
  assert.equal(huntSeenBy({ op: "hunt", id: "t9" }, transports, LATVIA).id, "", "and there is none");
  assert.equal(huntSeenBy({ op: "hunt", id: "t2" }, transports, LATVIA).id, "t2");
  const other = { op: "transport", id: "t1" };
  assert.equal(huntSeenBy(other, transports, LATVIA), other, "only a hunt is held to it");
  const id = opaqueId("t", ["t1"]);
  assert.match(id, /^t[0-9a-z]{8}$/);
  let turn = 0;
  const fixed = () => [0.5, 0.5, 0.25][turn++];
  const first = opaqueId("t", [], () => 0.5);
  assert.notEqual(opaqueId("t", [first], fixed), first, "never one that is taken");
  assert.deepEqual(withRenamed(transports, "t1", "tx").map((entry) => entry.id), ["tx", "t2"]);
});

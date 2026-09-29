import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_RESTORE_POINT_NOTE,
  heldTurnOutdated,
  mergeActionsAtCommit,
  restorePointProblem,
  restorePointsFor,
  undoableTurns,
} from "./turnCommit.js";

const order = (id, status = "planned", extra = {}) => ({ id, status, kind: "action", text: `Order ${id}`, ...extra });

test("an order queued while the turn ran is kept, after the turn's own", () => {
  const base = [order("a"), order("b")];
  const turn = [order("a", "resolved"), order("b", "planned", { overdue: true })];
  const stored = [order("a"), order("b"), order("new")];
  assert.deepEqual(mergeActionsAtCommit({ base, turn, stored }), [
    order("a", "resolved"),
    order("b", "planned", { overdue: true }),
    order("new"),
  ]);
});

test("an order deleted while the turn ran stays deleted, however the turn settled it", () => {
  const base = [order("a"), order("b")];
  const turn = [order("a", "resolved"), order("b", "planned", { overdue: true })];
  const stored = [order("b")];
  assert.deepEqual(mergeActionsAtCommit({ base, turn, stored }), [order("b", "planned", { overdue: true })]);
});

test("the turn's settlement stands for every order it read", () => {
  const base = [order("a")];
  const turn = [order("a", "resolved")];
  // The stored copy is the pre-turn one; the turn's resolution wins.
  assert.deepEqual(mergeActionsAtCommit({ base, turn, stored: [order("a")] }), [order("a", "resolved")]);
});

test("nothing changed while the turn ran: the turn's list is written as it was", () => {
  const base = [order("a")];
  const turn = [order("a", "resolved")];
  assert.deepEqual(mergeActionsAtCommit({ base, turn, stored: base }), turn);
});

test("a failed re-read writes the turn's list, as before the re-read existed", () => {
  const turn = [order("a", "resolved")];
  assert.equal(mergeActionsAtCommit({ base: [order("a")], turn, stored: null }), turn);
});

test("a held turn may be retried only on the round it was read on", () => {
  assert.equal(heldTurnOutdated({ round: 6 }, { round: 6 }), false);
  // An Undo while the jump was held took the campaign back a round.
  assert.equal(heldTurnOutdated({ round: 5 }, { round: 6 }), true);
  // A game with no round yet is round 1 either way.
  assert.equal(heldTurnOutdated({}, { round: 1 }), false);
});

// Restore points, newest first; each records the round its turn started on.
const point = (round, extra = {}) => ({ id: `snap-${round}`, round, ...extra });

test("the last turn's restore point is one round behind the game, and may be restored", () => {
  const list = [point(5), point(4), point(3)];
  assert.equal(restorePointProblem(list, { round: 6 }), "");
  assert.equal(restorePointProblem(list, { round: 6, index: 2 }), "");
  assert.equal(undoableTurns(list, { round: 6 }), 3);
});

test("a turn that saved no restore point stops Undo instead of taking two turns back", () => {
  // Round 5's turn landed without one: the newest is round 4's.
  const list = [point(4), point(3)];
  assert.equal(restorePointProblem(list, { round: 6 }), NO_RESTORE_POINT_NOTE);
  assert.equal(undoableTurns(list, { round: 6 }), 0);
  // A gap further back ends the run there.
  assert.equal(undoableTurns([point(5), point(3)], { round: 6 }), 1);
});

test("a restore point left by a turn that never landed is not offered", () => {
  // Saved for round 6's turn, whose commit then failed: the game is still on 6.
  const list = [point(6), point(5), point(4)];
  assert.deepEqual(restorePointsFor(list, { round: 6 }).map((entry) => entry.round), [5, 4]);
  assert.equal(undoableTurns(list, { round: 6 }), 2);
});

test("a restore point from another campaign is refused", () => {
  const list = [point(5, { campaignId: "game-b" })];
  assert.equal(restorePointProblem(list, { round: 6, campaignId: "game-a" }), NO_RESTORE_POINT_NOTE);
  assert.equal(restorePointProblem(list, { round: 6, campaignId: "game-b" }), "");
  // One saved before restore points knew their campaign cannot be checked.
  assert.equal(restorePointProblem([point(5)], { round: 6, campaignId: "game-a" }), "");
});

test("nothing to restore is a problem; a restore point with no round is taken on trust", () => {
  assert.equal(restorePointProblem([], { round: 3 }), NO_RESTORE_POINT_NOTE);
  assert.equal(restorePointProblem([{ id: "old" }], { round: 3 }), "");
  assert.equal(undoableTurns(null, { round: 3 }), 0);
});

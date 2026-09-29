import test from "node:test";
import assert from "node:assert/strict";
import { heldTurnOutdated, mergeActionsAtCommit } from "./turnCommit.js";

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

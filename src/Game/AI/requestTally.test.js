/*! Open Historia — tests of the tally of AI calls behind the badge on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/requestTally.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createRequestTally, longestOpen } from "./requestTally.js";

const clocked = () => {
  let at = 1000;
  const tally = createRequestTally({ now: () => at });
  return { tally, pass: (ms) => { at += ms; } };
};

test("a call is open from begin to end, and counted for its turn", () => {
  const { tally, pass } = clocked();
  assert.deepEqual(tally.current().open, []);
  const id = tally.begin("jumpForward");
  assert.deepEqual(tally.current().open, [{ taskKey: "jumpForward", startedAt: 1000 }]);
  assert.equal(tally.current().sinceTurn, 1);
  pass(42000);
  tally.end(id, true);
  assert.deepEqual(tally.current().open, []);
  assert.deepEqual(tally.current().last, { taskKey: "jumpForward", ms: 42000, answered: true });
  assert.equal(tally.current().unansweredSinceTurn, 0);
});

test("a call that threw is counted as unanswered", () => {
  const { tally } = clocked();
  tally.end(tally.begin("countryStatSheet"), false);
  assert.equal(tally.current().unansweredSinceTurn, 1);
  assert.equal(tally.current().last.answered, false);
});

test("ending a call twice, or one that never began, changes nothing", () => {
  const { tally } = clocked();
  const id = tally.begin("advisor");
  tally.end(id, false);
  const after = tally.current();
  tally.end(id, false);
  tally.end(999, false);
  assert.equal(tally.current(), after);
});

test("a new turn starts the counts again and keeps a call that is still open", () => {
  const { tally } = clocked();
  tally.end(tally.begin("jumpForward"), true);
  tally.end(tally.begin("timelineCurator"), false);
  const background = tally.begin("idleDiplomacy");
  assert.equal(tally.current().lastTurn, null);
  tally.newTurn();
  assert.equal(tally.current().sinceTurn, 1);
  assert.equal(tally.current().unansweredSinceTurn, 0);
  // What the turn that landed made: its two finished calls, not the one still open.
  assert.deepEqual(tally.current().lastTurn, { calls: 2, unanswered: 1 });
  assert.equal(tally.current().open.length, 1);
  tally.end(background, true);
  assert.equal(tally.current().sinceTurn, 1);
});

test("the snapshot is the same object until something changes", () => {
  const { tally } = clocked();
  const before = tally.current();
  assert.equal(tally.current(), before);
  tally.begin("advisor");
  assert.notEqual(tally.current(), before);
});

test("listeners hear every change, and one that throws costs nothing", () => {
  const { tally } = clocked();
  let heard = 0;
  tally.subscribe(() => { throw new Error("a broken listener"); });
  const stop = tally.subscribe(() => { heard += 1; });
  const id = tally.begin("advisor");
  tally.end(id, true);
  assert.equal(heard, 2);
  stop();
  tally.begin("advisor");
  assert.equal(heard, 2);
});

test("with several open, the badge names the one open longest", () => {
  const { tally, pass } = clocked();
  tally.begin("jumpForward");
  pass(5000);
  tally.begin("idleDiplomacy");
  assert.equal(longestOpen(tally.current()).taskKey, "jumpForward");
  assert.equal(longestOpen(createRequestTally().current()), null);
});

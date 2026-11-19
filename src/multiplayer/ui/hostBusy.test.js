// Run: node --test src/multiplayer/ui/hostBusy.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { hostBusyLine } from "./hostBusy.js";

test("the host is told what its game is still writing, and when a change was stopped at its bound", () => {
  assert.equal(hostBusyLine(null), "");
  assert.match(hostBusyLine({ label: "reading:stat-sheet", seconds: 40 }), /^Your game is still writing figures the AI read \(40 s\); starting/);
  assert.match(hostBusyLine({ label: "ownSheet", seconds: 21 }), /^Your game is still applying an earlier change \(21 s\)/);
  assert.match(hostBusyLine({ label: "ownSheet", seconds: 120, overdue: true }), /took too long \(120 s\) and was stopped; starting and every request wait until it has ended/);
  assert.equal(hostBusyLine({ label: "round", seconds: 300 }), "", "the round bar says what a round is doing");
  assert.doesNotMatch(hostBusyLine({ label: "reading:stat-sheet", seconds: 40 }), /reading:|stat-sheet/, "never the label");
});

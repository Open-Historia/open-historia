// Run: node --test src/multiplayer/ui/hostBusy.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { hostBusyLine } from "./hostBusy.js";

test("the host is told what its game is still writing, and when it went on without it", () => {
  assert.equal(hostBusyLine(null), "");
  assert.match(hostBusyLine({ label: "reading:stat-sheet", seconds: 40 }), /^Your game is still writing figures the AI read \(40 s\); starting/);
  assert.match(hostBusyLine({ label: "ownSheet", seconds: 21 }), /^Your game is still applying an earlier change \(21 s\)/);
  assert.match(hostBusyLine({ label: "ownSheet", seconds: 180, gaveUp: true }), /never finished \(180 s\): the game went on without waiting for it/);
  assert.equal(hostBusyLine({ label: "round", seconds: 300 }), "", "the round bar says what a round is doing");
  assert.doesNotMatch(hostBusyLine({ label: "reading:stat-sheet", seconds: 40 }), /reading:|stat-sheet/, "never the label");
});

/*! Open Historia — the next period's land war, thought through while the player reads: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontPrethink.test.js
//
// A world war's 180-day skip, after a month thought through ahead, took 60 seconds, and the month after it 87
// (2026-11-10). The next period is thought through to the length last skipped and then on to the Timeline's longer
// skips, and the periods are kept by length (frontApply.js FORESEEN_KEPT).

import test from "node:test";
import assert from "node:assert/strict";

import { PRETHINK_DAYS, PRETHINK_HORIZONS, prethinkLengths } from "./frontPrethink.js";

test("the next period is thought through to the length asked for, then on to the longer skips", () => {
  assert.deepEqual(PRETHINK_HORIZONS, [30, 90, 180]);
  assert.deepEqual(prethinkLengths(30), [30, 90, 180]);
  assert.deepEqual(prethinkLengths(7), [7, 30, 90, 180]);
  assert.deepEqual(prethinkLengths(90), [90, 180]);
  assert.deepEqual(prethinkLengths(365), [365], "a year, and nothing longer");
  assert.deepEqual(prethinkLengths(0), [PRETHINK_DAYS, 90, 180], "none made here yet: a month first");
});

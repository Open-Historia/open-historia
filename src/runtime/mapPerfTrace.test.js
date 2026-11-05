import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMapTrace,
  getMapTrace,
  isMapPerfVerbose,
  recordMapFreeze,
  recordMapTrace,
} from "./mapPerfTrace.js";

test("the trace keeps the newest 500 entries, oldest first", () => {
  clearMapTrace();
  for (let index = 0; index < 1234; index += 1) recordMapTrace("step", { index });
  const entries = getMapTrace();
  assert.equal(entries.length, 500);
  assert.equal(entries[0].detail.index, 734);
  assert.equal(entries[499].detail.index, 1233);
  assert.deepEqual(getMapTrace(3).map((entry) => entry.detail.index), [1231, 1232, 1233]);
});

test("a short trace reads back in order and clears", () => {
  clearMapTrace();
  recordMapTrace("a");
  recordMapTrace("b");
  assert.deepEqual(getMapTrace().map((entry) => entry.type), ["a", "b"]);
  assert.deepEqual(getMapTrace(10).map((entry) => entry.type), ["a", "b"]);
  clearMapTrace();
  assert.deepEqual(getMapTrace(), []);
});

test("the console handle reads the ordered trace", () => {
  clearMapTrace();
  recordMapTrace("first");
  recordMapTrace("second");
  assert.deepEqual(globalThis.__OH_MAP_TRACE__.map((entry) => entry.type), ["first", "second"]);
});

test("a freeze carries the most recent entries", () => {
  clearMapTrace();
  for (let index = 0; index < 600; index += 1) recordMapTrace("step", { index });
  const freeze = recordMapFreeze({ deltaMs: 150 });
  assert.equal(freeze.recent.length, 80);
  assert.equal(freeze.recent[79].detail.index, 599);
});

test("the verbose switch is off unless set to true", () => {
  const previous = globalThis.__OH_PERF_VERBOSE__;
  try {
    delete globalThis.__OH_PERF_VERBOSE__;
    assert.equal(isMapPerfVerbose(), false);
    globalThis.__OH_PERF_VERBOSE__ = "yes";
    assert.equal(isMapPerfVerbose(), false);
    globalThis.__OH_PERF_VERBOSE__ = true;
    assert.equal(isMapPerfVerbose(), true);
  } finally {
    if (previous === undefined) delete globalThis.__OH_PERF_VERBOSE__;
    else globalThis.__OH_PERF_VERBOSE__ = previous;
  }
});

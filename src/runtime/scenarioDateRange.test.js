import test from "node:test";
import assert from "node:assert/strict";

import { dateRangeBound, startsBetween } from "./scenarioDateRange.js";

test("a bound is a year or a date, BC as the game writes it", () => {
  assert.equal(dateRangeBound("1914"), "1914-01-01");
  assert.equal(dateRangeBound("1914", { end: true }), "1914-12-31");
  assert.equal(dateRangeBound("218 BC"), "-0218-01-01");
  assert.equal(dateRangeBound("-218", { end: true }), "-0218-12-31");
  assert.equal(dateRangeBound("1939-09-01"), "1939-09-01");
  assert.equal(dateRangeBound(""), null);
  assert.equal(dateRangeBound("0"), null);
  assert.equal(dateRangeBound("Third Age"), null);
});

test("a scenario is in the range by the day it begins, and one with no date is not", () => {
  const from = dateRangeBound("1900");
  const to = dateRangeBound("1950", { end: true });
  assert.equal(startsBetween("1936-01-01", from, to), true);
  assert.equal(startsBetween("1950-12-31", from, to), true);
  assert.equal(startsBetween("1951-01-01", from, to), false);
  assert.equal(startsBetween("-0218-03-01", dateRangeBound("300 BC"), dateRangeBound("100 BC", { end: true })), true);
  assert.equal(startsBetween("", from, to), false);
  assert.equal(startsBetween("Third Age 3019", from, null), false);
  assert.equal(startsBetween("", null, null), true);
});

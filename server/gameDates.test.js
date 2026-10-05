// Run: node --test server/gameDates.test.js
//
// Game dates in any year. Years before AD 1 carry a leading minus and count
// backwards with no year zero; the arithmetic is astronomical inside and never
// shows it. Ancient scenarios (a Second Punic War at -0218-03-01) run on these.

import test from "node:test";
import assert from "node:assert/strict";

import {
  addGameDays,
  addGameMonths,
  compareGameDates,
  compareGameDatesNewestFirst,
  diffGameDays,
  formatGameDateReadable,
  gameDateDaysInMonth,
  gameDateYear,
  isCanonicalGameDate,
  isGameDate,
  normalizeGameDate,
  parseGameDate,
  shiftGameYear,
} from "../src/runtime/gameDates.js";

test("parses the canonical, unpadded, signed, timed and era-suffixed spellings to one day", () => {
  assert.deepEqual(parseGameDate("-0218-03-01"), { year: -218, month: 3, day: 1 });
  assert.deepEqual(parseGameDate("-218-03-01"), { year: -218, month: 3, day: 1 });
  assert.deepEqual(parseGameDate("218-03-01 BC"), { year: -218, month: 3, day: 1 });
  assert.deepEqual(parseGameDate("0218-03-01 BCE"), { year: -218, month: 3, day: 1 });
  assert.deepEqual(parseGameDate("+2016-01-31"), { year: 2016, month: 1, day: 31 });
  assert.deepEqual(parseGameDate("2016-12-31T00:00:00.000Z"), { year: 2016, month: 12, day: 31 });
  assert.deepEqual(parseGameDate("2016-1-5"), { year: 2016, month: 1, day: 5 });
  assert.equal(normalizeGameDate("-218-03-01"), "-0218-03-01");
  assert.equal(normalizeGameDate("2016-1-5"), "2016-01-05");
});

test("rejects year zero, impossible days and prose dates", () => {
  assert.equal(parseGameDate("0000-01-01"), null);
  assert.equal(parseGameDate("2016-02-30"), null);
  assert.equal(parseGameDate("1200 BCE"), null);
  assert.equal(parseGameDate("Third Age 3019"), null);
  assert.equal(parseGameDate(""), null);
  assert.equal(isGameDate("December 31, 2016"), false);
});

test("leap years follow the astronomical year, so 1 BC and 5 BC are leap years and 2 BC is not", () => {
  assert.equal(gameDateDaysInMonth(-1, 2), 29, "1 BC is astronomical year 0");
  assert.equal(gameDateDaysInMonth(-5, 2), 29, "5 BC is astronomical year -4");
  assert.equal(gameDateDaysInMonth(-2, 2), 28);
  assert.equal(gameDateDaysInMonth(2016, 2), 29);
  assert.equal(gameDateDaysInMonth(1900, 2), 28);
  assert.equal(parseGameDate("-0001-02-29")?.day, 29);
  assert.equal(parseGameDate("-0002-02-29"), null);
});

test("stepping by days crosses the BC/AD boundary with no year zero", () => {
  assert.equal(addGameDays("-0001-12-31", 1), "0001-01-01");
  assert.equal(addGameDays("0001-01-01", -1), "-0001-12-31");
  assert.equal(addGameDays("-0218-03-01", 30), "-0218-03-31");
  // 217 BC is astronomical -216, a leap year: the 365th day is its 29 February.
  assert.equal(addGameDays("-0218-03-01", 365), "-0217-02-29");
  assert.equal(addGameDays("-0218-03-01", 366), "-0217-03-01");
  assert.equal(addGameDays("2016-01-01", 30), "2016-01-31");
  assert.equal(addGameDays("2016-01-01", 0.25), "2016-01-01", "a six-hour skip stays on the day");
  assert.equal(addGameDays("1200 BCE", 30), "");
});

test("differences and comparisons follow the calendar, not the text", () => {
  assert.equal(diffGameDays("-0218-03-01", "-0218-03-31"), 30);
  assert.equal(diffGameDays("-0001-12-31", "0001-01-01"), 1);
  assert.equal(diffGameDays("2016-01-31", "2016-01-01"), -30);
  assert.equal(diffGameDays("2016-01-01", "soon"), null);
  const order = ["2016-01-01", "-0300-01-01", "0001-01-01", "-0218-03-01", "-0001-12-31", "-218-03-02"]
    .sort(compareGameDates);
  assert.deepEqual(order, ["-0300-01-01", "-0218-03-01", "-218-03-02", "-0001-12-31", "0001-01-01", "2016-01-01"]);
  assert.equal(compareGameDates("-0218-03-01", "-218-03-01"), 0, "spellings of one day are equal");
  assert.deepEqual(["Undated", "2016-01-01", "-0218-03-01"].sort(compareGameDates), ["-0218-03-01", "2016-01-01", "Undated"], "non-dates sort last");
});

test("newest first runs the calendar backwards and still puts the undated last", () => {
  const order = ["Undated", "-0218-12-20", "", "-0217-01-15", "2016-01-01"].sort(compareGameDatesNewestFirst);
  assert.deepEqual(order, ["2016-01-01", "-0217-01-15", "-0218-12-20", "Undated", ""]);
});

test("calendar months and years step over the missing year zero", () => {
  assert.equal(addGameMonths("-0001-11-15", 3), "0001-02-15");
  assert.equal(addGameMonths("2016-01-31", 1), "2016-02-29", "the day clamps into the month");
  assert.equal(shiftGameYear(-1, 1), 1);
  assert.equal(shiftGameYear(1, -1), -1);
  assert.equal(shiftGameYear(-218, 1), -217);
  assert.equal(gameDateYear("-0218-03-01"), -218);
});

test("reads as a date a person would write, with BC spelled out", () => {
  assert.equal(formatGameDateReadable("-0218-03-01", "D MMMM YYYY"), "1 March 218 BC");
  assert.equal(formatGameDateReadable("-0218-03-01", "MMMM Do, YYYY"), "March 1st, 218 BC");
  assert.equal(formatGameDateReadable("-0218-03-22", "M/D/YYYY"), "3/22/218 BC");
  assert.equal(formatGameDateReadable("2016-01-31", "MMM D, YYYY"), "Jan 31, 2016");
  assert.equal(formatGameDateReadable("0044-03-15", "MMMM Do, YYYY"), "March 15th, 44");
  assert.equal(formatGameDateReadable("1200 BCE"), "", "prose dates are left to the caller");
});

test("a canonical game date is the stored spelling, BC included", () => {
  assert.equal(isCanonicalGameDate("-0218-03-01"), true);
  assert.equal(isCanonicalGameDate("2014-04-21"), true);
  assert.equal(isCanonicalGameDate("-218-03-01"), false, "unpadded");
  assert.equal(isCanonicalGameDate("0218-03-01 BC"), false, "era word");
  assert.equal(isCanonicalGameDate("2014-02-30"), false, "no such day");
  assert.equal(isCanonicalGameDate(""), false);
});

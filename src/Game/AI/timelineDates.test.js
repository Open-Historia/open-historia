/*! Open Historia — time-skip timeline date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/timelineDates.test.js
//
// validateTimelineDates decides whether a skip's strict answer is re-asked (a
// wasted request when it is wrong); clampTimelineDates is the final attempt's
// salvage. Both must order dates by the calendar, BC years included, and so
// must validatePregameEvents, which does both for the pre-game backstory.

import assert from "node:assert/strict";
import test from "node:test";

import { clampTimelineDates, validatePregameEvents, validateTimelineDates } from "./timelineDates.js";

const events = (...dates) => dates.map((date, index) => ({ date, title: `Event ${index + 1}` }));

test("BC dates are ordered by the calendar, not as text", () => {
  const originDate = "-0300-01-01";
  const targetDate = "-0218-01-01";
  assert.equal(validateTimelineDates({
    candidate: { stopDate: targetDate, events: events("-0250-05-01", "-0219-12-31", "-0218-01-01") },
    mode: "fixed", originDate, targetDate,
  }), "");
  // "-0200" sorts before "-0218" as text, but 200 BC is after the stop date.
  assert.match(validateTimelineDates({
    candidate: { stopDate: targetDate, events: events("-0200-01-01") },
    mode: "fixed", originDate, targetDate,
  }), /^\$\.events\[0\]\.date must be on or after -0300-01-01 and no later than -0218-01-01\.$/);
  // "-0301" sorts after "-0300" as text, but 301 BC is before the origin.
  assert.match(validateTimelineDates({
    candidate: { stopDate: targetDate, events: events("-0301-06-01") },
    mode: "fixed", originDate, targetDate,
  }), /events\[0\]\.date must be on or after/);
  assert.match(validateTimelineDates({
    candidate: { stopDate: targetDate, events: events("-0220-01-01", "-0250-01-01") },
    mode: "fixed", originDate, targetDate,
  }), /events\[1\]\.date must not precede the previous event date/);
});

test("an event dated on the origin is accepted, even on a 1-day jump", () => {
  assert.equal(validateTimelineDates({
    candidate: { stopDate: "2015-01-15", events: events("2015-01-14", "2015-01-15") },
    mode: "fixed", originDate: "2015-01-14", targetDate: "2015-01-15",
  }), "");
  assert.match(validateTimelineDates({
    candidate: { stopDate: "2015-01-15", events: events("2015-01-13") },
    mode: "fixed", originDate: "2015-01-14", targetDate: "2015-01-15",
  }), /events\[0\]\.date must be on or after 2015-01-14/);
});

test("fixed mode requires the stop date to be the target", () => {
  assert.match(validateTimelineDates({
    candidate: { stopDate: "2015-01-20", events: [] },
    mode: "fixed", originDate: "2015-01-01", targetDate: "2015-01-31",
  }), /stopDate must equal the requested target date 2015-01-31/);
  assert.match(validateTimelineDates({
    candidate: { stopDate: "", events: [] },
    mode: "fixed", originDate: "2015-01-01", targetDate: "2015-01-31",
  }), /received an empty value/);
  assert.match(validateTimelineDates({
    candidate: { stopDate: "2015-02-30", events: [] },
    mode: "fixed", originDate: "2015-01-01", targetDate: "2015-01-31",
  }), /stopDate must be a real date/);
});

test("auto mode takes any stop date after the origin and not past the target", () => {
  const base = { mode: "auto", originDate: "2015-01-01", targetDate: "2015-12-31" };
  assert.equal(validateTimelineDates({ ...base, candidate: { stopDate: "2015-06-01", events: events("2015-03-01") } }), "");
  assert.equal(validateTimelineDates({ ...base, candidate: { stopDate: "2015-12-31", events: [] } }), "");
  assert.match(validateTimelineDates({ ...base, candidate: { stopDate: "2016-01-01", events: [] } }),
    /stopDate must be after 2015-01-01 and no later than 2015-12-31/);
  assert.match(validateTimelineDates({ ...base, candidate: { stopDate: "2015-01-01", events: [] } }),
    /stopDate must be after 2015-01-01/);
  assert.match(validateTimelineDates({ ...base, candidate: { stopDate: "2015-06-01", events: events("2015-07-01") } }),
    /no later than 2015-06-01/);
});

test("a prose-dated scenario is lenient but rejects a stuck clock when an advance is required", () => {
  const originDate = "Third Age 3019, March 1";
  assert.equal(validateTimelineDates({
    candidate: { stopDate: "Third Age 3019, March 8", events: events("March 3", "March 8") },
    mode: "fixed", originDate, targetDate: "",
  }), "");
  assert.equal(validateTimelineDates({
    candidate: { stopDate: originDate, events: [] },
    mode: "fixed", originDate, targetDate: "",
  }), "", "no advance was asked for");
  assert.match(validateTimelineDates({
    candidate: { stopDate: originDate, events: [] },
    mode: "fixed", originDate, targetDate: "", requireAdvance: true,
  }), /stopDate must move time forward - it must not equal the current date Third Age 3019, March 1\./);
  assert.match(validateTimelineDates({
    candidate: { stopDate: "3019-02-30", events: [] },
    mode: "fixed", originDate, targetDate: "",
  }), /^\$\.stopDate must be a real Gregorian date/);
  assert.match(validateTimelineDates({
    candidate: { stopDate: "3019-03-08", events: events("3019-03-09") },
    mode: "fixed", originDate, targetDate: "",
  }), /events\[0\]\.date must not be later than 3019-03-08/);
  assert.match(validateTimelineDates({
    candidate: { stopDate: "3019-03-08", events: events("March 3") },
    mode: "fixed", originDate, targetDate: "",
  }), /events\[0\]\.date must use the same YYYY-MM-DD format/);
});

test("the salvage clamp pulls strays into the window, keeps order and never touches content", () => {
  const candidate = {
    stopDate: "2015-02-10",
    events: [
      { date: "2014-12-25", title: "Too early", description: "kept" },
      { date: "2015-01-20", title: "In window" },
      { date: "sometime", title: "No date" },
      { date: "2015-01-05", title: "Out of order" },
      { date: "2015-03-01", title: "Too late" },
    ],
  };
  clampTimelineDates(candidate, { mode: "fixed", originDate: "2015-01-01", targetDate: "2015-01-31" });
  assert.equal(candidate.stopDate, "2015-01-31");
  assert.deepEqual(candidate.events.map((event) => event.date),
    ["2015-01-01", "2015-01-20", "2015-01-31", "2015-01-31", "2015-01-31"]);
  assert.deepEqual(candidate.events.map((event) => event.title),
    ["Too early", "In window", "No date", "Out of order", "Too late"]);
  assert.equal(candidate.events[0].description, "kept");
  assert.equal(validateTimelineDates({ candidate, mode: "fixed", originDate: "2015-01-01", targetDate: "2015-01-31" }), "");
});

test("the clamp keeps a good auto stop date, replaces a bad one, and works in BC years", () => {
  const good = { stopDate: "2015-06-01", events: events("2015-07-01") };
  clampTimelineDates(good, { mode: "auto", originDate: "2015-01-01", targetDate: "2015-12-31" });
  assert.equal(good.stopDate, "2015-06-01");
  assert.equal(good.events[0].date, "2015-06-01");

  const bad = { stopDate: "2014-01-01", events: [] };
  clampTimelineDates(bad, { mode: "auto", originDate: "2015-01-01", targetDate: "2015-12-31" });
  assert.equal(bad.stopDate, "2015-12-31");

  const bc = { stopDate: "-0218-01-01", events: events("-0200-01-01", "-0301-01-01") };
  clampTimelineDates(bc, { mode: "fixed", originDate: "-0300-01-01", targetDate: "-0218-01-01" });
  assert.deepEqual(bc.events.map((event) => event.date), ["-0218-01-01", "-0218-01-01"]);
});

test("the clamp leaves a prose-dated answer alone", () => {
  const candidate = { stopDate: "Spring", events: events("Winter") };
  clampTimelineDates(candidate, { mode: "fixed", originDate: "Third Age 3019", targetDate: "" });
  assert.deepEqual(candidate, { stopDate: "Spring", events: events("Winter") });
});

test("pre-game history must sit before the start date, BC years included", () => {
  const startDate = "-0218-01-01";
  assert.equal(validatePregameEvents({ events: events("-0300-06-01", "-0250-01-01", "-0219-12-31") }, { startDate, strict: true }), "");
  // "-0200" sorts before "-0218" as text, but 200 BC is after the start.
  assert.match(validatePregameEvents({ events: events("-0200-01-01") }, { startDate, strict: true }),
    /^\$\.events\[0\]\.date must be strictly before the game start date -0218-01-01/);
  assert.match(validatePregameEvents({ events: events("-0218-01-01") }, { startDate, strict: true }),
    /events\[0\]\.date must be strictly before/, "the start date itself is round one, not backstory");
  assert.match(validatePregameEvents({ events: events("-0250-01-01", "-0300-01-01") }, { startDate, strict: true }),
    /events\[1\]\.date must not be earlier than the previous event/);
  assert.match(validatePregameEvents({ events: events("long ago") }, { startDate, strict: true }),
    /events\[0\]\.date must be a real YYYY-MM-DD date/);
  assert.equal(validatePregameEvents({ events: [] }, { startDate, strict: true }), "$.events must contain at least one pre-game event.");
});

test("the pre-game salvage drops what cannot be placed and orders the rest", () => {
  const candidate = {
    events: [
      { date: "1913-05-01", title: "Later" },
      { date: "1914-08-01", title: "On the start date" },
      { date: "someday", title: "Undated" },
      { date: "1912-10-08", title: "Earlier" },
      { date: "1920-01-01", title: "After the start" },
    ],
  };
  assert.equal(validatePregameEvents(candidate, { startDate: "1914-08-01", strict: false }), "");
  assert.deepEqual(candidate.events.map((event) => event.title), ["Earlier", "Later"]);
});

test("a prose-dated scenario's backstory is taken at its word", () => {
  const candidate = { events: events("The Second Age", "Year of the Long Winter") };
  assert.equal(validatePregameEvents(candidate, { startDate: "1200 BCE", strict: true }), "");
  assert.equal(validatePregameEvents(candidate, { startDate: "1200 BCE", strict: false }), "");
  assert.deepEqual(candidate.events.map((event) => event.date), ["The Second Age", "Year of the Long Winter"]);
  assert.equal(validatePregameEvents({ events: [] }, { startDate: "1200 BCE", strict: false }), "$.events must contain at least one pre-game event.");
});

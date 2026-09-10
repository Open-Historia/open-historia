/*! Open Historia — time-skip landing date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/jumpDates.test.js
//
// The timeline's buttons and its custom row say where a skip will land; the
// jump then moves the date. Both go through jumpTargetDate, so the label is the
// date the turn actually reaches. gameplay.js and time.jsx cannot be imported
// under node --test, so the last test checks their source instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { jumpDayStep, jumpTargetDate } from "./jumpDates.js";

test("a skip moves the date by whole days counted, not by calendar months", () => {
  assert.equal(jumpTargetDate("2015-01-01", 30), "2015-01-31", "1 month is 30 days");
  assert.equal(jumpTargetDate("2015-01-01", 180), "2015-06-30");
  assert.equal(jumpTargetDate("2016-01-01", 180), "2016-06-29", "leap year");
  assert.equal(jumpTargetDate("2016-01-01", 365), "2016-12-31", "leap year");
  assert.equal(jumpTargetDate("2015-01-01", 31), "2015-02-01", "the reporter's custom jump (#718)");
});

test("a part-day skip rounds the way the jump does, not down", () => {
  // The custom row used to truncate: 12 hours read as today while the jump
  // moved the date to tomorrow, and 36 hours read one day on and moved two.
  assert.equal(jumpTargetDate("2016-01-01", 6 / 24), "2016-01-01", "6 hours keeps the date");
  assert.equal(jumpTargetDate("2016-01-01", 12 / 24), "2016-01-02", "12 hours is tomorrow");
  assert.equal(jumpTargetDate("2016-01-01", 36 / 24), "2016-01-03", "36 hours is two days on");
  assert.equal(jumpDayStep(0.49), 0);
  assert.equal(jumpDayStep(0.5), 1);
  assert.equal(jumpDayStep(-3), 0);
  assert.equal(jumpDayStep("not a number"), 0);
});

test("BC dates step like any other, across the missing year zero", () => {
  assert.equal(jumpTargetDate("-0218-03-01", 30), "-0218-03-31");
  assert.equal(jumpTargetDate("-0001-12-31", 1), "0001-01-01", "1 BC is followed by AD 1");
});

test("a date the arithmetic cannot move comes back unchanged", () => {
  assert.equal(jumpTargetDate("not a date", 30), "not a date");
  assert.equal(jumpTargetDate("", 30), "");
  assert.equal(jumpTargetDate("2016-01-01", 0), "2016-01-01");
});

test("the jump, the preset labels and the custom row all use jumpTargetDate", () => {
  const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

  const gameplay = read("../Game/AI/gameplay.js");
  assert.match(gameplay, /const targetDate = jumpTargetDate\(originDate, safeDays\);/);

  const time = read("../Game/GameUI/time.jsx");
  const label = /const jumpLandingLabel = [\s\S]*?;\r?\n/.exec(time)?.[0] ?? "";
  assert.match(label, /jumpTargetDate\(from, days\)/, "the label goes through the jump's rule");
  assert.doesNotMatch(label, /addGameDays|Math\.trunc/, "not a second, truncating copy of it");

  const options = /const jumpOptions = \[[\s\S]*?\];/.exec(time)?.[0] ?? "";
  assert.ok(options.includes("jumpLandingLabel(currentDate, 30)"), "found the preset list");
  assert.doesNotMatch(options, /\.add\(/, "no preset computes its own date");

  const custom = /const customLanding = [\s\S]*?;/.exec(time)?.[0] ?? "";
  assert.ok(custom.includes("jumpLandingLabel(currentDate, customDays)"), "the custom row uses the same label");
});

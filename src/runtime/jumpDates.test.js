/*! Open Historia — time-skip landing date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/jumpDates.test.js
//
// Issue #718. The timeline's buttons printed calendar arithmetic while the jump
// added a fixed day count, so "1 month" promised 2/1 and delivered 1/31. Both
// now come from jumpTargetDate. These pin the rule, and the last test pins that
// both callers actually use it — the drift between them WAS the bug.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { addIsoDays, jumpDayStep, jumpTargetDate, parseIsoDate } from "./jumpDates.js";

test("each preset lands where the jump goes, not where a calendar month ends", () => {
  // The labels main printed before, for contrast: 2/1, 7/1, 1/1/2017 and 6/1.
  assert.equal(jumpTargetDate("2015-01-01", 30), "2015-01-31"); // "1 month"
  assert.equal(jumpTargetDate("2015-01-01", 180), "2015-06-30"); // "6 months"
  assert.equal(jumpTargetDate("2016-01-01", 180), "2016-06-29"); // "6 months", leap year
  assert.equal(jumpTargetDate("2016-01-01", 365), "2016-12-31"); // "1 year", leap year
  assert.equal(jumpTargetDate("2015-01-01", 365), "2016-01-01");
  assert.equal(jumpTargetDate("2015-03-01", 90), "2015-05-30"); // "3 months" from 1 March
});

test("the reporter's custom jump: 31 days from 1 January lands on 1 February", () => {
  assert.equal(jumpTargetDate("2015-01-01", 31), "2015-02-01");
});

test("sub-day skips keep the date; the rest round the way the jump always has", () => {
  assert.equal(jumpDayStep(0.25), 0);
  assert.equal(jumpTargetDate("2015-01-01", 0.25), "2015-01-01"); // "6 hours"
  assert.equal(jumpDayStep(0.5), 1, "12 hours rounds to a day — existing behaviour, pinned, not changed");
  assert.equal(jumpTargetDate("2015-01-01", 1.4), "2015-01-02");
  assert.equal(jumpDayStep(-3), 0);
  assert.equal(jumpDayStep("abc"), 0);
});

test("an origin that is not a real date comes back unchanged, as the jump leaves it", () => {
  assert.equal(jumpTargetDate("1200 BCE", 30), "1200 BCE");
  assert.equal(jumpTargetDate("2015-02-30", 30), "2015-02-30");
  assert.equal(parseIsoDate("2015-02-30"), null);
  assert.equal(addIsoDays("2015-12-31", 1), "2016-01-01");
  assert.equal(addIsoDays("9999-12-31", 1), "", "past the supported range");
});

test("the jump and the timeline buttons both use jumpTargetDate", () => {
  // gameplay.js cannot be imported under node --test, so this reads the source.
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const gameplay = read("../Game/AI/gameplay.js");
  const time = read("../Game/GameUI/time.jsx");

  assert.match(gameplay, /const targetDate = jumpTargetDate\(originDate, safeDays\);/, "the jump computes its own target again");
  assert.doesNotMatch(gameplay, /const addIsoDays = /, "a second copy of the day arithmetic is back in gameplay.js");

  assert.match(time, /const jumpLandingLabel = \(from, days\) => dayjs\(jumpTargetDate\(from, days\)\)/);
  const optionsAt = time.indexOf("const jumpOptions = [");
  assert.notEqual(optionsAt, -1, "the timeline's preset list moved");
  const options = time.slice(optionsAt, time.indexOf("];", optionsAt));
  assert.match(options, /jumpLandingLabel\(currentDate, 30\)/);
  assert.doesNotMatch(options, /\.add\(/, "a preset label is using its own calendar arithmetic again");
});

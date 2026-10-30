/*! Open Historia — the day a troop order is given on: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontOrderDate.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { dayOfPeriod, readGivenOrders } from "./frontOrderFunction.js";

const period = { fromDate: "0354-02-12", days: 7 };

test("an order's date is its day of the period, whatever millennium the model wrote (2354 for 0354, a Discord test game)", () => {
  assert.deepEqual(dayOfPeriod("0354-02-13", period), { date: "0354-02-13", day: 1 });
  assert.deepEqual(dayOfPeriod("2354-02-13", period), { date: "0354-02-13", day: 1 });
  assert.deepEqual(dayOfPeriod("354-02-13", period), { date: "0354-02-13", day: 1 });
  assert.deepEqual(dayOfPeriod("0354-02-18", period), { date: "0354-02-18", day: 6 });
});

test("a date no day of the period matches, or none, is the period's first day; a period past New Year reads the next year", () => {
  assert.deepEqual(dayOfPeriod("", period), { date: "0354-02-12", day: 0 });
  assert.deepEqual(dayOfPeriod("2354-05-01", period), { date: "0354-02-12", day: 0 });
  assert.deepEqual(dayOfPeriod("0354-02-19", period), { date: "0354-02-12", day: 0 }, "the day after the period is not in it");
  assert.deepEqual(dayOfPeriod("1355-01-02", { fromDate: "0354-12-29", days: 7 }), { date: "0355-01-02", day: 4 });
});

test("the order Sonnet gave in that game is read on the day it meant", () => {
  const { given } = readGivenOrders("Yarrowfield Forest~Hill Kingdom~reinforce~centre~2354-02-13~4", { ...period, players: ["Hill Kingdom"] });
  assert.equal(given.length, 1);
  assert.equal(given[0].date, "0354-02-13");
  assert.equal(given[0].day, 1);
});

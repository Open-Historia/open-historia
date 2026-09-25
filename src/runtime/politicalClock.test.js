import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPoliticalClockPlan,
  MAX_POLITICAL_RESPONSE_TICKS_PER_ADVANCE,
  normalizePoliticalSimulationClock,
  politicalDaysBetween,
} from "./politicalClock.js";

test("political clock accumulates short jumps until a monthly response tick is due", () => {
  const first = buildPoliticalClockPlan({
    clock: {},
    fromDate: "2014-03-22",
    toDate: "2014-04-05",
    round: 2,
  });
  assert.equal(first.responseTicks, 0);
  assert.ok(first.nextClock.responseRemainderMonths > 0);

  const second = buildPoliticalClockPlan({
    clock: first.nextClock,
    fromDate: "2014-04-05",
    toDate: "2014-04-25",
    round: 3,
  });
  assert.equal(second.responseTicks, 1);
  assert.ok(second.nextClock.responseRemainderMonths < 1);
});

test("political clock catches up from the last successful processed date", () => {
  const plan = buildPoliticalClockPlan({
    clock: { lastProcessedDate: "2014-01-01", responseRemainderMonths: 0 },
    fromDate: "2014-03-01",
    toDate: "2014-04-01",
    round: 5,
  });
  assert.equal(plan.effectiveFromDate, "2014-01-01");
  assert.ok(plan.elapsedMonths > 2.9);
  assert.ok(plan.responseTicks >= 2);
});

test("political clock bounds response work on very large scenario jumps", () => {
  const plan = buildPoliticalClockPlan({
    clock: {},
    fromDate: "1867-01-01",
    toDate: "2067-01-01",
    round: 2,
  });
  assert.equal(plan.responseTicks, MAX_POLITICAL_RESPONSE_TICKS_PER_ADVANCE);
  assert.ok(plan.droppedResponseTicks > 1000);
  assert.equal(plan.nextClock.lastProcessedDate, "2067-01-01");
});

test("political date math works for historical and future four-digit scenario years", () => {
  assert.equal(politicalDaysBetween("1066-01-01", "1066-02-01"), 31);
  assert.equal(politicalDaysBetween("2067-01-01", "2067-02-01"), 31);
  assert.deepEqual(normalizePoliticalSimulationClock({ responseRemainderMonths: 42 }), {
    schemaVersion: 1,
    responseRemainderMonths: 0.9999,
  });
});

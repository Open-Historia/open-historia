import test from "node:test";
import assert from "node:assert/strict";

import { sortTimelineEventsChronologically } from "../src/runtime/timelineOrder.js";

test("mechanical timeline ordering sorts valid model events without changing their content", () => {
  const candidate = {
    events: [
      { date: "2020-03-12", title: "C" },
      { date: "2020-03-04", title: "A" },
      { date: "2020-03-08", title: "B" },
    ],
  };

  assert.equal(sortTimelineEventsChronologically(candidate), true);
  assert.deepEqual(candidate.events.map((event) => event.title), ["A", "B", "C"]);
});

test("mechanical ordering leaves malformed dates for the real validator instead of hiding them", () => {
  const candidate = {
    events: [
      { date: "2020-02-31", title: "bad" },
      { date: "2020-02-20", title: "good" },
    ],
  };

  assert.equal(sortTimelineEventsChronologically(candidate), false);
  assert.deepEqual(candidate.events.map((event) => event.title), ["bad", "good"]);
});

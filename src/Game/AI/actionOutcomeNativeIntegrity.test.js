/*! Open Historia — queued-order outcome native-integrity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { screenGeneratedWorldEvents } from "./nativeWorldIntegrity.js";

const routinePatrol = (actionIds = []) => ({
  id: "routine-patrol",
  date: "1914-09-01",
  title: "Reconnaissance patrols continue along the frontier",
  description: "Reconnaissance patrols continue without a major engagement.",
  impacts: { actionIds },
});

test("routine military screening cannot hide the retained event that explicitly answers a queued Action", () => {
  const event = routinePatrol(["order-frontier-patrol"]);
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
  assert.deepEqual(screened.dropped, []);
});

test("ordinary routine military continuation remains eligible to stay off the timeline", () => {
  const event = routinePatrol();
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, []);
  assert.equal(screened.hidden.length, 1);
  assert.equal(screened.hidden[0].route, "ROUTINE_MILITARY_PRECURATION");
});

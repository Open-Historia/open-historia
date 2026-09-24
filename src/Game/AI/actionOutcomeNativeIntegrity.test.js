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

// From a player's log: a Project milestone that mentions a patrol vessel in
// passing is not a routine patrol card.
test("a milestone that mentions patrol vessels in passing stays on the timeline", () => {
  const event = {
    id: "helios-autonomy",
    date: "2019-07-01",
    kind: "world",
    playerRelated: false,
    title: "Imperial Research Directorate Evaluates Project Helios and Autonomy Status",
    description: "Imperial science boards at Culham reported stable secondary magnetic confinement for Project Helios, while Project Autonomy completed initial basin trials for unmanned surface patrol vessels despite lingering supply bottlenecks.",
    impacts: {},
  };
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
});

test("the player's own patrol news is left for the curator to judge", () => {
  const event = { ...routinePatrol(), kind: "player", playerRelated: true };
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
});

test("a quiet inspection report that mentions patrols is still kept off the timeline", () => {
  const screened = screenGeneratedWorldEvents({
    events: [{
      id: "omani-audit",
      date: "2019-08-27",
      kind: "world",
      playerRelated: false,
      title: "Omani Auditing Panel Reports Continued Compliance in Strait of Hormuz",
      description: "The Omani-chaired maritime auditing panel released its weekly inspection summary in Muscat, confirming zero non-compliance infractions across commercial tanker traffic through the Strait of Hormuz amid ongoing regional naval patrols.",
      impacts: {},
    }],
  });
  assert.equal(screened.events.length, 0);
  assert.equal(screened.hidden[0].route, "ROUTINE_MILITARY_PRECURATION");
});

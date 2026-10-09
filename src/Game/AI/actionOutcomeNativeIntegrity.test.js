/*! Open Historia — queued-order outcome native-integrity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { previewScreenedEvent, screenGeneratedWorldEvents } from "./nativeWorldIntegrity.js";

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

// In a real world the screen can tell who acted from an event's title, and
// then it keeps only the citations of orders still queued. It must be given
// the turn's orders for that, or it takes every citation away.
const world = {
  polityOverrides: {
    Ukraine: { code: "Ukraine", name: "Ukraine", status: "active" },
    Japan: { code: "Japan", name: "Japan", status: "active" },
  },
};
const game = { country: "United States of America", gameDate: "2014-04-21" };
const order = (id, text, status = "planned") => ({ id, kind: "action", status, title: text, text, rawInput: text });
const javelins = order("order-javelins", "Send Javelin anti-tank missiles to Ukraine.");
const patrols = order("order-patrols", "Ask Japan to join reconnaissance patrols in the East China Sea.");
const answer = (title, description, actionIds) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  date: "2014-04-26",
  title,
  description,
  importance: "major",
  playerRelated: true,
  impacts: { actionIds },
});
const shipment = () => answer(
  "Ukraine receives the first American Javelin shipment",
  "The first consignment of US Javelin anti-tank missiles reaches Kyiv under Washington's new aid package.",
  ["order-javelins"],
);
const jointPatrols = () => answer(
  "Japan joins reconnaissance patrols in the East China Sea",
  "Japanese maritime aircraft fly reconnaissance patrols alongside American crews, as Washington asked.",
  ["order-patrols"],
);

test("an order's answer keeps its citation when the screen can tell another country acted", () => {
  const screened = screenGeneratedWorldEvents({ events: [shipment()], world, game, actions: [javelins, patrols] });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.events[0].impacts.actionIds, ["order-javelins"]);
});

test("a cited patrol stays on the timeline in a world that knows who patrols", () => {
  const screened = screenGeneratedWorldEvents({ events: [jointPatrols()], world, game, actions: [javelins, patrols] });
  assert.deepEqual(screened.hidden, []);
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.events[0].impacts.actionIds, ["order-patrols"]);
});

test("a citation of an order no longer queued is still taken away", () => {
  const screened = screenGeneratedWorldEvents({
    events: [shipment()],
    world,
    game,
    actions: [order("order-javelins", "Send Javelin anti-tank missiles to Ukraine.", "done")],
  });
  assert.deepEqual(screened.events[0].impacts.actionIds, []);
});

test("every screen of a turn's events in the jump is given the turn's orders and chats", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const calls = [...source.matchAll(/screenGeneratedWorldEvents\(\{([\s\S]*?)\}\);/g)];
  const segmentCalls = [...source.matchAll(/screenSegmentPayload\(payload, \{([\s\S]*?)\}\);/g)];
  assert.ok(calls.length >= 2 && segmentCalls.length >= 1, "the jump's screens moved; update this test");
  for (const [, args] of [...calls, ...segmentCalls]) {
    assert.match(args, /\bactions\b/);
    // A player's own chat message is what authorizes a treaty they agreed.
    assert.match(args, /\bchats\b/);
  }
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

// Regression corpus from a community live playthrough: civilian/scientific
// events must not disappear merely because their article mentions military-style
// vocabulary such as reconnaissance or patrols in passing.
test("a lunar science milestone cannot be hidden as routine military activity", () => {
  const event = {
    id: "change-4-far-side",
    date: "2019-01-03",
    kind: "world",
    playerRelated: false,
    title: "China's Chang'e-4 Achieves First-Ever Landing on Moon's Far Side",
    description: "The Chang'e-4 lander completed the historic lunar mission and began scientific reconnaissance of the far-side terrain.",
    impacts: {},
  };
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
});

test("civilian protest news cannot be hidden because security patrols appear in the article", () => {
  const event = {
    id: "nationwide-protests",
    date: "2019-04-11",
    kind: "world",
    playerRelated: false,
    title: "Nationwide Anti-Government Protests Erupt Across Major Cities",
    description: "Large civilian demonstrations spread through major cities while police increased security patrols around government buildings.",
    impacts: {},
  };
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
});

// The live preview marks a streamed card with the rule that will judge it when
// the turn lands, and changes nothing about the event it looks at.
test("the live preview gives a streamed card the screen's own verdict", () => {
  const patrol = routinePatrol();
  const before = structuredClone(patrol);
  assert.deepEqual(previewScreenedEvent(patrol), {
    fate: "hide",
    route: "ROUTINE_MILITARY_PRECURATION",
    reason: "routine military continuation with no native material consequence",
  });
  assert.deepEqual(patrol, before);
  assert.equal(previewScreenedEvent(routinePatrol(["order-frontier-patrol"])), null);
  assert.equal(previewScreenedEvent(null), null);
});

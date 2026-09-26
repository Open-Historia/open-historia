/*! Open Historia — queued-order outcome native-integrity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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

test("every screen of a turn's events in the jump is given the turn's orders", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const calls = [...source.matchAll(/screenGeneratedWorldEvents\(\{([\s\S]*?)\}\);/g)];
  const segmentCalls = [...source.matchAll(/screenSegmentPayload\(payload, \{([\s\S]*?)\}\);/g)];
  assert.ok(calls.length >= 2 && segmentCalls.length >= 1, "the jump's screens moved; update this test");
  for (const [, args] of [...calls, ...segmentCalls]) assert.match(args, /\bactions\b/);
});

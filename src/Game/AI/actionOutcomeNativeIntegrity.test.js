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
  // The game hands the screen the turn's queued orders (every screen of a jump
  // is given them, below): a citation stands while its order is queued.
  const screened = screenGeneratedWorldEvents({ events: [event], actions: [{ id: "order-frontier-patrol", status: "planned" }] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
  assert.deepEqual(screened.dropped, []);
});

// The screen hid an English patrol card for its words (ROUTINE_MILITARY_CUE_RE)
// and kept the same card in any other language. No word list reads an event for
// the war any more: the skip is told to leave such a card out, and the curator
// judges what it writes anyway.
test("an ordinary patrol report is kept as written, as its twin in another language is", () => {
  const twin = {
    ...routinePatrol(),
    id: "routine-patrol-de",
    title: "Aufklärungspatrouillen entlang der Grenze gehen weiter",
    description: "Die Aufklärungspatrouillen gehen ohne größeres Gefecht weiter.",
  };
  for (const event of [routinePatrol(), twin]) {
    const screened = screenGeneratedWorldEvents({ events: [event] });
    assert.deepEqual(screened.events, [event]);
    assert.deepEqual(screened.hidden, []);
  }
});

// The screen keeps only the citations of orders still queued, by their exact
// ids. It must be given the turn's orders for that, or it takes every citation
// away.
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

test("an inspection report that mentions patrols is not taken for military news", () => {
  const event = {
    id: "omani-audit",
    date: "2019-08-27",
    kind: "world",
    playerRelated: false,
    title: "Omani Auditing Panel Reports Continued Compliance in Strait of Hormuz",
    description: "The Omani-chaired maritime auditing panel released its weekly inspection summary in Muscat, confirming zero non-compliance infractions across commercial tanker traffic through the Strait of Hormuz amid ongoing regional naval patrols.",
    impacts: {},
  };
  const screened = screenGeneratedWorldEvents({ events: [event] });
  assert.deepEqual(screened.events, [event]);
  assert.deepEqual(screened.hidden, []);
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

// The screen hid an English administrative card (ROUTINE_ADMINISTRATIVE_CUE_RE)
// and the live preview marked it as it streamed in; its twin in any other
// language was kept. The skip is told to write no filler and that nothing takes
// it off the timeline afterwards, so the screen keeps what it writes, and the
// preview marks only a word-for-word repeat of the record.
test("an administrative card is kept as written, as its twin in another language is", () => {
  for (const [title, description] of [
    ["Ministry Finalizes Technical Inspection Standards", "Officials finalize technical inspection standards after a committee review."],
    ["Ministerstwo zatwierdza techniczne normy inspekcji", "Urzędnicy zatwierdzają techniczne normy inspekcji po przeglądzie komisji."],
  ]) {
    const review = { id: "inspection-review", date: "2019-10-12", title, description, impacts: {} };
    const screened = screenGeneratedWorldEvents({ events: [review] });
    assert.deepEqual(screened.events, [review]);
    assert.deepEqual(screened.hidden, []);
  }
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const preview = source.slice(source.indexOf("const markStreamedEvents = "), source.indexOf("const filedEventsFromRows = "));
  assert.ok(preview.includes("EXACT_DUPLICATE") && !preview.includes("previewScreenedEvent"));
});

// A Game of Thrones skip hid "Rangers of the Night's Watch Burn Twenty-Two Wights
// Beside Whitetree" as routine military activity: rangers on patrol, nothing
// captured. Burning the dead destroys them; that is a consequence.
const rangerPatrol = (over = {}) => ({
  id: "rangers",
  date: "0298-09-22",
  kind: "world",
  playerRelated: false,
  title: "Rangers of the Night's Watch Burn Twenty-Two Wights Beside Whitetree",
  description: "A patrol of rangers from Castle Black came on twenty-two wights in the trees beside Whitetree and burned them where they lay, as Mance Rayder's host passed eleven hundred cookfires.",
  impacts: {},
  ...over,
});

test("an enemy burned or destroyed on patrol is not routine", () => {
  const screened = screenGeneratedWorldEvents({ events: [rangerPatrol()] });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.hidden, []);
});

test("an event that belongs to a storyline is not hidden as routine", () => {
  const quiet = rangerPatrol({
    title: "Rangers Patrol the Haunted Forest's Edge",
    description: "A patrol of rangers from Castle Black rode the edge of the Haunted Forest and reported the camps unchanged.",
  });
  assert.deepEqual(screenGeneratedWorldEvents({ events: [quiet] }).hidden, [], "nor on its own: no word hides it");
  const told = screenGeneratedWorldEvents({ events: [{ ...quiet, storylineIds: ["storyline-the-dead"] }] });
  assert.equal(told.events.length, 1);
  assert.deepEqual(told.hidden, []);
});

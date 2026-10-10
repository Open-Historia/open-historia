/*! Open Historia — the consequence signal reaches the main skip © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/worldConsequenceSignal.test.js
//
// The World Director measures whether recent history is "busy but toothless":
// many visible events, few that changed what anyone can do. It used to tell
// only the breadth repair — a request of its own, skipped while requests are
// saved (the default) — so free-key players got timelines of paperwork with no
// correction. It is now one line of the skip's own [What Is in Motion] block,
// which costs no request.

import test from "node:test";
import assert from "node:assert/strict";

import { buildWorldInitiativeContext } from "./nativeWorldDirector.js";

const ORIGIN = "2014-06-30";
const actors = ["France", "Germany"];

const bundleWith = (events) => ({
  game: { country: "France", gameDate: ORIGIN, round: 12 },
  events,
  chats: [],
  world: {
    polityOverrides: Object.fromEntries(actors.map((name) => [name, { name, code: name, aliases: [name], status: "active" }])),
    countryStats: Object.fromEntries(actors.map((name) => [name, {}])),
    regionOwnershipOverrides: { 1: "France", 2: "Germany" },
    regionClaimants: {},
    storylines: [],
    wars: [],
    relations: [],
    agreements: [],
    units: [],
    consolidatedHistory: [],
  },
});

const paperwork = (index) => ({
  id: `e-${index}`,
  date: `2014-06-${String(10 + index).padStart(2, "0")}`,
  title: `Ministry publishes consultation paper ${index}`,
  description: "A ministry opens a public consultation on procurement rules.",
  kind: "politics",
  impacts: {},
});

const LINE = /Recent history is busy but thin on real outcomes: 0 of the last 10 events in about 90 days/;

test("a busy but toothless recent history is named in the skip's own context", () => {
  const { text } = buildWorldInitiativeContext(bundleWith(Array.from({ length: 10 }, (_, index) => paperwork(index))), { targetDate: "2014-09-30" });
  assert.match(text, LINE);
  assert.match(text, /do not invent drama/);
  assert.ok(text.indexOf("Recent history is busy") > text.indexOf("Conflict risk in this world right now"), "beside the conflict-risk line");
});

test("history with real outcomes adds nothing", () => {
  const events = Array.from({ length: 10 }, (_, index) => ({
    ...paperwork(index),
    title: `Border region ${index} changes hands`,
    impacts: { regionTransfers: [{ regionId: "2", toCode: "France" }] },
  }));
  const { text } = buildWorldInitiativeContext(bundleWith(events), { targetDate: "2014-09-30" });
  assert.doesNotMatch(text, /Recent history is busy/);
});

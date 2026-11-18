/*! Open Historia — a peace or a treaty players make between rounds, told as an event: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/landings.test.js
//
// A peace two players made between rounds moved the borders on every map with
// no event and no word, and a treaty they signed appeared with none (the gap
// audit of 2026-11-18, G5 and N5). What landed is read from the world's own
// records, told as an event with the borders it moved, and put on the timeline.

import test from "node:test";
import assert from "node:assert/strict";

import { makePeace } from "../../Game/AI/warAndPeace.js";
import { TERRITORY_AS_HELD } from "../../runtime/peaceTerms.js";
import { answerTreaty, proposeTreaty } from "../../runtime/treatyOffers.js";
import { LANDING_SOURCE, bordersMoved, landingEvents, landingNotice, tellLandings, withLandingsOnTimeline } from "./landings.js";

const LATVIA = "Republic of Latvia";
const RUSSIA = "Russian Federation";
const ESTONIA = "Republic of Estonia";
const DATE = "2014-06-01";

// Russia holds two of Latvia's regions and Latvia one of Russia's; the war is between the two.
const atWar = () => ({
  wars: [{ id: "war-1", title: "The Baltic War", status: "active", sideA: [RUSSIA], sideB: [LATVIA], startedDate: "2014-03-01" }],
  regionOwnershipOverrides: { "reg-latgale": RUSSIA, "reg-vidzeme": RUSSIA, "reg-pskov": LATVIA, "reg-tallinn": ESTONIA },
  regionSovereigntyOverrides: { "reg-latgale": LATVIA, "reg-vidzeme": LATVIA, "reg-pskov": RUSSIA },
});

test("the borders that moved are read from who holds each region and whose it lawfully is", () => {
  const before = atWar();
  // Each keeps what it holds: title passes to the holder.
  const kept = { ...before, regionSovereigntyOverrides: {} };
  assert.deepEqual(bordersMoved(before, kept), {
    regionTransfers: [
      { regionId: "reg-latgale", fromCode: LATVIA, toCode: RUSSIA, basis: "treaty" },
      { regionId: "reg-vidzeme", fromCode: LATVIA, toCode: RUSSIA, basis: "treaty" },
      { regionId: "reg-pskov", fromCode: RUSSIA, toCode: LATVIA, basis: "treaty" },
    ],
    regionControlOps: [],
  });
  // Everything goes back: the occupier hands back what it held, under the same title.
  const restored = { ...before, regionOwnershipOverrides: { "reg-tallinn": ESTONIA }, regionSovereigntyOverrides: {} };
  const back = bordersMoved(before, restored, { ownerOf: (id) => ({ "reg-latgale": LATVIA, "reg-vidzeme": LATVIA, "reg-pskov": RUSSIA })[id] ?? "" });
  assert.deepEqual(back.regionTransfers, []);
  assert.deepEqual(back.regionControlOps.map((op) => [op.regionId, op.fromCode, op.toCode]), [
    ["reg-latgale", RUSSIA, LATVIA], ["reg-vidzeme", RUSSIA, LATVIA], ["reg-pskov", LATVIA, RUSSIA],
  ]);
  assert.deepEqual(bordersMoved(before, before), { regionTransfers: [], regionControlOps: [] }, "nothing moved, nothing told");
});

test("a peace made is told as one event naming its parties, with the borders it moved and its terms", () => {
  const before = atWar();
  const after = makePeace(before, { warId: "war-1", from: RUSSIA, to: LATVIA, terms: { territory: TERRITORY_AS_HELD }, date: DATE, round: 5, by: "offer", players: [RUSSIA, LATVIA] });
  assert.notEqual(after, before);
  const [event, ...more] = landingEvents(before, after, { date: DATE });
  assert.equal(more.length, 0);
  assert.match(event.id, /^landing-peace-treaty:war-1:/);
  assert.equal(event.title, `Peace between ${RUSSIA} and ${LATVIA}`);
  assert.match(event.description, /^The Baltic War is over\. Each side keeps the ground it holds; nobody pays reparations\.$/);
  assert.deepEqual(event.concerns, [RUSSIA, LATVIA]);
  assert.equal(event.warId, "war-1");
  assert.equal(event.source, LANDING_SOURCE);
  assert.deepEqual(event.impacts.regionTransfers.map((entry) => [entry.regionId, entry.toCode]).sort(), [["reg-latgale", RUSSIA], ["reg-pskov", LATVIA], ["reg-vidzeme", RUSSIA]]);
  assert.equal(landingNotice(event), `${RUSSIA} and ${LATVIA} have made peace.`);
});

test("a separate peace says the war goes on for the rest", () => {
  const before = { ...atWar(), wars: [{ id: "war-1", title: "The Baltic War", status: "active", sideA: [RUSSIA], sideB: [LATVIA, ESTONIA], startedDate: "2014-03-01" }] };
  const after = makePeace(before, { warId: "war-1", from: RUSSIA, to: LATVIA, terms: { territory: "restored" }, date: DATE, round: 5, players: [RUSSIA, LATVIA, ESTONIA] });
  const [event] = landingEvents(before, after, { date: DATE });
  assert.match(event.description, new RegExp(`^A separate peace: .*${LATVIA}.* leave The Baltic War, which goes on for the rest\\.`));
});

test("a treaty signed is told as one event, and one only proposed or declined is not told at all", () => {
  const players = [RUSSIA, LATVIA];
  const put = proposeTreaty({}, { from: RUSSIA, to: LATVIA, type: "non_aggression", title: "The Riga Pact", terms: "Neither attacks the other.", players, date: DATE, round: 5 });
  assert.deepEqual(landingEvents({}, put.world, { date: DATE }), [], "only proposed: the two's own business");
  const signed = answerTreaty(put.world, { op: "sign", ref: put.offer.id, country: LATVIA, date: DATE, round: 5 });
  const [event] = landingEvents(put.world, signed.world, { date: DATE });
  assert.equal(event.title, `${RUSSIA} and ${LATVIA} sign a treaty`);
  assert.equal(event.description, "The Riga Pact: Neither attacks the other.");
  assert.equal(event.id, `landing-treaty-${signed.agreement.id}`);
  assert.equal(landingNotice(event), `${RUSSIA} and ${LATVIA} have signed a treaty.`);
  const declined = answerTreaty(put.world, { op: "decline", ref: put.offer.id, country: LATVIA, date: DATE, round: 5 });
  assert.deepEqual(landingEvents(put.world, declined.world, { date: DATE }), []);
});

test("it goes on the timeline in the turn whose dates take it in, or in a record of its own before the first round", () => {
  const event = { id: "landing-peace-x", date: DATE };
  const turns = [
    { date: DATE, fromDate: "2014-05-01", toDate: DATE, round: 4, eventIds: ["e4"] },
    { date: "2014-05-01", fromDate: "2014-04-01", toDate: "2014-05-01", round: 3, eventIds: ["e3"] },
  ];
  const placed = withLandingsOnTimeline({ simulationHistory: turns }, [event], { round: 5 });
  assert.deepEqual(placed.simulationHistory.map((entry) => entry.eventIds), [["e4", "landing-peace-x"], ["e3"]], "the newest turn's next event to read");
  assert.deepEqual(withLandingsOnTimeline(placed, [event]).simulationHistory, placed.simulationHistory, "once");
  const first = withLandingsOnTimeline({}, [event], { round: 1 });
  assert.deepEqual(first.simulationHistory, [{ date: DATE, fromDate: DATE, toDate: DATE, eventIds: ["landing-peace-x"], fallbackReason: "", mode: LANDING_SOURCE, plannedActions: [], round: 1, source: LANDING_SOURCE, summary: "" }]);
});

test("what landed is told once: the world with it on the timeline, and the event log with it", () => {
  const before = atWar();
  const after = makePeace(before, { warId: "war-1", from: RUSSIA, to: LATVIA, terms: { territory: TERRITORY_AS_HELD }, date: DATE, round: 5, players: [RUSSIA, LATVIA] });
  const game = { gameDate: DATE, round: 5 };
  const told = tellLandings({ before, after, events: [{ id: "e4" }], game });
  assert.equal(told.landed.length, 1);
  assert.deepEqual(told.events.map((entry) => entry.id), ["e4", told.landed[0].id]);
  assert.ok(told.world.simulationHistory.some((entry) => entry.eventIds.includes(told.landed[0].id)));
  assert.equal(tellLandings({ before, after, events: told.events, game }), null, "an event the log holds is not told again");
  assert.equal(tellLandings({ before, after: before, events: [], game }), null);
});

// engineMain.js cannot be imported without the whole app, so where it tells what landed is pinned from its source,
// as engineHolds.test.js pins its other rules: the one commit of the world and the queue carries the event log too,
// and what the governments at a table decided (a leader taking a seat's terms of peace) is told as a players' is.
test("the engine's one commit carries the event log, and a table's decisions are told when they make a peace", async () => {
  const fs = await import("node:fs");
  const engine = fs.readFileSync(new URL("./engineMain.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(engine, /updateForces: \(fn\) => mutateCanonicalTurnState\(\(\{ world, actions, game, events \}\) => fn\(\{ world, actions, game, events \}\) \|\| null\),/);
  assert.match(engine, /commit: \(write\) => writeInOrder\("table-decided", \(\) => decidedAndTold\(write, landed\)\),/);
  const told = engine.slice(engine.indexOf("const decidedAndTold = async"), engine.indexOf("const tableTurn = async"));
  assert.ok(told.indexOf("readWorldState") < told.indexOf("await write()") && told.indexOf("tellLandings(") > told.indexOf("await write()"), "the world before the decisions, and after");
  assert.match(engine, /return \{ unreachable: outcome\?\.generation\?\.source === "fallback", landed: list\(outcome\?\.landed\) \};/);
});

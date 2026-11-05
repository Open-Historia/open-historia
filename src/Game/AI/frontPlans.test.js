/*! Open Historia — plans on the battlefields: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontPlans.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { chosenOrdersOf, orderTroops } from "../../runtime/fronts/command.js";
import { TROOP_STATES } from "../../runtime/fronts/constants.js";
import { runFronts } from "../../runtime/fronts/engine.js";
import { PROJECT_MARK, WATCH_MARK, withDiversion } from "../../runtime/fronts/plans.js";
import { applyFlips, frontInput, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";
import { boardsOf, stolenPlansBlock, turnPlanned, warRoomIntel, warRoomPlans } from "./frontPlans.js";

// Projects and espionage, where they meet a battlefield: an operation sends its
// troops, an agent sends its owner the other side's plans, a turned agent sends
// the diversion, and a side nobody plays digs in against what it was shown.

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.4, lat: 50, population: 300000 },
  { name: "Arda", lng: 20.5, lat: 49.25, population: 80000 },
  { name: "Brod", lng: 22.6, lat: 50, population: 900000 },
  { name: "Cetin", lng: 23.4, lat: 49.4, population: 500000 },
];
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
const steady = { even: true, wander: 0 };
const fresh = (orders = []) => {
  const map = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
  const record = runFronts(frontInput(map, { battlefields: [battlefieldOn(map, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 30)], orders })], days: 0, steering: steady })).battlefields[0];
  return { map, record };
};
const game = { country: "Aland", gameDate: "2024-03-01", round: 3 };
const operation = (extra = {}) => ({
  id: "project-kingfisher", name: "Operation Kingfisher", kind: "operation", ownerCode: "", status: "active",
  summary: "Three corps drive east to take Brod before the thaw.", ...extra,
});
const spy = (extra = {}) => ({ id: "spy-1", owner: "Borduria", target: "Aland", status: "active", ...extra });

test("every Board of the game is one list, each entry with its owner written out", () => {
  const world = {
    projects: [operation(), operation({ id: "p2", ownerCode: "Borduria" }), null],
    seatBoards: { Syldavia: [operation({ id: "p3" }), operation({ id: "p4", ownerCode: "Borduria" })], aland: [operation({ id: "p5" })] },
  };
  assert.deepEqual(boardsOf(world, game).map((entry) => [entry.id, entry.ownerCode]), [["project-kingfisher", "Aland"], ["p2", "Borduria"], ["p3", "Syldavia"]]);
  assert.deepEqual(boardsOf({}, game), []);
});

test("a turn sends the player's operation and leaves the world alone when there is nothing to do", () => {
  const { record } = fresh();
  const quiet = { battlefields: [record], projects: [], spies: [] };
  assert.equal(turnPlanned({ world: quiet, game, cities }), quiet, "nothing to do: the same world");
  const frozen = { battlefields: [{ ...record, status: "frozen" }], projects: [operation()], spies: [] };
  assert.equal(turnPlanned({ world: frozen, game, cities }), frozen, "a ceasefire moves nobody");

  const world = { battlefields: [{ name: "Closed", status: "closed" }, record], projects: [operation()], spies: [] };
  const planned = turnPlanned({ world, game, cities });
  assert.notEqual(planned, world);
  assert.equal(planned.battlefields[0], world.battlefields[0]);
  assert.deepEqual(chosenOrdersOf(planned.battlefields[1], 0).map((order) => [order.order, order.objective, order.mark, order.by]), [["advance", "city: Brod", `${PROJECT_MARK}project-kingfisher`, "Aland"]]);
  assert.equal(planned.projects, world.projects, "the Board is not written");
  // A second turn finds it sent.
  assert.equal(turnPlanned({ world: planned, game, cities }), planned);
});

test("a side nobody plays digs in against the route its agent took, or against the diversion a turned agent was fed", () => {
  const { map, record } = fresh();
  const ours = withDiversion(orderTroops(record, { side: 0, troops: [0, 1, 2, 3, 4, 5], way: [[21.2, 50.8], [22.5, 50.8]], by: "Aland" }), 0, { way: [[20.9, 49.2], [22.5, 49.2]], troops: 40 });
  const dugIn = TROOP_STATES.indexOf("dug in");
  const northOf = (rec, indexes) => {
    const troops = decodeTroops(rec.troops[1]);
    return indexes.map((index) => troops[index].y);
  };
  const middle = decodeTroops(ours.troops[1]).reduce((sum, troop) => sum + troop.y, 0) / 30;

  // No agent: nothing is known and nobody digs in for it.
  assert.deepEqual(chosenOrdersOf(turnPlanned({ world: { battlefields: [ours], spies: [] }, game, cities }).battlefields[0], 1), []);
  // With espionage off an agent is nobody.
  assert.deepEqual(chosenOrdersOf(turnPlanned({ world: { battlefields: [ours], spies: [spy()] }, game, cities, espionage: false }).battlefields[0], 1), []);

  // A live agent: the real route, in the north.
  const warned = turnPlanned({ world: { battlefields: [ours], spies: [spy()] }, game, cities }).battlefields[0];
  const [watch] = chosenOrdersOf(warned, 1);
  assert.deepEqual([watch.order, watch.mark], ["dig in", WATCH_MARK]);
  assert.ok(northOf(warned, watch.troops).every((y) => y > middle), "it waits where the blow is to fall");
  // The engine digs them in, and the player's own route is still his.
  const result = runFronts(frontInput(map, { battlefields: [warned], days: 3, steering: steady }));
  applyFlips(map, result.flips);
  const after = decodeTroops(result.battlefields[0].troops[1]);
  assert.ok(watch.troops.some((index) => after[index].state === dugIn));

  // A turned agent: the diversion, in the south; the real route is not waited for.
  const tricked = turnPlanned({ world: { battlefields: [ours], spies: [spy({ status: "turned" })] }, game, cities }).battlefields[0];
  const [fooled] = chosenOrdersOf(tricked, 1);
  assert.ok(northOf(tricked, fooled.troops).every((y) => y < middle), "it waits where nothing is coming");
  // The agent is sent home: it stands down.
  const quiet = turnPlanned({ world: { battlefields: [tricked], spies: [spy({ status: "exposed" })] }, game, cities }).battlefields[0];
  assert.deepEqual(chosenOrdersOf(quiet, 1), []);
});

test("the simulator is told what agents carried off, and nothing when there is nothing", () => {
  const { record } = fresh();
  const ours = withDiversion(orderTroops(record, { side: 0, troops: [0, 1, 2, 3, 4, 5], way: [[21.2, 50.8], [22.6, 50]], by: "Aland" }), 0, { way: [[20.9, 49.2], [23.35, 49.42]], troops: 40 });
  const world = (spies) => ({ battlefields: [ours], spies });
  assert.equal(stolenPlansBlock({ world: world([]), game, cities }), "");
  assert.equal(stolenPlansBlock({ world: world([spy()]), game, cities, espionage: false }), "");
  assert.equal(stolenPlansBlock({ world: world([spy({ status: "exposed" })]), game, cities }), "");
  // The player's own agents are the player's to read: the simulator has the battlefields whole.
  assert.equal(stolenPlansBlock({ world: world([spy({ owner: "Aland", target: "Borduria" })]), game, cities }), "");

  const truth = stolenPlansBlock({ world: world([spy()]), game, cities });
  assert.match(truth, /^\[What Agents Report of the Fronts\]\nKnown to you, not to the player\./);
  assert.match(truth, new RegExp(`\\n- ${ours.name}: Borduria knows from its agent that Aland plans an advance toward the country round city: Brod, about 6 formations\\. It prepares`));
  assert.doesNotMatch(truth, /FALSE/);
  const planted = stolenPlansBlock({ world: world([spy({ status: "turned" })]), game, cities });
  assert.match(planted, /Borduria has been shown by its agent, which Aland has turned, that Aland plans an advance toward the country round city: Cetin, about 40 formations\. This is FALSE and Borduria believes it/);
  assert.doesNotMatch(planted, /city: Brod/);
  for (const block of [truth, planted]) assert.doesNotMatch(block, /spy-1|order:|d1\b/, "names, never an id");
});

test("the war room is shown what the player's agents and Board have of the other side, and its own plans", () => {
  const { record } = fresh([{ s: 1, sector: "all", order: "spearhead", objective: "city: Alba", since: "2024-02-20" }]);
  const world = (spies, projects = []) => ({ battlefields: [record], spies, projects });
  const none = warRoomIntel({ world: world([]), game, record, side: 0, cities });
  assert.deepEqual([none.plans, none.sources, none.lines, none.double], [[], [], [], false]);
  const told = warRoomIntel({ world: world([spy({ owner: "Aland", target: "Borduria" })]), game, record, side: 0, cities });
  assert.deepEqual(told.plans.map((plan) => [plan.order, plan.objective]), [["spearhead", "city: Alba"]]);
  assert.equal(told.lines.length, 1);
  assert.match(told.lines[0], /^Borduria: a spearhead toward city: Alba, about \d+ formations$/);
  assert.deepEqual(told.sources, [{ agent: "Aland", inside: "Borduria" }]);
  assert.equal(warRoomIntel({ world: world([spy({ owner: "Aland", target: "Borduria" })]), game, record, side: 0, cities, espionage: false }).plans.length, 0);
  // What is fed to a turned agent of ours comes with nothing to mark it.
  const fed = warRoomIntel({ world: world([spy({ owner: "Aland", target: "Borduria", status: "turned" })]), game, record, side: 0, cities });
  assert.equal(fed.plans.length, 1);
  assert.notEqual(fed.plans[0].objective, "city: Alba");
  assert.deepEqual(Object.keys(fed.plans[0]).sort(), Object.keys(told.plans[0]).sort());
  // A foreign agent the player turned is somebody to show a diversion to.
  assert.equal(warRoomIntel({ world: world([spy({ status: "turned" })]), game, record, side: 0, cities }).double, true);
  assert.equal(warRoomIntel({ world: world([spy()]), game, record, side: 0, cities }).double, false);
  // The Board's entry on their operation is known without an agent.
  const board = warRoomIntel({ world: world([], [operation({ ownerCode: "Borduria", summary: "Encircle Alba." })]), game, record, side: 0, cities });
  assert.deepEqual(board.plans.map((plan) => [plan.kind, plan.name, plan.order]), [["project", "Operation Kingfisher", "encircle"]]);

  // The player's own: his operation, by the Board's own entry with no owner written.
  const own = warRoomPlans({ world: world([], [operation()]), game, record, side: 0, cities });
  assert.deepEqual(own.map((plan) => [plan.kind, plan.name, plan.objective, plan.live, plan.own]), [["project", "Operation Kingfisher", "city: Brod", true, true]]);
});

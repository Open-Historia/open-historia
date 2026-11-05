// Run: node --test src/runtime/fronts/plans.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTroops } from "./codec.js";
import { chosenOrdersOf, orderTroops } from "./command.js";
import { MAX_PLANS_PER_SIDE, MAX_WAY_POINTS, TROOP_STATES, WATCH_TROOPS_MOST } from "./constants.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import {
  PROJECT_MARK,
  WATCH_MARK,
  describePlans,
  hasDoubleAgent,
  keptPlansOf,
  knownPlans,
  operationsOn,
  plansOf,
  readPlans,
  withDiversion,
  withOperationOrders,
  withProjectPlan,
  withWatch,
  withoutPlan,
} from "./plans.js";
import { normalizeBattlefield } from "./record.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";

// The movements a side means to make: what the war room draws before they are
// made, what the Board's operations add to them, and what agents carry off.

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.4, lat: 50, population: 300000 },
  { name: "Arda", lng: 20.5, lat: 49.25, population: 80000 },
  { name: "Brod", lng: 22.6, lat: 50, population: 900000 },
  { name: "Nova Brod", lng: 24.2, lat: 50.6, population: 200000 },
  { name: "Cetin", lng: 23.4, lat: 49.4, population: 500000 },
];
const place = (name) => cities.find((city) => city.name === name);
const plain = () => syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const steady = { even: true, wander: 0 };
const run = (world, record, days, extra = {}) => {
  const result = runFronts(frontInput(world, { battlefields: [record], days, steering: steady, ...extra }));
  applyFlips(world, result.flips);
  return result.battlefields[0];
};
const opened = (orders = []) => {
  const world = plain();
  const record = run(world, battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 30)], orders }), 0);
  return { world, record };
};
const operation = (extra = {}) => ({
  id: "project-kingfisher", name: "Operation Kingfisher", kind: "operation", ownerCode: "", status: "active",
  summary: "Three corps drive east to take Brod before the thaw.", secrecy: "covert", targetDate: "2024-05-01", ...extra,
});
const context = (projects = []) => ({ projects, cities, player: "Aland" });
const endOf = (plan, way = 0) => plan.ways[way][plan.ways[way].length - 1];
const near = ([lng, lat], city, within = 0.06) => Math.abs(lng - city.lng) <= within && Math.abs(lat - city.lat) <= within;

test("a standing order is a plan: an arrow for an attack, none for troops that stay", () => {
  const { record } = opened([standing(0, "spearhead", { objective: "city: Brod" }), standing(1, "dig in")]);
  const ours = plansOf(record, 0, context());
  assert.equal(ours.length, 1);
  assert.deepEqual([ours[0].kind, ours[0].order, ours[0].objective, ours[0].ways.length], ["order", "spearhead", "city: Brod", 1]);
  assert.ok(near(endOf(ours[0]), place("Brod")), "the arrow ends on the place");
  assert.ok(ours[0].troops >= 4 && ours[0].troops <= 27, "it is the troops nearest the place, not the whole side");
  assert.ok(ours[0].ways[0][0][0] < 21, "and it starts where they stand");
  const theirs = plansOf(record, 1, context());
  assert.deepEqual(theirs.map((plan) => [plan.order, plan.ways.length]), [["dig in", 0]]);
  assert.deepEqual(plansOf(record, 2, context()), []);

  // An encirclement is two columns that pass either side of the place and close behind it.
  const round = plansOf(opened([standing(0, "encircle", { objective: "city: Brod" })]).record, 0, context())[0];
  assert.equal(round.ways.length, 2);
  const [north, south] = round.ways.map((way) => way[1][1]);
  assert.ok(north > place("Brod").lat && south < place("Brod").lat || north < place("Brod").lat && south > place("Brod").lat, "one column either side");
  for (const way of round.ways) assert.ok(way[way.length - 1][0] > place("Brod").lng, "both end beyond it");

  // The line going forward with nothing named: an arrow a general, toward the enemy.
  const forward = plansOf(opened([standing(0, "advance")]).record, 0, context())[0];
  assert.equal(forward.ways.length, 3);
  for (const way of forward.ways) assert.ok(way[1][0] > way[0][0], "eastward, where the other side is");
});

test("a route drawn for troops is a plan of its own kind, from where they stand along what was drawn", () => {
  const { record } = opened();
  const drawn = orderTroops(record, { side: 0, troops: [0, 1, 2, 3, 4, 5], way: [[21.4, 50.8], [22.2, 50.6], [22.6, 50]], by: "Aland", since: "2024-03-01" });
  const [plan] = plansOf(drawn, 0, context());
  assert.deepEqual([plan.kind, plan.order, plan.troops, plan.chosen], ["route", "advance", 6, true]);
  assert.deepEqual(plan.picked, [0, 1, 2, 3, 4, 5]);
  assert.equal(plan.ways[0].length, 4, "their own place, then the three points drawn");
  assert.ok(near(endOf(plan), place("Brod")));
});

test("an operation on the Board that sends troops at a place the other side holds is a plan", () => {
  const { record } = opened();
  const found = operationsOn({ record, side: 0, ...context([operation()]) });
  assert.deepEqual(found.map((entry) => [entry.project, entry.by, entry.own, entry.order, entry.place.name]), [["project-kingfisher", "Aland", true, "advance", "Brod"]]);
  // What it is not: a project that is no operation, one that has ended, one
  // about a city of its owner's own, one that runs an agent, one of a country
  // that is not fighting here; and a name inside another name is not that name.
  const not = [
    operation({ kind: "project" }),
    operation({ status: "complete" }),
    operation({ summary: "Rebuild the bridges of Alba." }),
    operation({ linkedSpyIds: ["spy-1"] }),
    operation({ ownerCode: "Syldavia" }),
    operation({ summary: "Take Brodnica and hold it." }),
  ];
  for (const entry of not) assert.deepEqual(operationsOn({ record, side: 0, ...context([entry]) }), [], JSON.stringify(entry).slice(0, 120));
  // The longest name wins, accents and capitals do not matter, and a point given is read by the city nearest it.
  assert.equal(operationsOn({ record, side: 0, ...context([operation({ summary: "The armour goes for NOVA BROD." })]) })[0].place.name, "Nova Brod");
  assert.equal(operationsOn({ record, side: 0, ...context([operation({ summary: "Seize the rail junction.", focus: { lng: 23.3, lat: 49.45 } })]) })[0].place.name, "Cetin");
  assert.equal(operationsOn({ record, side: 0, ...context([operation({ summary: "Seize the junction.", focus: { lng: 20.5, lat: 50 } })]) }).length, 0, "a point on its own ground is no attack");
  // The other side's operation, as the Board knows of it.
  const theirs = operationsOn({ record, side: 1, ...context([operation({ ownerCode: "Borduria", summary: "Encircle Alba from the north and the south.", verification: "doubted" })]) });
  assert.deepEqual(theirs.map((entry) => [entry.by, entry.own, entry.order, entry.place.name, entry.doubted]), [["Borduria", false, "encircle", "Alba", true]]);

  const [plan] = plansOf(record, 0, context([operation()]));
  assert.deepEqual([plan.kind, plan.name, plan.objective, plan.status, plan.live, plan.edited, plan.off], ["project", "Operation Kingfisher", "city: Brod", "active", true, false, false]);
  assert.ok(near(endOf(plan), place("Brod")));
  assert.equal(plansOf(record, 0, context([operation({ status: "proposed" })]))[0].live, false, "one not yet under way moves nothing");
});

test("the arrow of an operation can be redrawn, put back, and told to move nothing", () => {
  const { record } = opened();
  const projects = [operation()];
  const redrawn = withProjectPlan(record, 0, { project: "project-kingfisher", way: [[21, 49.3], [22, 49.3], [22.6, 50]], at: "2024-03-01" });
  const [plan] = plansOf(redrawn, 0, context(projects));
  assert.deepEqual([plan.edited, plan.live, plan.ways.length, plan.ways[0].length], [true, true, 1, 3]);
  assert.deepEqual(plan.ways[0][0], [21, 49.3]);
  // The troops it takes are the ones nearest where the drawn way begins: the southern ones.
  const troops = decodeTroops(redrawn.troops[0]);
  const { toLngLat } = projectorOf(redrawn.frame);
  for (const index of plan.picked) assert.ok(toLngLat(troops[index].x, troops[index].y)[1] < 50.2, "a southern troop");

  const off = withProjectPlan(redrawn, 0, { project: "project-kingfisher", off: true });
  assert.deepEqual([plansOf(off, 0, context(projects))[0].off, plansOf(off, 0, context(projects))[0].live, plansOf(off, 0, context(projects))[0].edited], [true, false, true]);
  const back = withProjectPlan(withProjectPlan(off, 0, { project: "project-kingfisher", off: false }), 0, { project: "project-kingfisher", way: [] });
  assert.deepEqual(keptPlansOf(back, 0), [], "nothing is kept of an arrow left as it was suggested");
  assert.equal(plansOf(back, 0, context(projects))[0].edited, false);
  // It goes through the record's own checking and a run of the engine.
  const kept = normalizeBattlefield(JSON.parse(JSON.stringify(redrawn)));
  assert.deepEqual(keptPlansOf(kept, 0), keptPlansOf(redrawn, 0));
});

test("an operation under way sends its troops once, and takes them off again when it ends", () => {
  const { world, record } = opened();
  const projects = [operation()];
  const sent = withOperationOrders(record, { sides: [0], ...context(projects), since: "2024-03-01" });
  const orders = chosenOrdersOf(sent, 0);
  assert.deepEqual(orders.map((order) => [order.order, order.objective, order.mark, order.by]), [["advance", "city: Brod", `${PROJECT_MARK}project-kingfisher`, "Aland"]]);
  assert.ok(orders[0].troops.length >= 4);
  // It is drawn once: the order is its arrow, under the operation's name.
  const drawn = plansOf(sent, 0, context(projects));
  assert.deepEqual(drawn.map((plan) => [plan.kind, plan.name, plan.project]), [["order", "Operation Kingfisher", "project-kingfisher"]]);
  // Asked again, nothing more is written.
  assert.deepEqual(withOperationOrders(sent, { sides: [0], ...context(projects), since: "2024-03-02" }).orders, sent.orders);
  // The other side's Board entry is what is believed of it, and moves nothing.
  const believed = withOperationOrders(record, { sides: [0], ...context([operation({ ownerCode: "Borduria", summary: "Take Alba." })]) });
  assert.equal(believed.orders.length, 0);
  // One not under way, or told to move nothing, sends nobody.
  assert.equal(withOperationOrders(record, { sides: [0], ...context([operation({ status: "paused" })]) }).orders.length, 0);
  assert.equal(withOperationOrders(withProjectPlan(record, 0, { project: "project-kingfisher", off: true }), { sides: [0], ...context(projects) }).orders.length, 0);

  // The engine carries it out: those troops go east, the rest stay.
  const before = decodeTroops(sent.troops[0]);
  const fought = run(world, sent, 12);
  const after = decodeTroops(fought.troops[0]);
  const went = orders[0].troops.filter((index) => after[index].strength > 0);
  assert.ok(went.length > 0);
  const gain = went.reduce((sum, index) => sum + (after[index].x - before[index].x), 0) / went.length;
  assert.ok(gain > 1, `the troops sent went forward (${gain.toFixed(2)} cells)`);
  // The operation ends: its troops are no longer under it, and it is not sent a second time.
  const ended = withOperationOrders(fought, { sides: [0], ...context([operation({ status: "complete" })]) });
  assert.deepEqual(chosenOrdersOf(ended, 0).filter((order) => order.mark), []);
  const again = withOperationOrders(fought, { sides: [0], ...context(projects), since: "2024-03-14" });
  assert.ok(chosenOrdersOf(again, 0).filter((order) => order.mark).length <= 1, "sent once");

  // Troops already given an order by hand are not taken from under it: the
  // operation takes the nearest that are free.
  const byHand = orderTroops(record, { side: 0, troops: orders[0].troops, order: "dig in", by: "Aland" });
  const beside = withOperationOrders(byHand, { sides: [0], ...context(projects), since: "2024-03-01" });
  const [dug, sentBeside] = chosenOrdersOf(beside, 0);
  assert.deepEqual([dug.order, dug.troops], ["dig in", orders[0].troops], "the hand's order stands whole");
  assert.equal(sentBeside.mark, `${PROJECT_MARK}project-kingfisher`);
  assert.ok(sentBeside.troops.length > 0 && sentBeside.troops.every((troop) => !orders[0].troops.includes(troop)), "and the operation has others");

  // Redrawn, it is carried out as the route drawn.
  const redrawn = withOperationOrders(withProjectPlan(record, 0, { project: "project-kingfisher", way: [[21, 49.3], [22, 49.3], [22.6, 50]] }), { sides: [0], ...context(projects), since: "2024-03-01" });
  const [route] = chosenOrdersOf(redrawn, 0);
  assert.deepEqual([route.order, route.objective, route.way.length, route.mark], ["advance", "", 3, `${PROJECT_MARK}project-kingfisher`]);
});

test("a diversion is drawn, kept and taken off, and never moves a troop", () => {
  const { world, record } = opened();
  const drawn = withDiversion(record, 0, { way: [[20.9, 50.8], [22, 50.9], [24.2, 50.6]], troops: 30, at: "2024-03-01" });
  assert.deepEqual(keptPlansOf(drawn, 0).map((plan) => [plan.id, plan.kind, plan.troops, plan.way.length]), [["d1", "diversion", 30, 3]]);
  const [plan] = plansOf(drawn, 0, context());
  assert.deepEqual([plan.kind, plan.troops, plan.ways.length, plan.picked.length], ["diversion", 30, 1, 0]);
  assert.equal(drawn.orders.length, 0, "it is no order");
  // A run over no days leaves it: nothing has happened yet for it to be stolen before.
  assert.deepEqual(keptPlansOf(run(world, drawn, 0), 0).map((entry) => entry.id), ["d1"]);
  const fought = run(world, drawn, 6);
  assert.deepEqual(decodeTroops(fought.troops[0]).map((troop) => Math.round(troop.x * 4)), decodeTroops(drawn.troops[0]).map((troop) => Math.round(troop.x * 4)), "nobody moved for it");
  // Days of fighting have passed over it: it is taken off, as a movement that was made is.
  assert.deepEqual(keptPlansOf(fought, 0), []);
  assert.deepEqual(plansOf(fought, 0, context()), []);
  // A second takes the next name; a way of one point is no way; and there is a most.
  const two = withDiversion(drawn, 0, { way: [[20.9, 49.2], [22, 49.2]] });
  assert.deepEqual(keptPlansOf(two, 0).map((entry) => entry.id), ["d1", "d2"]);
  assert.equal(withDiversion(record, 0, { way: [[20.9, 49.2]] }), record);
  let full = record;
  for (let index = 0; index < MAX_PLANS_PER_SIDE + 3; index += 1) full = withDiversion(full, 0, { way: [[20.9, 49.2], [22 + index / 100, 49.2]] });
  assert.equal(keptPlansOf(full, 0).length, MAX_PLANS_PER_SIDE);
  assert.deepEqual(keptPlansOf(withoutPlan(two, 0, "d1"), 0).map((entry) => entry.id), ["d2"]);
  assert.equal(withoutPlan(two, 0, "d9"), two);
  // A long way is thinned to what a route may hold.
  const long = withDiversion(record, 0, { way: Array.from({ length: 60 }, (_, index) => [20.9 + index * 0.05, 50 + ((index % 7) - 3) * 0.02]) });
  assert.ok(keptPlansOf(long, 0)[0].way.length <= MAX_WAY_POINTS);
  assert.deepEqual(readPlans("nonsense"), [[], []]);
});

test("a plan is a movement still to be made: once time has passed over it, it is under way, and then it is gone", () => {
  const { record } = opened();
  // A route for six troops with nobody in their way, east and then north.
  const world = plain();
  const alone = run(world, battlefieldOn(world, { troops: [row(20.9, 49.85, 50.15, 6), []] }), 0);
  const way = [[20.9, 50.0], [22.0, 50.0], [22.0, 50.55]];
  const told = orderTroops(alone, { side: 0, troops: [0, 1, 2, 3, 4, 5], order: "advance", way, by: "Aland" });
  const [meant] = plansOf(told, 0, context());
  assert.deepEqual([meant.kind, meant.begun, meant.troops], ["route", false, 6]);
  assert.ok(Math.abs(endOf(meant)[0] - 22.0) < 0.01 && Math.abs(endOf(meant)[1] - 50.55) < 0.01);
  // Two days on they are along its first stretch: it is being made, and what
  // is drawn of it is only what is left, from where they have got to.
  const early = run(world, told, 2);
  const [going] = plansOf(early, 0, context());
  assert.deepEqual([going.kind, going.begun], ["route", true]);
  assert.ok(going.ways[0][0][0] > meant.ways[0][0][0] + 0.1, `its arrow starts where they are now: ${going.ways[0][0][0]} against ${meant.ways[0][0][0]}`);
  assert.deepEqual(endOf(going), endOf(meant));
  // When they have come to its end it is no plan at all.
  assert.deepEqual(plansOf(run(world, early, 12), 0, context()), []);

  // An order at a place the side holds already has been carried out.
  const taken = opened([standing(0, "advance", { objective: "city: Alba" }), standing(0, "spearhead", { objective: "city: Brod", sector: "north" })]);
  assert.deepEqual(plansOf(taken.record, 0, context()).map((plan) => plan.objective), ["city: Brod"]);

  // An operation that sent its troops and whose order is over has been carried
  // out here: no arrow, and it is not sent again unless the player says so.
  const board = [operation()];
  const sent = withProjectPlan(record, 0, { project: "project-kingfisher", sent: true });
  const [over] = plansOf(sent, 0, context(board));
  assert.deepEqual([over.kind, over.done, over.ways, over.troops], ["project", true, [], 0]);
  assert.equal(withOperationOrders(sent, { sides: [0], ...context(board) }), sent, "it sends nothing more");
  const again = withProjectPlan(sent, 0, { project: "project-kingfisher", sent: false });
  const [fresh] = plansOf(again, 0, context(board));
  assert.deepEqual([fresh.done === true, fresh.ways.length], [false, 1]);
  assert.notEqual(withOperationOrders(again, { sides: [0], ...context(board) }), again, "and told to, it sends them once more");
});

test("an agent sends its owner the other side's real plans; one that was turned sends the diversions", () => {
  const { record } = opened([standing(1, "spearhead", { objective: "city: Alba" })]);
  const spy = (extra) => ({ id: "spy-1", owner: "Aland", target: "Borduria", status: "active", ...extra });
  const ask = (rec, side, spies, projects = [], played = ["Aland"]) => knownPlans({ record: rec, side, spies, ...context(projects), played });

  // Nobody inside: nothing is known but what the Board already holds.
  assert.deepEqual(ask(record, 0, []), { plans: [], sources: [] });
  const board = ask(record, 0, [], [operation({ ownerCode: "Borduria", summary: "Take Alba by storm.", verification: "doubted" })]);
  assert.deepEqual(board.plans.map((plan) => [plan.kind, plan.name, plan.objective, plan.doubted]), [["project", "Operation Kingfisher", "city: Alba", true]]);
  // An agent of ours in a country that is not on the other side sends nothing of it.
  assert.deepEqual(ask(record, 0, [spy({ target: "Syldavia" })]).plans, []);
  // A live agent: the spearhead at Alba, as it is.
  const truth = ask(record, 0, [spy()]);
  assert.deepEqual(truth.plans.map((plan) => [plan.order, plan.objective]), [["spearhead", "city: Alba"]]);
  assert.deepEqual(truth.sources, [{ agent: "Aland", inside: "Borduria" }]);
  assert.ok(near(endOf(truth.plans[0]), place("Alba")));
  assert.deepEqual(truth.plans[0].picked, [], "which of their troops is theirs to know");
  // One caught and not yet dealt with, or sent home, reports nothing.
  for (const status of ["discovered", "exposed", "recalled"]) assert.deepEqual(ask(record, 0, [spy({ status })]).plans, []);

  // Turned by a side nobody plays: a plan of its making, somewhere it is not going, and the same every time it is asked.
  const fed = ask(record, 0, [spy({ status: "turned" })]);
  assert.equal(fed.plans.length, 1);
  assert.equal(fed.plans[0].order, "spearhead");
  assert.equal(fed.plans[0].objective, "city: Arda", "the place furthest from where it is going");
  assert.deepEqual(ask(record, 0, [spy({ status: "turned" })]), fed);
  assert.deepEqual(Object.keys(fed.plans[0]).sort(), Object.keys(truth.plans[0]).sort(), "nothing in it says it is false");
  assert.deepEqual(fed.sources, truth.sources);

  // The other way round: their agent in us. Alive, it takes our route and not our diversion.
  let ours = orderTroops(record, { side: 0, troops: [0, 1, 2, 3], way: [[21.4, 50.8], [22.6, 50]], by: "Aland" });
  ours = withDiversion(ours, 0, { way: [[20.9, 49.2], [23.4, 49.4]], troops: 40 });
  const theirs = (status) => [{ id: "spy-9", owner: "Borduria", target: "Aland", status }];
  const stolen = ask(ours, 1, theirs("active"));
  assert.deepEqual(stolen.plans.map((plan) => [plan.kind, plan.troops]), [["route", 4]]);
  // Turned, it takes the diversion, which reads as a movement like any other.
  const tricked = ask(ours, 1, theirs("turned"));
  assert.deepEqual(tricked.plans.map((plan) => [plan.kind, plan.order, plan.troops]), [["order", "advance", 40]]);
  assert.ok(near(endOf(tricked.plans[0]), place("Cetin")));
  // Turned with no diversion drawn: it has nothing to say of movements (a person's side is not made a plan for).
  assert.deepEqual(ask(orderTroops(record, { side: 0, troops: [0, 1], way: [[21.4, 50.8], [22.6, 50]] }), 1, theirs("turned")).plans, []);

  assert.equal(hasDoubleAgent({ record, side: 0, spies: theirs("turned") }), true);
  assert.equal(hasDoubleAgent({ record, side: 0, spies: theirs("active") }), false);
  assert.equal(hasDoubleAgent({ record, side: 0, spies: [spy({ status: "turned" })] }), false, "our own agent turned against us is not ours to feed");
});

test("plans are told in words with names and kinds, never a number of the game's own", () => {
  const { record } = opened([standing(0, "spearhead", { objective: "city: Brod" })]);
  const drawn = withDiversion(record, 0, { way: [[20.9, 49.2], [23.35, 49.42]], troops: 40 });
  const lines = describePlans(drawn, plansOf(drawn, 0, context([operation({ summary: "Encircle Nova Brod.", status: "proposed" })])), { cities });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^a spearhead toward city: Brod, about \d+ formations$/);
  assert.match(lines[1], /^an encirclement toward city: Nova Brod, about \d+ formations \(operation "Operation Kingfisher"\)$/);
  assert.equal(lines[2], "an advance toward the country round city: Cetin, about 40 formations");
  for (const line of lines) assert.doesNotMatch(line, /project-|order:|\d+\.\d+/);
});

test("a side warned of a movement digs in the troops it has near the way, and stands down when the warning goes", () => {
  const { world, record } = opened();
  // What Borduria was shown: a thrust along the northern edge.
  const shown = [{ order: "spearhead", ways: [[[20.9, 50.8], [22.5, 50.8]]] }];
  const warned = withWatch(record, 1, shown, { since: "2024-03-01" });
  const [watch] = chosenOrdersOf(warned, 1);
  assert.deepEqual([watch.order, watch.mark], ["dig in", WATCH_MARK]);
  assert.ok(watch.troops.length > 0 && watch.troops.length <= Math.min(WATCH_TROOPS_MOST, 9), `a share of what it has there (${watch.troops.length})`);
  const { toLngLat } = projectorOf(warned.frame);
  const troops = decodeTroops(warned.troops[1]);
  for (const index of watch.troops) assert.ok(toLngLat(troops[index].x, troops[index].y)[1] > 50.3, "the northern ones");
  // What it does about it is not a plan of its own to be stolen back.
  assert.deepEqual(plansOf(warned, 1, context()), []);
  // The engine digs them in.
  const fought = run(world, warned, 4);
  const after = decodeTroops(fought.troops[1]);
  const dugIn = TROOP_STATES.indexOf("dug in");
  assert.ok(watch.troops.every((index) => after[index].state === dugIn), "they are dug in");
  assert.ok(after.every((troop, index) => watch.troops.includes(index) || troop.state !== dugIn), "the rest are not");
  // Shown something else, it moves its watch; shown nothing, it stands down.
  const moved = withWatch(fought, 1, [{ order: "advance", ways: [[[20.9, 49.2], [22.5, 49.2]]] }], { since: "2024-03-05" });
  const [second] = chosenOrdersOf(moved, 1);
  const then = decodeTroops(moved.troops[1]);
  for (const index of second.troops) assert.ok(toLngLat(then[index].x, then[index].y)[1] < 49.8, "the southern ones now");
  assert.deepEqual(chosenOrdersOf(withWatch(moved, 1, []), 1), []);
  assert.deepEqual(chosenOrdersOf(withWatch(moved, 1, [{ order: "dig in", ways: [] }]), 1), [], "a side that is only standing is not waited for");
});

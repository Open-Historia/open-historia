// Run: node --test src/runtime/fronts/command.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { describeBattlefield } from "./brief.js";
import { decodeTroops } from "./codec.js";
import { chosenOrdersOf, commandCount, commandOfTroops, generalsOf, nameGenerals, orderTroops, releaseTroops, thinRoute } from "./command.js";
import { FRONT_COMMANDS_MOST, MAX_ORDERS_PER_SIDE, MAX_WAY_POINTS } from "./constants.js";
import { runFronts } from "./engine.js";
import { normalizeBattlefield } from "./record.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";
import { routeAhead } from "./command.js";

// The generals of a side, the orders a person gives them, and the routes
// drawn for a body of troops: what the war room writes and the engine does.

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [{ name: "Brod", lng: 22.6, lat: 50 }, { name: "Alba", lng: 20.4, lat: 50 }];
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const steady = { even: true, wander: 0 };
// A run of a record, the world then told of the regions that changed hands in
// name as the game tells it: the next run reads who holds what from the world.
const run = (world, record, days, extra = {}) => {
  const result = runFronts(frontInput(world, { battlefields: [record], days, steering: steady, ...extra }));
  applyFlips(world, result.flips);
  return result.battlefields[0];
};

test("a side has a general for every body of its troops, and a troop keeps the one it was given", () => {
  assert.deepEqual([3, 12, 39, 40, 109, 110, 219, 220, 400].map(commandCount), [1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(commandCount(100000), FRONT_COMMANDS_MOST);

  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 9)] });
  const opened = run(world, record, 0);
  const ours = generalsOf(opened, 0);
  // Forty-five troops: three generals with fifteen each, the northernmost body first.
  assert.deepEqual(ours.map((general) => [general.command, general.n]), [[0, 15], [1, 15], [2, 15]]);
  const lats = ours.map((general) => general.troops.map((index) => decodeTroops(opened.troops[0])[index].y));
  assert.ok(Math.min(...lats[0]) > Math.max(...lats[1]) && Math.min(...lats[1]) > Math.max(...lats[2]), "each body stands together along the line");
  // Nine troops: one general.
  assert.deepEqual(generalsOf(opened, 1).map((general) => general.n), [9]);
  // The brief says what each body amounts to: where it is, what it is at.
  for (const general of ours) {
    assert.equal(general.pct, 100);
    assert.match(general.at, /^city: (Brod|Alba)$/);
    assert.equal(general.doing, "holding");
  }

  // After a fortnight of fighting every troop is under the general it began under.
  const fought = run(world, { ...opened, orders: [standing(0, "advance")] }, 14);
  assert.deepEqual(commandOfTroops(fought, 0), commandOfTroops(opened, 0));
  assert.deepEqual(generalsOf(fought, 0).map((general) => general.doing), ["advancing", "advancing", "advancing"]);
  // And a formation that comes later is under whoever commands the nearest of its side.
  const [lng, lat] = [20.95, 50.85];
  const joined = runFronts(frontInput(world, { battlefields: [opened], days: 1, steering: steady, moments: [{ day: 0, type: "reinforce", owner: "Aland", strength: 90, kind: "infantry", lng, lat }] })).battlefields[0];
  const commands = commandOfTroops(joined, 0);
  assert.equal(commands.length, 46);
  assert.equal(commands[45], 0, "it joined the northern body");
});

test("a general can be named, and a name once given is kept", () => {
  const world = plain();
  const opened = run(world, battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 9)] }), 0);
  const named = nameGenerals(opened, 0, ["Gen. Orlov", "  Gen.   Petrov ", ""]);
  assert.deepEqual(generalsOf(named, 0).map((general) => general.name), ["Gen. Orlov", "Gen. Petrov", ""]);
  assert.equal(nameGenerals(named, 0, ["Somebody Else"]), named, "a name already there stands");
  assert.deepEqual(generalsOf(nameGenerals(named, 0, ["Somebody Else", "", "Gen. Sidorov"]), 0).map((general) => general.name), ["Gen. Orlov", "Gen. Petrov", "Gen. Sidorov"]);
  assert.deepEqual(generalsOf(nameGenerals(named, 0, ["Somebody Else"], { replace: true }), 0)[0].name, "Somebody Else");
  // The names go through a run with the record.
  assert.deepEqual(generalsOf(run(world, named, 3), 0).map((general) => general.name), ["Gen. Orlov", "Gen. Petrov", ""]);
  assert.deepEqual(generalsOf(named, 1).map((general) => general.name), [""], "and the other side's are its own");
});

test("an order for one general's troops is put to them and to nobody else when the next run begins", () => {
  const world = plain();
  const opened = run(world, battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 9)], orders: [standing(0, "advance")] }), 0);
  const [north, centre, south] = generalsOf(opened, 0);
  const told = orderTroops(opened, { side: 0, troops: centre.troops, order: "dig in", by: "Aland", since: "2024-03-01" });
  assert.notEqual(told, opened);
  assert.deepEqual(told.orders.map(({ s, order, chosen }) => [s, order, Boolean(chosen)]), [[0, "advance", false], [0, "dig in", true]]);
  assert.deepEqual(chosenOrdersOf(told, 0).map((entry) => [entry.order, entry.troops.length]), [["dig in", 15]]);
  assert.deepEqual(normalizeBattlefield(told).orders, told.orders, "what was written is what the world's own check keeps");
  // The model that commands the war is told of it by how many they are.
  assert.match(describeBattlefield(told), /Aland: all advance \(major\); 15 formations dig in\./);

  const after = run(world, told, 6);
  const troops = decodeTroops(after.troops[0]);
  const start = decodeTroops(opened.troops[0]);
  for (const index of centre.troops) {
    assert.equal(troops[index].state, 4, "the centre is dug in");
    assert.deepEqual([troops[index].x, troops[index].y], [start[index].x, start[index].y], "and has not moved");
  }
  for (const index of [...north.troops, ...south.troops]) assert.ok(troops[index].x > start[index].x + 2, "the wings went forward");
  // Done: the order is not carried on, and the one for the line still stands.
  assert.deepEqual(after.orders.map(({ order, chosen }) => [order, Boolean(chosen)]), [["advance", false]]);
  assert.deepEqual(generalsOf(after, 0).map((general) => general.doing), ["advancing", "dug-in", "advancing"]);

  // Nothing is written for troops that are not there, for a word the engine has not got, or for the dead.
  assert.equal(orderTroops(opened, { side: 0, troops: [], order: "dig in" }), opened);
  assert.equal(orderTroops(opened, { side: 0, troops: [999], order: "dig in" }), opened);
  assert.equal(orderTroops(opened, { side: 0, troops: centre.troops, order: "charge" }), opened);
  assert.equal(orderTroops(opened, { side: 2, troops: centre.troops, order: "hold" }), opened);
});

test("a later order for the same troops takes the earlier one's place, and troops let go have none of their own", () => {
  const world = plain();
  const opened = run(world, battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 9)] }), 0);
  const [north, centre] = generalsOf(opened, 0);
  let record = orderTroops(opened, { side: 0, troops: north.troops, order: "advance", objective: "city: Brod" });
  record = orderTroops(record, { side: 0, troops: centre.troops, order: "dig in" });
  assert.deepEqual(chosenOrdersOf(record, 0).map((entry) => [entry.order, entry.objective, entry.troops.length]), [["advance", "city: Brod", 15], ["dig in", "", 15]]);
  // The north is told something else: its first order is gone, and nobody's numbering is off.
  record = orderTroops(record, { side: 0, troops: north.troops, order: "fall back" });
  assert.deepEqual(chosenOrdersOf(record, 0).map((entry) => [entry.order, entry.troops.length]), [["dig in", 15], ["fall back", 15]]);
  assert.deepEqual(chosenOrdersOf(record, 0)[0].troops, centre.troops);
  // Half of the centre is let go.
  record = releaseTroops(record, { side: 0, troops: centre.troops.slice(0, 8) });
  assert.deepEqual(chosenOrdersOf(record, 0).map((entry) => [entry.order, entry.troops.length]), [["dig in", 7], ["fall back", 15]]);
  record = releaseTroops(record, { side: 0, troops: centre.troops });
  assert.deepEqual(chosenOrdersOf(record, 0).map((entry) => entry.order), ["fall back"]);
  assert.equal(releaseTroops(record, { side: 0, troops: centre.troops }), record, "nothing to let go");
  // There is room for an order a general and a handful of routes, and no more than the record keeps.
  let full = opened;
  for (let index = 0; index < MAX_ORDERS_PER_SIDE + 4; index += 1) full = orderTroops(full, { side: 0, troops: [index], order: "dig in" });
  assert.equal(full.orders.length, MAX_ORDERS_PER_SIDE);
  assert.deepEqual(normalizeBattlefield(full).orders, full.orders);
});

test("a route drawn for a body of troops is a way they go along, from wherever on it they have got to", () => {
  const world = plain();
  const troops = [row(20.9, 49.85, 50.15, 6), []];
  const opened = run(world, battlefieldOn(world, { troops }), 0);
  // East for eighty kilometres, then north for sixty.
  const way = [[20.9, 50.0], [22.0, 50.0], [22.0, 50.55]];
  const told = orderTroops(opened, { side: 0, troops: [0, 1, 2, 3, 4, 5], order: "advance", way, by: "Aland" });
  assert.deepEqual(told.orders, [{ s: 0, sector: "all", order: "advance", since: "", chosen: true, by: "Aland", way }]);
  assert.match(describeBattlefield(told), /Aland: 6 formations sent along a route drawn for them \(major\); elsewhere hold\./);

  const seen = (record) => readBattlefield(record, world).troops[0];
  const mean = (list, key) => list.reduce((sum, troop) => sum + troop[key], 0) / list.length;
  const early = run(world, told, 2);
  assert.ok(mean(seen(early), "lng") > 21.3 && Math.abs(mean(seen(early), "lat") - 50) < 0.08, `two days along the first stretch: ${mean(seen(early), "lng")}, ${mean(seen(early), "lat")}`);
  assert.deepEqual(chosenOrdersOf(early, 0).map((entry) => entry.troops.length), [6], "still on it: the order is carried into the next run");
  assert.deepEqual(generalsOf(early, 0)[0].doing, "on-route");
  // The next run goes on from there: nobody goes back to where the route began.
  const later = run(world, early, 3);
  const before = seen(early);
  seen(later).forEach((troop, index) => assert.ok(troop.lng >= before[index].lng - 0.03, `troop ${index} did not go back (${before[index].lng} to ${troop.lng})`));
  const ended = run(world, later, 6);
  assert.ok(mean(seen(ended), "lng") > 21.7 && mean(seen(ended), "lat") > 50.3, `they turned north with it: ${mean(seen(ended), "lng")}, ${mean(seen(ended), "lat")}`);
  // The ground they walked through is theirs: the route is painted, not the country.
  const map = readBattlefield(ended, world);
  assert.equal(map.holderAt(21.6, 50.0), 0);
  assert.equal(map.holderAt(21.6, 49.3), 1);
  // At its end they stop, and the order is done with.
  assert.deepEqual(chosenOrdersOf(ended, 0), []);
  assert.deepEqual(ended.orders, []);
});

test("troops sent along a route go each by itself: not abreast, not in the order they stood, not all at once", () => {
  const world = plain();
  // Twelve in a line a hundred and thirty kilometres long, sent east along one route.
  const opened = runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.4, 50.6, 12), []] })], days: 0, steering: { wander: 0 } })).battlefields[0];
  const told = orderTroops(opened, { side: 0, troops: Array.from({ length: 12 }, (_, index) => index), order: "advance", way: [[20.9, 50.0], [22.4, 50.0]], by: "Aland" });
  const days = [];
  const result = runFronts({ ...frontInput(world, { battlefields: [told], days: 16, steering: { wander: 0 } }), watch: ({ day, troops }) => {
    days[day] = troops[0].map((troop) => [troop.x, troop.y]);
  } });
  const span = (day, axis) => Math.max(...days[day].map((point) => point[axis])) - Math.min(...days[day].map((point) => point[axis]));
  const across = (day) => days[day].map((point, index) => [point[1], index]).sort((a, b) => a[0] - b[0]).map((entry) => entry[1]).join(",");
  // Some set off on the first day and some are not ready yet.
  const gone = days[1].filter((point, index) => Math.abs(point[0] - days[0][index][0]) > 0.3).length;
  assert.ok(gone >= 1 && gone <= 11, `${gone} of twelve had set off on the first day`);
  // They come onto the route and go along it as a stream, strung out along it:
  // a rank would stay as broad as it stood and all of it would be level.
  assert.ok(span(3, 1) < span(0, 1) * 0.7, `they closed on the route: ${span(0, 1)} cells across, then ${span(3, 1)}`);
  assert.ok(span(3, 0) > 12, `and are strung out along it: ${span(3, 0)} cells from the first to the last`);
  // Nobody keeps the place it had in the line.
  assert.notEqual(across(4), across(0));
  // They end as a loose body round where the route ends, not as a line across
  // it, and the order is done with.
  assert.ok(span(16, 0) > 6, `${span(16, 0)} cells from the foremost to the hindmost at the end`);
  assert.deepEqual(chosenOrdersOf(result.battlefields[0], 0), []);
});

test("a route that cannot be made is given up: its troops go back to what the line is told", () => {
  const blocked = (days) => {
    const world = plain();
    // Six sent east into fourteen who are dug in across their way, with nothing to make their losses good.
    const wall = row(21.25, 49.6, 50.4, 14, { dig: 1, state: 4 });
    const opened = runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.85, 50.15, 6), wall], pool: [0, 0] })], days: 0, steering: { wander: 0 } })).battlefields[0];
    const told = orderTroops(opened, { side: 0, troops: [0, 1, 2, 3, 4, 5], order: "advance", way: [[20.9, 50.0], [22.4, 50.0]], by: "Aland" });
    const result = runFronts(frontInput(world, { battlefields: [told], days, steering: { wander: 0 } }));
    applyFlips(world, result.flips);
    return { record: result.battlefields[0], seen: readBattlefield(result.battlefields[0], world).troops[0] };
  };
  // A few days in they are still at it.
  assert.deepEqual(chosenOrdersOf(blocked(3).record, 0).map((entry) => entry.troops.length), [6]);
  // A month in they are where they were, alive, and nobody is under the order any more.
  const month = blocked(30);
  assert.equal(month.seen.filter((troop) => troop.strength > 0).length, 6);
  assert.ok(month.seen.every((troop) => troop.lng < 21.2), "they never got through");
  assert.deepEqual(chosenOrdersOf(month.record, 0), []);
  assert.deepEqual(month.record.orders, []);
});

test("two bodies sent round a place by the routes drawn for them shut it in: nothing else says encircle", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 21.6, lat: 50 }] });
  const garrison = { lng: 21.6, lat: 50.0, dig: 1, state: 4 };
  const opened = run(world, battlefieldOn(world, { troops: [[...row(20.9, 50.1, 50.5, 7), ...row(20.9, 49.5, 49.9, 7)], [garrison]], pool: [400, 0] }), 0);
  const upper = [0, 1, 2, 3, 4, 5, 6];
  const lower = [7, 8, 9, 10, 11, 12, 13];
  let told = orderTroops(opened, { side: 0, troops: upper, order: "advance", way: [[21.2, 50.45], [22.0, 50.45], [22.15, 50.0]] });
  told = orderTroops(told, { side: 0, troops: lower, order: "advance", way: [[21.2, 49.55], [22.0, 49.55], [22.15, 50.0]] });
  assert.equal(chosenOrdersOf(told, 0).length, 2);
  // Watched a day at a time: the garrison is cut off while it still stands on
  // its own ground, which is a pocket made by walking and by nothing else.
  let shutIn = -1;
  const result = runFronts({ ...frontInput(world, { battlefields: [told], days: 12, steering: steady }), watch: ({ day, troops }) => {
    if (shutIn < 0 && troops[1][0].strength > 0 && troops[1][0].pocket) shutIn = day;
  } });
  assert.ok(shutIn >= 3 && shutIn <= 10, `the garrison was cut off on day ${shutIn}`);
  const map = readBattlefield(result.battlefields[0], world);
  assert.equal(map.holderAt(22.1, 50.0), 0, "the two bodies met behind it");
  // And a pocket is closed on: by the end the place is taken, or still shut in.
  assert.ok(map.holderAt(21.6, 50.0) === 0 || map.troops[1][0].state === 2);
});

test("a drawn route is kept to a few points, and the part ahead of where one stands is what is left of it", () => {
  // A long wavering line is cut down to the places where it turns.
  const drawn = Array.from({ length: 200 }, (_, step) => [20 + step * 0.01, 50 + (step < 100 ? 0 : (step - 100) * 0.01) + Math.sin(step) * 0.0005]);
  const thin = thinRoute(drawn);
  assert.ok(thin.length <= MAX_WAY_POINTS && thin.length >= 3, `${thin.length} points`);
  assert.deepEqual(thin[0], drawn[0]);
  assert.deepEqual(thin.at(-1), drawn.at(-1));
  assert.ok(thin.some(([lng, lat]) => Math.abs(lng - 21) < 0.05 && Math.abs(lat - 50) < 0.01), "the corner is kept");
  assert.deepEqual(thinRoute([[1, 1], [2, 2]]), [[1, 1], [2, 2]]);
  assert.deepEqual(thinRoute([[1, 1], [2, 2], [3, 3], [4, 4]]), [[1, 1], [4, 4]], "a straight line is its two ends");

  const route = [[0, 0], [10, 0], [10, 10], [20, 10]];
  assert.deepEqual(routeAhead(route, -3, 1), route, "before its beginning: all of it");
  assert.deepEqual(routeAhead(route, 4, 1), [[10, 0], [10, 10], [20, 10]]);
  assert.deepEqual(routeAhead(route, 11, 6), [[10, 10], [20, 10]]);
  assert.deepEqual(routeAhead(route, 25, 9), [[20, 10]]);
  assert.deepEqual(routeAhead([[5, 5]], 0, 0), [[5, 5]]);
});

test("the record keeps a route as it was drawn and nothing that is not one", () => {
  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 6), []] });
  const kept = normalizeBattlefield({ ...record, orders: [
    { s: 0, sector: "all", order: "advance", since: "2024-03-01", chosen: true, way: [[21.123456, 50.5], ["x", 1], [22, 95], [22.5, 50.25], null] },
    { s: 0, sector: "north", order: "dig in", since: "2024-03-01", chosen: "yes", way: "east" },
    { s: 1, sector: "all", order: "advance", since: "2024-03-01", way: Array.from({ length: 40 }, (_, index) => [21 + index * 0.01, 50]) },
  ] });
  assert.deepEqual(kept.orders[0], { s: 0, sector: "all", order: "advance", since: "2024-03-01", chosen: true, way: [[21.1235, 50.5], [22.5, 50.25]] });
  assert.deepEqual(kept.orders[1], { s: 0, sector: "north", order: "dig in", since: "2024-03-01" });
  assert.equal(kept.orders[2].way.length, MAX_WAY_POINTS);
});

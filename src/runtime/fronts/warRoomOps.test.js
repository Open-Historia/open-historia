// Run: node --test src/runtime/fronts/warRoomOps.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { chosenOrdersOf, generalsOf, talkOf } from "./command.js";
import { runFronts } from "./engine.js";
import { keptPlansOf, withProjectPlan } from "./plans.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./warRoomOps.js";

// What a person does in the war room, as it is written onto the battlefields:
// for his own side only, in the engine's words only, on the battlefield only.

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [{ name: "Brod", lng: 22.6, lat: 50 }, { name: "Alba", lng: 20.4, lat: 50 }];
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
const field = () => {
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
  const record = runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 30)] })], days: 0, steering: { even: true, wander: 0 } })).battlefields[0];
  return [{ name: "Somewhere else", status: "closed" }, record];
};
const as = (player) => ({ player, date: "2024-03-01" });

test("an order is for the asker's own troops, in the war room's words", () => {
  const battlefields = field();
  const name = battlefields[1].name;
  const done = applyWarRoomOp(battlefields, { op: "order", battlefield: name.toUpperCase(), troops: [0, 1, 2, 2, "x", -4], order: "Dig In" }, as("Aland"));
  assert.equal(done.error, undefined);
  assert.equal(done.side, 0);
  assert.equal(done.battlefields[0], battlefields[0], "the other battlefields are not touched");
  assert.deepEqual(chosenOrdersOf(done.record, 0).map((order) => [order.order, order.troops, order.by]), [["dig in", [0, 1, 2], "Aland"]]);
  // The same troop numbers asked by the other side are the other side's troops.
  const theirs = applyWarRoomOp(battlefields, { op: "order", battlefield: name, troops: [0, 1, 2], order: "hold" }, as("Borduria"));
  assert.deepEqual([theirs.side, chosenOrdersOf(theirs.record, 1).length, chosenOrdersOf(theirs.record, 0).length], [1, 1, 0]);

  const refused = (op, who = "Aland") => applyWarRoomOp(battlefields, { battlefield: name, ...op }, as(who)).error;
  assert.match(refused({ op: "order", troops: [0], order: "assault" }), /do not know that order/);
  assert.match(refused({ op: "order", troops: [0], order: "land" }), /do not know that order/);
  assert.match(refused({ op: "order", troops: [900], order: "hold" }), /None of those troops/);
  assert.match(refused({ op: "order", troops: [0], order: "hold" }, "Syldavia"), /not on that battlefield/);
  assert.match(refused({ op: "order", troops: [0], order: "hold", battlefield: "Nowhere" }), /no longer open/);
  assert.match(refused({ op: "order", troops: [0], order: "hold", battlefield: "Somewhere else" }), /no longer open/);
  assert.match(refused({ op: "conquer" }), /Nothing was asked/);
});

test("a route is kept where it crosses the battlefield, and troops can be given back", () => {
  const battlefields = field();
  const name = battlefields[1].name;
  const routed = applyWarRoomOp(battlefields, { op: "route", battlefield: name, troops: [3, 4, 5], way: [[21.2, 50.8], [140, 10], [22.2, 50.6], ["a", "b"], [22.6, 50]] }, as("Aland"));
  const [order] = chosenOrdersOf(routed.record, 0);
  assert.deepEqual([order.order, order.way, order.troops], ["advance", [[21.2, 50.8], [22.2, 50.6], [22.6, 50]], [3, 4, 5]]);
  assert.match(applyWarRoomOp(battlefields, { op: "route", battlefield: name, troops: [3], way: [[140, 10], [21.2, 50.8]] }, as("Aland")).error, /does not cross the battlefield/);
  // A route that leaves the frame is kept past its edge: the battlefield grows
  // toward where its troops are sent, and a route cut at the edge would stop them there.
  const beyond = applyWarRoomOp(battlefields, { op: "route", battlefield: name, troops: [3], way: [[21.2, 50.8], [25.5, 49.4], [27.5, 50.2]] }, as("Aland"));
  assert.deepEqual(chosenOrdersOf(beyond.record, 0)[0].way, [[21.2, 50.8], [25.5, 49.4], [27.5, 50.2]]);
  // One that never touches the battlefield is no route of it.
  assert.match(applyWarRoomOp(battlefields, { op: "route", battlefield: name, troops: [3], way: [[27.2, 50.2], [27.9, 50.2]] }, as("Aland")).error, /does not cross the battlefield/);
  // A drawing of very many points is thinned from end to end, never cut short: its last point is where the troops go.
  const long = Array.from({ length: 3000 }, (_, index) => [21.2 + (index * 3.6) / 2999, 50.8 - (index * 0.9) / 2999]);
  const sent = cleanWarRoomOp({ op: "route", battlefield: name, troops: [3], way: long });
  assert.ok(sent.way.length <= 100, `${sent.way.length} points sent`);
  assert.deepEqual(sent.way.at(-1), [24.8, 49.9]);
  const drawn = chosenOrdersOf(applyWarRoomOp(battlefields, { op: "route", battlefield: name, troops: [3], way: long }, as("Aland")).record, 0)[0].way;
  assert.deepEqual([drawn[0], drawn.at(-1)], [[21.2, 50.8], [24.8, 49.9]]);
  const released = applyWarRoomOp(routed.battlefields, { op: "release", battlefield: name, troops: [3, 4, 5, 6] }, as("Aland"));
  assert.deepEqual(chosenOrdersOf(released.record, 0), []);
  assert.equal(released.record.orders.length, 0);
});

test("a turn of talk keeps what was said, names the generals and gives the orders they took", () => {
  const battlefields = field();
  const name = battlefields[1].name;
  const op = {
    op: "talk", battlefield: name, said: "Second Army, take Brod.",
    lines: [{ who: 1, text: "We go at first light." }, { who: 7, text: "Nobody commands a seventh army." }, { who: 0, text: "   " }],
    orders: [{ command: 1, order: "spearhead", objective: "city: Brod" }, { command: 1, order: "hold" }, { command: 0, order: "conquer" }, { command: 9, order: "hold" }],
    names: ["Gen. Orlov", "Gen. Petrov"],
  };
  const done = applyWarRoomOp(battlefields, op, as("Aland"));
  assert.deepEqual(talkOf(done.record, 0), [
    { who: "", text: "Second Army, take Brod.", at: "2024-03-01" },
    { who: 1, text: "We go at first light.", at: "2024-03-01" },
  ]);
  assert.deepEqual(talkOf(done.record, 1), [], "the other side heard none of it");
  const generals = generalsOf(done.record, 0);
  assert.deepEqual(generals.map((general) => general.name), ["Gen. Orlov", "Gen. Petrov", ""]);
  const orders = chosenOrdersOf(done.record, 0);
  assert.deepEqual(orders.map((order) => [order.order, order.objective]), [["spearhead", "city: Brod"]], "one order a general, and only orders there are");
  assert.deepEqual(orders[0].troops, generals[1].troops);
  // The talk is cleared for the asker's side alone.
  const forgot = applyWarRoomOp(done.battlefields, { op: "forget", battlefield: name }, as("Aland"));
  assert.deepEqual(talkOf(forgot.record, 0), []);
  assert.equal(chosenOrdersOf(forgot.record, 0).length, 1, "what was ordered stands");
  assert.match(applyWarRoomOp(battlefields, { op: "talk", battlefield: name, said: "", lines: [] }, as("Aland")).error, /Nothing was asked/);
});

test("a diversion and a redrawn operation are kept as plans, and taken off again", () => {
  const battlefields = field();
  const name = battlefields[1].name;
  let done = applyWarRoomOp(battlefields, { op: "diversion", battlefield: name, way: [[20.9, 49.2], [22, 49.2], [23.4, 49.4]], troops: 30 }, as("Aland"));
  assert.deepEqual(keptPlansOf(done.record, 0).map((plan) => [plan.id, plan.kind, plan.troops, plan.at]), [["d1", "diversion", 30, "2024-03-01"]]);
  done = applyWarRoomOp(done.battlefields, { op: "plan", battlefield: name, project: "project-kingfisher", way: [[21, 49.3], [22.6, 50]] }, as("Aland"));
  done = applyWarRoomOp(done.battlefields, { op: "plan", battlefield: name, project: "project-kingfisher", off: true }, as("Aland"));
  assert.deepEqual(keptPlansOf(done.record, 0).map((plan) => [plan.id, Boolean(plan.way), plan.off === true]), [["d1", true, false], ["project:project-kingfisher", true, true]]);
  // Putting the suggested arrow back leaves the rest of what was said of it.
  done = applyWarRoomOp(done.battlefields, { op: "plan", battlefield: name, project: "project-kingfisher", way: [] }, as("Aland"));
  assert.deepEqual(keptPlansOf(done.record, 0).map((plan) => [plan.id, Boolean(plan.way), plan.off === true]), [["d1", true, false], ["project:project-kingfisher", false, true]]);
  // An operation that was carried out is marked so; told again, the mark comes off.
  const carried = withProjectPlan(done.record, 0, { project: "project-kingfisher", sent: true });
  assert.equal(keptPlansOf(carried, 0).find((plan) => plan.kind === "project").sent, true);
  const again = applyWarRoomOp(done.battlefields.map((row) => (row.name === name ? carried : row)), { op: "plan", battlefield: name, project: "project-kingfisher", again: true }, as("Aland"));
  assert.equal(keptPlansOf(again.record, 0).find((plan) => plan.kind === "project").sent, undefined);
  done = applyWarRoomOp(done.battlefields, { op: "unplan", battlefield: name, id: "d1" }, as("Aland"));
  assert.deepEqual(keptPlansOf(done.record, 0).map((plan) => plan.id), ["project:project-kingfisher"]);
  assert.deepEqual(keptPlansOf(done.record, 1), []);
  assert.match(applyWarRoomOp(battlefields, { op: "diversion", battlefield: name, way: [[20.9, 49.2]] }, as("Aland")).error, /does not cross the battlefield/);
  assert.match(applyWarRoomOp(battlefields, { op: "plan", battlefield: name, project: "x", way: [[140, 10]] }, as("Aland")).error, /does not cross the battlefield/);
});

test("an op is cut to its own fields before it is sent anywhere", () => {
  assert.equal(cleanWarRoomOp({ op: "conquer" }), null);
  assert.equal(cleanWarRoomOp(null), null);
  const sent = cleanWarRoomOp({ op: "route", battlefield: "  The  Front ", troops: [1, 1, 2.5, "3"], way: Array.from({ length: 900 }, (_, index) => [20 + index / 1000, 50]), secret: "x", off: null });
  assert.deepEqual(Object.keys(sent).sort(), ["battlefield", "op", "troops", "way"]);
  assert.deepEqual([sent.battlefield, sent.troops], ["The Front", [1, 3]]);
  assert.ok(sent.way.length <= 100 && sent.way.length >= 2, `a long way is thinned (${sent.way.length})`);
  assert.deepEqual(cleanWarRoomOp({ op: "plan", battlefield: "F", project: "p", off: false }), { op: "plan", battlefield: "F", project: "p", off: false });
  assert.deepEqual(cleanWarRoomOp({ op: "plan", battlefield: "F", project: "p", again: true }), { op: "plan", battlefield: "F", project: "p", again: true });
  assert.deepEqual(cleanWarRoomOp({ op: "plan", battlefield: "F", project: "p", again: "yes" }), { op: "plan", battlefield: "F", project: "p" });
  assert.deepEqual(cleanWarRoomOp({ op: "talk", battlefield: "F", said: "Go.", lines: [{ who: 0, text: " Yes. ", extra: 1 }], orders: [{ command: 0, order: "HOLD" }], names: ["  Gen.  A "] }),
    { op: "talk", battlefield: "F", said: "Go.", lines: [{ who: 0, text: "Yes." }], orders: [{ command: 0, order: "hold", objective: "" }], names: ["Gen. A"] });
});

test("troops picked out are sent by a transporter, one not yet out is called off, and the other side's is gone after", () => {
  const battlefields = field();
  const name = battlefields[1].name;
  const ask = (op, who = "Aland", transports = []) => applyWarRoomOp(battlefields, { battlefield: name, ...op }, { ...as(who), transports });
  const sent = ask({ op: "transport", troops: [3, 4, 5, 5, 900], medium: "sea", to: [24.6, 50.2], name: "city: Brod" });
  assert.equal(sent.error, undefined);
  assert.equal(sent.battlefields, battlefields, "no battlefield is changed by it: the troops board when time next passes");
  assert.deepEqual(sent.transports.map((entry) => [entry.id, entry.status, entry.medium, entry.kind, entry.owner, entry.by, entry.warId, entry.to, entry.embark, entry.ordered]), [
    ["t1", "ordered", "sea", "troop convoy", "Aland", "Aland", "war-1", { lng: 24.6, lat: 50.2, name: "city: Brod" }, { battlefield: name, side: 0, troops: [3, 4, 5] }, "2024-03-01"],
  ]);
  // The same troops are not sent twice: those already told to board are left out of a second dispatch.
  const more = ask({ op: "transport", troops: [5, 6], medium: "air", to: [24, 50] }, "Aland", sent.transports);
  assert.deepEqual(more.transports.map((entry) => [entry.id, entry.medium, entry.embark.troops]), [["t1", "sea", [3, 4, 5]], ["t2", "air", [6]]]);
  assert.match(ask({ op: "transport", troops: [3, 4], medium: "land", to: [24, 50] }, "Aland", sent.transports).error, /already told to board/);
  // The other side's troops are the other side's: the same numbers asked by Borduria are its own.
  assert.deepEqual(ask({ op: "transport", troops: [3], medium: "sea", to: [20.2, 50] }, "Borduria").transports[0].embark, { battlefield: name, side: 1, troops: [3] });
  assert.match(ask({ op: "transport", troops: [900], medium: "sea", to: [24, 50] }).error, /None of those troops/);
  assert.match(ask({ op: "transport", troops: [3], medium: "balloon", to: [24, 50] }).error, /Nothing of that kind carries troops yet/);
  assert.match(ask({ op: "transport", troops: [3], medium: "sea" }).error, /Say where/);
  assert.match(ask({ op: "transport", troops: [3], medium: "sea", to: ["x", 2] }).error, /Say where/);
  assert.match(ask({ op: "transport", troops: [3], medium: "sea", to: [24, 50] }, "Syldavia").error, /not on that battlefield/);
  // Before anything flew troops, nothing does.
  assert.match(applyWarRoomOp(battlefields, { op: "transport", battlefield: name, troops: [3], medium: "air", to: [24, 50] }, { player: "Aland", date: "1890-03-01" }).error, /Nothing of that kind carries troops yet/);

  // Called off while it has not set out, by whoever sent it; not once it is out, and not by anybody else.
  assert.deepEqual(ask({ op: "untransport", id: "t1" }, "Aland", sent.transports).transports, []);
  assert.match(ask({ op: "untransport", id: "t1" }, "Borduria", sent.transports).error, /set out already, or is not yours/);
  const out = sent.transports.map((entry) => ({ ...entry, status: "moving", way: [[21, 50], [24.6, 50.2]], km: 250 }));
  assert.match(ask({ op: "untransport", id: "t1" }, "Aland", out).error, /set out already/);
  // The other side goes after it, and stops; a side does not hunt its own, and nobody hunts what is not there.
  const hunted = ask({ op: "hunt", id: "t1" }, "Borduria", out);
  assert.deepEqual(hunted.transports[0].hunters, ["Borduria"]);
  assert.deepEqual(ask({ op: "hunt", id: "t1", off: true }, "Borduria", hunted.transports).transports[0].hunters, []);
  assert.match(ask({ op: "hunt", id: "t1" }, "Aland", out).error, /not a transporter of a side you are fighting/);
  assert.match(ask({ op: "hunt", id: "t9" }, "Borduria", out).error, /not a transporter of a side you are fighting/);
  // What is sent to a host is the op's own fields, each held to what it is.
  assert.deepEqual(cleanWarRoomOp({ op: "transport", battlefield: name, troops: [3, "4"], medium: "sea", to: [24.60004, "50.2"], name: "  city:  Brod ", speed: 9000 }), { op: "transport", battlefield: name, troops: [3, 4], to: [24.6, 50.2], medium: "sea", name: "city: Brod" });
  assert.equal(cleanWarRoomOp({ op: "transport", battlefield: name, medium: "balloon" }).medium, "");
  assert.deepEqual(cleanWarRoomOp({ op: "hunt", battlefield: name, id: "t1", off: true }), { op: "hunt", battlefield: name, off: true, id: "t1" });
});

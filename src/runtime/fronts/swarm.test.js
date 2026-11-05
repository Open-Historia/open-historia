// Run: node --test src/runtime/fronts/swarm.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { takeCapsule } from "./field.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, disc, readBattlefield, settleWorld } from "./testKit.js";

// How troops move, as the owner settled it on the map. Each test is named for
// what he asked for.

const legend = { A: "Aland", B: "Borduria", "~": null };
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The front", side, order: word, sector: "all", ...extra });

// A run a day at a time: each side's troops as they stood after each day (day
// 0 first), with what each was at, and the ground.
const watchRun = (input) => {
  const days = [];
  const result = runFronts({ ...input, watch: ({ day, troops, holders }) => {
    days[day] = {
      troops: troops.map((list) => list.map(({ x, y, strength, state, order: at, dug, pocket }) => ({ x, y, strength, state, dug, pocket, at: at && !at.done ? at.kind : "", after: at && !at.done && at.resume && !at.resume.done ? at.resume.kind : "" }))),
      holders: Uint8Array.from(holders),
    };
  } });
  return { days, result };
};
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const heldBy = (holders, side) => holders.reduce((count, holder) => count + (holder === side ? 1 : 0), 0);

test("a group told to advance goes as a rank and ends spread along its line: nobody gathers, nobody turns back", () => {
  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 8), []], orders: [standing(0, "advance")] });
  const { days } = watchRun(frontInput(world, { battlefields: [record], days: 8 }));
  const km = record.frame.km;
  const first = days[0].troops[0];
  const last = days[8].troops[0];
  // They went: every one of them, and a long way.
  for (let index = 0; index < 8; index += 1) assert.ok((last[index].x - first[index].x) * km > 120, `troop ${index} went ${(last[index].x - first[index].x) * km} km`);
  // Abreast in the order they stood in: no two crossed.
  for (let index = 1; index < 8; index += 1) assert.ok(last[index].y > last[index - 1].y, "still in the order they stood in");
  // Spread along the line they reached: nobody within a tenth of the group's breadth of another.
  const breadth = (last[7].y - last[0].y) * km;
  assert.ok(breadth > 130, `the rank is ${breadth} km broad`);
  for (let a = 0; a < 8; a += 1) {
    for (let b = a + 1; b < 8; b += 1) assert.ok(apart(last[a], last[b]) * km >= breadth / 10, `troops ${a} and ${b} ended ${apart(last[a], last[b]) * km} km apart`);
  }
  // No path turns back on itself while it is advancing.
  let moves = 0;
  for (let index = 0; index < 8; index += 1) {
    for (let day = 2; day <= 8; day += 1) {
      if (days[day].troops[0][index].at !== "way" || days[day - 1].troops[0][index].at !== "way") continue;
      const now = [days[day].troops[0][index].x - days[day - 1].troops[0][index].x, days[day].troops[0][index].y - days[day - 1].troops[0][index].y];
      const then = [days[day - 1].troops[0][index].x - days[day - 2].troops[0][index].x, days[day - 1].troops[0][index].y - days[day - 2].troops[0][index].y];
      if (Math.hypot(...now) < 0.5 || Math.hypot(...then) < 0.5) continue;
      moves += 1;
      const cos = (now[0] * then[0] + now[1] * then[1]) / (Math.hypot(...now) * Math.hypot(...then));
      assert.ok(cos > 0.5, `troop ${index} turned back on day ${day} (cosine ${cos})`);
    }
  }
  assert.ok(moves > 30);
});

test("a spearhead is a point and its shoulders, and its point does not end stacked where the way ends", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 22.4, lat: 50 }] });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49.3, 50.7, 12).map((troop, index) => ({ ...troop, kind: index % 4 === 1 ? 1 : 0 })), row(21.1, 49, 51, 4, { strength: 40 })],
    orders: [standing(0, "spearhead", { objective: "city: Brod" })],
  });
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 14 }));
  const km = record.frame.km;
  const last = days[14].troops[0];
  const first = days[0].troops[0];
  const gone = last.map((troop, index) => (troop.x - first[index].x) * km);
  // The point is the leading third: the four that went furthest, the armour among them.
  const byReach = gone.map((reach, index) => ({ reach, index })).sort((a, b) => b.reach - a.reach);
  const point = byReach.slice(0, 4).map((entry) => entry.index);
  assert.ok(point.filter((index) => index % 4 === 1).length >= 2, `the armour is at the point (${point})`);
  assert.ok(byReach[0].reach > 70, `the point went ${byReach[0].reach} km`);
  for (let a = 0; a < 4; a += 1) {
    for (let b = a + 1; b < 4; b += 1) assert.ok(apart(last[point[a]], last[point[b]]) * km > 5, `two of the point ended ${apart(last[point[a]], last[point[b]]) * km} km apart`);
  }
  // The shoulders stopped short of it, staggered back, out to the sides they began on.
  const shoulders = byReach.slice(4);
  assert.ok(shoulders.at(-1).reach < byReach[0].reach * 0.6, `the rearmost shoulder went ${shoulders.at(-1).reach} km of the point's ${byReach[0].reach}`);
  const middle = (last[point[0]].y + last[point[1]].y + last[point[2]].y + last[point[3]].y) / 4;
  for (const { index } of shoulders) assert.equal(Math.sign(last[index].y - middle), Math.sign(first[index].y - (first[0].y + first[11].y) / 2), `shoulder ${index} is on the side it began on`);
  // Everyone has done: nobody is still walking, and nobody circles the town.
  assert.ok(last.every((troop) => troop.at === ""), "the order is carried out");
  assert.equal(readBattlefield(result.battlefields[0], world).holderAt(22.4, 50), HOLDER_SIDE_A, "and the town is taken");
});

test("troops marching past a pocket do not go by it: the nearest wheel in, whatever their order, and go on after", () => {
  // Borduria holds a piece of ground 40 km across with two troops in it, cut
  // off behind a rank of Aland's that has been told to advance east past it.
  const world = plain({ cities: [{ name: "Brod", lng: 22.2, lat: 50.0 }] });
  const record = settleWorld(world, battlefieldOn(world, {
    troops: [row(22.75, 49.2, 50.8, 10), [{ lng: 22.15, lat: 50.0 }, { lng: 22.25, lat: 50.05 }, ...row(24.9, 49.2, 50.8, 3)]],
    orders: [standing(0, "advance")],
    carve: (field, toCell) => {
      // Aland has come 120 km, leaving the town and the ground round it behind.
      const [x, y] = toCell(22.2, 50.0);
      for (let index = 0; index < field.size; index += 1) {
        const col = (index % field.cols) + 0.5;
        const line = Math.floor(index / field.cols) + 0.5;
        if (field.play[index] && col < toCell(22.7, 50)[0] && Math.hypot(col - x, line - y) > 5) disc(field, HOLDER_SIDE_A, col, line, 0.6);
      }
    },
  }));
  const before = readBattlefield(record, world);
  assert.equal(before.holderAt(22.2, 50.0), HOLDER_SIDE_B);
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 14 }));
  const km = record.frame.km;
  const [townX, townY] = before.place.toCell(22.2, 50.0);
  // Within a day the nearest of them are closing on it, taken off the order they were under.
  const sent = days[1].troops[0].map((troop, index) => ({ ...troop, index })).filter((troop) => troop.at === "reduce");
  assert.ok(sent.length >= 3 && sent.length <= 10, `${sent.length} troops were sent at it`);
  assert.ok(sent.every((troop) => troop.after === "way"), "and each has its order to go back to");
  const nearest = days[0].troops[0].map((troop, index) => ({ index, away: Math.hypot(troop.x - townX, troop.y - townY) })).sort((a, b) => a.away - b.away);
  for (const troop of sent) assert.ok(nearest.findIndex((entry) => entry.index === troop.index) < sent.length + 2, `troop ${troop.index} was among the nearest`);
  // They went in: toward it, not on east with the rest.
  for (const troop of sent) {
    const was = days[0].troops[0][troop.index];
    const mid = days[3].troops[0][troop.index];
    assert.ok(Math.hypot(mid.x - townX, mid.y - townY) < Math.hypot(was.x - townX, was.y - townY), `troop ${troop.index} closed on it`);
  }
  // It was closed: the ground is Aland's, and nobody of Borduria's is left standing behind the line.
  const last = days[14];
  assert.equal(readBattlefield(result.battlefields[0], world).holderAt(22.2, 50.0), HOLDER_SIDE_A, "the pocket is gone");
  // Its two troops were driven off it: taken, or got away to their own side the worse for it.
  const front = Math.min(...last.troops[0].filter((troop) => troop.strength > 0).map((troop) => troop.x));
  for (const troop of last.troops[1].slice(0, 2)) assert.ok(!(troop.strength > 0) || (troop.strength <= 90 && troop.x > front - 40 / km), `one of its troops: ${troop.strength} at ${troop.x}`);
  assert.ok(last.troops[1].every((troop) => !(troop.strength > 0) || troop.x > front - 40 / km), "nobody is left alive behind the line");
  // And those that closed it went back to what they were told: on their way east again.
  const closed = days.findIndex((day) => day.holders[Math.floor(townY) * record.frame.cols + Math.floor(townX)] === HOLDER_SIDE_A);
  assert.ok(closed >= 1 && closed <= 8, `it was closed on day ${closed}`);
  for (const troop of sent) {
    if (!(last.troops[0][troop.index].strength > 0)) continue;
    // (Never more than ten days at it, whatever else there was to close on along the way.)
    let longest = 0;
    let stretch = 0;
    for (const day of days) {
      stretch = day.troops[0][troop.index].at === "reduce" ? stretch + 1 : 0;
      longest = Math.max(longest, stretch);
    }
    assert.ok(longest <= 10, `troop ${troop.index} was closing on ground for ${longest} days running`);
    assert.ok(days.slice(closed).some((day) => day.troops[0][troop.index].at === "way"), `troop ${troop.index} went back to its order`);
    assert.ok(last.troops[0][troop.index].x > days[0].troops[0][troop.index].x + 20 / km, `and went on east (${(last.troops[0][troop.index].x - days[0].troops[0][troop.index].x) * km} km)`);
  }
});

test("dug in, a troop is stronger and does not move at all, until the ground it stands on is lost", () => {
  const world = plain();
  // Borduria digs in in the north; the fighting is in the south, where Aland
  // attacks a line that holds it.
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49, 50, 6), [...row(21.1, 49, 50, 6), ...row(21.08, 50.4, 50.95, 4)]],
    orders: [standing(0, "advance", { sector: "south" }), standing(1, "dig in", { sector: "north" })],
    pool: [600, 600],
  });
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 60 }));
  const dug = [6, 7, 8, 9];
  for (const index of dug) {
    for (const day of [1, 20, 40, 60]) {
      const troop = days[day].troops[1][index];
      assert.equal(troop.dug, true, `day ${day}: troop ${index} is dug in`);
      assert.equal(troop.state, 4);
      assert.ok(troop.x === days[0].troops[1][index].x && troop.y === days[0].troops[1][index].y, `day ${day}: troop ${index} has not moved`);
    }
  }
  const saved = readBattlefield(result.battlefields[0], world);
  for (const index of dug) {
    assert.equal(saved.troops[1][index].state, 4, "saved as dug in");
    assert.equal(saved.troops[1][index].dig, 1);
  }
  // There was fighting beside them all that time.
  assert.ok(days[60].troops[0].some((troop) => troop.strength < 95), "Aland's attack in the south was paid for");
  // The next run finds them dug in still. Then Aland comes at the north with
  // six times their number: where the ground under one is lost it is thrown
  // out of its works, the worse for it, and is a troop like any other again.
  const later = watchRun(frontInput(world, {
    battlefields: result.battlefields,
    days: 12,
    fromDate: "2024-04-30",
    moments: [
      ...row(20.95, 50.35, 50.98, 24).map((troop) => ({ day: 0, type: "reinforce", owner: "Aland", strength: 100, kind: "infantry", ...troop })),
      order(0, "Aland", "advance", { sector: "north" }),
    ],
  }));
  assert.ok(dug.every((index) => later.days[0].troops[1][index].dug), "dug in as the next run begins");
  const out = dug.filter((index) => !later.days[12].troops[1][index].dug);
  assert.ok(out.length >= 1, "the attack threw some of them out of their works");
  for (const index of out) {
    const day = later.days.findIndex((entry) => !entry.troops[1][index].dug);
    const was = later.days[day - 1].troops[1][index];
    const now = later.days[day].troops[1][index];
    assert.ok(later.days[day - 1].holders[Math.floor(was.y) * record.frame.cols + Math.floor(was.x)] === HOLDER_SIDE_A, `troop ${index}: the ground under it was lost the day before`);
    assert.ok(now.strength <= was.strength - 15 || now.strength === 0, `and it cost it (${was.strength} to ${now.strength})`);
  }
  // Until then they had not moved.
  for (const index of dug) {
    const day = later.days.findIndex((entry) => !entry.troops[1][index].dug);
    const until = day < 0 ? 12 : day - 1;
    assert.ok(later.days[until].troops[1][index].x === later.days[0].troops[1][index].x, `troop ${index} stood until day ${until}`);
  }
});

test("an assault is sent at what it names: troops come off their orders, close round it without stacking on it, and go back", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 21.9, lat: 50.3 }] });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49, 51, 14), row(21.1, 49, 51, 5, { strength: 50 })],
    orders: [standing(0, "advance")],
    pool: [400, 100],
  });
  const moments = [order(2, "Aland", "assault", { objective: "city: Brod" }), order(2, "Aland", "assault", { objective: "city: Atlantis", ref: 7 })];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 16, moments }));
  const km = record.frame.km;
  const [townX, townY] = readBattlefield(record, world).place.toCell(21.9, 50.3);
  assert.deepEqual(result.notes, [{ battlefield: "The front", side: "Aland", ref: 7, kind: "objective-not-found", detail: "city: Atlantis" }]);
  // The day it is ordered: six at least, the nearest, whatever they were at.
  const sent = days[2].troops[0].map((troop, index) => ({ ...troop, index })).filter((troop) => troop.at === "assault");
  assert.ok(sent.length >= 6 && sent.length <= 24, `${sent.length} troops were sent`);
  const away = days[2].troops[0].map((troop, index) => ({ index, away: Math.hypot(troop.x - townX, troop.y - townY) })).sort((a, b) => a.away - b.away);
  assert.deepEqual(sent.map((troop) => troop.index).sort((a, b) => a - b), away.slice(0, sent.length).map((entry) => entry.index).sort((a, b) => a - b), "the nearest of them");
  assert.ok(sent.every((troop) => troop.after === "way"), "each of them taken off the advance it was on");
  const ordered = runFronts(frontInput(world, { battlefields: [record], days: 2, moments }));
  assert.deepEqual(ordered.battlefields[0].log.filter((entry) => entry.k === "assault"), [{ d: "2024-03-03", k: "assault", s: 0, at: "city: Brod" }]);
  assert.deepEqual(ordered.battlefields[0].orders.filter((entry) => entry.order === "assault"), [{ s: 0, sector: "all", order: "assault", since: "2024-03-03", objective: "city: Brod", by: "Aland" }]);
  // It falls, and the log says so the usual way.
  const fell = days.findIndex((day) => day.holders[Math.floor(townY) * record.frame.cols + Math.floor(townX)] === HOLDER_SIDE_A);
  assert.ok(fell > 2 && fell <= 14, `the town fell on day ${fell}`);
  assert.equal(result.battlefields[0].log.filter((entry) => entry.k === "city" && entry.at === "city: Brod" && entry.s === 0).length, 1);
  // They closed round it and did not stack on it.
  const there = sent.map((troop) => days[fell].troops[0][troop.index]).filter((troop) => troop.strength > 0);
  for (const troop of there) assert.ok(Math.hypot(troop.x - townX, troop.y - townY) * km > 2.5, "each stopped short of the place itself");
  let close = 0;
  for (let a = 0; a < there.length; a += 1) for (let b = a + 1; b < there.length; b += 1) if (apart(there[a], there[b]) * km < 2) close += 1;
  assert.ok(close <= 1, `${close} pairs of them within 2 km of each other`);
  // Then they went on with what they were at, and the assault is no longer a standing order.
  for (const troop of sent) assert.notEqual(days[16].troops[0][troop.index].at, "assault");
  assert.ok(sent.filter((troop) => troop.after === "way").every((troop) => ["way", ""].includes(days[fell + 1].troops[0][troop.index].at)));
  assert.equal(result.battlefields[0].orders.some((entry) => entry.order === "assault"), false);
});

test("an assault on a formation follows it, and is done when the formation is gone", () => {
  const world = plain();
  const units = [{ id: "unit-9", name: "9th Guards", type: "armor", ownerCode: "Borduria", strength: 60, lng: 21.5, lat: 50.0 }];
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 4, { strength: 50 })], pool: [400, 0] });
  const moments = [order(1, "Aland", "assault", { objective: "unit: 9th Guards" }), order(1, "Borduria", "fall back", { sector: "centre" })];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], units, days: 20, moments }));
  const [saved] = result.battlefields;
  const guards = saved.named.find((entry) => entry.unitId === "unit-9");
  const sent = days[1].troops[0].map((troop, index) => ({ ...troop, index })).filter((troop) => troop.at === "assault");
  assert.ok(sent.length >= 6, `${sent.length} troops were sent at it`);
  // It moved, and they went after it where it went.
  const path = days.map((day) => day.troops[1][guards.i]);
  const gone = path.findIndex((troop) => !(troop.strength > 0));
  assert.ok(gone > 2, `the formation was destroyed on day ${gone}`);
  assert.ok(apart(path[gone - 1], path[1]) > 2, "it had moved from where it stood when the order was given");
  const closest = (day) => Math.min(...sent.map((troop) => apart(days[day].troops[0][troop.index], path[Math.min(day, gone - 1)])));
  assert.ok(closest(gone - 1) * record.frame.km < 12, `they were upon it (${closest(gone - 1) * record.frame.km} km) where it had got to`);
  // Once they were upon it, it was fought where it stood: it did not slip away from under them.
  assert.equal(apart(path[gone - 1], path[gone - 3]), 0, "it stood for its last days");
  assert.ok(path[gone - 1].strength < path[gone - 3].strength - 4, "and was worn down there");
  assert.deepEqual(saved.log.filter((entry) => entry.k === "destroyed"), [{ d: saved.log.find((entry) => entry.k === "destroyed").d, k: "destroyed", s: 0, at: "unit: 9th Guards" }]);
  assert.ok(result.unitChanges.some((change) => change.unitId === "unit-9" && change.remove === true), "and the world is told it is gone");
  for (const troop of sent) assert.notEqual(days[20].troops[0][troop.index].at, "assault");
  assert.equal(saved.orders.some((entry) => entry.order === "assault"), false, "the order is done with");
});

// Aland three regions deep, so that a tongue into it does not all but cut it in two.
const deep = () => syntheticMap({ layout: ["AAABBB", "AAABBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
// A tongue of Borduria's ground 50 km long and 20 wide, reaching west into
// Aland's country along the 50th parallel.
const tongue = (field, toCell) => {
  const [x0, y] = toCell(23.0, 50);
  const [x1] = toCell(22.3, 50);
  takeCapsule(field, HOLDER_SIDE_B, x0, y, x1, y, 2.5, 2.5);
};

test("ground squeezed between the other side's is closed on, and its troops fight as surrounded; a thrust still being driven is not", () => {
  const world = deep();
  const inIt = [{ lng: 22.38, lat: 50.0 }, { lng: 22.52, lat: 50.0 }];
  const ours = [...row(22.5, 49.2, 49.8, 4), ...row(22.5, 50.2, 50.8, 4)];
  // Left there by a fight that has stopped: squeezed.
  const stopped = battlefieldOn(world, { troops: [ours, [...inIt, ...row(23.2, 49, 51, 4)]], carve: tongue });
  const { days } = watchRun(frontInput(world, { battlefields: [stopped], days: 6 }));
  for (const index of [0, 1]) {
    assert.equal(days[1].troops[1][index].pocket, true, "its troops fight as surrounded");
    assert.equal(days[1].troops[1][index].state, 2);
  }
  assert.ok(days[1].troops[1].slice(2).every((troop) => !troop.pocket), "those on the line are not");
  const closing = days[1].troops[0].filter((troop) => troop.at === "reduce");
  assert.ok(closing.length >= 3, `${closing.length} of Aland's troops beside it are closing on it, with no order to`);
  const taken = (day) => heldBy(days[day].holders, HOLDER_SIDE_B);
  assert.ok(taken(6) < taken(0) - 25, `the end of the tongue is closed: ${taken(0)} cells of Borduria's became ${taken(6)}`);
  // They do not give up as a pocket does, and waste more slowly: a point a day, with the fighting on top of it.
  assert.ok(days[1].troops[1][0].strength <= 99 && days[1].troops[1][0].strength > 90);

  // The same ground with a column being driven along it: it is there because it means to be.
  const driven = battlefieldOn(world, { troops: [ours, [...inIt, ...row(23.2, 49, 51, 4)]], carve: tongue, orders: [standing(1, "advance", { sector: "centre" })] });
  const thrust = watchRun(frontInput(world, { battlefields: [driven], days: 2 }));
  assert.ok(thrust.days[1].troops[1].slice(0, 2).every((troop) => !troop.pocket && troop.at === "way"), "a thrust is not squeezed while it is driven");
  assert.equal(thrust.days[1].troops[0].filter((troop) => troop.at === "reduce").length, 0);
});

test("a bend of the border as it always was is not squeezed, however deep", () => {
  // Borduria's own country reaches west between two parts of Aland's: the same
  // shape as a tongue, and nobody made it by fighting.
  const world = syntheticMap({ layout: ["AAABBB", "ABBBBB", "AAABBB"], legend, west: 20, north: 50.6, step: 1, stepLat: 0.4 });
  const record = battlefieldOn(world, { troops: [[...row(21.5, 49.5, 49.7, 3), ...row(21.5, 50.3, 50.5, 3)], [{ lng: 21.5, lat: 50.0 }, { lng: 22.0, lat: 50.0 }, ...row(23.2, 49.5, 50.5, 3)]] });
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 5 }));
  assert.ok(days[5].troops[1].every((troop) => !troop.pocket && troop.state === 0), "nobody in it is surrounded");
  assert.ok(days[5].troops[0].every((troop) => troop.at === ""), "and nobody closes on it");
  assert.deepEqual(result.battlefields[0].field, record.field);
});

test("two equal sides that both attack stop each other: nobody walks through, nobody swaps countries", () => {
  const world = syntheticMap({ layout: ["AAABBB", "AAABBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  for (const count of [40, 400]) {
    const record = battlefieldOn(world, {
      troops: [row(22.9, 49, 51, count), row(23.1, 49, 51, count)],
      orders: [standing(0, "advance"), standing(1, "advance")],
      pool: [count * 30, count * 30],
    });
    const { days } = watchRun(frontInput(world, { battlefields: [record], days: 30 }));
    const began = [heldBy(days[0].holders, HOLDER_SIDE_A), heldBy(days[0].holders, HOLDER_SIDE_B)];
    const [border] = readBattlefield(record, world).place.toCell(23.0, 50);
    for (const day of [5, 15, 30]) {
      const held = [heldBy(days[day].holders, HOLDER_SIDE_A), heldBy(days[day].holders, HOLDER_SIDE_B)];
      assert.ok(Math.abs(held[0] - began[0]) < began[1] * 0.03, `${count} a side, day ${day}: Aland holds ${held[0]} cells where it held ${began[0]}`);
      assert.ok(Math.abs(held[1] - began[1]) < began[0] * 0.03);
      const live = days[day].troops.map((list) => list.filter((troop) => troop.strength > 0));
      assert.ok(live[0].length >= count * 0.95 && live[1].length >= count * 0.95, `day ${day}: ${live.map((list) => list.length)} left of ${count} a side`);
      assert.ok(live[0].every((troop) => troop.x < border + 3) && live[1].every((troop) => troop.x > border - 3), "each is still on its own side of the border");
      assert.ok(live.every((list) => list.every((troop) => !troop.pocket)), "and nobody is cut off");
    }
  }
});

test("a run cut at day k ends as the full run stood after day k, with ways, dug-in troops, an assault and a pocket in it", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 22.0, lat: 50.4 }, { name: "Port", lng: 22.2, lat: 49.5 }] });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49, 51, 14), [...row(21.1, 49, 51, 6, { strength: 60 }), { lng: 21.9, lat: 49.6 }, { lng: 22.0, lat: 49.5 }]],
    orders: [standing(1, "dig in", { sector: "north" })],
    pool: [400, 200],
  });
  const moments = [
    order(0, "Aland", "spearhead", { sector: "south", objective: "city: Port" }),
    order(2, "Aland", "assault", { objective: "city: Brod" }),
    order(4, "Borduria", "advance", { sector: "centre" }),
    order(6, "Aland", "flank", { sector: "centre", objective: "city: Brod" }),
    order(8, "Borduria", "fall back", { sector: "south" }),
    order(9, "Aland", "hold", { sector: "south", result: "stalemate" }),
  ];
  const input = (days) => frontInput(world, { battlefields: [record], days, moments: moments.filter((moment) => moment.day <= days) });
  const withoutReplay = (battlefields) => battlefields.map(({ replay: _replay, ...rest }) => rest);
  const run = createFrontRun(input(12));
  for (const k of [0, 1, 3, 5, 7, 9, 12]) {
    while (run.snapshot().stats.days < k) run.advance(1);
    const full = run.snapshot();
    const cut = runFronts(input(k));
    assert.equal(JSON.stringify(withoutReplay(cut.battlefields)), JSON.stringify(withoutReplay(full.battlefields)), `the battlefields after day ${k}`);
    assert.deepEqual(cut.flips, full.flips, `the flips up to day ${k}`);
    assert.deepEqual(cut.notes, full.notes);
  }
  const whole = runFronts(input(12));
  assert.equal(JSON.stringify(run.finish()), JSON.stringify(whole), "in steps or in one go");
  assert.equal(JSON.stringify(runFronts(input(12))), JSON.stringify(whole), "and the same every time");
  assert.ok(whole.battlefields[0].log.some((entry) => entry.k === "assault"));
});

test("a group goes on with its order from one run to the next, the same troops under it", () => {
  const world = plain({ layout: ["ABBBBBBB", "ABBBBBBB"], cities: [{ name: "Brod", lng: 23.5, lat: 50 }] });
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), row(21.1, 49, 51, 3, { strength: 30 })], pool: [300, 0] });
  const moments = [order(0, "Aland", "spearhead", { sector: "centre", objective: "city: Brod" }), order(0, "Borduria", "dig in", { sector: "north" })];
  const first = watchRun(frontInput(world, { battlefields: [record], days: 3, moments, pace: 0.5 }));
  const group = first.days[3].troops[0].map((troop, index) => ({ ...troop, index })).filter((troop) => troop.at === "way").map((troop) => troop.index);
  assert.ok(group.length >= 2 && group.length <= 5, `${group.length} troops are on the spearhead`);
  const [saved] = first.result.battlefields;
  // The record says who serves which standing order; nothing else of where they were going is kept.
  assert.deepEqual(saved.brief.carry.under[0].map((serves, index) => (serves >= 0 ? index : -1)).filter((index) => index >= 0), group);
  assert.equal(saved.orders[saved.brief.carry.under[0][group[0]]].order, "spearhead");
  // The next run: the same troops are on their way the first day, nobody waits to set off again, and the others are not.
  const next = watchRun(frontInput(world, { battlefields: first.result.battlefields, days: 3, fromDate: "2024-03-04", pace: 0.5 }));
  assert.deepEqual(next.days[1].troops[0].map((troop, index) => ({ ...troop, index })).filter((troop) => troop.at === "way").map((troop) => troop.index), group);
  for (const index of group) assert.ok(next.days[1].troops[0][index].x > next.days[0].troops[0][index].x + 0.5, `troop ${index} went on the first day`);
  // And Borduria's northern troop is dug in still.
  assert.ok(next.days[3].troops[1].some((troop) => troop.dug && troop.state === 4));
});

// How long each live troop has stood, day after day, on the other side's
// ground with none of its own side's within a brush of it: behind the line.
const leftBehind = (days, frame) => {
  const reach = Math.ceil(16 / frame.km) + 1;
  const running = [new Map(), new Map()];
  let longest = 0;
  for (const { troops, holders } of days) {
    troops.forEach((list, side) => list.forEach((troop, index) => {
      let behind = troop.strength > 0 && holders[Math.floor(troop.y) * frame.cols + Math.floor(troop.x)] === 1 - side;
      for (let row = Math.max(0, Math.floor(troop.y - reach)); behind && row <= Math.min(frame.rows - 1, Math.floor(troop.y + reach)); row += 1) {
        for (let col = Math.max(0, Math.floor(troop.x - reach)); col <= Math.min(frame.cols - 1, Math.floor(troop.x + reach)); col += 1) {
          if (holders[row * frame.cols + col] === side) behind = false;
        }
      }
      running[side].set(index, behind ? (running[side].get(index) ?? 0) + 1 : 0);
      longest = Math.max(longest, running[side].get(index));
    }));
  }
  return longest;
};

test("the weaker of two sides that both attack is driven back, not walked through: nobody is left alive behind the other side's line", () => {
  // Sixty against thirty, both told to advance. The thirty cannot gain; the
  // sixty can, and the ground under the thirty is taken as they come.
  const world = syntheticMap({ layout: ["AAABBB", "AAABBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const record = battlefieldOn(world, {
    troops: [row(22.9, 49, 51, 60), row(23.1, 49, 51, 30)],
    orders: [standing(0, "advance"), standing(1, "advance")],
    pool: [1800, 900],
  });
  const { days } = watchRun(frontInput(world, { battlefields: [record], days: 25 }));
  // Nobody goes on with an attack from behind the other side's line, at full
  // strength and untouched: a troop the other side has walked past falls back
  // onto its own side's ground, or with none to go to is taken within two days.
  assert.ok(leftBehind(days, record.frame) <= 2, `a troop stood ${leftBehind(days, record.frame)} days behind the other side's line`);
  // And the weaker side is pushed back fighting: ten days in it still holds
  // most of its country, with its troops in front of the advance.
  const began = heldBy(days[0].holders, HOLDER_SIDE_B);
  assert.ok(heldBy(days[10].holders, HOLDER_SIDE_B) > began * 0.5, `Borduria holds ${heldBy(days[10].holders, HOLDER_SIDE_B)} of ${began} cells on day 10`);
  assert.ok(heldBy(days[10].holders, HOLDER_SIDE_B) < began * 0.9, "though it has lost ground");
  assert.ok(days[10].troops[1].filter((troop) => troop.strength > 0).length >= 27, "and most of its troops are still in the field");
  // Its troops are still under the order they were given: thrown back, they try again from where they stand.
  assert.ok(days[10].troops[1].filter((troop) => troop.at === "way").length >= 20);
});

test("a rank stays a rank: the few that slip through a gap in the defenders do not run on alone", () => {
  // Thirty told to advance on a line 310 km long. The defenders stand thick
  // on either wing and leave a gap of 50 km in the middle.
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51.5, step: 1, stepLat: 1 });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 48.6, 51.4, 30), [...row(21.1, 48.6, 49.775, 14), ...row(21.1, 50.225, 51.4, 14)]],
    orders: [standing(0, "advance")],
    pool: [900, 840],
  });
  const ahead = (steering) => {
    const { days } = watchRun(frontInput(world, { battlefields: [record], days: 8, steering }));
    const xs = days[8].troops[0].filter((troop) => troop.strength > 0).map((troop) => troop.x).sort((a, b) => a - b);
    return (xs[xs.length - 1] - xs[Math.floor(xs.length / 2)]) * record.frame.km;
  };
  // Those in front of the gap get through, and go on: but at the pace the
  // ground their side holds round them allows, which is not much while the
  // breach is a few brushes wide.
  const held = ahead({});
  assert.ok(held > 60 && held < 180, `the furthest is ${held.toFixed(0)} km ahead of the middle of its rank after eight days`);
  // Left to themselves they would be most of the way across the country, down a corridor nobody holds the sides of.
  const loose = ahead({ rank: 0 });
  assert.ok(loose > 240 && loose > held + 100, `and ${loose.toFixed(0)} km with nothing to hold them to their rank`);
});

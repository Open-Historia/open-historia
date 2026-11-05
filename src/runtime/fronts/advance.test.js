// Run: node --test src/runtime/fronts/advance.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, THRUST_SHARE } from "./constants.js";
import { runFronts } from "./engine.js";
import { outwardOf } from "./ground.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";

// What the owner saw the first time the real engine was put on the map beside
// the battle he had approved, and what each was made to do instead.

const legend = { A: "Aland", B: "Borduria", "~": null };
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const along = (lat, west, east, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lat, lng: west + ((index + 0.5) * (east - west)) / count, ...extra }));
const steady = { even: true, wander: 0 };

// A run a day at a time: each side's troops as they stood after each day, day 0 first.
const watchRun = (input) => {
  const days = [];
  runFronts({ ...input, watch: ({ day, troops, holders }) => {
    days[day] = {
      troops: troops.map((list) => list.map(({ x, y, strength, dug, pocket, order }) => ({ x, y, strength, dug, pocket, at: order && !order.done ? order.kind : "" }))),
      holders: Uint8Array.from(holders),
    };
  } });
  return days;
};

test("which way a stretch of the line faces is read off the line itself: any angle, a kink averaged away, a coast pulling nothing aside", () => {
  const cols = 80;
  const rows = 80;
  const aim = [0, 0];
  const fieldOf = (holderAt) => {
    const holders = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) holders[row * cols + col] = holderAt(col + 0.5, row + 0.5);
    return { cols, rows, holders };
  };
  // A straight line through the middle at every angle of a turn: its own normal, to a degree or two.
  for (let step = 0; step < 16; step += 1) {
    const nx = Math.cos((step * Math.PI) / 8 + 0.2);
    const ny = Math.sin((step * Math.PI) / 8 + 0.2);
    const field = fieldOf((x, y) => ((x - 40) * nx + (y - 40) * ny < 0 ? HOLDER_SIDE_A : HOLDER_SIDE_B));
    assert.equal(outwardOf(field, HOLDER_SIDE_A, 40 - nx * 3, 40 - ny * 3, 25, aim), true);
    assert.ok(aim[0] * nx + aim[1] * ny > 0.999, `a line facing ${nx.toFixed(2)}, ${ny.toFixed(2)} read as ${aim[0].toFixed(2)}, ${aim[1].toFixed(2)}`);
    // And the other side reads the opposite way.
    outwardOf(field, HOLDER_SIDE_B, 40 + nx * 3, 40 + ny * 3, 25, aim);
    assert.ok(aim[0] * nx + aim[1] * ny < -0.999);
  }
  // A line running north and south with the sea over all the ground north of the point: still due east.
  const coast = fieldOf((x, y) => (y > 44 ? HOLDER_WALL : x < 40 ? HOLDER_SIDE_A : HOLDER_SIDE_B));
  outwardOf(coast, HOLDER_SIDE_A, 37, 42, 25, aim);
  assert.ok(aim[0] > 0.999, `beside a coast it reads ${aim[0].toFixed(3)}, ${aim[1].toFixed(3)}`);
  // A kink in the border four cells deep is not a turn in the line.
  const kinked = fieldOf((x, y) => (x < (y > 36 && y < 44 ? 44 : 40) ? HOLDER_SIDE_A : HOLDER_SIDE_B));
  outwardOf(kinked, HOLDER_SIDE_A, 37, 46, 25, aim);
  assert.ok(aim[0] > 0.97, `past a kink it reads ${aim[0].toFixed(3)}, ${aim[1].toFixed(3)}`);
  // A patch of the other side's shut in on every hand adds nothing.
  const patch = fieldOf((x, y) => (x >= 40 || (Math.abs(x - 28) < 3 && Math.abs(y - 40) < 3) ? HOLDER_SIDE_B : HOLDER_SIDE_A));
  outwardOf(patch, HOLDER_SIDE_A, 36, 40, 25, aim);
  assert.ok(aim[0] > 0.99, `with a patch behind it reads ${aim[0].toFixed(3)}, ${aim[1].toFixed(3)}`);
  // No line within reach: nothing to read.
  assert.equal(outwardOf(fieldOf(() => HOLDER_SIDE_A), HOLDER_SIDE_A, 40, 40, 25, aim), false);
});

test("an advance with nothing named goes straight out from each stretch of a line that bends, not all one way", () => {
  // Aland lies along the north of Borduria and down its west: one border faces south and one east.
  const world = syntheticMap({ layout: ["AAAAAAA", "ABBBBBB", "ABBBBBB", "ABBBBBB", "ABBBBBB"], legend, west: 20, north: 51.65, step: 1, stepLat: 0.65 });
  const north = along(51.1, 23, 26.6, 12);
  const west = row(20.9, 48.5, 50.0, 12);
  const record = battlefieldOn(world, { troops: [[...north, ...west], []], orders: [standing(0, "advance")] });
  const days = watchRun(frontInput(world, { battlefields: [record], days: 5, steering: steady }));
  const km = record.frame.km;
  for (let index = 0; index < 24; index += 1) {
    const from = days[0].troops[0][index];
    const to = days[5].troops[0][index];
    const east = (to.x - from.x) * km;
    const south = (from.y - to.y) * km;
    if (index < 12) assert.ok(south > 100 && Math.abs(east) < south * 0.2, `troop ${index} on the northern border went ${south.toFixed(0)} km south and ${east.toFixed(0)} east`);
    else assert.ok(east > 100 && Math.abs(south) < east * 0.2, `troop ${index} on the western border went ${east.toFixed(0)} km east and ${south.toFixed(0)} south`);
  }
});

test("a thrust is made by the troops nearest what it is sent at, one body of them, and the rest of the line stays", () => {
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51.3, step: 1, stepLat: 0.65, cities: [{ name: "Brod", lng: 23.5, lat: 50 }] });
  const troops = [row(20.9, 48.8, 51.2, 40), []];
  // How far forward each went in six days, and which of them were sent on the way.
  const gone = (order) => {
    const record = battlefieldOn(world, { troops, orders: [order] });
    const days = watchRun(frontInput(world, { battlefields: [record], days: 6, steering: steady }));
    return {
      km: days[6].troops[0].map((troop, index) => (troop.x - days[0].troops[0][index].x) * record.frame.km),
      sent: days[1].troops[0].map((troop, index) => (troop.at === "way" ? index : -1)).filter((index) => index >= 0),
    };
  };
  // Forty stand along 270 km of line. A spearhead at a town opposite the middle
  // of it takes six tenths of them, and they are the middle ones.
  const spear = gone(standing(0, "spearhead", { objective: "city: Brod" }));
  const went = spear.sent;
  assert.equal(went.length, Math.ceil(40 * THRUST_SHARE), `${went.length} of forty were sent`);
  assert.deepEqual(went, Array.from({ length: went.length }, (_, at) => went[0] + at), "one body: no gaps in who went");
  assert.ok(went[0] >= 6 && went.at(-1) <= 33, `the ones opposite the town (${went[0]} to ${went.at(-1)})`);
  assert.ok(Math.max(...went.map((index) => spear.km[index])) > 120, "and they went");
  // The rest stay in the line, and only come up behind it as it moves on.
  for (let index = 0; index < 40; index += 1) if (!went.includes(index)) assert.ok(spear.km[index] < 45 && spear.km[index] > -1, `troop ${index} stayed in the line (${spear.km[index].toFixed(0)} km)`);
  // An advance on the same town: the whole line goes forward, straight out; those nearest go at the town.
  const whole = gone(standing(0, "advance", { objective: "city: Brod" }));
  assert.equal(whole.sent.length, 40);
  assert.ok(whole.km.every((km) => km > 100), `every one of them went (the least ${Math.min(...whole.km).toFixed(0)} km)`);
  // And a place on the line for a sector is already a few troops: all of them go.
  const few = gone(standing(0, "spearhead", { sector: "city: Brod", objective: "city: Brod" }));
  assert.ok(few.sent.length >= 4 && few.sent.length < 24, `${few.sent.length} went from the stretch of line nearest the town`);
});

test("a troop that holds gives ground when it has been got round, and one that is dug in stands and is shut in", () => {
  // Two bodies of Aland's advance either side of a stretch nobody attacks, where one troop of Borduria's stands.
  const world = syntheticMap({ layout: ["ABBBBBB", "ABBBBBB", "ABBBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65 });
  const attackers = [...row(20.9, 50.5, 50.95, 8), ...row(20.9, 49.1, 49.55, 8)];
  const stand = (extra) => {
    const record = battlefieldOn(world, { troops: [attackers, [{ lng: 21.15, lat: 50.02, ...extra }]], orders: [standing(0, "advance")] });
    const days = watchRun(frontInput(world, { battlefields: [record], days: 16, pace: 0.4, steering: steady }));
    return { days, km: record.frame.km, cols: record.frame.cols };
  };
  const held = stand({});
  const first = held.days[0].troops[1][0];
  const last = held.days[16].troops[1][0];
  assert.ok(last.strength > 0, "the one that only held is alive");
  assert.ok((last.x - first.x) * held.km > 30, `and drew back ${((last.x - first.x) * held.km).toFixed(0)} km as they came round it`);
  assert.ok(Math.abs(last.y - first.y) * held.km < 25, "straight back, along its way to its own side's ground");
  assert.equal(held.days.some((day) => day.troops[1][0].pocket), false, "and was never cut off");
  for (const day of held.days) {
    const troop = day.troops[1][0];
    assert.equal(day.holders[Math.floor(troop.y) * held.cols + Math.floor(troop.x)], HOLDER_SIDE_B, "on its own side's ground every day");
  }
  // Told to dig in, it does not move; the two bodies meet behind it.
  const dug = stand({ dig: 1, state: 4 });
  const stood = dug.days.filter((day) => day.troops[1][0].strength > 0);
  assert.ok(stood.every((day) => day.troops[1][0].x === dug.days[0].troops[1][0].x && day.troops[1][0].y === dug.days[0].troops[1][0].y), "the one dug in did not move");
  assert.ok(dug.days.some((day) => day.troops[1][0].pocket), "and was cut off for it");
});

test("a general advance is a line: nobody runs on ahead of it, and what it pushes back is still an army", () => {
  // Forty against twenty-four along 290 km, the forty told to advance and the others given no order.
  const world = syntheticMap({ layout: ["ABBBBBB", "ABBBBBB", "ABBBBBB", "ABBBBBB"], legend, west: 20, north: 51.3, step: 1, stepLat: 0.65 });
  const record = battlefieldOn(world, { troops: [row(20.9, 48.8, 51.2, 40), row(21.1, 48.8, 51.2, 24)], orders: [standing(0, "advance")], pool: [1200, 720] });
  const days = watchRun(frontInput(world, { battlefields: [record], days: 20, pace: 0.4 }));
  const km = record.frame.km;
  const forward = (day) => days[day].troops[0].map((troop, index) => (troop.x - days[0].troops[0][index].x) * km).sort((a, b) => a - b);
  for (const day of [5, 10, 20]) {
    const went = forward(day);
    const middle = went[20];
    assert.ok(went.at(-1) - middle < 45, `day ${day}: the furthest is ${(went.at(-1) - middle).toFixed(0)} km ahead of the middle of the line`);
  }
  assert.ok(forward(20)[20] > 15, `the line went forward (${forward(20)[20].toFixed(0)} km in twenty days)`);
  // The defenders were pushed back fighting, and are nearly all still there.
  const left = days[20].troops[1].filter((troop) => troop.strength > 0);
  assert.ok(left.length >= 22, `${left.length} of the twenty-four defenders are still in the field`);
  assert.ok(days.every((day) => day.troops[1].filter((troop) => troop.pocket).length <= 2), "and at no time were more than a couple of them cut off");
  // Nor did they retreat along the rows of the grid: no defender's day's march turns a right angle on the one before.
  let corners = 0;
  for (let index = 0; index < 24; index += 1) {
    for (let day = 2; day <= 20; day += 1) {
      const a = [days[day - 1].troops[1][index].x - days[day - 2].troops[1][index].x, days[day - 1].troops[1][index].y - days[day - 2].troops[1][index].y];
      const b = [days[day].troops[1][index].x - days[day - 1].troops[1][index].x, days[day].troops[1][index].y - days[day - 1].troops[1][index].y];
      const la = Math.hypot(...a) * km;
      const lb = Math.hypot(...b) * km;
      if (la < 5 || lb < 5) continue;
      if ((a[0] * b[0] + a[1] * b[1]) / (la * lb / (km * km)) < 0.2) corners += 1;
    }
  }
  assert.ok(corners <= 3, `${corners} sharp corners in the defenders' retreat`);
});

test("attacking costs the attacker: at odds that gain nothing its strength wears away faster than the defender's", () => {
  // Ten against ten, dug in, with no reserves on either side: the attack gets nowhere and pays for trying.
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49.2, 50.8, 10), row(21.1, 49.2, 50.8, 10, { dig: 1, state: 4 })],
    orders: [standing(0, "advance"), standing(1, "dig in")],
    pool: [0, 0],
  });
  const days = watchRun(frontInput(world, { battlefields: [record], days: 20, steering: steady }));
  const mean = (side) => days[20].troops[side].reduce((sum, troop) => sum + troop.strength, 0) / 10;
  assert.ok(days[20].troops[0].every((troop, index) => Math.abs(troop.x - days[0].troops[0][index].x) < 1), "nobody got forward");
  assert.ok(mean(HOLDER_SIDE_A) < mean(HOLDER_SIDE_B) - 3, `the attackers are down to ${mean(HOLDER_SIDE_A).toFixed(1)} and the defenders to ${mean(HOLDER_SIDE_B).toFixed(1)}`);
  assert.ok(mean(HOLDER_SIDE_B) > 80, "and the defenders are far from broken");
});

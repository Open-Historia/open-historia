// Run: node --test src/runtime/fronts/dynamics.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_RADIUS_MAX_KM, HOLDER_SIDE_A, HOLDER_SIDE_B, PATCH_MAX_KM2 } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { takeCapsule } from "./field.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, disc, kmPerDegree, readBattlefield, settleWorld } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", M: { owner: "Borduria", typeId: "peaks" }, "~": null };
const regionTypes = [{ id: "peaks", passable: false, pathfindingSpeed: 1 }];
// What every troop draws is set aside, and the wander with it: a test that
// measures one thing at a time needs troops that are all alike.
const steady = { even: true, wander: 0 };

// Aland a strip in the west, Borduria wide in the east: room to advance into.
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });

// Troops in a row along a meridian, `count` of them between two latitudes.
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));

// A run a day at a time: the result as it stood after each day, day 0 first.
const dayByDay = (input) => {
  const run = createFrontRun(input);
  const seen = [run.snapshot()];
  for (let day = 1; day <= input.days; day += 1) {
    run.advance(1);
    seen.push(run.snapshot());
  }
  return seen;
};

const eastmost = (seen, lat) => seen.lineAt(lat).at(-1);

test("a straight advance through ground nobody defends covers pace times days, at any latitude and on a flat sheet", () => {
  for (const [label, options] of [
    ["30 north", { north: 31 }],
    ["50 north", { north: 51 }],
    ["65 north", { north: 66, layout: ["ABBBBBBBB", "ABBBBBBBB"] }],
    ["a flat sheet", { north: 51, flat: true, scale: 60 }],
  ]) {
    const world = plain(options);
    const middle = options.north - 1;
    const troops = [row(20.9, middle - 0.75, middle + 0.75, 9), []];
    const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")] });
    const input = (days) => frontInput(world, { battlefields: [record], days, steering: steady });
    const early = readBattlefield(runFronts(input(2)).battlefields[0], world);
    const late = readBattlefield(runFronts(input(7)).battlefields[0], world);
    const frame = record.frame;
    // Infantry in the modern era advances 30 km a day when nothing is in its way.
    for (const lat of [middle - 0.2, middle, middle + 0.2]) {
      const gainedKm = (eastmost(late, lat) - eastmost(early, lat)) * kmPerDegree(frame, lat);
      assert.ok(Math.abs(gainedKm - 150) <= frame.km / 8, `${label}, at ${lat}: ${gainedKm.toFixed(2)} km in five days, on ${frame.km} km cells`);
    }
    // And the troops went straight: the middle one is within a degree or so of the latitude it set off
    // from (equal marches east from a meridian do not end on a meridian, so the front leans a little).
    assert.ok(Math.abs(late.troops[0][4].lat - troops[0][4].lat) < 0.06, `${label}: straight along the normal (${late.troops[0][4].lat} from ${troops[0][4].lat})`);
    assert.equal(late.troops[0][4].state, 1, "advancing");
  }
});

// A border only 55 km long, between two seas: the troops of a short line stand close together.
const neck = (options = {}) => syntheticMap({ layout: ["~~~~~~", "ABBBBB", "~~~~~~"], legend, west: 20, north: 50.75, step: 1, stepLat: 0.5, ...options });

// How far a point is from a path of troop positions, in cells.
const offPath = (path, x, y) => {
  let best = Infinity;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const [ax, ay] = path[index];
    const sx = path[index + 1][0] - ax;
    const sy = path[index + 1][1] - ay;
    const length = sx * sx + sy * sy;
    const along = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / length)) : 0;
    best = Math.min(best, Math.hypot(x - ax - sx * along, y - ay - sy * along));
  }
  return best;
};

test("the ground changes hands only where a troop walked", () => {
  const world = neck({ cities: [{ name: "Brod", lng: 23.5, lat: 50.1 }] });
  const record = battlefieldOn(world, { troops: [[{ lng: 20.9, lat: 50 }], []], orders: [standing(0, "spearhead", { objective: "city: Brod" })] });
  const before = readBattlefield(record, world);
  const days = dayByDay(frontInput(world, { battlefields: [record], days: 4, steering: steady }));
  const after = readBattlefield(days[4].battlefields[0], world);
  const path = days.map((day) => readBattlefield(day.battlefields[0], world).troops[0][0]).map((troop) => [troop.x, troop.y]);
  const { toCell, kmAt } = after.place;
  // It went at the city, 30 km a day.
  const walkedKm = Math.hypot(path[4][0] - path[0][0], path[4][1] - path[0][1]) * kmAt(path[4][1]);
  assert.ok(Math.abs(walkedKm - 120) < 4, `${walkedKm} km in four days`);
  const [cityX, cityY] = toCell(23.5, 50.1);
  assert.ok(Math.hypot(cityX - path[4][0], cityY - path[4][1]) < Math.hypot(cityX - path[0][0], cityY - path[0][1]) - 28, "toward its objective");
  assert.ok(path[4][1] > path[0][1], "which lies a little north of it");

  const radius = CONTROL_RADIUS_MAX_KM / kmAt(path[0][1]);
  let taken = 0;
  let same = 0;
  for (let index = 0; index < after.holders.length; index += 1) {
    const distance = offPath(path, (index % after.frame.cols) + 0.5, Math.floor(index / after.frame.cols) + 0.5);
    if (after.holders[index] !== before.holders[index]) {
      taken += 1;
      assert.equal(after.holders[index], HOLDER_SIDE_A);
      assert.ok(distance <= radius + 0.3, `a cell ${distance.toFixed(2)} cells from its path changed hands (its radius is ${radius.toFixed(2)})`);
    } else if (before.holders[index] === HOLDER_SIDE_B) assert.ok(distance >= radius - 0.3, `a cell ${distance.toFixed(2)} cells from its path did not`);
    // Away from where it walked the field is the same to the last bit.
    if (distance > radius + 5 && before.field.play[index]) {
      assert.ok(Object.is(after.field.phi[index], before.field.phi[index]), `cell ${index}`);
      same += 1;
    }
  }
  assert.ok(taken > 100 && same > 200, `${taken} cells taken, ${same} far from it untouched`);
});

test("an attack at worse than 1.15 to 1 gains nothing, and both sides pay for it", () => {
  const world = plain();
  const troops = [row(20.9, 49, 51, 4), row(21.1, 49, 51, 9, { dig: 0.5 })];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance"), standing(1, "hold")] });
  const result = runFronts(frontInput(world, { battlefields: [record], days: 30, steering: steady }));
  const [after] = result.battlefields;
  assert.deepEqual(after.field, record.field, "the line did not move");
  const seen = readBattlefield(after, world);
  const before = readBattlefield(record, world);
  seen.troops[0].forEach((troop, index) => {
    assert.ok(Math.abs(troop.x - before.troops[0][index].x) < 0.07 && Math.abs(troop.y - before.troops[0][index].y) < 0.07, "the attackers did not move");
    assert.ok(troop.strength < 80, `and paid for the failed assault (${troop.strength})`);
  });
  // (Each of them by its share of the fight: one far from any attacker hardly at all.)
  const stood = seen.troops[1].reduce((sum, troop) => sum + troop.strength, 0) / seen.troops[1].length;
  assert.ok(stood < 99.5 && stood > 90 && seen.troops[1].every((troop) => troop.strength > 90), `so did the troops that stopped them, less (${stood} left on average)`);
  assert.deepEqual(result.flips, []);
  assert.equal(result.stats.steps > 0, true, "they tried every day");
});

test("a troop driven off its ground falls back to one place, straight, and one with nowhere to go is taken", () => {
  const world = plain();
  const troops = [row(20.92, 49, 51, 9), [{ lng: 21.08, lat: 50, strength: 35 }]];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")] });
  const days = dayByDay(frontInput(world, { battlefields: [record], days: 6, steering: steady }));
  const path = days.map((day) => readBattlefield(day.battlefields[0], world).troops[1][0]);
  const km = record.frame.km;
  // It is driven back, never forward, and by no more than a day's falling back at a time.
  let moves = 0;
  for (let day = 1; day < path.length && path[day].strength > 0; day += 1) {
    const went = Math.hypot(path[day].x - path[day - 1].x, path[day].y - path[day - 1].y) * km;
    assert.ok(went <= 26.5, `day ${day}: it fell back ${went} km`);
    assert.ok(path[day].x >= path[day - 1].x - 0.1, "never toward the attackers");
    // No zigzag: it goes straight for the place it picked.
    assert.ok(Math.abs(path[day].y - path[day - 1].y) <= Math.abs(path[day].x - path[day - 1].x) + 1.5, `day ${day}: straight back`);
    if (went > 1) moves += 1;
  }
  assert.ok(moves >= 2, `it fell back on ${moves} days`);
  const last = readBattlefield(days[6].battlefields[0], world);
  const first = readBattlefield(days[0].battlefields[0], world);
  assert.ok(eastmost(last, 50) > eastmost(first, 50) + 0.3, "while the line went forward");
  const [defender] = last.troops[1];
  assert.ok(!(defender.strength > 0) || last.holderAt(defender.lng, defender.lat) === HOLDER_SIDE_B || defender.lng > eastmost(last, 50) - 0.5, "it is on its own side's ground, or all but, or gone");

  // With nothing of its own side's to fall back to, it is taken where it stands: after a day, not at once.
  const deep = syntheticMap({ layout: ["AAABBB", "AAABBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, cities: [{ name: "Alba", lng: 21.0, lat: 50.0 }] });
  const lost = battlefieldOn(deep, { troops: [row(22.9, 49, 51, 4), [{ lng: 21.0, lat: 50.0 }, ...row(23.1, 49, 51, 4)]] });
  const stranded = dayByDay(frontInput(deep, { battlefields: [lost], days: 3, steering: steady }));
  assert.ok(readBattlefield(stranded[1].battlefields[0], deep).troops[1][0].strength > 0, "it stands a day behind the other side's line");
  assert.equal(readBattlefield(stranded[2].battlefields[0], deep).troops[1][0].strength, 0, "and then it is taken");
  assert.deepEqual(stranded[2].battlefields[0].log, [{ d: "2024-03-03", k: "overrun", at: "city: Alba", s: 1 }]);
  assert.ok(readBattlefield(stranded[3].battlefields[0], deep).troops[1].slice(1).every((troop) => troop.strength === 100), "nobody else is touched");
});

test("under fall back the line does not move until the other side walks in, and then it follows them", () => {
  const world = plain();
  const troops = [row(20.9, 49.6, 50.4, 6), row(21.1, 49.6, 50.4, 6)];
  // Aland is dug in and stays; Borduria falls back.
  const unpursued = battlefieldOn(world, { troops, orders: [standing(0, "dig in"), standing(1, "fall back")] });
  const left = runFronts(frontInput(world, { battlefields: [unpursued], days: 5, steering: steady })).battlefields[0];
  assert.deepEqual(left.field, unpursued.field, "nobody walked in: the line is where it was");
  const gone = readBattlefield(left, world);
  for (const troop of gone.troops[1]) assert.ok(troop.lng > 21.6, `the side falling back has gone back (${troop.lng})`);
  for (const troop of gone.troops[0]) assert.ok(troop.lng < 21, "the side dug in has stayed");
  // Aland merely holding goes after them, and the line goes with it.
  const pursued = battlefieldOn(world, { troops, orders: [standing(0, "hold"), standing(1, "fall back")] });
  const days = dayByDay(frontInput(world, { battlefields: [pursued], days: 5, steering: steady }));
  const after = readBattlefield(days[5].battlefields[0], world);
  assert.ok(eastmost(after, 50) > 21.8, `the line followed (${eastmost(after, 50)})`);
  for (const troop of after.troops[0]) assert.ok(troop.lng > 21.5 && troop.state === 1, "the pursuers walked in");
  const lines = days.map((day) => eastmost(readBattlefield(day.battlefields[0], world), 50));
  for (let day = 1; day < lines.length; day += 1) assert.ok(lines[day] >= lines[day - 1], "and it never came back");
});

test("a wall stops the line, and is never anybody's", () => {
  // A range no unit can cross lies across Borduria, with a gap of sea-level ground south of it.
  const world = syntheticMap({ layout: ["ABMBBB", "ABMBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5 });
  const troops = [row(20.9, 49.6, 50.9, 8), []];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")], regionTypes });
  const result = runFronts(frontInput(world, { battlefields: [record], days: 9, steering: steady, regionTypes }));
  const seen = readBattlefield(result.battlefields[0], world, { regionTypes });
  for (const lat of [50.2, 50.6, 50.9]) {
    for (const lng of [22.1, 22.5, 22.9]) assert.equal(seen.holderAt(lng, lat), 2, "the range is a wall still");
    assert.equal(seen.holderAt(21.9, lat), HOLDER_SIDE_A, "the advance reached its foot");
  }
  assert.equal(seen.holderAt(22.5, 49.7), HOLDER_SIDE_A, "south of the range the way was open");
  for (const troop of seen.troops[0]) {
    assert.notEqual(seen.holderAt(troop.lng, troop.lat), 2, "no troop stands in the wall");
  }
});

test("an empty patch is filled the day the ring closes; one with troops in it is a pocket, and holds ten days", () => {
  // (Borduria's own troops are 250 km off: too far to be drawn in to close on it.)
  const world = plain({ cities: [{ name: "Brod", lng: 24.6, lat: 50.0 }] });
  const pocketOf = (radiusKm, manned) => {
    const record = battlefieldOn(world, {
      troops: [manned ? [{ lng: 24.6, lat: 50.0 }, { lng: 24.65, lat: 50.05 }] : [], row(21.1, 49.5, 50.5, 3)],
      // Ground of Aland's deep in Borduria, joined to nothing of its own.
      carve: (field, toCell) => disc(field, HOLDER_SIDE_A, ...toCell(24.6, 50.0), radiusKm / 4),
    });
    return dayByDay(frontInput(world, { battlefields: [record], days: 12, steering: steady }));
  };
  // Nobody in it, and under the size of a pocket: gone the same day, and not news.
  const empty = pocketOf(18, false);
  assert.ok(Math.PI * 18 * 18 < PATCH_MAX_KM2);
  assert.equal(readBattlefield(empty[0].battlefields[0], world).holderAt(24.6, 50.0), HOLDER_SIDE_A);
  assert.equal(readBattlefield(empty[1].battlefields[0], world).holderAt(24.6, 50.0), HOLDER_SIDE_B, "the empty patch is the other side's at the end of the first day");
  assert.deepEqual(empty[1].battlefields[0].log, [{ d: "2024-03-02", k: "city", at: "city: Brod", s: 1 }], "the town in it is the other side's again");
  assert.deepEqual(empty[1].battlefields[0].brief.pockets, []);

  // The same ground, 600 square kilometres of it, with defenders in it: a
  // pocket however small, still theirs the day the ring closes and for nine more.
  const small = pocketOf(14, true);
  assert.ok(Math.abs(Math.PI * 14 * 14 - 600) < 20);
  for (let day = 0; day <= 9; day += 1) {
    const seen = readBattlefield(small[day].battlefields[0], world);
    assert.equal(seen.holderAt(24.6, 50.0), HOLDER_SIDE_A, `still held on day ${day}`);
    if (day === 0) continue;
    assert.deepEqual(small[day].battlefields[0].brief.pockets, [{ s: 0, at: "city: Brod", days: day }]);
    for (const troop of seen.troops[0]) {
      assert.equal(troop.state, 2, "encircled");
      assert.ok(Math.abs(troop.strength - (100 - 2 * day)) < 1.5, `wasting away for want of supply: ${troop.strength} on day ${day}`);
    }
  }
  const fallen = readBattlefield(small[10].battlefields[0], world);
  assert.equal(fallen.holderAt(24.6, 50.0), HOLDER_SIDE_B, "it gives up on the tenth day and its ground changes hands");
  assert.ok(fallen.troops[0].every((troop) => troop.strength === 0));
  assert.deepEqual(small[10].battlefields[0].log, [{ d: "2024-03-11", k: "pocket", at: "city: Brod", s: 0 }, { d: "2024-03-11", k: "city", at: "city: Brod", s: 1 }], "said once, not once a troop");
  // A large one with nobody in it gives up at once too.
  const vacant = pocketOf(28, false);
  assert.ok(Math.PI * 28 * 28 > PATCH_MAX_KM2);
  assert.equal(readBattlefield(vacant[1].battlefields[0], world).holderAt(24.6, 50.0), HOLDER_SIDE_B);
  assert.equal(readBattlefield(vacant[0].battlefields[0], world).holderAt(24.6, 50.0), HOLDER_SIDE_A);
});

test("a pocket is fought for like any other ground: a strong one holds against a weak ring, and takes some back", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 21.75, lat: 50.0 }] });
  // Eight of Aland's at full strength, standing all round the edge of a pocket
  // 56 km across at Brod, 25 km from Aland's own line, and eight of Borduria's
  // at a third of theirs in a ring round it. The ring is told to attack; and
  // the nearest of Borduria's troops close on it of themselves.
  const circle = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]];
  const round = (km, extra = {}) => circle.map(([east, north]) => ({ lng: 21.75 + (east * km) / 71.5, lat: 50.0 + (north * km) / 111.2, ...extra }));
  const fought = battlefieldOn(world, {
    troops: [round(22), round(40, { strength: 30 })],
    orders: [standing(1, "advance", { sector: "city: Brod" })],
    carve: (field, toCell) => disc(field, HOLDER_SIDE_A, ...toCell(21.75, 50.0), 7),
  });
  const days = dayByDay(frontInput(world, { battlefields: [fought], days: 5, steering: steady }));
  const [x, y] = readBattlefield(fought, world).place.toCell(21.75, 50.0);
  // The ground Aland holds within 60 km of the town, east of its own border.
  const [border] = readBattlefield(fought, world).place.toCell(21.0, 50.0);
  const held = (day) => {
    const seen = readBattlefield(days[day].battlefields[0], world);
    let cells = 0;
    for (let index = 0; index < seen.holders.length; index += 1) {
      const col = (index % seen.frame.cols) + 0.5;
      const dy = Math.floor(index / seen.frame.cols) + 0.5 - y;
      if (seen.holders[index] === HOLDER_SIDE_A && col > border + 1 && (col - x) * (col - x) + dy * dy < 225) cells += 1;
    }
    return cells;
  };
  for (let day = 1; day <= 5; day += 1) {
    const seen = readBattlefield(days[day].battlefields[0], world);
    assert.equal(seen.holderAt(21.75, 50.0), HOLDER_SIDE_A, `the pocket stands on day ${day}`);
    assert.ok(seen.troops[0].filter((troop) => troop.strength > 0).length >= 7, "its troops fight on");
  }
  // Its troops were not told to do anything: cut off, with their own side's
  // ground not far, they tried to break out to it, and took ground doing so.
  assert.ok(held(5) > held(0) + 20, `it took ground: ${held(0)} cells became ${held(5)}`);
  assert.equal(days[1].battlefields[0].brief.pockets.length >= 1, true, "cut off all the same, the day it began");
});

test("supply is by home ground: a peninsula apart is fed, defenders ringed on their own soil are not", () => {
  // Borduria has a peninsula of its own joined to its mainland only by sea.
  const world = syntheticMap({ layout: ["ABBBB~B", "ABBBB~B", "ABBBB~~"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities: [{ name: "Brod", lng: 22.5, lat: 50.2 }] });
  const quiet = battlefieldOn(world, { troops: [row(20.9, 49.6, 50.9, 4), row(21.1, 49.6, 50.9, 4)] });
  const after = runFronts(frontInput(world, { battlefields: [quiet], days: 20, steering: steady })).battlefields[0];
  assert.equal(readBattlefield(after, world).holderAt(26.5, 50.5), HOLDER_SIDE_B, "nothing touched the peninsula, and it stands");
  assert.deepEqual(after.brief.pockets, []);
  assert.deepEqual(after.log, []);

  // Aland has driven a ring round a piece of Borduria's own country, with defenders in it.
  const ringed = settleWorld(world, battlefieldOn(world, {
    troops: [[], [{ lng: 22.5, lat: 50.2 }, { lng: 22.55, lat: 50.25 }, { lng: 24.5, lat: 50.2 }]],
    carve: (field, toCell) => {
      const [x, y] = toCell(22.5, 50.2);
      for (let step = 0; step < 16; step += 1) {
        // A ring of discs 14 cells from its middle: ground of Aland's all the way round.
        const angle = [[1, 0], [0.924, 0.383], [0.707, 0.707], [0.383, 0.924], [0, 1], [-0.383, 0.924], [-0.707, 0.707], [-0.924, 0.383], [-1, 0], [-0.924, -0.383], [-0.707, -0.707], [-0.383, -0.924], [0, -1], [0.383, -0.924], [0.707, -0.707], [0.924, -0.383]][step];
        disc(field, HOLDER_SIDE_A, x + angle[0] * 14, y + angle[1] * 14, 3.5);
      }
      // ...joined to its own country by the way it came.
      const [homeX] = toCell(20.9, 50.2);
      takeCapsule(field, HOLDER_SIDE_A, homeX, y, x - 14, y, 3.5, 3.5);
    },
  }));
  const days = dayByDay(frontInput(world, { battlefields: [ringed], days: 11, steering: steady }));
  const first = readBattlefield(days[1].battlefields[0], world);
  assert.equal(first.holderAt(22.5, 50.2), HOLDER_SIDE_B);
  assert.deepEqual(days[1].battlefields[0].brief.pockets.map(({ s, days: stood }) => [s, stood]), [[1, 1]], "a pocket from the day the ring is closed, on its own soil");
  assert.equal(first.troops[1][0].state, 2, "the defenders in it are encircled");
  assert.notEqual(first.troops[1][2].state, 2, "the ones outside are not");
  const end = readBattlefield(days[11].battlefields[0], world);
  // It gives up in its time, unless its troops have broken out to their own side's ground first.
  assert.ok(end.holderAt(22.5, 50.2) === HOLDER_SIDE_A || days[11].battlefields[0].brief.pockets.length === 0, "and it gives up in its time, or has broken out");
  assert.equal(end.holderAt(24.5, 50.2), HOLDER_SIDE_B);
});

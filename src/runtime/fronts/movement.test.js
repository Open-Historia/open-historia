// Run: node --test src/runtime/fronts/movement.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { rasterizeArena } from "./arena.js";
import { PAINT_OWN_A, decodeTracks, decodeTroops } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL } from "./constants.js";
import { runFronts } from "./engine.js";
import { normalizeBattlefield } from "./record.js";
import { replayOf } from "./replay.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";

const legend = {
  A: "Aland",
  B: "Borduria",
  C: "Cisland",
  M: { owner: "Borduria", typeId: "peaks" },
  S: { owner: "Borduria", typeId: "marsh" },
  "~": null,
};
const regionTypes = [{ id: "peaks", passable: false, pathfindingSpeed: 1 }, { id: "marsh", passable: true, pathfindingSpeed: 0.3 }];
const steady = { even: true, wander: 0 };
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));

// A run a day at a time: each side's troops as they stood after each day, day 0 first.
const watchRun = (input) => {
  const days = [];
  const result = runFronts({ ...input, watch: ({ day, troops, holders, painters, homes, when }) => {
    days[day] = {
      troops: troops.map((list) => list.map(({ x, y, strength, state, hx, hy }) => ({ x, y, strength, state, hx, hy }))),
      holders: Uint8Array.from(holders),
      painters: Uint8Array.from(painters),
      homes: Uint8Array.from(homes),
      when: Float32Array.from(when),
    };
  } });
  return { days, result };
};

// ---- shapes of attack ------------------------------------------------------------

test("a spearhead on one sector outruns the line either side of it", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 23.5, lat: 50 }] });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49, 51, 10), row(21.1, 49, 51, 6, { strength: 60 })],
    orders: [standing(0, "spearhead", { sector: "centre", objective: "city: Brod" })],
  });
  const before = readBattlefield(record, world);
  const after = readBattlefield(runFronts(frontInput(world, { battlefields: [record], days: 8, steering: steady })).battlefields[0], world);
  const gained = (lat) => (after.lineAt(lat).at(-1) - before.lineAt(lat).at(-1)) * 71.5;
  assert.ok(gained(50) > 40, `the point of the spear went ${gained(50)} km`);
  assert.equal(gained(49.1), 0, "the southern flank stood");
  assert.equal(gained(50.9), 0, "and the northern");
  // Only the sector's own troops went: the rest are where they were.
  const moved = after.troops[0].filter((troop, index) => Math.abs(troop.x - before.troops[0][index].x) > 1).length;
  assert.ok(moved >= 2 && moved <= 5, `${moved} of ten went`);
});

test("a blitz gains nothing while it masses, and then goes faster than an advance", () => {
  const world = plain();
  const troops = [row(20.9, 49, 51, 12), row(21.1, 49, 51, 4, { strength: 30 })];
  const start = () => battlefieldOn(world, { troops });
  const run = (word) => watchRun(frontInput(world, { battlefields: [start()], days: 12, steering: steady, moments: [{ day: 0, type: "order", battlefield: "The front", side: "Aland", order: word, sector: "north" }] }));
  const held = (holders) => holders.reduce((count, holder) => count + (holder === HOLDER_SIDE_A ? 1 : 0), 0);
  const blitz = run("blitz");
  const even = run("advance");
  const base = held(blitz.days[0].holders);
  // The mass gathers for four days before anyone steps off: an advance has ground on the first.
  const firstGain = blitz.days.findIndex((day) => held(day.holders) > base);
  assert.ok(firstGain >= 4, `the blitz took its first ground on day ${firstGain}`);
  for (let day = 1; day < firstGain; day += 1) assert.deepEqual(blitz.days[day].holders, blitz.days[0].holders);
  assert.equal(even.days.findIndex((day) => held(day.holders) > base), 1);
  // Once it goes, a day of it is worth more than a day of the advance.
  const pace = (days, from) => Math.max(...days[from + 3].troops[0].map((troop, index) => troop.x - days[from].troops[0][index].x)) / 3;
  assert.ok(pace(blitz.days, firstGain) > pace(even.days, 2) * 1.15, `${pace(blitz.days, firstGain)} cells a day against ${pace(even.days, 2)}`);
  // And all of it in the north.
  const frame = start().frame;
  for (let index = 0; index < blitz.days[7].holders.length; index += 1) {
    if (blitz.days[7].holders[index] !== blitz.days[0].holders[index]) assert.ok(Math.floor(index / frame.cols) > frame.rows * 0.4, "and it begins in the north");
  }
});

// ---- a troop does not walk in a straight line -------------------------------------

test("with nothing to steer by a troop walks its way straight; with its own drift, no two walk alike, and the same run walks the same", () => {
  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 8), []], orders: [standing(0, "advance")] });
  const bearings = (steering) => {
    const { days } = watchRun(frontInput(world, { battlefields: [record], days: 6, steering }));
    return days[6].troops[0].map((troop, index) => {
      const from = days[0].troops[0][index];
      return (troop.y - from.y) / (troop.x - from.x);
    });
  };
  // Even ground, nobody in reach, the drift set aside: along the way, with only the slide to its own place across it.
  for (const slope of bearings(steady).slice(3, 5)) assert.ok(Math.abs(slope) < 0.1, `straight (${slope})`);
  const drifting = bearings({ even: true });
  for (let index = 3; index < 6; index += 1) assert.ok(Math.abs(drifting[index] - drifting[index - 1]) > 0.003, `neighbours on different bearings (${drifting})`);
  assert.deepEqual(bearings({ even: true }), drifting);
});

test("a troop leans away from where the defenders in front of it are thick", () => {
  // One troop of Aland's going east; three of Borduria's dug in together a
  // little north of its way, sixty kilometres on.
  const world = plain();
  const clump = [{ lng: 21.75, lat: 50.12 }, { lng: 21.8, lat: 50.18 }, { lng: 21.85, lat: 50.1 }].map((place) => ({ ...place, dig: 1 }));
  const walk = (defenders) => {
    const record = battlefieldOn(world, { troops: [[{ lng: 20.9, lat: 50 }], defenders], orders: [standing(0, "advance")] });
    return watchRun(frontInput(world, { battlefields: [record], days: 4, steering: steady })).days.map((day) => day.troops[0][0]);
  };
  const clear = walk([]);
  const pressed = walk(clump);
  assert.ok(Math.abs(clear[3].y - clear[0].y) < 0.3, "with nobody ahead it keeps its line");
  // Its heading turns from them, by degrees: it is held up before it has gone far on it.
  const leant = Math.min(pressed[2].hy, pressed[3].hy, pressed[4].hy);
  assert.ok(leant < -0.03 && Math.abs(clear[3].hy) < 0.01, `with them ahead and to the north it leans south (its heading by ${leant})`);
});

test("no step ends in a wall, and a troop on the attack turns by degrees", () => {
  const world = syntheticMap({ layout: ["ABMBBB", "ABBBMB", "ABMBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities: [{ name: "Brod", lng: 24.5, lat: 50.2 }] });
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 7, { strength: 50 })], orders: [standing(0, "advance"), standing(1, "fall back")], regionTypes, pool: [200, 200] });
  const { days } = watchRun(frontInput(world, { battlefields: [record], days: 14, regionTypes }));
  const { cols, rows } = record.frame;
  let moves = 0;
  days.forEach((day, at) => {
    day.troops.forEach((list, side) => list.forEach((troop, index) => {
      if (!(troop.strength > 0)) return;
      assert.ok(troop.x >= 0 && troop.y >= 0 && troop.x < cols && troop.y < rows, "on the frame");
      const cell = Math.floor(troop.y) * cols + Math.floor(troop.x);
      assert.notEqual(day.holders[cell], HOLDER_WALL, `day ${at}: a troop stands in a wall`);
      const before = at > 1 ? days[at - 1].troops[side][index] : null;
      const earlier = at > 1 ? days[at - 2].troops[side][index] : null;
      if (side !== 0 || !before || !earlier || troop.state !== 1 || before.state !== 1) return;
      const now = [troop.x - before.x, troop.y - before.y];
      const then = [before.x - earlier.x, before.y - earlier.y];
      if (Math.hypot(...now) < 1 || Math.hypot(...then) < 1) return;
      moves += 1;
      // The heading it keeps turns by degrees: a troop wheels at once only when it is taken off its way.
      const kept = before.hx * troop.hx + before.hy * troop.hy;
      if (kept < 0.86) return;
      // Round a wall it may give a little of its way back; it never turns round.
      assert.ok((now[0] * then[0] + now[1] * then[1]) / (Math.hypot(...now) * Math.hypot(...then)) > -0.2, `day ${at}: troop ${index} came back on itself`);
    }));
  });
  assert.ok(moves > 40, `${moves} moves were checked`);
});

// ---- individuals, not a rank ---------------------------------------------------------

test("troops do not stand evenly spaced, at one depth, or advance in lockstep", () => {
  // A border 450 km long, and two states that each field thirty counters.
  const world = syntheticMap({ layout: ["ABBBB", "ABBBB", "ABBBB", "ABBBB"], legend, west: 20, north: 52, step: 1.4, stepLat: 1 });
  const thirty = () => 2.5;
  const opened = runFronts(frontInput(world, { days: 0, strengthOf: thirty }));
  const seen = readBattlefield(opened.battlefields[0], world);
  for (const side of [0, 1]) {
    const list = seen.troops[side].slice().sort((a, b) => a.y - b.y);
    assert.ok(list.length >= 28 && list.length <= 32, `${list.length} counters`);
    const gaps = list.slice(1).map((troop, index) => troop.y - list[index].y);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    assert.ok(Math.max(...gaps) >= 1.5 * Math.min(...gaps), "the widest gap is half as wide again as the narrowest");
    assert.ok(Math.min(...gaps) >= 0.3 * mean, `and no two crowd each other (${Math.min(...gaps)} against a mean of ${mean})`);
    const border = seen.place.toCell(21.4, 50)[0];
    const depths = list.map((troop) => Math.abs(troop.x - border));
    assert.ok(Math.max(...depths) >= 2 * Math.min(...depths), `the furthest back stands twice as far back as the nearest (${Math.min(...depths)} to ${Math.max(...depths)} cells)`);
  }
  assert.deepEqual(runFronts(frontInput(world, { days: 0, strengthOf: thirty })).battlefields[0].troops, opened.battlefields[0].troops, "the same input stands them in the same places");
  assert.notDeepEqual(runFronts(frontInput(world, { days: 0, strengthOf: thirty, seed: "other" })).battlefields[0].troops, opened.battlefields[0].troops);

  // Ten days of advance against a weak, even defence: no lockstep.
  const fought = watchRun(frontInput(world, { days: 10, strengthOf: (name) => (name === "Aland" ? 6 : 2), moments: [{ day: 0, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" }] }));
  const advance = fought.days[10].troops[0].map((troop, index) => troop.x - fought.days[0].troops[0][index].x).filter((gone, index) => fought.days[10].troops[0][index].strength > 0);
  const mean = advance.reduce((sum, gone) => sum + gone, 0) / advance.length;
  assert.ok(mean > 20, `they advanced ${mean} cells on average`);
  assert.ok((Math.max(...advance) - Math.min(...advance)) / mean >= 0.25, `from ${Math.min(...advance)} to ${Math.max(...advance)} cells`);
});

test("a troop whose attack is called off stays where it ended, unless it must move", () => {
  const world = plain({ layout: ["ABBBBBBBB", "ABBBBBBBB"] });
  const troops = [row(20.9, 49, 51, 11), row(21.1, 49, 51, 5, { strength: 60 })];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")], pool: [300, 100] });
  const moments = [{ day: 6, type: "order", battlefield: "The front", side: "Aland", order: "hold", sector: "all" }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 16, moments, pace: 0.5 }));
  assert.equal(result.battlefields[0].orders[0].order, "hold");
  // While it attacked, everyone went forward.
  for (let index = 0; index < 11; index += 1) assert.ok(days[6].troops[0][index].x > days[0].troops[0][index].x + 5, `troop ${index} advanced`);
  // What was left to close on behind them is closed in the days after; then
  // nothing moves: no ground changes hands, and nobody walks back into a row.
  const held = (day) => day.holders.reduce((count, holder) => count + (holder === HOLDER_SIDE_A ? 1 : 0), 0);
  for (let day = 14; day <= 16; day += 1) assert.equal(held(days[day]), held(days[13]), `day ${day}: no ground changes hands`);
  let stayed = 0;
  for (let index = 0; index < 11; index += 1) {
    const moved = Math.hypot(days[16].troops[0][index].x - days[13].troops[0][index].x, days[16].troops[0][index].y - days[13].troops[0][index].y);
    if (moved < 0.1) stayed += 1;
  }
  assert.ok(stayed >= 9, `${stayed} of eleven did not move at all in the last three days`);
});

// ---- flanking ------------------------------------------------------------------------

test("a defender holds worse against two directions at once, and works are no help from behind", () => {
  // A strip of Borduria 107 km wide between two lands of Aland's, and one
  // defender in it, standing behind the western edge and facing it.
  const world = syntheticMap({ layout: ["~~~~~~~~", "AABBBAA~", "~~~~~~~~"], legend, west: 20, north: 51, step: 0.5, stepLat: 1 });
  // (Neither side has reserves: what a fight costs is not made good, and shows.)
  const fight = (attackers, extra = {}, days = 6) => {
    const record = battlefieldOn(world, { troops: [attackers, [{ lng: 21.2, lat: 50, ...extra }]], orders: [standing(0, "advance"), standing(1, "hold")], pool: [0, 0] });
    const result = runFronts(frontInput(world, { battlefields: [record], days, steering: steady }));
    return readBattlefield(result.battlefields[0], world);
  };
  const untouched = readBattlefield(battlefieldOn(world), world);
  const west = { lng: 20.93, lat: 50 };
  const east = { lng: 22.57, lat: 50 };
  // One attacker in front of it gets nowhere in six days. With another coming
  // at it from behind, the same attacker breaks in, and the defender comes off
  // worse than against either of them alone.
  const front = fight([west]);
  const behind = fight([east]);
  const both = fight([west, east]);
  const [startX] = untouched.place.toCell(20.93, 50);
  assert.ok(Math.abs(front.troops[0][0].x - startX) < 0.1, "alone in front of it: no step forward");
  assert.equal(front.held[1], untouched.held[1], "and no ground");
  assert.ok(both.troops[0][0].x > startX + 0.5, `with another behind the defender it broke in: ${both.troops[0][0].x - startX} cells`);
  assert.ok(both.troops[1][0].x > front.troops[1][0].x, "and the defender gave way");
  assert.ok(both.troops[1][0].strength < Math.min(front.troops[1][0].strength, behind.troops[1][0].strength) - 2, `the defender: ${both.troops[1][0].strength} left, against ${front.troops[1][0].strength} and ${behind.troops[1][0].strength}`);

  // Works dug facing the enemy count against the front...
  const dugFront = fight([west], { dig: 1 }, 20);
  const openFront = fight([west], {}, 20);
  assert.ok(dugFront.troops[1][0].strength > openFront.troops[1][0].strength, "a dug-in defender comes off better against its front");
  assert.ok(dugFront.troops[0][0].strength < openFront.troops[0][0].strength, "and the attacker worse");
  // ...and for nothing against an attacker coming from behind.
  const dug = fight([east], { dig: 1 }, 2);
  const open = fight([east], {}, 2);
  assert.deepEqual(dug.holders, open.holders, "dug in or not, the same ground is lost to an attack from behind");
  assert.ok(dug.held[1] < untouched.held[1], "and ground was lost");
});

test("a flank is a column that goes round one side of what it is sent round, and none through it", () => {
  const cities = [{ name: "Brod", lng: 22.0, lat: 50 }];
  const world = plain({ cities });
  const clump = [{ lng: 21.9, lat: 50.05 }, { lng: 21.95, lat: 49.95 }, { lng: 22.0, lat: 50.1 }, { lng: 22.05, lat: 50 }].map((place) => ({ ...place, dig: 1 }));
  const record = battlefieldOn(world, { troops: [row(20.9, 49.6, 50.4, 6), clump], orders: [standing(1, "dig in")] });
  // Told in other words, it is the same order.
  const moments = [{ day: 0, type: "order", battlefield: "The front", side: "Aland", order: "outflank", sector: "all", objective: "city: Brod" }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 12, moments, steering: steady }));
  assert.equal(result.battlefields[0].orders.find((order) => order.s === 0).order, "flank");
  assert.deepEqual(result.notes, []);
  const frame = record.frame;
  const [townX, townY] = readBattlefield(record, world).place.toCell(22.0, 50);
  const movers = days[12].troops[0].map((troop, index) => ({ index, gone: troop.x - days[0].troops[0][index].x })).filter((troop) => troop.gone > 4);
  assert.ok(movers.length >= 4, `${movers.length} troops went round`);
  const sides = new Set();
  for (const { index } of movers) {
    for (let day = 0; day < days.length; day += 1) {
      const troop = days[day].troops[0][index];
      assert.ok(Math.hypot(troop.x - townX, troop.y - townY) * frame.km > 8, "none went through the defenders");
      const before = day > 0 ? days[day - 1].troops[0][index] : troop;
      // The day it came level with them: which side of them it was on.
      if (before.x < townX && troop.x >= townX) sides.add(Math.sign(before.y + ((troop.y - before.y) * (townX - before.x)) / (troop.x - before.x) - townY));
    }
  }
  assert.equal(sides.size, 1, "and all on one side of them");
});

// ---- what the map is handed ------------------------------------------------------------

test("taken ground is painted for the member whose troops took it, and the map is handed sound ground every day", () => {
  const world = syntheticMap({ layout: ["ABBBBB", "CBBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const sides = [["Aland", "Cisland"], ["Borduria"]];
  // Aland's troops in the north, Cisland's in the south.
  const troops = [[...row(20.9, 49, 50, 5, { owner: 1 }), ...row(20.9, 50, 51, 5, { owner: 0 })], row(21.1, 49, 51, 3, { strength: 40 })];
  const record = battlefieldOn(world, { sides, troops, orders: [standing(0, "advance")] });
  const wars = [{ id: "war-1", status: "active", sideA: sides[0], sideB: sides[1] }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], wars, days: 6, steering: steady }));
  const { cols, rows } = record.frame;
  const last = days[6];
  let north = 0;
  let south = 0;
  for (let index = 0; index < last.holders.length; index += 1) {
    assert.ok([HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL].includes(last.holders[index]));
    if (last.holders[index] === HOLDER_WALL) continue;
    assert.ok(last.painters[index] < sides[last.holders[index]].length, "a painter is one of the side's own members");
    if (last.holders[index] !== HOLDER_SIDE_A || days[0].holders[index] === HOLDER_SIDE_A) continue;
    const row = Math.floor(index / cols);
    // Away from where the two meet, each took its own.
    if (row > rows * 0.62) {
      assert.equal(last.painters[index], 0, "taken in the north: Aland's");
      north += 1;
    } else if (row < rows * 0.38) {
      assert.equal(last.painters[index], 1, "taken in the south: Cisland's");
      south += 1;
    }
  }
  assert.ok(north > 100 && south > 100);
  // Whose home a cell is does not move with the line: it changes only on the
  // day the whole of its region is held, and then for every cell of the region.
  assert.ok(days[0].homes.includes(0) && days[0].homes.includes(1) && days[0].homes.includes(2));
  const arena = rasterizeArena(record.frame, world.regions, {});
  let whole = 0;
  for (let day = 1; day < days.length; day += 1) {
    const turned = new Set();
    for (let index = 0; index < arena.size; index += 1) if (days[day].homes[index] !== days[day - 1].homes[index]) turned.add(arena.region[index]);
    for (const region of turned) {
      whole += 1;
      for (let index = 0; index < arena.size; index += 1) {
        if (arena.region[index] !== region) continue;
        assert.equal(days[day].holders[index], HOLDER_SIDE_A, "every cell of a region that changed home is held");
        assert.equal(days[day].homes[index], HOLDER_SIDE_A, "and all of it is home now");
        assert.equal(days[day].painters[index], days[day].painters[arena.region.indexOf(region)], "painted for one member");
      }
    }
  }
  assert.ok(whole >= 2, `${whole} regions were taken whole`);
  // Ground taken in a region that is not yet whole is not home: the map draws it as taken.
  let takenNotHome = 0;
  for (let index = 0; index < arena.size; index += 1) {
    if (days[2].holders[index] === HOLDER_SIDE_A && days[0].holders[index] === HOLDER_SIDE_B && days[2].homes[index] === HOLDER_SIDE_B) takenNotHome += 1;
  }
  assert.ok(takenNotHome > 100, `${takenNotHome} cells taken and not yet home on the second day`);
  // A cell that changed hands did so at some part of that day.
  for (let day = 1; day < days.length; day += 1) {
    let changed = 0;
    for (let index = 0; index < days[day].holders.length; index += 1) {
      if (days[day].holders[index] === days[day - 1].holders[index]) continue;
      changed += 1;
      assert.ok(days[day].when[index] >= 0 && days[day].when[index] <= 1, `when: ${days[day].when[index]}`);
    }
    assert.ok(changed > 0);
  }
  const early = days[3].when.filter((value, index) => days[3].holders[index] !== days[2].holders[index]);
  assert.ok(Math.min(...early) < 0.5 && Math.max(...early) > 0.5, "spread over the day, as the troops walked");

  // The record keeps a replay of it, and no line.
  const [saved] = result.battlefields;
  assert.equal(saved.frames, undefined);
  assert.deepEqual(saved.replay.names, ["Aland", "Cisland", "Borduria"]);
  // The record's own check keeps all of it, the regions taken in name and not yet whole among it.
  assert.deepEqual(normalizeBattlefield(saved), saved);
  for (const [id, name] of saved.contested) assert.ok(world.regions.some((region) => region.id === id) && name === "Borduria", "a region still shown as Borduria's");
  const replay = replayOf(saved);
  assert.equal(replay.days, 6);
  // Painted in the replay as the engine painted it: ground Cisland took in a
  // region that is not yet whole is state 2, its name's; a region taken whole
  // is its holder's own ground, and has no paint over it.
  const ground = Uint8Array.from(replay.paint.began);
  replay.paint.cells.forEach((cell, index) => { ground[cell] = replay.paint.states[index]; });
  let painted = 0;
  let own = 0;
  for (let index = 0; index < last.holders.length; index += 1) {
    if (last.holders[index] !== HOLDER_SIDE_A || days[0].holders[index] !== HOLDER_SIDE_B) continue;
    if (last.homes[index] === HOLDER_SIDE_A) {
      assert.equal(ground[index], PAINT_OWN_A, "whole: its holder's own");
      own += 1;
    } else {
      assert.equal(ground[index], 1 + last.painters[index], "taken: painted for the member that took it");
      painted += 1;
    }
  }
  assert.ok(own > 100 && painted > 100, `${own} cells taken whole, ${painted} taken and painted`);
  const probe = last.holders.findIndex((holder, index) => holder === HOLDER_SIDE_A && last.homes[index] === HOLDER_SIDE_B && Math.floor(index / cols) < rows * 0.3);
  assert.equal(ground[probe], 2, "Cisland's, in the south");
  // One path a troop, ending where the record has it.
  for (const side of [0, 1]) {
    const tracks = decodeTracks(saved.replay.t[side]);
    const list = decodeTroops(saved.troops[side]);
    assert.equal(tracks.length, list.length);
    list.forEach((troop, index) => {
      if (!(troop.strength > 0)) return;
      const end = tracks[index].at(-1);
      assert.ok(Math.abs(end.x - troop.x) <= 1 / 16 && Math.abs(end.y - troop.y) <= 1 / 16);
    });
  }
  assert.ok(applyFlips(world, result.flips));
});

test("one list of troops a side for a whole record: the fallen keep their places until the next run begins", () => {
  const world = plain();
  const units = [
    { id: "unit-7", name: "7th Rifles", type: "infantry", ownerCode: "Aland", strength: 90, lng: 20.8, lat: 50.4 },
    // (Left 68 km behind Aland's line, with none of its own side's ground to fall back to.)
    { id: "unit-8", name: "8th Lancers", type: "armor", ownerCode: "Borduria", strength: 20, lng: 20.05, lat: 50 },
  ];
  // Borduria's few are overrun, and one of them is a named formation; both sides are sent more.
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49.6, 50.4, 3, { strength: 25 })], orders: [standing(0, "advance")] });
  const moments = [
    { day: 3, type: "reinforce", owner: "Aland", strength: 80, kind: "infantry", lng: 20.7, lat: 49.5 },
    { day: 4, type: "reinforce", owner: "Borduria", name: "9th Guards", unitId: "unit-9", strength: 100, kind: "armor", lng: 24.5, lat: 50.5 },
  ];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], units, days: 10, moments, steering: steady }));
  const [saved] = result.battlefields;
  const lists = saved.troops.map(decodeTroops);
  assert.equal(lists[0].length, 14, "twelve, a formation taken in, and one sent");
  assert.equal(lists[1].length, 5);
  assert.ok(lists[1].some((troop) => troop.strength === 0), "the fallen are still in the saved list");
  // A list only ever grows at its end: every index of an earlier day means the same troop later.
  for (let day = 1; day < days.length; day += 1) {
    for (const side of [0, 1]) assert.ok(days[day].troops[side].length >= days[day - 1].troops[side].length);
  }
  assert.equal(days[2].troops[0].length, 13);
  assert.equal(days[3].troops[0].length, 14);
  for (const entry of saved.named) {
    assert.equal(lists[entry.s][entry.i].named, true, `${entry.name} is where the record says`);
    assert.equal(decodeTracks(saved.replay.t[entry.s]).length, lists[entry.s].length);
  }
  assert.deepEqual(saved.named.map((entry) => entry.unitId), ["unit-7", "unit-8", "unit-9"]);
  // The named formation that fell is struck off the world's list when the run is saved.
  const lancers = saved.named.find((entry) => entry.unitId === "unit-8");
  assert.equal(lists[1][lancers.i].strength, 0);
  assert.deepEqual(result.unitChanges, [
    { unitId: "unit-7", committedTo: "The front" },
    { unitId: "unit-8", committedTo: "The front" },
    { unitId: "unit-9", committedTo: "The front" },
    { unitId: "unit-8", committedTo: "", remove: true },
  ]);

  // The next run begins by dropping the fallen: its lists are in its own order from the first day.
  applyFlips(world, result.flips);
  const next = watchRun(frontInput(world, { battlefields: result.battlefields, days: 0, fromDate: "2024-03-11", steering: steady }));
  const began = next.days[0].troops;
  assert.ok(began[0].every((troop) => troop.strength > 0) && began[1].every((troop) => troop.strength > 0), "no fallen troop in the first day of the next run");
  const after = next.result.battlefields[0];
  assert.deepEqual(after.named.map((entry) => entry.unitId), ["unit-7", "unit-9"]);
  const before = (unitId) => lists[saved.named.find((entry) => entry.unitId === unitId).s][saved.named.find((entry) => entry.unitId === unitId).i];
  for (const entry of after.named) {
    const troop = began[entry.s][entry.i];
    const was = before(entry.unitId);
    assert.ok(Math.abs(troop.x - was.x) < 1e-9 && Math.abs(troop.y - was.y) < 1e-9, `${entry.name} is the same formation, at the same place`);
    assert.equal(decodeTroops(after.troops[entry.s])[entry.i].named, true);
  }
  assert.deepEqual(next.result.unitChanges, []);
});

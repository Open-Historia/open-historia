// Run: node --test src/runtime/fronts/orders.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { rasterizeArena } from "./arena.js";
import { describeBattlefield } from "./brief.js";
import { FLIP_AT, HOLDER_SIDE_A, HOLDER_SIDE_B, MIN_DAYS_BETWEEN_FLIPS } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { createFrame, projectorOf } from "./frame.js";
import { normalizeBattlefields } from "./record.js";
import { replayOf } from "./replay.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, disc, readBattlefield } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", C: "Cisland", "~": null };
const steady = { even: true, wander: 0 };
const cities = [{ name: "Brod", lng: 22.1, lat: 50 }, { name: "Alba", lng: 20.4, lat: 50 }, { name: "Port", lng: 24.5, lat: 50.6 }];
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, cities, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The front", side, order: word, sector: "all", ...extra });
// Two even lines facing each other, neither told to do anything.
const facing = (world, extra = {}) => battlefieldOn(world, { troops: [row(20.9, 49, 51, 10), row(21.1, 49, 51, 10)], pool: [300, 300], ...extra });
const mean = (list, key) => list.reduce((sum, troop) => sum + troop[key], 0) / list.length;

test("captured: the objective is the attacker's by the end of that day, by a walk, and never earlier", () => {
  const world = plain();
  const record = facing(world);
  const moments = [order(2, "Aland", "spearhead", { sector: "centre", objective: "city: Brod", result: "captured" })];
  const input = (days) => frontInput(world, { battlefields: [record], days, moments: moments.filter((moment) => moment.day <= days), steering: steady });
  const dayBefore = readBattlefield(runFronts(input(1)).battlefields[0], world);
  assert.equal(dayBefore.holderAt(22.1, 50), HOLDER_SIDE_B, "not before its day");
  assert.equal(dayBefore.held[0], readBattlefield(record, world).held[0]);
  const result = runFronts(input(2));
  const seen = readBattlefield(result.battlefields[0], world);
  assert.equal(seen.holderAt(22.1, 50), HOLDER_SIDE_A, "the town is taken");
  // The way there is the attacker's too: it was walked.
  for (const lng of [21.2, 21.5, 21.8]) assert.equal(seen.holderAt(lng, 50), HOLDER_SIDE_A, `the way at ${lng}`);
  assert.equal(seen.holderAt(21.6, 50.7), HOLDER_SIDE_B, "and nothing but the way");
  // The column that walked it stands at the objective.
  const there = seen.troops[0].filter((troop) => Math.hypot(troop.lng - 22.1, (troop.lat - 50) * 1.56) < 0.35);
  assert.ok(there.length >= 2 && there.length <= 4, `${there.length} troops at the objective`);
  assert.ok(there.every((troop) => troop.state === 1));
  // Defenders in the way gave way and paid for it.
  const pushed = seen.troops[1].filter((troop) => troop.strength < 75);
  assert.ok(pushed.length >= 1 && pushed.every((troop) => seen.holderAt(troop.lng + 0.03, troop.lat) === HOLDER_SIDE_B || troop.strength === 0));
  assert.deepEqual(result.battlefields[0].log.filter((entry) => entry.k === "city"), [{ d: "2024-03-03", k: "city", at: "city: Brod", s: 0 }]);
  assert.deepEqual(result.battlefields[0].brief.cities, [["Brod"], []]);
  assert.deepEqual(result.notes, []);
  // With no objective of its own, the result is about the one the standing order names.
  const later = runFronts(frontInput(world, { battlefields: [facing(world, { orders: [standing(0, "spearhead", { sector: "centre", objective: "city: Brod" })] })], days: 0, moments: [order(0, "Aland", "", { sector: "centre", result: "captured" })], steering: steady }));
  assert.equal(readBattlefield(later.battlefields[0], world).holderAt(22.1, 50), HOLDER_SIDE_A);
  assert.equal(later.battlefields[0].orders.length, 1, "and the standing orders are left exactly as they were");
  // Nowhere to capture, or no way there: said, and nothing done.
  const none = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "", { result: "captured", ref: 3 })] }));
  assert.deepEqual(none.notes, [{ battlefield: "The front", side: "Aland", ref: 3, kind: "objective-not-found", detail: "captured" }]);
  assert.deepEqual(none.battlefields[0].field, record.field);
});

test("breakthrough: the defenders in the middle of the sector are broken, and nothing is repainted", () => {
  const world = plain();
  const record = facing(world, { troops: [row(20.9, 49, 51, 10), row(21.1, 49, 51, 10, { dig: 0.5 })] });
  const result = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "advance", { sector: "north", result: "breakthrough" })] }));
  const seen = readBattlefield(result.battlefields[0], world);
  assert.deepEqual(result.battlefields[0].field, record.field, "the line is where it was");
  const broken = seen.troops[1].filter((troop) => troop.strength < 60);
  assert.ok(broken.length >= 2 && broken.length <= 5, `${broken.length} defenders broken`);
  for (const troop of seen.troops[1]) {
    // The north third of the line, and its central 80 km.
    const inMiddle = Math.abs(troop.lat - 50.67) < 0.36;
    assert.equal(troop.strength < 60, inMiddle, `at ${troop.lat}: ${troop.strength}`);
    assert.equal(troop.dig, inMiddle ? 0 : 4 / 7);
  }
  assert.ok(seen.troops[0].every((troop) => troop.strength === 100));
  assert.deepEqual(result.battlefields[0].orders, [{ s: 0, sector: "north", order: "advance", since: "2024-03-01", by: "Aland" }]);
});

test("repulsed: the ground gained on that sector goes back, and the attackers with it", () => {
  const world = plain();
  const record = facing(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 4, { strength: 40 })] });
  const moments = [order(0, "Aland", "advance"), order(5, "Aland", "advance", { sector: "north", result: "repulsed" })];
  const run = createFrontRun(frontInput(world, { battlefields: [record], days: 12, moments, steering: steady }));
  const start = readBattlefield(run.snapshot().battlefields[0], world);
  run.advance(4);
  const before = readBattlefield(run.snapshot().battlefields[0], world);
  run.advance(1);
  const after = run.snapshot();
  const seen = readBattlefield(after.battlefields[0], world);
  assert.ok(before.lineAt(50.7).at(-1) > start.lineAt(50.7).at(-1) + 0.5, "ground had been gained in the north");
  assert.ok(Math.abs(seen.lineAt(50.7).at(-1) - start.lineAt(50.7).at(-1)) < 0.02, `the line in the north is back where the run began (${seen.lineAt(50.7).at(-1)})`);
  assert.ok(seen.lineAt(49.3).at(-1) > start.lineAt(49.3).at(-1) + 0.5, "the south keeps what it gained");
  // The attackers that had gone forward in the north are back behind the
  // restored line, a quarter weaker; the rest are as they were.
  let back = 0;
  seen.troops[0].forEach((troop, index) => {
    const was = before.troops[0][index];
    if (was.lat > 50.5 && was.lng > 21.05) {
      back += 1;
      assert.ok(troop.lng < 21.02, `back behind the restored line (${troop.lng})`);
      assert.ok(troop.strength < was.strength * 0.8, `a quarter weaker (${was.strength} to ${troop.strength})`);
    } else if (was.lat < 50.3) assert.ok(troop.strength > was.strength * 0.9, "the south was not touched");
  });
  assert.ok(back >= 2, `${back} troops came back`);
  assert.deepEqual(after.battlefields[0].brief.carry.halts, [{ s: 0, sector: "north", days: 14 }]);
  // No step there for a fortnight: a week on, the north is still where it was put back.
  run.advance(7);
  const week = readBattlefield(run.snapshot().battlefields[0], world);
  assert.ok(Math.abs(week.lineAt(50.7).at(-1) - start.lineAt(50.7).at(-1)) < 0.02);
  assert.ok(week.lineAt(49.3).at(-1) > seen.lineAt(49.3).at(-1), "while the south went on");
  assert.deepEqual(run.snapshot().battlefields[0].brief.carry.halts, [{ s: 0, sector: "north", days: 7 }]);
  // The halt is carried into the next run and runs out there.
  const next = runFronts(frontInput(world, { battlefields: run.finish().battlefields, days: 10, fromDate: "2024-03-13", steering: steady, controllerOf: (id) => (applyFlips(world, run.finish().flips), world.controllerOf(id)) }));
  assert.deepEqual(next.battlefields[0].brief.carry.halts, []);
});

test("stalemate, collapse and surrender", () => {
  const world = plain();
  const record = facing(world, { orders: [standing(0, "advance", { objective: "city: Brod" }), standing(1, "advance", { sector: "south" })] });
  // Stalemate: both sides hold on that sector.
  const stalled = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "advance", { sector: "south", result: "stalemate" })] })).battlefields[0];
  assert.deepEqual(stalled.orders.map(({ s, sector, order: word }) => [s, sector, word]), [[0, "all", "advance"], [0, "south", "hold"], [1, "south", "hold"]]);
  // Said of a side whose orders are not the engine's to change: they stand, and it is held where it is.
  const told = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "", { sector: "south", result: "stalemate" })] })).battlefields[0];
  assert.deepEqual(told.orders.filter((entry) => entry.s === 0), record.orders.filter((entry) => entry.s === 0));
  assert.deepEqual(told.orders.filter((entry) => entry.s === 1).map(({ sector, order: word }) => [sector, word]), [["south", "hold"]]);
  assert.deepEqual(told.brief.carry.halts, [{ s: 0, sector: "south", days: 14 }]);

  // Collapse: that side's troops fall to a fifth and its reserves to nothing; the other side advances everywhere.
  const fallen = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Borduria", "", { result: "collapse" })] }));
  const seen = readBattlefield(fallen.battlefields[0], world);
  assert.ok(Math.abs(mean(seen.troops[1], "strength") - 20) < 1.5);
  assert.equal(mean(seen.troops[0], "strength"), 100);
  assert.deepEqual(fallen.battlefields[0].pool, [300, 0]);
  assert.deepEqual(fallen.battlefields[0].orders.filter((entry) => entry.s === 0), [{ s: 0, sector: "all", order: "advance", since: "2024-03-01" }]);
  assert.deepEqual(fallen.battlefields[0].field, record.field, "nothing is handed over at once");
  const week = runFronts(frontInput(world, { battlefields: [record], days: 7, moments: [order(0, "Borduria", "", { result: "collapse" })] }));
  assert.ok(readBattlefield(week.battlefields[0], world).held[0] > seen.held[0] * 2, "the ground then falls at pace");

  // Surrender of the whole line: that side's troops are gone and the battlefield closes.
  const over = runFronts(frontInput(world, { battlefields: [record], days: 3, moments: [order(1, "Borduria", "", { result: "surrender" })] }));
  assert.equal(over.battlefields[0].status, "closed");
  assert.equal(over.battlefields[0].closedDate, "2024-03-02");
  assert.ok(readBattlefield(over.battlefields[0], world).troops[1].every((troop) => troop.strength === 0));
  assert.deepEqual(over.notes.map((note) => note.kind), ["closed"]);
  assert.deepEqual(normalizeBattlefields(over.battlefields), over.battlefields);

  // Surrender of a pocket, named by a place inside it: that pocket goes now, not in ten days.
  const pocketed = battlefieldOn(world, {
    troops: [[...row(20.9, 49, 51, 6), { lng: 24.5, lat: 50.6 }, { lng: 24.45, lat: 50.55 }], row(21.1, 49, 51, 6)],
    carve: (field, toCell) => disc(field, HOLDER_SIDE_A, ...toCell(24.5, 50.6), 7),
  });
  const given = runFronts(frontInput(world, { battlefields: [pocketed], days: 1, moments: [order(1, "Aland", "", { sector: "city: Port", result: "surrender" }), order(1, "Aland", "", { sector: "city: Alba", result: "surrender", ref: 9 })] }));
  const gone = readBattlefield(given.battlefields[0], world);
  assert.equal(readBattlefield(pocketed, world).holderAt(24.5, 50.6), HOLDER_SIDE_A);
  assert.equal(gone.holderAt(24.5, 50.6), HOLDER_SIDE_B);
  assert.deepEqual(gone.troops[0].map((troop) => troop.strength > 0), [true, true, true, true, true, true, false, false]);
  assert.equal(given.battlefields[0].status, "active");
  assert.deepEqual(given.notes, [{ battlefield: "The front", side: "Aland", ref: 9, kind: "no-pocket-there", detail: "city: Alba" }]);
});

test("a region changes hands in name when more than six tenths of it are held, not before, and a ceiling stops the advance", () => {
  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), row(21.1, 49, 51, 3, { strength: 30 })], orders: [standing(0, "advance")] });
  const arena = rasterizeArena(record.frame, world.regions, {});
  const days = [];
  const input = (extra = {}) => frontInput(world, { battlefields: [record], days: 12, steering: steady, ...extra });
  const result = runFronts({ ...input(), watch: ({ day, holders }) => { days[day] = Uint8Array.from(holders); } });
  // The share of a region side A held at the end of a day.
  const share = (day, id) => {
    const region = arena.indexOf.get(id);
    let held = 0;
    for (let index = 0; index < arena.size; index += 1) if (arena.region[index] === region && days[day][index] === HOLDER_SIDE_A) held += 1;
    return held / arena.cells[region];
  };
  assert.ok(result.flips.length >= 4, `${result.flips.length} regions changed hands`);
  const seen = new Map();
  for (const flip of result.flips) {
    assert.deepEqual([flip.from, flip.to, flip.kind, flip.battlefield], ["Borduria", "Aland", "control", "The front"]);
    assert.equal(flip.date, `2024-03-${String(flip.day + 1).padStart(2, "0")}`);
    assert.ok(share(flip.day, flip.regionId) > FLIP_AT, `${flip.regionId} was ${share(flip.day, flip.regionId)} held on the day it changed hands`);
    assert.ok(share(flip.day - 1, flip.regionId) <= FLIP_AT, "and no more than six tenths the day before");
    assert.ok(!seen.has(flip.regionId) || flip.day - seen.get(flip.regionId) >= MIN_DAYS_BETWEEN_FLIPS, "no region flaps");
    seen.set(flip.regionId, flip.day);
  }
  assert.equal(seen.size, result.flips.length, "each region once");
  assert.deepEqual(result.battlefields[0].brief.taken[0], result.flips.map((flip) => world.regions.find((region) => region.id === flip.regionId).name));
  // From the day a region is taken in name until the day it is whole it is
  // listed under the name the map still draws it as, and the ground taken in
  // it is hatched.
  const stepped = createFrontRun(input());
  let listed = 0;
  for (let day = 1; day <= 12; day += 1) {
    stepped.advance(1);
    const [saved] = stepped.snapshot().battlefields;
    const names = new Map(saved.contested);
    for (const flip of result.flips) {
      const disputed = flip.day <= day && share(day, flip.regionId) < 1;
      assert.equal(names.get(flip.regionId), disputed ? "Borduria" : undefined, `${flip.regionId} on day ${day}`);
      if (disputed) listed += 1;
    }
    assert.equal(names.size, result.flips.filter((flip) => flip.day <= day && share(day, flip.regionId) < 1).length, "and no other region");
    if (names.size > 0) assert.ok(saved.held.length > 0);
  }
  assert.ok(listed >= 2, `a region was in dispute on ${listed} days`);

  // A scenario's ceiling: two regions may change hands in this run, and then nobody advances.
  const capped = runFronts({ ...input({ flipAllowance: 2 }), watch: ({ day, holders }) => { days[day] = Uint8Array.from(holders); } });
  assert.equal(capped.flips.length, 2);
  assert.deepEqual(capped.notes, [{ kind: "tempo" }]);
  const stopped = capped.flips[1].day;
  assert.deepEqual(days[12], days[stopped], "nothing moved after the ceiling was reached");
  assert.deepEqual(capped.flips, result.flips.slice(0, 2), "and up to it the run was the same run");
  const none = runFronts(input({ flipAllowance: 0 }));
  assert.deepEqual(none.flips, []);
  assert.deepEqual(none.notes, [{ kind: "tempo" }]);
  assert.deepEqual(none.battlefields[0].field, record.field);
});

test("a group holds an area without owning it: its gains are takes, and what a state wins back is released", () => {
  // The east is Aland's own country too, but the Free East hold it.
  const world = syntheticMap({ layout: ["AAAAAA", "AAAAAA"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const groupAreas = {};
  for (const region of world.regions) if (Number(region.id.slice(1).split("-")[0]) >= 1) groupAreas[region.id] = "Free East";
  const wars = [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Free East"] }];
  const base = { wars, groupAreas, isGroup: (name) => name === "Free East", steering: steady };
  const opened = runFronts(frontInput(world, { ...base, days: 0 }));
  const [record] = opened.battlefields;
  assert.equal(record.name, "Aland - Free East front");
  assert.deepEqual(record.sides, [["Aland"], ["Free East"]]);
  const seen = readBattlefield(record, world);
  assert.equal(seen.troops[0].length > 5 && seen.troops[1].length > 5, true);

  // Aland advances into the area: each region it wins is released from the group, and is Aland's as it always was.
  // (A side is sized when its battlefield opens: each case opens its own, the attacker four times the stronger.)
  const strong = (name) => (side) => (side === name ? 8 : 2);
  const openedFor = (name) => runFronts(frontInput(world, { ...base, days: 0, strengthOf: strong(name) })).battlefields;
  const won = runFronts(frontInput(world, { ...base, battlefields: openedFor("Aland"), days: 8, strengthOf: strong("Aland"), moments: [{ day: 0, type: "order", battlefield: record.name, side: "Aland", order: "advance", sector: "all" }] }));
  assert.ok(won.flips.length >= 2);
  for (const flip of won.flips) assert.deepEqual([flip.from, flip.to, flip.kind], ["Free East", "Aland", "groupRelease"]);
  // The group advances out of it: each region it wins is a take.
  const lost = runFronts(frontInput(world, { ...base, battlefields: openedFor("Free East"), days: 8, strengthOf: strong("Free East"), moments: [{ day: 0, type: "order", battlefield: record.name, side: "Free East", order: "advance", sector: "all" }] }));
  assert.ok(lost.flips.length >= 1);
  for (const flip of lost.flips) assert.deepEqual([flip.from, flip.to, flip.kind], ["Aland", "Free East", "groupTake"]);
  // The next run finds the area as the flips left it.
  const areas = applyFlips(world, won.flips, groupAreas);
  assert.equal(Object.keys(areas).length, Object.keys(groupAreas).length - won.flips.length);
  const next = runFronts(frontInput(world, { ...base, groupAreas: areas, battlefields: won.battlefields, days: 0, fromDate: "2024-03-09" }));
  assert.deepEqual(readBattlefield(next.battlefields[0], world).held, readBattlefield(won.battlefields[0], world).held, "nothing is repainted: the world and the field agree");
});

test("a landing: a disc of ground on the other side's shore, fed from where it landed", () => {
  const world = plain();
  const record = facing(world);
  const landed = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "land", { objective: "city: Port" })] }));
  const seen = readBattlefield(landed.battlefields[0], world);
  assert.equal(seen.holderAt(24.5, 50.6), HOLDER_SIDE_A);
  assert.equal(seen.holderAt(24.5, 50.3), HOLDER_SIDE_B, "a disc of two cells and no more");
  assert.equal(seen.contour.strands.filter((strand) => strand.closed).length, 1, "a beachhead is a ring");
  assert.deepEqual(landed.battlefields[0].pool, [0, 300], "its counters came out of the side's reserves");
  const ashore = seen.troops[0].slice(10);
  assert.equal(ashore.length, 3);
  assert.ok(ashore.every((troop) => Math.abs(troop.lng - 24.5) < 0.05 && Math.abs(troop.lat - 50.6) < 0.05 && troop.strength === 100));
  assert.deepEqual(landed.battlefields[0].orders, [], "a landing is done, not kept as a standing order");
  assert.equal(landed.battlefields[0].brief.carry.anchors.length, 1);
  // It is fed from its anchor: neither filled as a patch nor starved as a pocket.
  const held = runFronts(frontInput(world, { battlefields: landed.battlefields, days: 15 }));
  assert.equal(readBattlefield(held.battlefields[0], world).holderAt(24.5, 50.6), HOLDER_SIDE_A);
  assert.deepEqual(held.battlefields[0].brief.pockets, []);
  // With no reserves there is no landing; with no such place, no order.
  const poor = runFronts(frontInput(world, { battlefields: [facing(world, { pool: [0, 0] })], days: 0, moments: [order(0, "Aland", "land", { objective: "city: Port" })] }));
  assert.deepEqual(poor.notes, [{ battlefield: "The front", side: "Aland", kind: "landing-refused", detail: "no-reserves" }]);
  const own = runFronts(frontInput(world, { battlefields: [record], days: 0, moments: [order(0, "Aland", "land", { objective: "city: Alba" })] }));
  assert.deepEqual(own.notes, [{ battlefield: "The front", side: "Aland", kind: "landing-refused", detail: "city: Alba" }]);

  // Where the two sides do not touch at all, a landing opens the battlefield, under the name the order gave.
  const apart = syntheticMap({ layout: ["AA~~BBB", "AA~~BBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, cities: [{ name: "Port", lng: 24.6, lat: 50.2 }] });
  const quiet = runFronts(frontInput(apart, { days: 2 }));
  assert.deepEqual(quiet.battlefields, []);
  const invaded = runFronts(frontInput(apart, { days: 3, moments: [{ day: 1, type: "order", battlefield: "Operation Tide", side: "Aland", order: "land", sector: "all", objective: "city: Port" }] }));
  assert.equal(invaded.battlefields.length, 1);
  const [beach] = invaded.battlefields;
  assert.equal(beach.name, "Operation Tide");
  assert.equal(beach.openedDate, "2024-03-02");
  const shore = readBattlefield(beach, apart);
  assert.equal(shore.holderAt(24.6, 50.2), HOLDER_SIDE_A);
  assert.ok(shore.troops[0].length >= 6 && shore.troops[1].length >= 6);
  assert.ok(shore.troops[0].every((troop) => Math.abs(troop.lng - 24.6) < 0.3), "the attackers are in the beachhead");
  assert.equal(beach.replay.s, 1, "its replay begins the day it opened");
  assert.deepEqual(invaded.notes, []);
});

test("the frame grows when the line nears its edge, and the line stays where it was", () => {
  const world = plain();
  // A frame that covers only the western third of Borduria.
  const small = createFrame({ west: 20, south: 49, east: 22.6, north: 51 }, { marginKm: 10 });
  const troops = [row(20.9, 49, 51, 9), []];
  const tight = battlefieldOn(world, { troops, orders: [standing(0, "advance")], frame: small });
  const roomy = battlefieldOn(world, { troops, orders: [standing(0, "advance")] });
  const arenas = new Map();
  const run = (record, days, extra = {}) => runFronts(frontInput(world, { battlefields: [record], days, steering: steady, arenas, ...extra }));
  // While the line cannot reach the edge in a day's advance the frame is as it was.
  assert.deepEqual(run(tight, 1).battlefields[0].frame, small);
  const grown = run(tight, 6).battlefields[0];
  assert.ok(grown.frame.cols > small.cols, `${small.cols} columns grew to ${grown.frame.cols}`);
  assert.equal(grown.frame.cell, small.cell, "the same cells, more of them");
  assert.equal(grown.frame.rows, small.rows);
  // The run went on as if the frame had been that size from the start.
  const there = readBattlefield(grown, world);
  const wide = readBattlefield(run(roomy, 6).battlefields[0], world);
  for (const lat of [49.6, 50, 50.4]) {
    const apart = Math.abs(there.lineAt(lat).at(-1) - wide.lineAt(lat).at(-1)) / small.cell;
    assert.ok(apart < 1, `at ${lat} the line is ${apart} cells from where a roomy frame has it`);
  }
  there.troops[0].forEach((troop, index) => assert.ok(Math.abs(troop.lng - wide.troops[0][index].lng) < small.cell * 1.5));
  assert.ok(there.lineAt(50).at(-1) > 22.9, "and it is past where the old frame ended");
  // And its replay is of the whole run, carried onto the larger grid (replay.js carryOnto): a reveal shows the
  // battle at every event of the run, and each troop's path begins where it stood on the first day.
  assert.equal(grown.replay.s, 0, "the replay goes on across the growing");
  const { toLngLat } = projectorOf(grown.frame);
  const paths = replayOf(grown).tracks[0];
  assert.equal(paths.length, troops[0].length);
  paths.forEach((path, index) => {
    assert.equal(path[0].day, 0);
    assert.ok(Math.abs(toLngLat(path[0].x, path[0].y)[0] - troops[0][index].lng) < small.cell * 1.5, `troop ${index} began at ${toLngLat(path[0].x, path[0].y)[0]}`);
    const end = path[path.length - 1];
    assert.ok(Math.abs(toLngLat(end.x, end.y)[0] - there.troops[0][index].lng) < small.cell * 1.5, `troop ${index} ends where it stands`);
  });
  // Without the map's shapes a frame cannot grow: the engine says so, and the run is done again with them.
  const bare = { ...world.map, regions: null };
  const kept = new Map();
  run(tight, 0, { arenas: kept });
  assert.equal(run(tight, 1, { arenas: kept, map: bare }).needsRegions, undefined);
  assert.deepEqual(run(tight, 6, { arenas: kept, map: bare }), { needsRegions: true });
});

// ---- a siege -----------------------------------------------------------------------------

// A border 120 km long, and a town 30 km behind it on Borduria's side.
const siegeWorld = () => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 50.54, step: 1, stepLat: 0.54, cities: [{ name: "Brod", lng: 21.42, lat: 50 }] });
// Aland is told to encircle the town. The run is watched a day at a time until
// the ring has been closed for a while; what it is then is saved, and the
// sheet given the regions that changed hands, for other runs to begin from.
// The town has a garrison dug in: troops that only hold a line draw back
// before a ring can close on them, and it is those told to stand that are
// shut in.
const besiege = (extraDays = 2) => {
  const world = siegeWorld();
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49.46, 50.54, 12), [...row(21.1, 49.46, 50.54, 5), { lng: 21.42, lat: 50, dig: 1, state: 4 }]],
    orders: [standing(0, "encircle", { objective: "city: Brod" })],
  });
  const run = createFrontRun(frontInput(world, { battlefields: [record], days: 70, steering: steady }));
  const days = [run.snapshot()];
  let closed = -1;
  while (days.length <= 70 && (closed < 0 || days.length <= closed + extraDays)) {
    run.advance(1);
    days.push(run.snapshot());
    if (closed < 0 && days.at(-1).battlefields[0].brief.pockets.some((pocket) => pocket.siege)) closed = days.length - 1;
  }
  applyFlips(world, days.at(-1).flips);
  return { world, record, days, closed, saved: days.at(-1).battlefields[0], date: days.at(-1).battlefields[0].asOf };
};
// The cells within 20 km of the town that Aland holds, and Borduria's troop nearest it.
const roundTheTown = (record, world) => {
  const seen = readBattlefield(record, world);
  const [x, y] = seen.place.toCell(21.42, 50);
  let taken = 0;
  let within = 0;
  for (let index = 0; index < seen.holders.length; index += 1) {
    const dx = (index % seen.frame.cols) + 0.5 - x;
    const dy = Math.floor(index / seen.frame.cols) + 0.5 - y;
    if (Math.sqrt(dx * dx + dy * dy) * seen.frame.km > 20) continue;
    within += 1;
    if (seen.holders[index] === HOLDER_SIDE_A) taken += 1;
  }
  const garrison = seen.troops[1].filter((troop) => troop.strength > 0).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  return { seen, taken, within, garrison };
};
const sieges = (record) => record.brief.pockets.filter((pocket) => pocket.siege);

test("a siege: a place a side is told to encircle is shut in and left alone, and is its defenders' twenty days later", () => {
  const { world, days, closed } = besiege(45);
  assert.ok(closed >= 3 && closed <= 11, `the ring closed on day ${closed}`);
  // Until the ring closes there is no pocket, and the pincers have gone round the town, not through it.
  for (let day = 0; day < closed; day += 1) assert.deepEqual(days[day].battlefields[0].brief.pockets, []);
  for (let day = 0; day <= closed + 20; day += 1) {
    const { taken, within, seen } = roundTheTown(days[day].battlefields[0], world);
    assert.ok(within > 60, `${within} cells within 20 km of the town`);
    assert.equal(taken, 0, `day ${day}: no step of the besiegers took ground within 20 km of the town`);
    assert.equal(seen.holderAt(21.42, 50), HOLDER_SIDE_B);
  }
  // The day it closes the log says so, once, and the brief calls it what it is.
  const when = days[closed].battlefields[0].asOf;
  for (let day = closed; day <= closed + 20; day += 1) {
    const [record] = days[day].battlefields;
    assert.deepEqual(record.log.filter((entry) => entry.k === "siege"), [{ d: when, k: "siege", s: 1, at: "city: Brod" }]);
    assert.deepEqual(sieges(record), [{ s: 1, at: "city: Brod", days: day - closed + 1, siege: true }]);
  }
  // (Who is shut in and by whom, said outright: "Besieged: Borduria at X" could be read as Borduria's doing.)
  assert.match(describeBattlefield(days[closed + 12].battlefields[0]), /Besieged: troops of Borduria are shut in by Aland at city: Brod, 13 days\./);
  // Its garrison is alive, cut off, and has wasted by a point a day and nothing more: it is not assaulted.
  const first = roundTheTown(days[closed].battlefields[0], world).garrison;
  const last = roundTheTown(days[closed + 20].battlefields[0], world).garrison;
  assert.equal(last.state, 2, "encircled");
  assert.ok(last.strength > 40, `${last.strength} left`);
  assert.ok(Math.abs(first.strength - last.strength - 20) < 1.7, `twenty days cost it ${first.strength - last.strength}`);
  assert.ok(Math.abs(first.x - last.x) < 0.1 && Math.abs(first.y - last.y) < 0.1, "and it has not been made to give way");
  // It holds forty-five days where an ordinary pocket holds ten, and then it is the besiegers'.
  assert.deepEqual(sieges(days[closed + 43].battlefields[0]), [{ s: 1, at: "city: Brod", days: 44, siege: true }]);
  assert.equal(readBattlefield(days[closed + 43].battlefields[0], world).holderAt(21.42, 50), HOLDER_SIDE_B);
  const fell = days[closed + 44].battlefields[0];
  assert.equal(readBattlefield(fell, world).holderAt(21.42, 50), HOLDER_SIDE_A, "on the forty-fifth day it gives up");
  assert.deepEqual(fell.log.filter((entry) => entry.at === "city: Brod" && entry.k !== "siege").map(({ k, s }) => [k, s]).slice(-2), [["pocket", 1], ["city", 0]]);
  assert.deepEqual(sieges(fell), []);
});

test("a siege ends when the place is captured, when the besiegers are repulsed, when it is relieved, and when the order is replaced", () => {
  const { world, saved, date } = besiege(2);
  assert.equal(sieges(saved).length, 1);
  const from = (moments, days) => {
    const run = createFrontRun(frontInput(world, { battlefields: [saved], fromDate: date, days, moments, steering: steady }));
    const seen = [run.snapshot()];
    for (let day = 1; day <= days; day += 1) {
      run.advance(1);
      seen.push(run.snapshot());
    }
    return seen;
  };
  // Left alone it goes on: the next run finds it besieged still, and says nothing new.
  const quiet = from([], 4);
  assert.deepEqual(sieges(quiet[4].battlefields[0]), [{ s: 1, at: "city: Brod", days: 7, siege: true }]);
  assert.equal(quiet[4].battlefields[0].log.filter((entry) => entry.k === "siege").length, 1, "said once, in the run it closed");
  assert.equal(roundTheTown(quiet[4].battlefields[0], world).taken, 0);

  // "Captured": the town is the besiegers' that day, and not the day before.
  const stormed = from([order(3, "Aland", "", { battlefield: saved.name, result: "captured" })], 4);
  assert.equal(readBattlefield(stormed[2].battlefields[0], world).holderAt(21.42, 50), HOLDER_SIDE_B);
  assert.equal(readBattlefield(stormed[3].battlefields[0], world).holderAt(21.42, 50), HOLDER_SIDE_A, "taken the day the story says so");
  assert.deepEqual(stormed[3].battlefields[0].log.filter((entry) => entry.k === "city"), [{ d: stormed[3].battlefields[0].asOf, k: "city", s: 0, at: "city: Brod" }]);
  assert.deepEqual(sieges(stormed[3].battlefields[0]), [], "and the siege is over");
  assert.deepEqual(stormed[3].notes, []);

  // "Repulsed": the ring is opened, the town is its defenders' still, and they are cut off no longer.
  const lifted = from([order(1, "Aland", "", { battlefield: saved.name, result: "repulsed" })], 5);
  assert.equal(sieges(lifted[0].battlefields[0]).length, 1);
  for (let day = 1; day <= 5; day += 1) {
    const { seen, garrison } = roundTheTown(lifted[day].battlefields[0], world);
    assert.deepEqual(sieges(lifted[day].battlefields[0]), [], `day ${day}: the siege is lifted`);
    assert.equal(seen.holderAt(21.42, 50), HOLDER_SIDE_B);
    // (The day after the ring is opened the town still hangs by a neck of
    // ground between the besiegers' and counts as cut off; from the day
    // after that it does not.)
    if (day > 2) assert.notEqual(garrison.state, 2);
  }
  assert.deepEqual(lifted[5].battlefields[0].orders.map(({ s, order: word, objective }) => [s, word, objective]), [[0, "encircle", "city: Brod"]], "the standing order is left as it was");

  // A relief: fresh troops of the defenders' come up on their own ground east
  // of the ring and are told to advance; they break through it from outside,
  // and the siege is over.
  const relief = [];
  for (const lng of [22.6, 22.68, 22.76, 22.84]) {
    for (const lat of [49.97, 50.03]) relief.push({ day: 0, type: "reinforce", owner: "Borduria", strength: 100, kind: "armor", lng, lat });
  }
  const relieved = from([...relief, order(0, "Borduria", "advance", { battlefield: saved.name })], 8);
  const opened = relieved.findIndex((day, index) => index > 0 && sieges(day.battlefields[0]).length === 0);
  assert.ok(opened >= 1 && opened <= 8, `the ring was open again on day ${opened}`);
  const after = roundTheTown(relieved[opened].battlefields[0], world);
  assert.equal(after.seen.holderAt(21.42, 50), HOLDER_SIDE_B, "the town is its defenders' still");
  assert.equal(after.taken, 0);

  // The order replaced by another for that sector: no siege, and the ground round the town is spared no longer.
  const called = from([order(1, "Aland", "hold", { battlefield: saved.name })], 2);
  assert.deepEqual(sieges(called[2].battlefields[0]), []);
});

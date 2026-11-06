// Run: node --test src/runtime/fronts/regions.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { rasterizeArena } from "./arena.js";
import { FLIP_AT, HOLDER_SIDE_A, HOLDER_SIDE_B, PATCH_MAX_KM2, WHOLE_AT } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { takeCells } from "./field.js";
import { projectorOf } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn } from "./testKit.js";
import { shownOwnersAt } from "./replay.js";

// A region changes hands twice. In name, when more than six tenths of it are
// held: that is the flip the game is told of, and nothing on the map changes.
// On the map, when the whole of it is held: only then is it drawn as its new
// holder's. These tests watch one region of Borduria's, "Borduria 1.0", the
// northern of the two on the border, go through both.

const legend = { A: "Aland", B: "Borduria", O: { owner: "Borduria", sovereign: "Aland" }, "~": null };
const REGION = "r1-0";
const steady = { even: true, wander: 0 };
const sheet = (layout = ["ABBBBB", "ABBBBB"], north = 51) => syntheticMap({ layout, legend, west: 20, north, step: 1, stepLat: 1 });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));

// The cells of a region on a sheet's frame, from its western edge eastward.
const cellsOf = (world, id) => {
  const frame = world.frame({ marginKm: 10 });
  const arena = rasterizeArena(frame, world.regions, {});
  const region = arena.indexOf.get(id);
  const cells = [];
  for (let index = 0; index < arena.size; index += 1) if (arena.region[index] === region) cells.push(index);
  cells.sort((a, b) => (a % arena.cols) - (b % arena.cols) || a - b);
  return { frame, arena, cells };
};
// Gives side A that share of a region, from the west, and side B the rest of it.
const holding = (world, id, share) => {
  const { cells } = cellsOf(world, id);
  const mine = Math.floor(cells.length * share);
  return (field) => {
    takeCells(field, HOLDER_SIDE_A, cells.slice(0, mine));
    takeCells(field, HOLDER_SIDE_B, cells.slice(mine));
  };
};

// A run a day at a time: what was saved after each day, what the recorder was
// handed, and everything it was told of who a region is shown as.
const follow = (input) => {
  const seen = [];
  const said = [];
  const run = createFrontRun({ ...input, watch: ({ day, holders, painters, homes, own, shown }) => {
    seen[day] = { holders: Uint8Array.from(holders), painters: Uint8Array.from(painters), homes: Uint8Array.from(homes), own: Uint8Array.from(own) };
    said.push(...shown);
  } });
  const days = [run.snapshot()];
  for (let day = 1; day <= input.days; day += 1) {
    run.advance(1);
    days.push(run.snapshot());
  }
  return { days, seen, said };
};
const shareOf = (ground, cells, side = HOLDER_SIDE_A) => cells.reduce((sum, cell) => sum + (ground.holders[cell] === side ? 1 : 0), 0) / cells.length;
const namesOf = (saved) => new Map(saved.contested);

test("six tenths of a region is not enough; more than six tenths changes its hands in name, and nothing on the map", () => {
  const world = sheet();
  const { cells } = cellsOf(world, REGION);
  // Fifty-five hundredths, and exactly six tenths if the region's cells allow it: nothing.
  for (const share of [0.55, FLIP_AT]) {
    const quiet = runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { carve: holding(world, REGION, share) })], days: 4 }));
    assert.ok(Math.floor(cells.length * share) / cells.length <= FLIP_AT);
    assert.deepEqual(quiet.flips, [], `no flip at ${share}`);
    assert.deepEqual(quiet.battlefields[0].contested, []);
    assert.deepEqual(quiet.battlefields[0].log, []);
  }

  // Aland walks into it, slowly. The day it holds more than six tenths the
  // region is Aland's in name; the day it holds all of it, on the map.
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), []], orders: [standing(0, "advance")] });
  const { days, seen, said } = follow(frontInput(world, { battlefields: [record], days: 9, pace: 0.5, steering: steady }));
  const flip = days[9].flips.find((entry) => entry.regionId === REGION);
  assert.deepEqual([flip.from, flip.to, flip.kind], ["Borduria", "Aland", "control"]);
  const named = flip.day;
  const whole = seen.findIndex((ground) => shareOf(ground, cells) === 1);
  assert.ok(named >= 2 && whole > named, `in name on day ${named}, whole on day ${whole}`);
  assert.ok(shareOf(seen[named], cells) > FLIP_AT && shareOf(seen[named - 1], cells) <= FLIP_AT, `${shareOf(seen[named - 1], cells)} then ${shareOf(seen[named], cells)}`);

  for (let day = 0; day <= 9; day += 1) {
    const [saved] = days[day].battlefields;
    const homes = new Set(cells.map((cell) => seen[day].homes[cell]));
    if (day < named) {
      assert.equal(namesOf(saved).has(REGION), false, `day ${day}: not in dispute yet`);
      assert.deepEqual([...homes], [HOLDER_SIDE_B]);
    } else if (day < whole) {
      // In name only: the map still draws it as Borduria's, all of it, and what
      // Aland holds of it is ground taken, not home.
      assert.equal(namesOf(saved).get(REGION), "Borduria", `day ${day}: shown as its old holder's`);
      assert.deepEqual([...homes], [HOLDER_SIDE_B], "every cell of it is still Borduria's home, the defender's own and the taken alike");
      assert.equal(saved.log.some((entry) => entry.k === "whole" && entry.at === "region: Borduria 1.0"), false);
    } else {
      // Whole: it is drawn as Aland's, it is Aland's home, and it is one colour.
      // The map is told of its home ground only on the run's last day: the
      // paint stays over the region while the map switches its own colour.
      assert.equal(namesOf(saved).has(REGION), false, `day ${day}: no longer in dispute`);
      assert.deepEqual([...new Set(cells.map((cell) => seen[day].own[cell]))], [HOLDER_SIDE_A], "Aland's home ground at once");
      assert.deepEqual([...homes], [day === 9 ? HOLDER_SIDE_A : HOLDER_SIDE_B], `day ${day}: what the recorder is told of it`);
      assert.deepEqual([...new Set(cells.map((cell) => seen[day].painters[cell]))], [0], "painted for one member");
      assert.deepEqual(saved.log.filter((entry) => entry.k === "whole" && entry.at === "region: Borduria 1.0"), [{ d: days[whole].battlefields[0].asOf, k: "whole", s: 0, at: "region: Borduria 1.0" }]);
    }
  }
  // The recorder was told twice of it: the day it changed hands in name, to go
  // on drawing it as Borduria's; and the day it was whole, that it is Aland's now.
  assert.deepEqual(said.filter((entry) => entry[1] === REGION), [[named, REGION, "Borduria", "Borduria"], [whole, REGION, "Aland", "Borduria"]]);
  // The game was told once, on the first of those days, and never of the second.
  assert.equal(days[9].flips.filter((entry) => entry.regionId === REGION).length, 1);
  assert.ok(days[9].flips.every((entry) => entry.kind === "control"));
});

test("a region all but taken is finished off at night, unless one of its defenders still stands on the rest", () => {
  // Aland has held Borduria 1.0 in name for some time, and all of it but a
  // strip along its eastern edge.
  const world = sheet();
  world.controller.set(REGION, "Aland");
  const { frame, arena, cells } = cellsOf(world, REGION);
  const rest = cells.slice(Math.floor(cells.length * 0.96));
  const km2 = rest.reduce((sum, cell) => sum + projectorOf(frame).rowKm[Math.floor(cell / arena.cols)] ** 2, 0);
  assert.ok(rest.length >= 5 && (cells.length - rest.length) / cells.length >= WHOLE_AT && km2 < PATCH_MAX_KM2, `${rest.length} cells left, ${km2} km2`);
  const start = (troops) => battlefieldOn(world, { frame, troops: [[], troops], carve: holding(world, REGION, 0.96), shown: [[REGION, "Borduria"]] });

  // Nobody on the rest: it goes that night, and the region is whole.
  const empty = follow(frontInput(world, { battlefields: [start([])], days: 2, steering: steady }));
  assert.equal(namesOf(empty.days[0].battlefields[0]).get(REGION), "Borduria", "in dispute as the run begins");
  assert.equal(shareOf(empty.seen[0], cells), (cells.length - rest.length) / cells.length);
  assert.equal(shareOf(empty.seen[1], cells), 1, "the rest went at the end of the first day");
  assert.deepEqual(empty.days[1].battlefields[0].contested, []);
  assert.deepEqual(empty.days[1].battlefields[0].log, [{ d: "2024-03-02", k: "whole", s: 0, at: "region: Borduria 1.0" }]);
  assert.deepEqual(empty.days[2].flips, [], "the game was told of this region long ago");
  // The recorder: as the run begins, that the region is drawn as Borduria's
  // although the world says Aland; then the day it was whole.
  assert.deepEqual(empty.said, [[0, REGION, "Borduria", "Borduria"], [1, REGION, "Aland", "Borduria"]]);
  for (const cell of cells) {
    assert.equal(empty.seen[1].own[cell], HOLDER_SIDE_A, "Aland's home ground at once");
    assert.equal(empty.seen[1].homes[cell], HOLDER_SIDE_B, "the recorder is told so on the run's last day");
    assert.equal(empty.seen[2].homes[cell], HOLDER_SIDE_A);
  }
  for (const cell of rest) assert.equal(empty.seen[1].painters[cell], 0);

  // One defender standing on the rest, dug in there: it stays, and the region stays in dispute.
  const [x, y] = [(rest[2] % arena.cols) + 0.5, Math.floor(rest[2] / arena.cols) + 0.5];
  const [lng, lat] = projectorOf(frame).toLngLat(x, y);
  const held = follow(frontInput(world, { battlefields: [start([{ lng, lat, state: 4, dig: 1 }])], days: 3, steering: steady }));
  for (let day = 1; day <= 3; day += 1) {
    assert.equal(shareOf(held.seen[day], cells), (cells.length - rest.length) / cells.length, `day ${day}: the strip is still its defenders'`);
    assert.equal(namesOf(held.days[day].battlefields[0]).get(REGION), "Borduria");
    for (const cell of rest) assert.equal(held.seen[day].homes[cell], HOLDER_SIDE_B);
  }
  assert.deepEqual(held.days[3].battlefields[0].log, []);
  assert.deepEqual(held.said, [[0, REGION, "Borduria", "Borduria"]]);
});

test("a region taken in name and won back changes hands in name again, and was never shown as anyone else's", () => {
  // Aland holds Borduria 1.0 in name and seven tenths of it; Borduria's troops
  // in the east of it are told to take it back, and nobody stands in their way.
  const world = sheet();
  world.controller.set(REGION, "Aland");
  const { cells } = cellsOf(world, REGION);
  const record = battlefieldOn(world, {
    troops: [[], row(21.85, 50.05, 50.95, 5)],
    orders: [standing(1, "advance")],
    carve: holding(world, REGION, 0.7),
    shown: [[REGION, "Borduria"]],
  });
  const { days, seen, said } = follow(frontInput(world, { battlefields: [record], days: 6, pace: 0.5, steering: steady }));
  const back = days[6].flips.find((entry) => entry.regionId === REGION);
  assert.ok(back, "it changed hands in name again");
  assert.deepEqual([back.from, back.to, back.kind], ["Aland", "Borduria", "control"]);
  assert.ok(shareOf(seen[back.day], cells, HOLDER_SIDE_B) > FLIP_AT && shareOf(seen[back.day - 1], cells, HOLDER_SIDE_B) <= FLIP_AT);
  for (let day = 0; day <= 6; day += 1) {
    // In dispute until the day Borduria holds it in name again: from then the
    // world and the map agree, whatever Aland still holds of it.
    assert.equal(namesOf(days[day].battlefields[0]).get(REGION), day < back.day ? "Borduria" : undefined, `day ${day}`);
    for (const cell of cells) assert.equal(seen[day].homes[cell], HOLDER_SIDE_B, "it was Borduria's home all along");
    assert.equal(days[day].battlefields[0].log.some((entry) => entry.k === "whole"), false);
  }
  assert.deepEqual(said.filter((entry) => entry[1] === REGION), [[0, REGION, "Borduria", "Borduria"], [back.day, REGION, "Borduria", "Borduria"]]);
});

test("ground won back from an occupier of long standing is drawn as taken until the region is whole", () => {
  // Borduria 1.0 here is Aland's own country, held by Borduria since before
  // this war: the map draws it as Borduria's.
  const world = sheet(["AOBBBB", "ABBBBB"]);
  assert.equal(world.sovereignOf(REGION), "Aland");
  assert.equal(world.controllerOf(REGION), "Borduria");
  const { cells } = cellsOf(world, REGION);
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), []], orders: [standing(0, "advance")] });
  const { days, seen } = follow(frontInput(world, { battlefields: [record], days: 9, pace: 0.5, steering: steady }));
  const whole = seen.findIndex((ground) => shareOf(ground, cells) === 1);
  assert.ok(whole >= 3, `whole on day ${whole}`);
  let retaken = 0;
  for (let day = 1; day < whole; day += 1) {
    for (const cell of cells) {
      // Its sovereign's troops are back on it, and it is not their home ground yet.
      assert.equal(seen[day].homes[cell], HOLDER_SIDE_B, `day ${day}`);
      if (seen[day].holders[cell] === HOLDER_SIDE_A) retaken += 1;
    }
  }
  assert.ok(retaken > 100, `${retaken} cell-days retaken and drawn as taken`);
  for (const cell of cells) {
    assert.equal(seen[whole].own[cell], HOLDER_SIDE_A, "whole: home again");
    assert.equal(seen[9].homes[cell], HOLDER_SIDE_A, "and the map is told so as the run ends");
  }
  // It goes back to its sovereign, in name and then on the map.
  const flip = days[9].flips.find((entry) => entry.regionId === REGION);
  assert.deepEqual([flip.from, flip.to, flip.kind], ["Borduria", "Aland", "control"]);
  assert.equal(namesOf(days[flip.day].battlefields[0]).get(REGION), flip.day < whole ? "Borduria" : undefined);
});

test("a run cut at day k ends as the full run stood after day k, with regions changing hands in name, back again, and in full", () => {
  // Three rows of regions. In the northern one Borduria takes back a region
  // Aland holds in name; in the southern one, far from that, Aland walks
  // through Borduria's.
  const world = sheet(["ABBBBB", "ABBBBB", "ABBBBB"], 51.5);
  world.controller.set(REGION, "Aland");
  const record = battlefieldOn(world, {
    troops: [row(20.9, 48.55, 49.45, 5), row(21.85, 50.55, 51.45, 5)],
    orders: [standing(0, "advance"), standing(1, "advance")],
    carve: holding(world, REGION, 0.7),
    shown: [[REGION, "Borduria"]],
  });
  const moments = [{ day: 7, type: "order", battlefield: "The front", side: "Borduria", order: "hold", sector: "all" }];
  const input = (days) => frontInput(world, { battlefields: [record], days, moments: moments.filter((moment) => moment.day <= days), pace: 0.5 });
  const withoutReplay = (battlefields) => battlefields.map(({ replay: _replay, ...rest }) => rest);
  const run = createFrontRun(input(10));
  for (const k of [0, 1, 3, 4, 6, 7, 10]) {
    while (run.snapshot().stats.days < k) run.advance(1);
    const full = run.snapshot();
    const cut = runFronts(input(k));
    assert.equal(JSON.stringify(withoutReplay(cut.battlefields)), JSON.stringify(withoutReplay(full.battlefields)), `the battlefields after day ${k}`);
    assert.deepEqual(cut.flips, full.flips, `the flips up to day ${k}`);
  }
  const whole = runFronts(input(10));
  assert.equal(JSON.stringify(run.finish()), JSON.stringify(whole));
  // All of it happened in that run.
  assert.ok(whole.flips.some((flip) => flip.regionId === REGION && flip.to === "Borduria"), "a region won back in name");
  assert.ok(whole.flips.some((flip) => flip.to === "Aland"), "regions taken in name");
  assert.ok(whole.battlefields[0].log.some((entry) => entry.k === "whole" && entry.s === 0), "and one of them taken whole");
});

test("a defender that has won back all but the last of a region finishes it too, once the other side's troops are gone from it", () => {
  // Aland holds a strip along the western edge of Borduria 1.0 and nothing
  // else of it: the region is Borduria's in name and on the map.
  const world = sheet();
  const { frame, arena, cells } = cellsOf(world, REGION);
  const strip = cells.slice(0, Math.floor(cells.length * 0.04));
  const [lng, lat] = projectorOf(frame).toLngLat((strip[1] % arena.cols) + 0.5, Math.floor(strip[1] / arena.cols) + 0.5);
  const start = (troops) => battlefieldOn(world, { frame, troops: [troops, []], carve: holding(world, REGION, 0.04) });
  // With nobody of Aland's near it, it goes back that night.
  const empty = follow(frontInput(world, { battlefields: [start([])], days: 2, steering: steady }));
  assert.equal(shareOf(empty.seen[0], cells), strip.length / cells.length);
  assert.equal(shareOf(empty.seen[1], cells), 0, "the strip went back at the end of the first day");
  assert.deepEqual(empty.days[2].flips, []);
  assert.deepEqual(empty.days[2].battlefields[0].contested, []);
  assert.deepEqual(empty.days[2].battlefields[0].log, [], "nothing changed hands in name, so there is nothing to say");
  // With one of Aland's standing on it, dug in, it stays: the first cells an
  // advance takes across a region's border are not handed back at night.
  const held = follow(frontInput(world, { battlefields: [start([{ lng, lat, state: 4, dig: 1 }])], days: 3, steering: steady }));
  for (let day = 1; day <= 3; day += 1) assert.equal(shareOf(held.seen[day], cells), strip.length / cells.length, `day ${day}: the strip is still Aland's`);
});

test("on forces standing in peace a region the story hands over is drawn as its new holder's at once", () => {
  // Aland's forces stand at home, Borduria across the border, and Neutralia's
  // two regions to the west lie on the same frame. The story annexes one of
  // them to Aland halfway through the run. Nothing is fought on a standing
  // battlefield, so nothing would ever take the region "in full": it must not
  // be kept drawn as Neutralia's, its colour and its name left on the map.
  const world = syntheticMap({ layout: ["NABBBB", "NABBBB"], legend: { N: "Neutralia", A: "Aland", B: "Borduria" }, west: 20, north: 51, step: 1, stepLat: 1 });
  const record = battlefieldOn(world, { status: "standing", troops: [row(21.5, 49.2, 50.8, 4), row(23.5, 49.2, 50.8, 4)] });
  const result = runFronts(frontInput(world, {
    battlefields: [record],
    wars: [],
    days: 3,
    moments: [{ day: 1, type: "control", regionId: "r0-0", to: "Aland" }],
  }));
  const [saved] = result.battlefields;
  assert.equal(saved.status, "standing");
  assert.deepEqual(saved.contested, [], "no region is held back as anyone else's");
  assert.equal(shownOwnersAt(saved.replay, 3)?.["r0-0"], undefined, "nor does the run's replay draw it as Neutralia's");
});

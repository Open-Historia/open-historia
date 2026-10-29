import fs from "node:fs";
import test from "node:test";
import { encode } from "./runtime.mjs";
import { createReplayRecorder } from "../../../../../src/runtime/fronts/replay.js";
import { rasterizeArena } from "../../../../../src/runtime/fronts/arena.js";
import { decodeFourMask, encodeMask } from "../../../../../src/runtime/fronts/codec.js";
import { deployCells, readDeploy } from "../../../../../src/runtime/fronts/deploy.js";
import { openField, rebuildFromHolders, restoreCells, takeCapsule, traceContour } from "../../../../../src/runtime/fronts/field.js";
import { addGameDays } from "../../../../../src/runtime/gameDates.js";
import { climateAt, freezesAt, oddsAt, zonesOver, zonesToday } from "../../../../../src/runtime/fronts/climate.js";
import { WEATHER_ODDS, skiesAhead, skyOver } from "../../../../../src/runtime/fronts/weather.js";
import { linesChanged, raiseWalls, readLines, wallAhead, wallsOf, wearWall } from "../../../../../src/runtime/fronts/walls.js";
import { createTroop } from "../../../../../src/runtime/fronts/troops.js";
import { boundFor, huntTransport, interceptionOf, moveOn, normalizeTransport, orderTransport, struck, transportTitle } from "../../../../../src/runtime/fronts/transports.js";
import { projectorOf } from "../../../../../src/runtime/fronts/frame.js";
import { awayOf, cellsOf, measure } from "../../../../../src/runtime/fronts/ground.js";
import { measureLine } from "../../../../../src/runtime/fronts/line.js";
import { nearestVertex } from "../../../../../src/runtime/fronts/sectors.js";
import { sideTable, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";

const SIDES = [["Aland"], ["Borduria"]];
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const LAYOUTS = [
  ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "~~~~~~~~"],
  ["AAABBBBB", "AAAABBBB", "AANABBBB", "AAAAABBB", "~~AA~~BB"],
  ["AAAAAA", "ABBBBA", "ABBBBA", "AAAAAA"],
];

let seed = 7;
const random = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};

const sheet = (layout) => {
  const world = syntheticMap({ layout, legend, west: 20, north: 52, step: 0.5 });
  const frame = world.frame({ marginKm: 10 });
  const arena = rasterizeArena(frame, world.regions, {});
  const sides = sideTable(arena, world, SIDES);
  return { world, frame, arena, sides, field: openField(arena, world.regions, sides) };
};

test("golden probes for the thinly covered functions", () => {
  for (let round = 0; round < 24; round += 1) {
    const length = 1 + Math.floor(random() * 300);
    const values = Uint8Array.from({ length }, () => (random() < 0.7 ? Math.floor(random() * 4) : 0));
    decodeFourMask(encodeMask(values), length + Math.floor(random() * 3) - 1);
  }
  for (const layout of LAYOUTS) {
    const { frame, field } = sheet(layout);
    if (!field) continue;
    for (let round = 0; round < 4; round += 1) {
      const earlier = Float64Array.from(field.phi);
      const x = random() * field.cols;
      const y = random() * field.rows;
      takeCapsule(field, round % 2, x, y, x + random() * 4 - 2, y + random() * 4 - 2, 1 + random() * 3, 1 + random() * 3);
      const cells = [];
      for (let index = 0; index < field.size; index += 1) if (field.phi[index] !== earlier[index]) cells.push(index);
      restoreCells(field, cells.filter((_, at) => at % 2 === 0), earlier, (index) => index % 3);
      restoreCells(field, cells, earlier);
    }
    const line = measureLine(field, traceContour(field));
    for (let round = 0; round < 12; round += 1) nearestVertex(line, random() * field.cols, random() * field.rows);
    const battle = { field, frame, place: projectorOf(frame) };
    measure(battle);
    for (let round = 0; round < 12; round += 1) {
      const side = round % 2;
      awayOf(battle, side, random() * field.cols, random() * field.rows);
      cellsOf(field, battle.toSide[side], random() * (field.cols + 4) - 2, random() * (field.rows + 4) - 2);
    }
    const [west, east] = [frame.lng0, frame.lng0 + frame.cols * frame.cell];
    for (let round = 0; round < 8; round += 1) {
      const way = Array.from({ length: 2 + (round % 3) }, () => [west + random() * (east - west), 50 + random() * 2]);
      battle.deploy = readDeploy([[{ country: "Aland", way }], [{ country: "Borduria", way }]]);
      deployCells(battle, round % 2, SIDES[round % 2][0], [1, 2, 3]);
      deployCells(battle, round % 2, "Nobody", [4]);
    }
    rebuildFromHolders(field);
  }
});

test("golden probes for climate zones that freeze", () => {
  const zone = (id, west, east, extra = {}) => ({
    id, name: id, color: "#8899aa", blendKm: 120, transitionDays: 16,
    rings: [[[west, 40], [east, 40], [east, 58], [west, 58]]],
    seasons: [
      { name: "Frost", start: "11-20", end: "02-20", weather: { frost: 2, snow: 1 }, effects: { freezes: true, pace: 0.7 } },
      { name: "Wet", start: "03-01", end: "05-10", weather: { rain: 1, mud: 1 }, effects: { wear: 0.02 } },
    ],
    events: [{ name: "Thaw", from: "1900-01-20", to: "1900-02-02", effects: { freezes: false } }],
    ...extra,
  });
  const boxed = (entry, box) => ({ ...entry, box, inside: (lng, lat) => (lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3] ? 0.75 : 0.25) });
  const zones = [boxed({ zone: zone("a", 10, 20) }, [10, 40, 20, 58]), boxed({ zone: zone("b", 18, 30, { transitionDays: 0 }) }, [18, 40, 30, 58])];
  const dates = ["1900-01-05", "1900-01-25", "1900-02-15", "1900-03-01", "1900-06-10", "1900-11-25", "1900-12-31", "-0200-01-10", "nonsense"];
  for (const date of dates) {
    for (const [lng, lat] of [[12, 45], [19, 50], [25, 55], [40, 10], [5, -50], [15, 75]]) {
      freezesAt(zones, lng, lat, date);
      freezesAt(zones.slice(0, 1), lng, lat, date);
    }
  }
});

test("golden probes for a battlefield's climate zones and weather", () => {
  const zone = (id, west, east, south, north, extra = {}) => ({
    id, name: id === "c" ? "" : `Zone ${id}`, color: "#8899aa", blendKm: 60, transitionDays: 10,
    rings: [[[west, south], [east, south], [east, north], [west, north]]],
    seasons: [
      { name: "Hard winter", start: "12-01", end: "02-28", weather: { blizzard: 1, snow: 2, frost: 1 }, effects: { pace: 0.4, air: 0.5, cold: 0.6, freezes: true } },
      { name: "Mud", start: "03-01", end: "04-20", weather: { mud: 3, rain: 1 }, effects: { pace: 0.6, wear: 0.03 } },
      { name: "Dry", start: "06-01", end: "08-31", weather: { heat: 1, clear: 1 }, effects: { heat: 0.4, air: 1 } },
    ],
    events: [{ name: "Storm week", from: "1941-10-02", to: "1941-10-08", weather: "storm", effects: { attack: 0.7 } }],
    ...extra,
  });
  const layouts = [
    { zones: [zone("a", 19, 22.5, 49, 53), zone("b", 22, 26, 49, 53)], seed: "probe-1", steer: {} },
    { zones: [zone("a", 18, 30, 45, 56, { blendKm: 0 })], seed: "probe-2", steer: {} },
    { zones: [zone("c", 21, 23, 50, 51.5, { transitionDays: 0 }), zone("d", 40, 41, 10, 11)], seed: "probe-3", steer: { weather: "fog" } },
  ];
  for (const { zones, seed, steer } of layouts) {
    const { frame } = sheet(LAYOUTS[0]);
    const fromDate = "1941-09-20";
    const run = { input: { climateZones: zones, climateSeed: seed === "probe-2" ? undefined : `${seed}-sky`, fromDate, days: 200 }, seed, steer, dateOf: (day) => addGameDays(fromDate, day) };
    const battle = { name: `field ${seed}`, frame, arena: { frame }, field: { cols: frame.cols, rows: frame.rows }, place: projectorOf(frame) };
    zonesOver(run, battle);
    for (let day = 0; day < 200; day += 9) {
      skyOver(run, battle, day);
      if (day % 27 === 0) skiesAhead(run, battle, day, 5);
      const today = zonesToday(run, battle, run.dateOf(day), 51.25);
      if (!today) continue;
      for (const cell of [-1, 0, 7, Math.floor(frame.cols * frame.rows / 2), frame.cols * frame.rows - 1, frame.cols * frame.rows + 3]) {
        climateAt(today, cell);
        oddsAt(today, cell, WEATHER_ODDS.continental.autumn);
      }
    }
  }
});

test("golden probes for fortified lines", () => {
  for (const layout of LAYOUTS) {
    const { frame, field } = sheet(layout);
    if (!field) continue;
    const place = projectorOf(frame);
    const [west, east] = [frame.lng0, frame.lng0 + frame.cols * frame.cell];
    const middle = (west + east) / 2;
    const fortifications = [
      { id: "w1", name: "The Aland  wall ss", owner: "Aland", level: 6, points: [[middle - 0.3, 50], [middle - 0.3, 51], [middle - 0.2, 52.2]], breaches: [[2, 4]], wear: [[3, 0.4], [7.6, 0.2]] },
      { id: "w2", name: "", owner: " borduria ", level: 3.6, points: [[middle + 0.4, 50.1], [middle + 0.5, 51.9]], building: { since: "1914-07-20", days: 5 } },
      { id: "w3", name: "Paper", owner: "Aland", level: 2, points: [[middle, 50], [middle, 51]] },
      { id: "w4", owner: "Nobody", level: 9, points: [[west, 50], [east, 51]] },
      { id: "w5", owner: "Aland", level: 10, points: [[middle - 1, 50.5], ["x", 51], [middle - 1, 51.5]] },
    ];
    const run = { input: { fortifications, map: {} }, mech: { walls: true } };
    readLines(run);
    const troops = [0, 1].map((side) => Array.from({ length: 6 }, (_, at) => createTroop({ x: random() * field.cols, y: random() * field.rows, strength: at === 5 ? 0 : 50, owner: 0 })));
    const battle = { sides: SIDES.map((members) => members.slice()), gone: [new Set(), new Set()], field, frame, place, troops, log: [] };
    wallsOf(run, battle);
    for (const date of ["1914-07-22", "1914-07-28", "1914-08-03"]) {
      raiseWalls(run, battle, date);
      for (let round = 0; round < 30; round += 1) {
        const side = round % 2;
        const ahead = wallAhead(battle, side, random() * field.cols, random() * field.rows);
        if (ahead) wearWall(battle, ahead, random() * 4, round % 3 === 0, 0.5 + random());
      }
      for (let piece = 0; piece < 6; piece += 1) wearWall(battle, { line: 0, piece }, 3, true, 2);
    }
    battle.gone[1].add(0);
    wallsOf(run, battle);
    linesChanged(run);
  }
});

test("golden probes for transporters", () => {
  const raw = [
    { id: " t1 ", medium: "sea", owner: "Aland", to: { lng: 12.25, lat: 0.25 }, load: [[50, 1], { strength: 120, kind: 2 }, [0, 1], ["30", "1"]], speed: "500", capacity: 3, hunters: ["Borduria", "borduria ", " Cyrene"], attacks: ["X", "Y", "Z"], km: 900.4, gone: 10.6, way: [[10, 50], [11, 51], ["a", 2], [12, 52]], status: "moving", at: [10.12345, 50.98765] },
    { id: "t2", medium: "air", owner: "Borduria", to: { name: "Port  Nowhere" }, raise: 12.6, embark: { battlefield: "Front", side: 1, troops: [3, 3, -0, 2.5, "4", -1] } },
    { id: "t3", medium: "land", owner: "Aland", to: { lng: -3.75, lat: -0.05, name: "" }, from: [1, 2], embark: { battlefield: "", side: 0, troops: [1] }, speed: 99999, capacity: 0 },
    { id: "t4", medium: "rail", owner: "Aland", to: { lng: 1, lat: 2 } },
    { id: "t5", medium: "sea", owner: "", to: { lng: 1, lat: 2 } },
    { id: "t6", medium: "sea", owner: "Aland", to: { lng: 1, lat: 95 } },
    [1, 2],
    null,
  ];
  const kept = raw.map(normalizeTransport).filter(Boolean);
  for (const transport of kept) {
    boundFor(transport);
    transportTitle(transport);
    for (const draw of [0, 0.3, 0.99, 2]) struck(transport, draw, "1940-01-01");
    moveOn(transport, { flat: true, scale: 100 });
    interceptionOf(transport, [10.5, 50.5], {
      units: [
        { type: "naval", ownerCode: "Borduria", lng: 10.6, lat: 50.4, strength: 80, name: "Fleet" },
        { type: "air", ownerCode: "Cyrene", lng: 12, lat: 51, strength: 150, name: "Wing" },
        { type: "air", ownerCode: "Aland", lng: 10.4, lat: 50.5, strength: 60, name: "Cover" },
        { type: "naval", ownerCode: "Borduria", lng: "x", lat: 50, strength: 80 },
        { type: "army", ownerCode: "Borduria", lng: 10, lat: 50, strength: 80 },
        { type: "air", ownerCode: "Borduria", lng: 10, lat: 50, strength: 80, committedTo: "elsewhere" },
      ],
      enemy: (name) => name !== "Aland",
      ally: (name) => name === "Aland",
    });
  }
  huntTransport(kept, "t1", "Cyrene", false);
  huntTransport(kept, "t1", "Dacia");
  for (const spec of [{ medium: "sea", owner: "Aland", to: { lng: 3, lat: 4 }, load: [[40, 0]] }, { medium: "air", owner: "Aland", to: { lng: 3, lat: 4 }, raise: 2 }, { medium: "air", kind: "zeppelin", speed: 300, owner: "Aland", to: { lng: 3, lat: 4 }, raise: 2 }, { medium: "sea", owner: "Aland", to: { lng: 3, lat: 4 } }]) {
    for (const year of [1700, 1900, 1950, null]) orderTransport(kept, spec, { date: "1900-01-01", year });
  }
});

test("golden probes for a replay carried onto a larger grid", () => {
  const cases = [];
  const ground = (cols, rows, salt) => {
    const size = cols * rows;
    return {
      holders: Uint8Array.from({ length: size }, (_, at) => ((at * 7 + salt) % 11 === 0 ? 3 : (at + salt) % 3 === 0 ? 1 : 0)),
      painters: Uint8Array.from({ length: size }, (_, at) => (at + salt) % 2),
      homes: Uint8Array.from({ length: size }, (_, at) => ((at + salt) % 5 === 0 ? 0 : 9)),
      when: Float32Array.from({ length: size }, (_, at) => ((at * 13 + salt) % 10) / 10),
    };
  };
  const troops = (day) => [0, 1].map((side) => Array.from({ length: 3 + side }, (_, at) => ({ strength: Math.max(0, 80 - day * 9 * at), x: 1 + at + day * 0.3, y: 1 + side + day * 0.2, state: ["holding", "advancing", "encircled"][(day + at) % 3] })));
  for (const [sides, nowSides, shiftX, shiftY, days] of [
    [[["Aland", "Cyrene"], ["Borduria"]], [["Aland", "Cyrene"], ["Borduria"]], 2, 1, 4],
    [[["Aland"], ["Borduria", "Dacia"]], [["Aland"], ["Borduria", "Dacia"]], 0, 3, 6],
    [[["Aland"], ["Borduria"]], [["Aland"], ["Borduria", "Dacia"]], 1, 1, 2],
    [[["Aland"], []], [["Aland"], []], 3, 0, 3],
  ]) {
    const [cols, rows, toCols, toRows] = [6, 4, 6 + 2 * shiftX + 1, 4 + 2 * shiftY];
    const calls = [];
    const recorder = createReplayRecorder({ sides, cols, rows });
    for (let day = 0; day < days; day += 1) {
      const args = [day, troops(day), ground(cols, rows, day)];
      calls.push(["record", args]);
      recorder.record(...args);
      if (day === 1) {
        const shown = [day, "r1", "Cyrene", "Aland"];
        calls.push(["shown", shown]);
        recorder.shown(...shown);
      }
    }
    const carry = { sides: nowSides, cols: toCols, rows: toRows, shiftX, shiftY, ground: ground(toCols, toRows, 5), day: days };
    const carried = recorder.carryOnto({
      ...carry,
      cellOf: (cell) => (cell === 3 ? -1 : (Math.floor(cell / cols) + shiftY) * toCols + (cell % cols) + shiftX),
      pointOf: (x, y) => [x + shiftX, y + shiftY],
    });
    const after = [days + 1, troops(days + 1), ground(toCols, toRows, 7)];
    if (carried) carried.record(...after);
    const finish = { date: "1914-09-01", days: days + 1 };
    cases.push({ a: encode([sides, cols, rows, calls, carry, after, finish]), r: carried ? encode(carried.finish(finish)) : null });
  }
  if (process.env.GOLDEN_OUT) fs.writeFileSync(new URL("../tests/golden/carry.json", import.meta.url), JSON.stringify({ blobs: [], cases: { carryOnto: cases } }));
});

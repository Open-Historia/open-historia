import test from "node:test";
import { rasterizeArena } from "../../../../../src/runtime/fronts/arena.js";
import { decodeFourMask, encodeMask } from "../../../../../src/runtime/fronts/codec.js";
import { deployCells, readDeploy } from "../../../../../src/runtime/fronts/deploy.js";
import { openField, rebuildFromHolders, restoreCells, takeCapsule, traceContour } from "../../../../../src/runtime/fronts/field.js";
import { addGameDays } from "../../../../../src/runtime/gameDates.js";
import { climateAt, freezesAt, oddsAt, zonesOver, zonesToday } from "../../../../../src/runtime/fronts/climate.js";
import { WEATHER_ODDS, skiesAhead, skyOver } from "../../../../../src/runtime/fronts/weather.js";
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

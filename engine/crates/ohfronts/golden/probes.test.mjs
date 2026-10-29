import test from "node:test";
import { rasterizeArena } from "../../../../../src/runtime/fronts/arena.js";
import { decodeFourMask, encodeMask } from "../../../../../src/runtime/fronts/codec.js";
import { deployCells, readDeploy } from "../../../../../src/runtime/fronts/deploy.js";
import { openField, rebuildFromHolders, restoreCells, takeCapsule, traceContour } from "../../../../../src/runtime/fronts/field.js";
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

/*! Open Historia — the strategy experiment: fair duels on boards drawn at random © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "For the training make the playing fields even
// so one model doesn't just win for having an advantage. but randomize the
// battlefield cities and regions and stuff so the model can work through many
// scenarios (so it shouldnt be training in an actual in game scenario, but in
// a controlled environment)" (the owner, 2026-10-14).
//
// A DUEL is a war on a board that is the same for both sides: whatever one
// side has, the other has turned half round (a turn of 180 degrees about the
// board's middle), so neither has more ground, more towns, better ground or a
// better wall than the other. Drawn at random from a seed:
//
//   the board        3 to 8 rows of regions, 6 to 14 columns, regions of a
//                    half to one degree; the border wandering
//   the sides        one against one, or two against two (each side two
//                    countries, one to the north of the other)
//   the towns        a capital and up to five towns a country, anywhere on its
//                    ground, of any size
//   the ground       now and then a band of hard ground, a wall of a side's
//                    own a little behind its border, its air wings
//   the age, the month it begins in, how far north it lies, how long it lasts
//   the armies       the same military figures, mustering and strength for all
//
// The war is begun by one side (it attacks first, and musters sooner); every
// duel is fought twice, each side beginning it once (arena.mjs match). A duel
// is an arena scenario (arena.mjs fight).

import { AGES, rngOf } from "./arena.mjs";

const NAMES = Object.freeze(["Aland", "Borduria", "Cisland", "Dorland"]);
const LETTERS = "ABCD";

// A duel from a seed.
export const makeDuel = (seed) => {
  const random = rngOf(seed ^ 0x5eed);
  const pick = (least, most) => least + Math.floor(random() * (most - least + 1));
  const rows = pick(3, 8);
  const cols = 2 * pick(3, 7);
  const pairs = random() < 0.3 && rows >= 4;
  // Where the border runs, row by row, for the first half of the rows; the
  // rest is the same turned half round, so that it meets itself in the middle.
  const border = new Array(rows).fill(cols / 2);
  for (let row = 0; row < Math.floor(rows / 2); row += 1) {
    const was = row === 0 ? cols / 2 : border[row - 1];
    border[row] = Math.max(2, Math.min(cols - 2, was + pick(-1, 1)));
    border[rows - 1 - row] = cols - border[row];
  }
  if (rows % 2 === 1) border[Math.floor(rows / 2)] = cols / 2;
  // Each side's letter at a cell: the first side west of the border, the
  // second east of it; with pairs, the first side's two countries split north
  // and south (A north, C south), and the second's the same turned round.
  const split = Math.floor(rows / 2);
  const letterAt = (row, col) => {
    if (col < border[row]) return pairs && row >= split ? "C" : "A";
    return pairs && rows - 1 - row >= split ? "D" : "B";
  };
  const layout = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (__, col) => letterAt(row, col)).join(""));
  const count = pairs ? 4 : 2;
  const teams = pairs ? [[0, 2], [1, 3]] : [[0], [1]];
  // The country a cell turned half round belongs to.
  const turned = (row, col) => [rows - 1 - row, cols - 1 - col];
  const step = [0.5, 0.75, 1][pick(0, 2)];
  const stepLat = Math.round(step * 0.6 * 100) / 100;
  // How far north it lies: anywhere from the tropics to the far north, now and then south of the equator.
  const middle = (random() < 0.2 ? -1 : 1) * pick(5, 62);
  const north = Math.round((middle + (rows * stepLat) / 2) * 100) / 100;
  const at = (row, col) => ({ lng: 20 + (col + 0.5) * step, lat: north - (row + 0.5) * stepLat });

  // The towns of the first side's countries, and the same for the second's, turned round.
  const cities = [];
  const firsts = pairs ? [0, 2] : [0];
  for (const country of firsts) {
    const cells = [];
    layout.forEach((line, row) => [...line].forEach((letter, col) => { if (letter === LETTERS[country]) cells.push([row, col]); }));
    const towns = Math.min(cells.length, 1 + pick(0, 5));
    for (let town = 0; town < towns; town += 1) {
      const [row, col] = cells.splice(pick(0, cells.length - 1), 1)[0];
      const population = town === 0 ? 300000 + pick(0, 4700000) : 15000 + pick(0, 900000);
      const mirror = turned(row, col);
      const other = LETTERS.indexOf(layout[mirror[0]][mirror[1]]);
      for (const [owner, [r, c], name] of [[country, [row, col], NAMES[country]], [other, mirror, NAMES[other]]]) {
        cities.push({ name: town === 0 ? `${name} Capital` : `${name} Town ${town}`, ...at(r, c), population, ...(town === 0 ? { capital: true } : {}), country: owner });
      }
    }
  }

  // The armies: the same for everyone.
  const weight = Math.round((2 + random() * 6) * 10) / 10;
  const figures = {
    quality: pick(30, 80),
    technology: pick(30, 80),
    land: 50,
    sea: 50,
    air: 50,
    manpowerShare: [8, 10, 12, 12, 15, 20][pick(0, 5)],
  };
  const first = [0.3, 0.4, 0.5, 0.6][pick(0, 3)];
  const days = pick(5, 30);
  const muster = [[first, days], [1, days * (2 + pick(0, 3))]];

  // Hard ground: a band across the whole board (the same for both, being turned into itself), or one each side.
  const terrain = [];
  if (random() < 0.35) {
    const level = pick(3, 8);
    if (random() < 0.5) {
      const width = pick(1, 2);
      const from = cols / 2 - width / 2;
      const ring = (west, east) => [[20 + west * step, north], [20 + east * step, north], [20 + east * step, north - rows * stepLat], [20 + west * step, north - rows * stepLat]];
      terrain.push({ id: "rough-middle", level, rings: [ring(from, from + width)] });
    } else {
      const row = pick(0, rows - 1);
      const col = pick(0, Math.max(0, border[row] - 2));
      const box = (r, c) => [[20 + c * step, north - r * stepLat], [20 + (c + 1.5) * step, north - r * stepLat], [20 + (c + 1.5) * step, north - (r + 1.5) * stepLat], [20 + c * step, north - (r + 1.5) * stepLat]];
      const mirror = turned(row, col);
      terrain.push({ id: "rough-a", level, rings: [box(row, col)] }, { id: "rough-b", level, rings: [box(mirror[0] - 0.5, mirror[1] - 0.5)] });
    }
  }
  // A wall of each side's own, a column behind its border, the length of the board.
  const wall = [];
  if (random() < 0.25) {
    const level = pick(3, 8);
    const back = Math.min(...border) - 1;
    if (back >= 1) {
      const west = 20 + (back + 0.5) * step;
      const east = 20 + (cols - back - 0.5) * step;
      wall.push(
        { id: "wall-a", name: "the western wall", owner: 0, level, points: [[west, north + 0.2], [west, north - rows * stepLat - 0.2]], breaches: [], wear: [] },
        { id: "wall-b", name: "the eastern wall", owner: 1, level, points: [[east, north - rows * stepLat - 0.2], [east, north + 0.2]], breaches: [], wear: [] },
      );
    }
  }
  const year = AGES[pick(0, AGES.length - 1)];
  // Air wings from 1914: the same number for each side, each turned round.
  const wings = [];
  if (year >= 1914) {
    const many = pick(0, 4);
    const own = [];
    layout.forEach((line, row) => [...line].forEach((letter, col) => { if (letter === "A") own.push([row, col]); }));
    for (let wing = 0; wing < many && own.length > 0; wing += 1) {
      const [row, col] = own[pick(0, own.length - 1)];
      const mirror = turned(row, col);
      const other = LETTERS.indexOf(layout[mirror[0]][mirror[1]]);
      wings.push({ id: `wing-a-${wing}`, name: `${NAMES[0]} wing ${wing + 1}`, type: "air", ownerCode: NAMES[0], strength: 100, ...at(row, col) });
      wings.push({ id: `wing-b-${wing}`, name: `${NAMES[other]} wing ${wing + 1}`, type: "air", ownerCode: NAMES[other], strength: 100, ...at(mirror[0], mirror[1]) });
    }
  }
  return {
    seed,
    duel: true,
    layout,
    step,
    stepLat,
    north,
    countries: NAMES.slice(0, count),
    weights: new Array(count).fill(weight),
    teams,
    kind: pairs ? "two against two" : "one against one",
    cities,
    year,
    periods: pick(3, 5),
    month: pick(1, 12),
    military: new Array(count).fill(null).map(() => ({ ...figures })),
    muster: new Array(count).fill(null).map(() => muster.map((point) => point.slice())),
    terrain,
    wall,
    wings,
  };
};

// `count` duel seeds from `from` on.
export const duelSeeds = (from, count) => Array.from({ length: count }, (_, index) => from + index);

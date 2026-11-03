/*! Open Historia — battlefields and fronts: a country's forces at home, built up in peace © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "building up forces shouldnt happen on a border, it should just happen in
// your country around cities. you can them move them with war room tools to a
// border"; "other countries should also be able to militerize"; "it shouldnt
// prevent attacks, you should be able to start wars by moving troops into
// others land" (the owner, 2026-11-02).
//
// A country's FORCES AT HOME are a battlefield record of their own (`home`),
// STANDING: no war is fought on it. Its frame is the country itself with
// HOME_MARGIN_KM round it; its first side is the country, and its second the
// countries whose land is nearest (homeNeighbours), so that the ground beyond
// its borders is somebody's. Its troops are called up round the country's
// cities, the more round the larger (homeCells): by the story, for any country
// and for a player's when an action or a project of theirs does it (`home:
// Country`, engine.js applyHomeMoment), as many as its
// men, supplies, war weariness and mustering allow (engine.js callUpSize),
// once a day at most, the rest as they muster. In the War Room they go where
// routes are drawn for them over its own land, at the march's pace (march.js);
// the story stations them on a border (borderCells). A route into another
// country's land is the war with it beginning (engine.js attackFromStanding).
// When a battlefield of a war of the country's is open, those of them within
// HOME_JOIN_KM of its line join it where they stand, with what they were told
// (engine.js bringHome); the rest stay at home.
//
// Only + - * / and Math.sqrt.

import { MAX_HOME_FORCES, MAX_SIDE_MEMBERS } from "./constants.js";
import { blockSteps } from "./swarms.js";

export const HOME_MARGIN_KM = 150;
export const HOME_JOIN_KM = 100;
export const HOME_MOST = MAX_HOME_FORCES;
export const HOME_SUFFIX = "home forces";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

export const homeName = (country) => `${clean(country)} ${HOME_SUFFIX}`;

// The box round a country's regions: { west, east, south, north }. Across the
// antimeridian where its land is: the widest gap between its regions' middles
// is the part of the world it is not in. null for none. (A region whose own
// box crosses the antimeridian has none, and is left out.)
export const homeBounds = (regions) => {
  const boxes = regions.map((region) => region?.bbox).filter((box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite));
  if (boxes.length === 0) return null;
  const middles = boxes.map((box) => (box[0] + box[2]) / 2).sort((a, b) => a - b);
  let start = middles[0];
  let widest = middles[0] + 360 - middles[middles.length - 1];
  for (let at = 1; at < middles.length; at += 1) {
    if (middles[at] - middles[at - 1] > widest) {
      widest = middles[at] - middles[at - 1];
      start = middles[at];
    }
  }
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const box of boxes) {
    const shift = (box[0] + box[2]) / 2 < start ? 360 : 0;
    if (box[0] + shift < west) west = box[0] + shift;
    if (box[2] + shift > east) east = box[2] + shift;
    if (box[1] < south) south = box[1];
    if (box[3] > north) north = box[3];
  }
  if (west > 180) {
    west -= 360;
    east -= 360;
  }
  return { west, east: east > 180 ? east - 360 : east, south, north };
};

// The countries whose land is on a home frame, the most of it first: at most MAX_SIDE_MEMBERS.
//   holderOf   (region id) => who holds it
export const homeNeighbours = (arena, holderOf, country) => {
  const cells = new Map();
  for (let region = 1; region < arena.ids.length; region += 1) {
    const holder = clean(holderOf(arena.ids[region]));
    if (!holder || fold(holder) === fold(country) || !(arena.cells[region] > 0)) continue;
    cells.set(holder, (cells.get(holder) ?? 0) + arena.cells[region]);
  }
  return [...cells.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_SIDE_MEMBERS).map(([name]) => name);
};

// Where `count` new troops of a member come in at home: round its cities on the frame, each city's share by its
// people (the largest remainders first), each round its city a ring at a time over the side's own ground; with no
// city, along its ground. A cell a troop, in order.
//   mine   (cell) => whether a cell is the member's own ground
export const homeCells = (battle, side, mine, count) => {
  const { field, arena } = battle;
  if (count <= 0) return [];
  const cities = (Array.isArray(arena.cities) ? arena.cities : []).filter((city) => city.cell >= 0 && city.population > 0 && mine(city.cell));
  const cells = [];
  if (cities.length === 0) {
    const ground = [];
    for (let cell = 0; cell < field.size; cell += 1) if (mine(cell)) ground.push(cell);
    for (let at = 0; at < count && ground.length > 0; at += 1) cells.push(ground[Math.floor(((at + 0.5) * ground.length) / count)]);
    return cells;
  }
  const people = cities.reduce((sum, city) => sum + city.population, 0);
  const shares = cities.map((city, at) => ({ at, whole: Math.floor((count * city.population) / people), part: (count * city.population) / people }));
  let left = count - shares.reduce((sum, share) => sum + share.whole, 0);
  for (const share of shares.slice().sort((a, b) => (b.part - b.whole) - (a.part - a.whole) || a.at - b.at)) {
    if (left <= 0) break;
    share.whole += 1;
    left -= 1;
  }
  for (const share of shares) {
    if (share.whole === 0) continue;
    const city = cities[share.at];
    const col = city.cell % field.cols;
    const row = Math.floor(city.cell / field.cols);
    const steps = blockSteps(share.whole * 4);
    let placed = 0;
    for (const [dx, dy] of steps) {
      if (placed >= share.whole) break;
      const x = col + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= field.cols || y >= field.rows) continue;
      const cell = y * field.cols + x;
      if (!mine(cell)) continue;
      cells.push(cell);
      placed += 1;
    }
    for (; placed < share.whole; placed += 1) cells.push(city.cell);
  }
  return cells;
};

// The cells of a side's own ground on a home frame beside another country's land: where its forces stand
// stationed on that border. `theirs(cell)` says whether a cell is that country's.
export const borderCells = (battle, side, theirs) => {
  const { field } = battle;
  const found = [];
  for (let cell = 0; cell < field.size; cell += 1) {
    if (field.holders[cell] !== side || field.play[cell] !== 1) continue;
    const col = cell % field.cols;
    const row = Math.floor(cell / field.cols);
    let beside = false;
    for (let dy = -1; dy <= 1 && !beside; dy += 1) {
      for (let dx = -1; dx <= 1 && !beside; dx += 1) {
        const x = col + dx;
        const y = row + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < field.cols && y < field.rows && theirs(y * field.cols + x)) beside = true;
      }
    }
    if (beside) found.push(cell);
  }
  return found;
};

// The first country's land a way goes into from a side's own ground on a battle, by who holds its region; "" for
// none. The way is in cell units; it is looked at every half cell.
//   holderAt   (cell) => who holds the region the cell is in
export const wayInto = (battle, side, way, holderAt) => {
  const { field } = battle;
  for (let leg = 1; leg < way.length; leg += 1) {
    const [ax, ay] = way[leg - 1];
    const [bx, by] = way[leg];
    const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const steps = Math.max(1, Math.ceil(length * 2));
    for (let step = 0; step <= steps; step += 1) {
      const x = ax + ((bx - ax) * step) / steps;
      const y = ay + ((by - ay) * step) / steps;
      if (x < 0 || y < 0 || x >= field.cols || y >= field.rows) continue;
      const cell = Math.floor(y) * field.cols + Math.floor(x);
      if (field.holders[cell] === side) continue;
      const holder = clean(holderAt(cell));
      if (holder) return holder;
    }
  }
  return "";
};

/*! Open Historia — battlefields and fronts: the way a transporter takes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Nobody draws a transporter's way: it is found, over the sheet of the whole
// map (worldGrid.js), by what the transporter is.
//
//   sea    a ship goes by water, round the land, and comes to the coast
//          nearest where it was sent. It keeps off a shore its enemies hold
//          where another way is not much longer.
//   land   a train goes through land its own side holds, and no further: it
//          sets its troops down at the last such place on the way.
//   air    an aircraft goes over anything, and round its enemies' land where
//          that costs it little.
//
// The same map, the same holders and the same two places give the same way,
// every time: the search has no chance in it. Pure.

import { distanceTo, greatPoint, kmBetween, nearestCell, seasOf, wayKm } from "./worldGrid.js";

export const MEDIA = Object.freeze(["sea", "land", "air"]);
// How far from where it is told to go a ship may find its coast, and from
// where its troops stand its harbour.
export const COAST_REACH_KM = 420;
// A place this near the water a ship comes to is where its troops go ashore; further
// inland than that they land on the coast and go on by foot.
export const COAST_NEAR_KM = 60;
// The most cells a search may open before it gives the way up.
export const SEARCH_CELLS_MOST = 1000000;
// The most points a way is kept as.
export const WAY_POINTS_MOST = 48;
// The search leans toward where it is going: its guess of what is left is counted a little over,
// which opens far fewer cells for a way hardly any longer.
const GUESS_WEIGHT = 1.15;
// A cell beside land an enemy holds costs a ship, and an aircraft, this many times its length.
const HOSTILE_COST = { sea: 3.2, air: 2.4, land: 1 };
// How near such land is "beside" it, and the most cells that is counted over.
export const HOSTILE_KM = 55;
const HOSTILE_RINGS_MOST = 6;
// Along a coast a ship keeps a little out, and past the polar circles nobody sails by choice.
const SHORE_COST = 1.25;
const ICE_LAT = 70;
const ICE_COST = 14;
// A way is kept as points no further apart than this, so that a straight line
// drawn between two of them on any map is the short way on the globe.
const WAY_LEG_KM = 450;

// The cuts men have dug between seas, on the world's own map: the two waters
// each joins, and the year it opened. A scenario's map need not be the Earth
// (it may be an invented world, on a globe of its own), so a canal is gone
// through only where the map IS that part of the Earth: `sea` and `land` are
// places round it that are sea and land there, and every one of them has to be
// so on the sheet, besides the two ends being water and the neck between them
// land. An invented world that passes all of that by chance does not exist.
export const CANALS = Object.freeze([
  {
    name: "Suez",
    since: 1869,
    a: [32.35, 31.55],
    b: [32.6, 29.6],
    // The Mediterranean off the delta and off the Levant, and the Red Sea; the delta, Sinai, the Negev and the Eastern Desert.
    sea: [[32.3, 32.2], [33.5, 32.6], [35.0, 26.5]],
    land: [[31.2, 30.1], [33.9, 29.6], [34.9, 30.9], [32.5, 27.5]],
  },
  {
    name: "Panama",
    since: 1914,
    a: [-79.95, 9.55],
    b: [-79.5, 8.75],
    // The Caribbean and the Pacific on either hand; Veraguas, the Darien, Costa Rica and Colombia.
    sea: [[-80.0, 10.2], [-78.0, 11.0], [-79.3, 8.0], [-82.0, 6.5]],
    land: [[-81.0, 8.5], [-78.0, 8.5], [-84.0, 10.0], [-76.5, 7.0]],
  },
]);

const heapPush = (heap, cost, cell) => {
  let at = heap.cost.length;
  heap.cost.push(cost);
  heap.cell.push(cell);
  while (at > 0) {
    const up = (at - 1) >> 1;
    if (heap.cost[up] <= cost) break;
    heap.cost[at] = heap.cost[up];
    heap.cell[at] = heap.cell[up];
    at = up;
  }
  heap.cost[at] = cost;
  heap.cell[at] = cell;
};
const heapPop = (heap) => {
  const top = heap.cell[0];
  const cost = heap.cost.pop();
  const cell = heap.cell.pop();
  const size = heap.cost.length;
  if (size > 0) {
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= size) break;
      if (child + 1 < size && heap.cost[child + 1] < heap.cost[child]) child += 1;
      if (heap.cost[child] >= cost) break;
      heap.cost[at] = heap.cost[child];
      heap.cell[at] = heap.cell[child];
      at = child;
    }
    heap.cost[at] = cost;
    heap.cell[at] = cell;
  }
  return top;
};

// What a search keeps of a sheet between searches: its books are as large as
// the sheet, so they are made once and marked by which search wrote them.
const booksOf = (grid) => {
  if (!grid.books) {
    const size = grid.cols * grid.rows;
    grid.books = { reached: new Float64Array(size), from: new Int32Array(size), mark: new Uint32Array(size), shut: new Uint32Array(size), search: 0 };
  }
  grid.books.search += 1;
  if (grid.books.search > 4e9) {
    grid.books.mark.fill(0);
    grid.books.shut.fill(0);
    grid.books.search = 1;
  }
  return grid.books;
};

// Finds the way for a transporter.
//   grid            the sheet (buildWorldGrid)
//   medium          "sea" | "land" | "air"
//   from, to        [lng, lat]: where its troops are, and where they are sent
//   holderOf(id)    who holds a region in name
//   friendly(name)  it is the sender's, or its ally's in this war
//   hostile(name)   it is the sender's enemy in this war
//   year            the game's year, for a canal that is not dug yet
// Returns { way, km, start, end, landing } with `way` as [[lng, lat]...] from
// where it sets out to where it stops, and `landing` where its troops then
// stand; or { error } with one of: "off-map", "no-coast" (no sea near where it
// starts), "no-shore" (none near where it is sent), "no-sea-way", "no-ground"
// (a train with no land of its side's to start on), "too-far" (the search gave up).
export const findWay = (grid, { medium = "sea", from, to, holderOf = () => "", friendly = () => false, hostile = () => false, year = null } = {}) => {
  if (!grid || !MEDIA.includes(medium) || !Array.isArray(from) || !Array.isArray(to)) return { error: "off-map" };
  const { cols, rows, land, region, ids, full, wrap, step } = grid;
  const fromCell = grid.cellOf(from[0], from[1]);
  const toCell = grid.cellOf(to[0], to[1]);
  if (fromCell < 0 || toCell < 0) return { error: "off-map" };
  const km = (cellA, cellB) => {
    const a = grid.centreOf(cellA);
    const b = grid.centreOf(cellB);
    return grid.km(a[0], a[1], b[0], b[1]);
  };
  const reachCells = (wanted) => Math.max(2, Math.ceil(wanted / Math.max(1, grid.km(to[0], to[1], to[0], to[1] + step))));

  // Whose a region is to the sender: 1 its own side's, 2 its enemy's, 3 anybody else's.
  const sides = new Int8Array(ids.length);
  const sideOfCell = (cell) => {
    const mark = region[cell];
    if (!mark) return 0;
    if (!sides[mark]) {
      const name = String(holderOf(ids[mark]) ?? "");
      sides[mark] = name && friendly(name) ? 1 : name && hostile(name) ? 2 : 3;
    }
    return sides[mark];
  };
  const HOSTILE_RINGS = Math.max(1, Math.min(HOSTILE_RINGS_MOST, Math.round(HOSTILE_KM / Math.max(1, grid.km(to[0], to[1], to[0], to[1] + step)))));
  const threat = new Int8Array(cols * rows);
  const nearHostile = (cell) => {
    if (threat[cell]) return threat[cell] === 2;
    const row = Math.floor(cell / cols);
    const col = cell % cols;
    let found = false;
    for (let dy = -HOSTILE_RINGS; dy <= HOSTILE_RINGS && !found; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -HOSTILE_RINGS; dx <= HOSTILE_RINGS; dx += 1) {
        let x = col + dx;
        if (wrap) x = (x + cols) % cols;
        else if (x < 0 || x >= cols) continue;
        if (sideOfCell(y * cols + x) === 2) {
          found = true;
          break;
        }
      }
    }
    threat[cell] = found ? 2 : 1;
    return found;
  };

  // Where it sets out and where it is making for, on the sheet.
  let start = fromCell;
  let goal = toCell;
  let passable = () => true;
  if (medium === "sea") {
    const seas = seasOf(grid);
    const reach = reachCells(COAST_REACH_KM);
    // The water nearest each end, for every sea within reach of it: the two
    // ends must be on the same sea, and the nearest water to a place may be a lake.
    const waters = (cell) => {
      const found = new Map();
      nearestCell(grid, cell, reach, (next, ring) => {
        const sea = seas[next];
        if (sea && !found.has(sea)) found.set(sea, { cell: next, ring });
        return false;
      });
      return found;
    };
    const near = waters(fromCell);
    const far = waters(toCell);
    if (near.size === 0) return { error: "no-coast" };
    if (far.size === 0) return { error: "no-shore" };
    let best = null;
    for (const [sea, out] of near) {
      const home = far.get(sea);
      if (!home) continue;
      const cost = out.ring + home.ring;
      if (!best || cost < best.cost) best = { cost, start: out.cell, goal: home.cell };
    }
    if (!best) return { error: "no-sea-way" };
    start = best.start;
    goal = best.goal;
    passable = (cell) => land[cell] < full;
  } else if (medium === "land") {
    const mine = (cell) => land[cell] > 0 && sideOfCell(cell) === 1;
    start = mine(fromCell) ? fromCell : nearestCell(grid, fromCell, reachCells(160), (next) => mine(next));
    if (start < 0) return { error: "no-ground" };
    passable = mine;
  }

  // The canals open this year, as pairs of cells a ship may go between.
  const cuts = new Map();
  if (medium === "sea" && !grid.flat && Number.isFinite(year)) {
    for (const canal of CANALS) {
      if (year < canal.since) continue;
      const ends = [canal.a, canal.b].map(([lng, lat]) => nearestCell(grid, grid.cellOf(lng, lat), 2, (next) => land[next] < full));
      const middle = grid.cellOf((canal.a[0] + canal.b[0]) / 2, (canal.a[1] + canal.b[1]) / 2);
      if (ends[0] < 0 || ends[1] < 0 || middle < 0 || land[middle] === 0) continue;
      // Is this the Earth, here? Every place that is sea there is sea, and every place that is land is land.
      const here = ([lng, lat], wanted) => nearestCell(grid, grid.cellOf(lng, lat), 1, (next) => (wanted ? land[next] > 0 : land[next] < full)) >= 0;
      if (!canal.sea.every((point) => here(point, false)) || !canal.land.every((point) => here(point, true))) continue;
      cuts.set(ends[0], ends[1]);
      cuts.set(ends[1], ends[0]);
    }
  }

  const costOf = (cell) => {
    let cost = 1;
    if (medium !== "land" && nearHostile(cell)) cost *= HOSTILE_COST[medium];
    if (medium === "sea") {
      if (land[cell] > 0) cost *= SHORE_COST;
      if (!grid.flat && Math.abs(grid.centreOf(cell)[1]) > ICE_LAT) cost *= ICE_COST;
    }
    return cost;
  };

  // The search: the cheapest way from the start, best guess first.
  const books = booksOf(grid);
  const { reached, mark, shut, search } = books;
  const before = books.from;
  const heap = { cost: [], cell: [] };
  const goalAt = grid.centreOf(goal);
  const guess = distanceTo(grid, goal);
  const leaning = (cell) => guess(cell) * GUESS_WEIGHT;
  reached[start] = 0;
  before[start] = -1;
  mark[start] = search;
  heapPush(heap, leaning(start), start);
  let opened = 0;
  let nearest = start;
  let nearestKm = guess(start);
  let found = start === goal;
  while (!found && heap.cell.length > 0) {
    const cell = heapPop(heap);
    if (shut[cell] === search) continue;
    shut[cell] = search;
    if (cell === goal) {
      found = true;
      break;
    }
    opened += 1;
    if (opened > SEARCH_CELLS_MOST) break;
    const left = guess(cell);
    if (left < nearestKm) {
      nearestKm = left;
      nearest = cell;
    }
    const row = Math.floor(cell / cols);
    const col = cell % cols;
    const visit = (next, length) => {
      if (shut[next] === search || !passable(next)) return;
      const total = reached[cell] + length * costOf(next);
      if (mark[next] === search && reached[next] <= total) return;
      reached[next] = total;
      before[next] = cell;
      mark[next] = search;
      heapPush(heap, total + leaning(next), next);
    };
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        let x = col + dx;
        if (wrap) x = (x + cols) % cols;
        else if (x < 0 || x >= cols) continue;
        const next = y * cols + x;
        // (A step's length is its row's: along it, down a column (the same everywhere on a globe), or aslant between this row and the next.)
        visit(next, dy === 0 ? grid.stepKm.along[row] : dx === 0 ? (grid.stepKm.downRow ? grid.stepKm.downRow[dy < 0 ? y : row] : grid.stepKm.down) : grid.stepKm.aslant[dy < 0 ? y : row]);
      }
    }
    const cut = cuts.get(cell);
    if (cut !== undefined) visit(cut, km(cell, cut));
  }
  let end = goal;
  if (!found) {
    // A train goes as far toward the place as its side's land goes.
    if (medium !== "land") return { error: opened > SEARCH_CELLS_MOST ? "too-far" : "no-sea-way" };
    end = nearest;
  }

  // The cells of the way, from the start.
  const cells = [];
  for (let cell = end; cell >= 0 && cells.length <= cols * rows; cell = before[cell]) cells.push(cell);
  cells.reverse();

  // Straightened: the search goes from cell to neighbouring cell, which on
  // open water is a staircase. A stretch of it is replaced by the short way
  // between its two ends (the great circle, or on a flat sheet a straight
  // line) wherever that way is as clear as the cells it stands for: no dry
  // land for a ship, and no worse water than the search took.
  const worst = cells.map((cell) => costOf(cell));
  const stepKm = Math.max(0.5, grid.km(goalAt[0], goalAt[1], goalAt[0], goalAt[1] + step));
  const between = (a, b, share) => (grid.flat ? [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share] : greatPoint(a[0], a[1], b[0], b[1], share));
  // Whether the short way between two points is as clear as `most`.
  const clearLine = (a, b, most) => {
    const steps = Math.max(1, Math.ceil(grid.km(a[0], a[1], b[0], b[1]) / (stepKm / 2)));
    for (let at = 1; at < steps; at += 1) {
      const [lng, lat] = between(a, b, at / steps);
      const cell = grid.cellOf(lng, lat);
      if (cell < 0 || !passable(cell) || costOf(cell) > most + 1e-9) return false;
    }
    return true;
  };
  const worstOf = (a, b) => {
    let most = 0;
    for (let index = a; index <= b; index += 1) if (worst[index] > most) most = worst[index];
    return most;
  };
  const clear = (a, b) => clearLine(grid.centreOf(cells[a]), grid.centreOf(cells[b]), worstOf(a + 1, b));
  // A canal is gone through as it lies: no stretch is drawn across one.
  const gates = [];
  for (let index = 0; index + 1 < cells.length; index += 1) if (cuts.get(cells[index]) === cells[index + 1]) gates.push(index);
  const kept = [0];
  let at = 0;
  while (at < cells.length - 1) {
    let next = at + 1;
    if (!gates.includes(at)) {
      // The furthest cell that can be made for directly, tried from the far end inwards.
      const gate = gates.find((index) => index > at);
      const far = gate === undefined ? cells.length - 1 : gate;
      for (let span = far - at; span > 1; span = Math.floor(span * 0.62)) {
        if (clear(at, at + span)) {
          next = at + span;
          break;
        }
      }
    }
    kept.push(next);
    at = next;
  }
  let corners = kept.map((index) => grid.centreOf(cells[index]));
  // It sets out from where its troops are and, where it can, stops where it was sent.
  const first = grid.centreOf(start);
  const startKm = grid.km(from[0], from[1], first[0], first[1]);
  // (The place itself stands in for the middle of its cell where the stretch
  // from it is clear too; where it is not, it is put before that middle.)
  if (medium !== "sea" && fromCell === start) {
    const origin = [from[0], from[1]];
    if (corners.length > 1 && clearLine(origin, corners[1], worstOf(0, kept[1]))) corners[0] = origin;
    else corners.unshift(origin);
  }
  if (medium === "air" || (medium === "land" && end === toCell)) {
    const place = [to[0], to[1]];
    const before = corners.length - 2;
    if (before >= 0 && clearLine(corners[before], place, worstOf(Math.max(0, kept.at(-2) ?? 0), cells.length - 1))) corners[corners.length - 1] = place;
    else corners.push(place);
  }
  while (corners.length > WAY_POINTS_MOST) corners = corners.filter((_, index) => index === 0 || index === corners.length - 1 || index % 2 === 0);
  // Set out as points: every corner, and between two corners far apart the
  // short way between them, a point every so often.
  const laid = (legKm) => {
    const points = [corners[0]];
    for (let index = 0; index + 1 < corners.length; index += 1) {
      const a = corners[index];
      const b = corners[index + 1];
      const parts = grid.flat ? 1 : Math.max(1, Math.ceil(grid.km(a[0], a[1], b[0], b[1]) / legKm));
      for (let part = 1; part < parts; part += 1) points.push(between(a, b, part / parts));
      points.push(b);
    }
    return points;
  };
  let points = laid(WAY_LEG_KM);
  for (let legKm = WAY_LEG_KM * 1.5; points.length > WAY_POINTS_MOST && legKm < 40000; legKm *= 1.5) points = laid(legKm);
  const way = points.map(([lng, lat]) => [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000]);

  // Where the troops then stand.
  const last = grid.centreOf(end);
  let landing = [to[0], to[1]];
  if (medium === "sea") {
    // On the land nearest where they were sent, beside the water the ship came to.
    const shore = nearestCell(grid, end, 3, (next) => land[next] > 0);
    const toKm = grid.km(to[0], to[1], last[0], last[1]);
    const stepKm = Math.max(1, grid.km(last[0], last[1], last[0], last[1] + step));
    if (toKm > Math.max(stepKm * 2.5, COAST_NEAR_KM) || land[toCell] === 0) {
      if (shore < 0) return { error: "no-shore" };
      // Among the land beside that water, the cell nearest the place.
      let best = shore;
      let least = Infinity;
      nearestCell(grid, end, 3, (next) => {
        if (land[next] === 0) return false;
        const centre = grid.centreOf(next);
        const far = grid.km(centre[0], centre[1], to[0], to[1]);
        if (far < least) {
          least = far;
          best = next;
        }
        return false;
      });
      landing = grid.centreOf(best);
    }
  } else if (medium === "land" && end !== toCell) landing = last;
  return {
    way,
    km: Math.round(wayKm(way, { flat: grid.flat, scale: grid.scale })),
    start: [Math.round(first[0] * 1000) / 1000, Math.round(first[1] * 1000) / 1000],
    startKm: Math.round(startKm),
    end: [Math.round(last[0] * 1000) / 1000, Math.round(last[1] * 1000) / 1000],
    landing: [Math.round(landing[0] * 1000) / 1000, Math.round(landing[1] * 1000) / 1000],
    arrived: medium !== "land" || end === toCell,
  };
};

export { kmBetween };

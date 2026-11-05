/*! Open Historia — battlefields and fronts: how far it is over the ground © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A troop that is not on the line still has to know where the line is: how far
// off the other side's ground lies and which way, how far the ground it is to
// close on, how far its own side's supplied ground when it is cut off. Those
// are distances over the whole frame, and they are worked out here, once for
// each change of the ground, as whole numbers: a 3-4 chamfer, two passes over
// the cells, which is near enough to round and the same on every machine.
//
// A distance is kept in THIRDS of a cell (so a step along a row is 3 and a
// step on the diagonal 4); `cellsOf` reads one in cells.

import { FAR_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { readField } from "./field.js";

export const FAR_THIRDS = 1 << 28;

// How far each cell is from the nearest source cell, into `out` (an Int32Array).
// Each pass gives every cell the least of what it has and what the neighbours
// the pass has been through offer; the first row and the first and last
// columns are taken on their own, so that the cells between test no edge (the
// staff that looks ahead works this out thousands of times a turn: "its SOO
// LAGGY while in war", the owner, 2026-10-15). The least is the least in any
// order: the same distances as ever.
export const distanceFrom = (cols, rows, isSource, out) => {
  const size = cols * rows;
  for (let cell = 0; cell < size; cell += 1) out[cell] = isSource(cell) ? 0 : FAR_THIRDS;
  if (size === 0) return out;
  const last = cols - 1;
  // Forward: from the west and the north.
  for (let cell = 1; cell < cols; cell += 1) if (out[cell - 1] + 3 < out[cell]) out[cell] = out[cell - 1] + 3;
  for (let start = cols; start < size; start += cols) {
    let best = out[start];
    if (out[start - cols] + 3 < best) best = out[start - cols] + 3;
    if (last > 0 && out[start - cols + 1] + 4 < best) best = out[start - cols + 1] + 4;
    out[start] = best;
    const end = start + last;
    for (let cell = start + 1; cell < end; cell += 1) {
      best = out[cell];
      const west = out[cell - 1] + 3;
      if (west < best) best = west;
      const north = out[cell - cols] + 3;
      if (north < best) best = north;
      const northWest = out[cell - cols - 1] + 4;
      if (northWest < best) best = northWest;
      const northEast = out[cell - cols + 1] + 4;
      if (northEast < best) best = northEast;
      out[cell] = best;
    }
    if (last > 0) {
      best = out[end];
      if (out[end - 1] + 3 < best) best = out[end - 1] + 3;
      if (out[end - cols] + 3 < best) best = out[end - cols] + 3;
      if (out[end - cols - 1] + 4 < best) best = out[end - cols - 1] + 4;
      out[end] = best;
    }
  }
  // Back: from the east and the south.
  const lastRow = size - cols;
  for (let cell = size - 2; cell >= lastRow; cell -= 1) if (out[cell + 1] + 3 < out[cell]) out[cell] = out[cell + 1] + 3;
  for (let start = lastRow - cols; start >= 0; start -= cols) {
    const end = start + last;
    let best = out[end];
    if (out[end + cols] + 3 < best) best = out[end + cols] + 3;
    if (last > 0 && out[end + cols - 1] + 4 < best) best = out[end + cols - 1] + 4;
    out[end] = best;
    for (let cell = end - 1; cell > start; cell -= 1) {
      best = out[cell];
      const east = out[cell + 1] + 3;
      if (east < best) best = east;
      const south = out[cell + cols] + 3;
      if (south < best) best = south;
      const southEast = out[cell + cols + 1] + 4;
      if (southEast < best) best = southEast;
      const southWest = out[cell + cols - 1] + 4;
      if (southWest < best) best = southWest;
      out[cell] = best;
    }
    if (last > 0) {
      best = out[start];
      if (out[start + 1] + 3 < best) best = out[start + 1] + 3;
      if (out[start + cols] + 3 < best) best = out[start + cols] + 3;
      if (out[start + cols + 1] + 4 < best) best = out[start + cols + 1] + 4;
      out[start] = best;
    }
  }
  return out;
};

// The same, keeping for each cell WHICH source is nearest it: `labels` holds a
// number for every source cell and -1 for the rest; `outLabel` takes the
// number of the nearest.
export const nearestOf = (cols, rows, labels, out, outLabel) => {
  const size = cols * rows;
  for (let cell = 0; cell < size; cell += 1) {
    out[cell] = labels[cell] >= 0 ? 0 : FAR_THIRDS;
    outLabel[cell] = labels[cell];
  }
  const take = (cell, from, cost) => {
    if (out[from] + cost < out[cell]) {
      out[cell] = out[from] + cost;
      outLabel[cell] = outLabel[from];
    }
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      if (col > 0) take(cell, cell - 1, 3);
      if (row > 0) {
        take(cell, cell - cols, 3);
        if (col > 0) take(cell, cell - cols - 1, 4);
        if (col < cols - 1) take(cell, cell - cols + 1, 4);
      }
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const cell = row * cols + col;
      if (col < cols - 1) take(cell, cell + 1, 3);
      if (row < rows - 1) {
        take(cell, cell + cols, 3);
        if (col < cols - 1) take(cell, cell + cols + 1, 4);
        if (col > 0) take(cell, cell + cols - 1, 4);
      }
    }
  }
};

// How far each cell is from each side's ground: battle.toSide[side]. Worked
// out again only when ground has changed hands.
export const measure = (battle) => {
  const { field } = battle;
  if (battle.measuredFor === field && battle.measured === field.turns) return battle.toSide;
  if (battle.measuredFor !== field) battle.toSide = [new Int32Array(field.size), new Int32Array(field.size)];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) distanceFrom(field.cols, field.rows, (cell) => field.holders[cell] === side, battle.toSide[side]);
  battle.measuredFor = field;
  battle.measured = field.turns;
  return battle.toSide;
};

export const cellAt = (field, x, y) => (x >= 0 && y >= 0 && x < field.cols && y < field.rows ? Math.floor(y) * field.cols + Math.floor(x) : -1);

// One of these distances at a point, in cells; the frame's edge stands for
// what lies beyond it.
export const cellsOf = (field, grid, x, y) => {
  const col = x < 0 ? 0 : x >= field.cols ? field.cols - 1 : Math.floor(x);
  const row = y < 0 ? 0 : y >= field.rows ? field.rows - 1 : Math.floor(y);
  return grid[row * field.cols + col] / 3;
};

// The way such a distance falls away fastest from a point, as a unit vector
// through `out`; false where it is level.
export const downhill = (field, grid, x, y, out) => {
  const dx = cellsOf(field, grid, x - 1.5, y) - cellsOf(field, grid, x + 1.5, y);
  const dy = cellsOf(field, grid, x, y - 1.5) - cellsOf(field, grid, x, y + 1.5);
  const length = Math.sqrt(dx * dx + dy * dy);
  out[0] = length > 0 ? dx / length : 0;
  out[1] = length > 0 ? dy / length : 0;
  return length > 0;
};

// How far a troop of a side stands from the other side's ground, in cells: 0
// when it is on it. Near the line this is read off the field itself, which
// knows where inside a cell the line runs; further off, off the chamfer.
export const awayOf = (battle, side, x, y) => {
  const { field } = battle;
  const cell = cellAt(field, x, y);
  if (cell < 0 || field.holders[cell] !== side) return 0;
  const near = Math.abs(readField(field, x, y));
  return near < FAR_CELLS - 1 ? near : battle.toSide[1 - side][cell] / 3;
};

// Which way a side's stretch of the line FACES near a point: across the line,
// from its own ground to the other side's, taken over all the line within
// `reach` cells, the nearer the heavier. Every place where a cell of the
// side's lies beside a cell of the other's adds a push from the one to the
// other; a straight line at any angle gives exactly its own normal, a kink in
// a border is averaged away, a patch shut in on every side adds nothing, and a
// coast or a neighbour's land (which are nobody's) do not pull it aside.
// `downhill` over the chamfer knows only eight ways to point and turns with
// every kink; this turns by degrees as the point moves, which is what a troop
// is to walk by. A unit vector through `out`; false where there is no line
// within reach.
export const outwardOf = (field, side, x, y, reach, out) => {
  const other = 1 - side;
  const { cols, rows, holders } = field;
  const col0 = Math.floor(x);
  const row0 = Math.floor(y);
  const span = Math.ceil(reach);
  const within = reach * reach;
  let sumX = 0;
  let sumY = 0;
  for (let row = Math.max(0, row0 - span); row <= Math.min(rows - 1, row0 + span); row += 1) {
    for (let col = Math.max(0, col0 - span); col <= Math.min(cols - 1, col0 + span); col += 1) {
      const holder = holders[row * cols + col];
      if (holder !== side && holder !== other) continue;
      // The cell to the east of it, and the cell to the south: each pair once.
      if (col + 1 < cols) {
        const beside = holders[row * cols + col + 1];
        if (beside !== holder && (beside === side || beside === other)) {
          const dx = col + 1 - x;
          const dy = row + 0.5 - y;
          const apart = dx * dx + dy * dy;
          if (apart <= within) sumX += (holder === side ? 1 : -1) * (1 - apart / within);
        }
      }
      if (row + 1 < rows) {
        const below = holders[(row + 1) * cols + col];
        if (below !== holder && (below === side || below === other)) {
          const dx = col + 0.5 - x;
          const dy = row + 1 - y;
          const apart = dx * dx + dy * dy;
          if (apart <= within) sumY += (holder === side ? 1 : -1) * (1 - apart / within);
        }
      }
    }
  }
  const length = Math.sqrt(sumX * sumX + sumY * sumY);
  out[0] = length > 0 ? sumX / length : 0;
  out[1] = length > 0 ? sumY / length : 0;
  return length > 0;
};

// Whether the straight line between two points lies over ground in play all
// the way: looked at every half cell.
export const clearBetween = (field, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const cell = cellAt(field, ax + (dx * step) / steps, ay + (dy * step) / steps);
    if (cell < 0 || !field.play[cell]) return false;
  }
  return true;
};

// How much of the ground round a point is a side's: its share of the cells
// within `reach` cells that either side holds. Sea and the land of those not
// in the war are nobody's and count for nothing, so a coast does not read as
// the other side's. 1 where neither side holds anything near.
export const heldRound = (field, side, x, y, reach) => {
  const col0 = Math.floor(x);
  const row0 = Math.floor(y);
  const span = Math.ceil(reach);
  const within = reach * reach;
  let own = 0;
  let theirs = 0;
  for (let row = Math.max(0, row0 - span); row <= Math.min(field.rows - 1, row0 + span); row += 1) {
    const dy = row + 0.5 - y;
    for (let col = Math.max(0, col0 - span); col <= Math.min(field.cols - 1, col0 + span); col += 1) {
      const dx = col + 0.5 - x;
      if (dx * dx + dy * dy > within) continue;
      const holder = field.holders[row * field.cols + col];
      if (holder === side) own += 1;
      else if (holder === 1 - side) theirs += 1;
    }
  }
  return own + theirs > 0 ? own / (own + theirs) : 1;
};

// The cheapest way over ground in play from one cell to another, by what the
// ground costs to cross: a list of cells from the first to the last, or null
// when there is no way. Cells are settled in order of cost and, at equal cost,
// of index, so the same ground always gives the same way.
export const cheapestWay = (battle, from, to) => {
  const { field, arena } = battle;
  const { cols, rows, size, play } = field;
  if (from < 0 || to < 0 || !play[from] || !play[to]) return null;
  const cost = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const heap = [from];
  cost[from] = 0;
  const before = (a, b) => cost[a] < cost[b] || (cost[a] === cost[b] && a < b);
  const settled = new Uint8Array(size);
  while (heap.length > 0) {
    const index = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let least = at;
        if (left < heap.length && before(heap[left], heap[least])) least = left;
        if (right < heap.length && before(heap[right], heap[least])) least = right;
        if (least === at) break;
        [heap[at], heap[least]] = [heap[least], heap[at]];
        at = least;
      }
    }
    if (settled[index]) continue;
    settled[index] = 1;
    if (index === to) break;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = col + dx;
        const next = y * cols + x;
        if ((dx === 0 && dy === 0) || x < 0 || x >= cols || !play[next] || settled[next]) continue;
        const step = (dx !== 0 && dy !== 0 ? 1.4142135623730951 : 1) * (0.5 / arena.speed[index] + 0.5 / arena.speed[next]);
        if (!(cost[index] + step < cost[next])) continue;
        cost[next] = cost[index] + step;
        parent[next] = index;
        heap.push(next);
        for (let at = heap.length - 1; at > 0;) {
          const up = (at - 1) >> 1;
          if (!before(heap[at], heap[up])) break;
          [heap[at], heap[up]] = [heap[up], heap[at]];
          at = up;
        }
      }
    }
  }
  if (!settled[to]) return null;
  const way = [];
  for (let index = to; index >= 0; index = parent[index]) way.push(index);
  return way.reverse();
};

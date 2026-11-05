/*! Open Historia — battlefields and fronts: the field, who holds the ground and where the line runs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The front line is not stored as a line. Every cell of the frame carries a
// signed distance to it, in cells: negative where side A holds the ground,
// positive where side B does. The line is where that distance is zero, traced
// between the cells' centres to a fraction of a cell, so it runs anywhere and
// pockets, beachheads and encirclements need no special case: they are simply
// where the sign says they are.
//
//   field {
//     arena, cols, rows, size
//     play      1 where the cell is in play: ground of a region one of the two
//               sides controls, that a unit can cross. Everything else is wall.
//     holders   HOLDER_SIDE_A, HOLDER_SIDE_B or HOLDER_WALL, a cell each
//     phi       the signed distance; a cell far from the line holds FAR_CELLS
//   }
//
// The line moves only by EDITS, never by being carried along: a side takes a
// shape (the strip a troop walked, a disc, a region), and every cell the shape
// brings the line nearer to is rewritten. A cell no shape reaches is not
// written at all, so a front nobody pushes is the same to the last bit after
// any number of days. That is the rule the rest of this file exists to keep.

import { bandIndices, decodeBand, decodeMask, encodeBand, encodeMask } from "./codec.js";
import {
  BAND_UNITS,
  EDIT_MARGIN_CELLS,
  FAR_CELLS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  HOLDER_WALL,
  REDISTANCE_NEAR_CELLS,
  REDISTANCE_REACH_CELLS,
  SUPERSAMPLE,
} from "./constants.js";
import { sampleRegions } from "./arena.js";
import { projectorOf } from "./frame.js";

// The least distance a cell may hold: a cell exactly on the line still has a side.
const LEAST = 1 / 1024;
// What a cell holds when all that is known of it is its side.
const ROUGH = 0.5;

export const createField = (arena) => {
  const { cols, rows, size } = arena;
  return {
    arena,
    cols,
    rows,
    size,
    play: new Uint8Array(size),
    holders: new Uint8Array(size).fill(HOLDER_WALL),
    phi: new Float64Array(size),
    // For a wall cell beside the play, the cell in play whose distance it
    // borrows so the line can be traced up to the wall; itself for a cell in
    // play; -1 for a wall with no play beside it.
    ghost: new Int32Array(size).fill(-1),
    // The cells written since distances were last worked out again.
    changed: [],
    marked: new Uint8Array(size),
    // For the map, which paints the ground a side has taken in the colour of
    // the member whose troops took it: that member's place in its side's
    // list, a cell each, and the part of the day (0 to 1) a cell last changed
    // hands at. Working state: neither is saved.
    painter: new Uint8Array(size),
    when: new Float32Array(size).fill(1),
    // Counts every write, and every change of holder: what is worked out from
    // the field (the contour, the pockets) is good while its count stands.
    edits: 0,
    turns: 0,
    contour: null,
    contourEdits: -1,
    pieceFrom: new Int32Array(size * 2).fill(-1),
    pieceTo: new Int32Array(size * 2).fill(-1),
  };
};

const sideSign = (holder) => (holder === HOLDER_SIDE_A ? -1 : 1);

const refreshGhosts = (field) => {
  const { cols, rows, play, ghost } = field;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (play[index]) {
        ghost[index] = index;
        continue;
      }
      const south = row > 0;
      const north = row < rows - 1;
      const west = col > 0;
      const east = col < cols - 1;
      // The nearest first: the four beside it, then the four corners.
      ghost[index] = south && play[index - cols] ? index - cols
        : west && play[index - 1] ? index - 1
          : east && play[index + 1] ? index + 1
            : north && play[index + cols] ? index + cols
              : south && west && play[index - cols - 1] ? index - cols - 1
                : south && east && play[index - cols + 1] ? index - cols + 1
                  : north && west && play[index + cols - 1] ? index + cols - 1
                    : north && east && play[index + cols + 1] ? index + cols + 1
                      : -1;
    }
  }
};

const markChanged = (field, index) => {
  if (field.marked[index]) return;
  field.marked[index] = 1;
  field.changed.push(index);
};

// The one place a cell in play is written by an edit. Where the cell changes
// hands it is painted for `painter`, the member of its new side whose troops
// took it, and `when` it happened in the day is noted for the map's playback.
const write = (field, index, value, painter = 0, when = 1) => {
  field.phi[index] = value;
  field.edits += 1;
  markChanged(field, index);
  const holder = value < 0 ? HOLDER_SIDE_A : HOLDER_SIDE_B;
  if (field.holders[index] !== holder) {
    field.holders[index] = holder;
    field.painter[index] = painter;
    field.when[index] = when;
    field.turns += 1;
  }
};

// Which cells are in play, from the side each region's controller fights on:
// `sideOfRegion[regionIndex]` is 0, 1, or -1 for a region outside the war. A
// cell that comes into play takes its region's side, roughly, until distances
// are worked out; one that leaves it becomes wall. true when anything changed.
// (Frozen water, which is no side's region, takes `iceSide`'s side cell by cell: battle.js iceSides.)
export const setGround = (field, sideOfRegion, iceSide = null) => {
  const { arena, size, play, holders, phi } = field;
  let changed = false;
  for (let index = 0; index < size; index += 1) {
    const side = arena.speed[index] > 0 ? (iceSide && arena.iced && arena.iced[index] === 1 ? iceSide[index] : sideOfRegion[arena.region[index]]) : -1;
    if (side === 0 || side === 1) {
      if (play[index]) continue;
      play[index] = 1;
      holders[index] = side;
      phi[index] = sideSign(side) * ROUGH;
      markChanged(field, index);
    } else {
      if (!play[index] && holders[index] === HOLDER_WALL) continue;
      play[index] = 0;
      holders[index] = HOLDER_WALL;
      phi[index] = 0;
      markChanged(field, index);
    }
    changed = true;
  }
  if (changed) {
    field.edits += 1;
    field.turns += 1;
    refreshGhosts(field);
  }
  return changed;
};

// ---- the line ------------------------------------------------------------------

// Marching squares over the lattice of cell centres. A square's corners are
// numbered south-west, south-east, north-east, north-west and its edges south,
// east, north, west; a corner is "in" where side A holds it. Each case lists
// the edges a piece of line runs between, FROM and TO, so that side A's ground
// is always on the LEFT of the direction of travel. The map colours each side
// of the line by that rule, so it is fixed here, where the line is made.
const CASES = [
  [], [0, 3], [1, 0], [1, 3], [2, 1], null, [2, 0], [2, 3],
  [3, 2], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0], [],
];
// The two corners that are "in" touch only at the square's middle: who holds
// the middle decides whether they are joined through it.
const SADDLE_5 = [[0, 1, 2, 3], [0, 3, 2, 1]];
const SADDLE_10 = [[3, 0, 1, 2], [1, 0, 3, 2]];

// The line as it stands: strands of vertices in cell units.
//
//   contour {
//     strands: [{ closed, first, count }]   a run of the vertex lists below
//     x, y                                  every vertex, strand after strand
//     cellA, cellB   the cells either side of a vertex that lies between two
//                    cells in play; -1 for a vertex where a strand meets a wall
//     segments       how many; segment k runs from vertex from[k] to vertex to[k]
//     from, to, square
//   }
//
// A strand ends where the line meets a wall and is closed where it runs wholly
// through the two sides' ground. The order is fixed: squares are read row by
// row from the south, an open strand is listed from its beginning, a closed one
// from its first piece in that reading.
export const traceContour = (field) => {
  if (field.contour && field.contourEdits === field.edits) return field.contour;
  const { cols, rows, phi, play, holders, ghost, pieceFrom, pieceTo } = field;

  const fromX = [];
  const fromY = [];
  const toX = [];
  const toY = [];
  const startEdge = [];
  const endEdge = [];
  const square = [];
  const edgeX = [0, 0, 0, 0];
  const edgeY = [0, 0, 0, 0];
  const edgeId = [0, 0, 0, 0];
  const edgeReal = [false, false, false, false];
  const used = [];

  const addPiece = (x0, y0, x1, y1, from, to, squareIndex) => {
    const piece = fromX.length;
    fromX.push(x0);
    fromY.push(y0);
    toX.push(x1);
    toY.push(y1);
    startEdge.push(from);
    endEdge.push(to);
    square.push(squareIndex);
    if (from >= 0) {
      pieceFrom[from] = piece;
      used.push(from);
    }
    if (to >= 0) {
      pieceTo[to] = piece;
      used.push(to);
    }
  };

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const sw = row * cols + col;
      const se = sw + 1;
      const nw = sw + cols;
      const ne = nw + 1;
      const southReal = holders[sw] + holders[se] === 1;
      const eastReal = holders[se] + holders[ne] === 1;
      const northReal = holders[nw] + holders[ne] === 1;
      const westReal = holders[sw] + holders[nw] === 1;
      if (!southReal && !eastReal && !northReal && !westReal) continue;

      const valueSw = phi[ghost[sw]];
      const valueSe = phi[ghost[se]];
      const valueNe = phi[ghost[ne]];
      const valueNw = phi[ghost[nw]];
      const shape = (valueSw < 0 ? 1 : 0) | (valueSe < 0 ? 2 : 0) | (valueNe < 0 ? 4 : 0) | (valueNw < 0 ? 8 : 0);
      let pairs = CASES[shape];
      if (pairs === null) {
        const joined = valueSw + valueSe + valueNe + valueNw < 0 ? 0 : 1;
        pairs = (shape === 5 ? SADDLE_5 : SADDLE_10)[joined];
      }
      if (pairs.length === 0) continue;

      edgeX[0] = col + 0.5 + valueSw / (valueSw - valueSe);
      edgeY[0] = row + 0.5;
      edgeId[0] = sw * 2;
      edgeReal[0] = southReal;
      edgeX[1] = col + 1.5;
      edgeY[1] = row + 0.5 + valueSe / (valueSe - valueNe);
      edgeId[1] = se * 2 + 1;
      edgeReal[1] = eastReal;
      edgeX[2] = col + 0.5 + valueNw / (valueNw - valueNe);
      edgeY[2] = row + 1.5;
      edgeId[2] = nw * 2;
      edgeReal[2] = northReal;
      edgeX[3] = col + 0.5;
      edgeY[3] = row + 0.5 + valueSw / (valueSw - valueNw);
      edgeId[3] = sw * 2 + 1;
      edgeReal[3] = westReal;

      const whole = play[sw] && play[se] && play[ne] && play[nw];
      for (let pair = 0; pair < pairs.length; pair += 2) {
        const from = pairs[pair];
        const to = pairs[pair + 1];
        if (!edgeReal[from] && !edgeReal[to]) continue;
        const x0 = edgeX[from];
        const y0 = edgeY[from];
        const x1 = edgeX[to];
        const y1 = edgeY[to];
        if (whole) {
          addPiece(x0, y0, x1, y1, edgeId[from], edgeId[to], sw);
          continue;
        }
        // A corner of this square is wall: keep only what lies over the quarters
        // of the square that belong to cells in play, so no strand runs into a
        // wall and one that reaches a coast ends on it.
        const middleX = col + 1;
        const middleY = row + 1;
        let first = (middleX - x0) / (x1 - x0);
        let second = (middleY - y0) / (y1 - y0);
        if (!(first > 0 && first < 1)) first = 1;
        if (!(second > 0 && second < 1)) second = 1;
        if (second < first) {
          const swap = first;
          first = second;
          second = swap;
        }
        const stops = [0, first, second, 1];
        // A run of the piece that lies over cells in play is kept if one of its
        // ends is a true crossing between the two sides.
        const keepRun = (begin, end) => {
          const startsReal = begin === 0 && edgeReal[from];
          const endsReal = end === 1 && edgeReal[to];
          if (!startsReal && !endsReal) return;
          addPiece(
            x0 + (x1 - x0) * begin,
            y0 + (y1 - y0) * begin,
            x0 + (x1 - x0) * end,
            y0 + (y1 - y0) * end,
            startsReal ? edgeId[from] : -1,
            endsReal ? edgeId[to] : -1,
            sw,
          );
        };
        let runStart = -1;
        let runEnd = 0;
        for (let part = 0; part < 3; part += 1) {
          const begin = stops[part];
          const end = stops[part + 1];
          if (!(end > begin)) continue;
          const middle = (begin + end) / 2;
          const east = x0 + (x1 - x0) * middle >= middleX;
          const north = y0 + (y1 - y0) * middle >= middleY;
          if (play[north ? (east ? ne : nw) : (east ? se : sw)] === 1) {
            if (runStart < 0) runStart = begin;
            runEnd = end;
          } else if (runStart >= 0) {
            keepRun(runStart, runEnd);
            runStart = -1;
          }
        }
        if (runStart >= 0) keepRun(runStart, runEnd);
      }
    }
  }

  // Pieces into strands: a piece that begins where no other ends begins a
  // strand; what is left over after those are followed runs in rings.
  const pieces = fromX.length;
  const strands = [];
  const x = [];
  const y = [];
  const cellA = [];
  const cellB = [];
  const from = [];
  const to = [];
  const segmentSquare = [];
  const taken = new Uint8Array(pieces);

  const pushVertex = (px, py, edge) => {
    x.push(px);
    y.push(py);
    if (edge < 0) {
      cellA.push(-1);
      cellB.push(-1);
      return;
    }
    const low = edge >> 1;
    const high = low + ((edge & 1) === 1 ? cols : 1);
    cellA.push(holders[low] === HOLDER_SIDE_A ? low : high);
    cellB.push(holders[low] === HOLDER_SIDE_A ? high : low);
  };
  const follow = (start, closed) => {
    const first = x.length;
    pushVertex(fromX[start], fromY[start], startEdge[start]);
    let piece = start;
    while (piece >= 0 && !taken[piece]) {
      taken[piece] = 1;
      const edge = endEdge[piece];
      const next = edge >= 0 ? pieceFrom[edge] : -1;
      const last = closed && next === start;
      from.push(x.length - 1);
      segmentSquare.push(square[piece]);
      if (last) {
        to.push(first);
        break;
      }
      to.push(x.length);
      pushVertex(toX[piece], toY[piece], edge);
      piece = next;
    }
    strands.push({ closed, first, count: x.length - first });
  };
  for (let piece = 0; piece < pieces; piece += 1) {
    if (!taken[piece] && (startEdge[piece] < 0 || pieceTo[startEdge[piece]] < 0)) follow(piece, false);
  }
  for (let piece = 0; piece < pieces; piece += 1) {
    if (!taken[piece]) follow(piece, true);
  }
  for (const edge of used) {
    pieceFrom[edge] = -1;
    pieceTo[edge] = -1;
  }

  field.contour = {
    strands,
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    cellA: Int32Array.from(cellA),
    cellB: Int32Array.from(cellB),
    segments: from.length,
    from: Int32Array.from(from),
    to: Int32Array.from(to),
    square: Int32Array.from(segmentSquare),
    heads: null,
    nexts: null,
  };
  field.contourEdits = field.edits;
  return field.contour;
};

// The segments of a contour, listed by the square each lies in, lowest first.
const bucket = (field, contour) => {
  if (contour.heads) return;
  const heads = new Int32Array(field.size).fill(-1);
  const nexts = new Int32Array(contour.segments);
  for (let segment = contour.segments - 1; segment >= 0; segment -= 1) {
    nexts[segment] = heads[contour.square[segment]];
    heads[contour.square[segment]] = segment;
  }
  contour.heads = heads;
  contour.nexts = nexts;
};

// The point of the line nearest a place, looked for out to `reach` cells.
// Answers through `nearest`: its distance (Infinity when there is none that
// near), the segment it is on and how far along that segment, 0 to 1. Of two
// equally near, the segment listed first.
export const nearest = { distance: Infinity, segment: -1, along: 0 };
export const nearestOnContour = (field, contour, px, py, reach) => {
  bucket(field, contour);
  const { cols, rows } = field;
  const { heads, nexts, x, y, from, to } = contour;
  const col = Math.floor(px - 0.5);
  const row = Math.floor(py - 0.5);
  let best = Infinity;
  let bestSegment = -1;
  let bestAlong = 0;
  const rings = Math.ceil(reach);
  for (let ring = 0; ring <= rings; ring += 1) {
    // Nothing in this ring of squares or beyond is nearer than `ring - 1` cells.
    if (best < ring - 1) break;
    for (let dy = -ring; dy <= ring; dy += 1) {
      const squareRow = row + dy;
      if (squareRow < 0 || squareRow >= rows) continue;
      const edge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx += edge ? 1 : Math.max(1, ring * 2)) {
        const squareCol = col + dx;
        if (squareCol < 0 || squareCol >= cols) continue;
        for (let segment = heads[squareRow * cols + squareCol]; segment >= 0; segment = nexts[segment]) {
          const ax = x[from[segment]];
          const ay = y[from[segment]];
          const bx = x[to[segment]] - ax;
          const by = y[to[segment]] - ay;
          const length = bx * bx + by * by;
          let along = length > 0 ? ((px - ax) * bx + (py - ay) * by) / length : 0;
          along = along < 0 ? 0 : along > 1 ? 1 : along;
          const ox = px - (ax + bx * along);
          const oy = py - (ay + by * along);
          const distance = Math.sqrt(ox * ox + oy * oy);
          if (distance < best || (distance === best && segment < bestSegment)) {
            best = distance;
            bestSegment = segment;
            bestAlong = along;
          }
        }
      }
    }
  }
  if (best > reach) {
    nearest.distance = Infinity;
    nearest.segment = -1;
    nearest.along = 0;
    return Infinity;
  }
  nearest.distance = best;
  nearest.segment = bestSegment;
  nearest.along = bestAlong;
  return best;
};

// ---- edits ---------------------------------------------------------------------

// A side takes everything within a radius of a segment: the strip a troop
// swept as it walked from (px, py) to (qx, qy). The radius may run from one
// value at p to another at q, which is the bridge between two troops advancing
// side by side; p and q the same point is a disc.
//
// `how` says the rest, every part of it optional:
//   claims, strength   settles ground both sides step into in one moment:
//                      claims is { stamp, power, moment } and strength the
//                      taker's own. Side A writes first and leaves its strength
//                      on the cells it covers; side B then takes such a cell
//                      only if it is the stronger there.
//   painter, painterQ  the member the ground is taken for: at p, and at q if
//                      another's (a bridge is painted for the nearer of the two)
//   from, span         when in the day the walk began and how long it took,
//                      as parts of the day: a cell is taken when the walk
//                      came level with it
//   spare              discs of ground the sweep leaves alone, as a flat list
//                      of x, y and radius in cells: what is taken is the strip
//                      less the discs, so the line comes to run round them
//   keep               cells the sweep leaves alone, a mask over the field
export const takeCapsule = (field, side, px, py, qx, qy, radiusP, radiusQ, how = null) => {
  const { cols, rows, play, phi } = field;
  const claims = how?.claims ?? null;
  const strength = how?.strength ?? 0;
  const painterP = how?.painter ?? 0;
  const painterQ = how?.painterQ ?? painterP;
  const from = how?.from ?? 1;
  const span = how?.span ?? 0;
  const spare = how?.spare ?? null;
  const keep = how?.keep ?? null;
  const reach = Math.max(radiusP, radiusQ) + EDIT_MARGIN_CELLS;
  const col0 = Math.max(0, Math.floor(Math.min(px, qx) - reach));
  const col1 = Math.min(cols - 1, Math.floor(Math.max(px, qx) + reach));
  const row0 = Math.max(0, Math.floor(Math.min(py, qy) - reach));
  const row1 = Math.min(rows - 1, Math.floor(Math.max(py, qy) + reach));
  const sx = qx - px;
  const sy = qy - py;
  const length = sx * sx + sy * sy;
  for (let row = row0; row <= row1; row += 1) {
    const cy = row + 0.5;
    for (let col = col0; col <= col1; col += 1) {
      const index = row * cols + col;
      if (!play[index] || (keep && keep[index])) continue;
      const cx = col + 0.5;
      let along = length > 0 ? ((cx - px) * sx + (cy - py) * sy) / length : 0;
      along = along < 0 ? 0 : along > 1 ? 1 : along;
      const ox = cx - (px + sx * along);
      const oy = cy - (py + sy * along);
      let distance = Math.sqrt(ox * ox + oy * oy) - (radiusP + (radiusQ - radiusP) * along);
      if (spare) {
        // The strip less each spared disc: a cell is as far inside what is
        // taken as it is inside the strip and outside every disc, and a cell
        // within a disc is never inside it at all.
        for (let at = 0; at < spare.length; at += 3) {
          const dx = cx - spare[at];
          const dy = cy - spare[at + 1];
          const within = spare[at + 2] - Math.sqrt(dx * dx + dy * dy);
          if (within > distance) distance = within;
          if (within >= 0 && distance < LEAST) distance = LEAST;
        }
      }
      if (distance > EDIT_MARGIN_CELLS) continue;
      if (side === HOLDER_SIDE_A) {
        if (claims && distance < 0 && !(claims.stamp[index] === claims.moment && claims.power[index] >= strength)) {
          claims.stamp[index] = claims.moment;
          claims.power[index] = strength;
        }
        if (distance < phi[index]) write(field, index, distance, along < 0.5 ? painterP : painterQ, from + span * along);
      } else if (-distance > phi[index]) {
        if (claims && claims.stamp[index] === claims.moment && claims.power[index] >= strength) continue;
        write(field, index, -distance, along < 0.5 ? painterP : painterQ, from + span * along);
      }
    }
  }
};

// A side takes a set of cells whole (a region, a pocket that surrenders, land
// the world handed over). Nothing says where inside a cell such a line runs, so
// it is put on the cells' own edges: the cells taken hold half a cell, and so
// does whatever of the other side now touches them. `painter` is the member
// they are taken for, or a function giving it for each cell.
export const takeCells = (field, side, cells, painter = 0) => {
  const { cols, rows, play, phi, holders } = field;
  const inside = sideSign(side) * ROUGH;
  for (let position = 0; position < cells.length; position += 1) {
    const index = cells[position];
    if (!play[index]) continue;
    if (side === HOLDER_SIDE_A ? phi[index] > inside : phi[index] < inside) {
      write(field, index, inside, holders[index] === side ? 0 : typeof painter === "function" ? painter(index) : painter);
    }
  }
  for (let position = 0; position < cells.length; position += 1) {
    const index = cells[position];
    if (!play[index]) continue;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let step = 0; step < 4; step += 1) {
      const neighbour = step === 0 ? (row > 0 ? index - cols : -1)
        : step === 1 ? (col > 0 ? index - 1 : -1)
          : step === 2 ? (col < cols - 1 ? index + 1 : -1)
            : (row < rows - 1 ? index + cols : -1);
      if (neighbour < 0 || !play[neighbour] || holders[neighbour] === side) continue;
      if (side === HOLDER_SIDE_A ? phi[neighbour] > ROUGH : phi[neighbour] < -ROUGH) write(field, neighbour, -inside);
    }
  }
};

// Puts cells back to the values of an earlier copy of the field (ground an
// attack took and lost again). Only cells in play in both are touched.
// `painter` gives the member a cell that changes hands goes back to.
export const restoreCells = (field, cells, earlierPhi, painter = () => 0) => {
  for (let position = 0; position < cells.length; position += 1) {
    const index = cells[position];
    if (!field.play[index] || earlierPhi[index] === 0 || field.phi[index] === earlierPhi[index]) continue;
    const returns = earlierPhi[index] < 0 !== field.phi[index] < 0;
    write(field, index, earlierPhi[index], returns ? painter(index) : 0);
  }
};

// ---- distances -----------------------------------------------------------------

const touchesOtherSide = (field, index) => {
  const { cols, rows, holders } = field;
  const want = 1 - holders[index];
  const col = index % cols;
  const row = (index - col) / cols;
  return (row > 0 && holders[index - cols] === want)
    || (col > 0 && holders[index - 1] === want)
    || (col < cols - 1 && holders[index + 1] === want)
    || (row < rows - 1 && holders[index + cols] === want);
};

const distanceFor = (field, contour, index) => {
  const col = index % field.cols;
  const found = nearestOnContour(field, contour, col + 0.5, (index - col) / field.cols + 0.5, REDISTANCE_REACH_CELLS);
  const distance = found === Infinity ? FAR_CELLS : found < LEAST ? LEAST : found;
  return sideSign(field.holders[index]) * distance;
};

// After a day's edits: the cells that were written, and those within two cells
// of one, are given their true distance to the line as it now stands. The cells
// that touch the other side are left exactly as they are, because the line is
// read off them and nothing else: so this never moves the line, not by a bit,
// and a cell nothing came near is never written.
export const redistance = (field) => {
  const { cols, rows, play, phi, changed, marked } = field;
  if (changed.length === 0) return;
  const contour = traceContour(field);
  field.seen ??= new Uint8Array(field.size);
  const seen = field.seen.fill(0);
  for (let position = 0; position < changed.length; position += 1) {
    const centre = changed[position];
    const col = centre % cols;
    const row = (centre - col) / cols;
    const row1 = Math.min(rows - 1, row + REDISTANCE_NEAR_CELLS);
    const col1 = Math.min(cols - 1, col + REDISTANCE_NEAR_CELLS);
    for (let near = Math.max(0, row - REDISTANCE_NEAR_CELLS); near <= row1; near += 1) {
      for (let index = near * cols + Math.max(0, col - REDISTANCE_NEAR_CELLS); index <= near * cols + col1; index += 1) {
        if (seen[index]) continue;
        seen[index] = 1;
        if (!play[index] || touchesOtherSide(field, index)) continue;
        phi[index] = distanceFor(field, contour, index);
      }
    }
  }
  for (let position = 0; position < changed.length; position += 1) marked[changed[position]] = 0;
  changed.length = 0;
  // The contour was read off cells this did not write: it stands.
  field.edits += 1;
  field.contourEdits = field.edits;
};

// Every distance from scratch: the line is traced from what the cells hold now,
// however rough, and every cell in play is given its distance to that line.
// For a new battlefield, a saved one whose distances cannot be trusted, and a
// frame that has grown. With `keepLine` the cells that touch the other side are
// left as they are, for a field whose line is already where it should be:
// measuring a curved line again from its own tracing would round it off.
export const rebuildDistances = (field, keepLine = false) => {
  const { cols, rows, size, play, phi, holders, changed, marked } = field;
  const contour = traceContour(field);
  const near = new Uint8Array(size);
  const reach = REDISTANCE_REACH_CELLS;
  for (let segment = 0; segment < contour.segments; segment += 1) {
    const square = contour.square[segment];
    const col = square % cols;
    const row = (square - col) / cols;
    const row1 = Math.min(rows - 1, row + reach + 1);
    const col1 = Math.min(cols - 1, col + reach + 1);
    for (let at = Math.max(0, row - reach); at <= row1; at += 1) near.fill(1, at * cols + Math.max(0, col - reach), at * cols + col1 + 1);
  }
  const next = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    if (!play[index]) continue;
    next[index] = !near[index] ? sideSign(holders[index]) * FAR_CELLS
      : keepLine && touchesOtherSide(field, index) ? phi[index]
        : distanceFor(field, contour, index);
  }
  phi.set(next);
  for (let position = 0; position < changed.length; position += 1) marked[changed[position]] = 0;
  changed.length = 0;
  field.edits += 1;
};

// ---- a new field ---------------------------------------------------------------

// The field of a battlefield as it opens: each cell held by the side whose
// region lies under its centre, and the line put where the two sides' regions
// really meet, to a fraction of a cell. A cell beside the other side is sampled
// sixteen times; the share of it each side has says how far through it the
// border runs. null when the two sides do not touch here.
export const openField = (arena, regions, sideOfRegion, iceSide = null) => {
  const field = createField(arena);
  setGround(field, sideOfRegion, iceSide);
  const { cols, rows, size, play, holders, phi } = field;
  const border = [];
  let col0 = cols;
  let col1 = -1;
  let row0 = rows;
  let row1 = -1;
  for (let index = 0; index < size; index += 1) {
    if (!play[index]) continue;
    phi[index] = sideSign(holders[index]) * ROUGH;
    const col = index % cols;
    const row = (index - col) / cols;
    const want = 1 - holders[index];
    let beside = false;
    for (let dy = -1; dy <= 1 && !beside; dy += 1) {
      for (let dx = -1; dx <= 1 && !beside; dx += 1) {
        const nx = col + dx;
        const ny = row + dy;
        beside = nx >= 0 && ny >= 0 && nx < cols && ny < rows && holders[ny * cols + nx] === want;
      }
    }
    if (!beside) continue;
    border.push(index);
    if (col < col0) col0 = col;
    if (col > col1) col1 = col;
    if (row < row0) row0 = row;
    if (row > row1) row1 = row;
  }
  if (border.length === 0) return null;

  const scale = SUPERSAMPLE;
  const fine = sampleRegions(arena, regions, { col0, row0, col1, row1 }, scale, (value) => sideOfRegion[value] >= 0 && arena.regionSpeed[value] > 0);
  for (const index of border) {
    const col = index % cols;
    const row = (index - col) / cols;
    let countA = 0;
    let countB = 0;
    for (let dy = 0; dy < scale; dy += 1) {
      const base = ((row - row0) * scale + dy) * fine.width + (col - col0) * scale;
      for (let dx = 0; dx < scale; dx += 1) {
        const side = sideOfRegion[fine.grid[base + dx]];
        if (side === 0) countA += 1;
        else if (side === 1) countB += 1;
      }
    }
    const share = countA + countB === 0 ? (holders[index] === HOLDER_SIDE_B ? 1 : 0) : countB / (countA + countB);
    const least = 1 / 64;
    phi[index] = holders[index] === HOLDER_SIDE_A ? Math.min(-least, share - 0.5) : Math.max(least, share - 0.5);
  }
  field.edits += 1;
  rebuildDistances(field);
  return field;
};

// Distances from the holders alone: the line is put on the cells' edges.
export const rebuildFromHolders = (field) => {
  const { size, play, holders, phi } = field;
  for (let index = 0; index < size; index += 1) if (play[index]) phi[index] = sideSign(holders[index]) * ROUGH;
  field.edits += 1;
  rebuildDistances(field);
};

// ---- saving and loading --------------------------------------------------------

// What a battlefield keeps of its field: who holds every cell, and the distance
// for the cells near the other side, in thirty-seconds of a cell. A kept
// distance is never nothing: 0 is how a reader knows a value is missing.
export const packField = (field) => {
  const { cols, rows, holders, phi } = field;
  const cells = bandIndices(holders, cols, rows);
  const values = new Int16Array(cells.length);
  for (let position = 0; position < cells.length; position += 1) {
    const index = cells[position];
    const value = Math.round(phi[index] * BAND_UNITS);
    values[position] = holders[index] === HOLDER_SIDE_A ? Math.min(-1, value) : Math.max(1, value);
  }
  return { mask: encodeMask(holders), band: encodeBand(values), key: field.arena.key };
};

// A saved field laid back on its arena. The ground is taken from the arena and
// the sides as they are now, the holders from the saved mask where it speaks of
// a cell in play, and the distances from the saved band. If the band cannot be
// trusted (the map was redrawn since, a value is missing, a value has the wrong
// sign) every distance is worked out again from the holders.
export const unpackField = (arena, saved, sideOfRegion, iceSide = null) => {
  const field = createField(arena);
  setGround(field, sideOfRegion, iceSide);
  const { cols, rows, size, play, holders, phi } = field;
  const mask = decodeMask(saved?.mask, size);
  const cells = bandIndices(mask, cols, rows);
  const band = String(saved?.band ?? "");
  let trusted = saved?.key === arena.key && band.length * 6 >= cells.length * 8;
  for (let index = 0; index < size; index += 1) {
    if (!play[index]) continue;
    if (mask[index] === HOLDER_WALL) trusted = false;
    else holders[index] = mask[index];
    phi[index] = sideSign(holders[index]) * FAR_CELLS;
  }
  if (trusted) {
    const values = decodeBand(band, cells.length);
    for (let position = 0; position < cells.length && trusted; position += 1) {
      const index = cells[position];
      if (!play[index]) continue;
      const value = values[position];
      if (value === 0 || (value < 0) !== (holders[index] === HOLDER_SIDE_A)) trusted = false;
      else phi[index] = value / BAND_UNITS;
    }
  }
  field.changed.length = 0;
  field.marked.fill(0);
  field.edits += 1;
  field.turns += 1;
  if (!trusted) rebuildFromHolders(field);
  return field;
};

// A field moved onto another arena (the frame grew, or its cells changed size):
// every new cell reads the old field at its own place on the map. Where the old
// frame did not reach, a cell takes its region's side. `scale` is how many new
// cells an old cell's side measures.
export const resampleField = (old, arena, sideOfRegion, iceSide = null) => {
  const field = createField(arena);
  setGround(field, sideOfRegion, iceSide);
  const { cols, size, play, holders, phi } = field;
  const { toLngLat } = projectorOf(arena.frame);
  const { toCell } = projectorOf(old.arena.frame);
  const scale = old.arena.frame.cell / arena.frame.cell;
  for (let index = 0; index < size; index += 1) {
    if (!play[index]) continue;
    const col = index % cols;
    const [lng, lat] = toLngLat(col + 0.5, (index - col) / cols + 0.5);
    const [x, y] = toCell(lng, lat);
    const value = readField(old, x, y);
    if (value !== 0) holders[index] = value < 0 ? HOLDER_SIDE_A : HOLDER_SIDE_B;
    phi[index] = value !== 0 ? value * scale : sideSign(holders[index]) * ROUGH;
  }
  field.changed.length = 0;
  field.marked.fill(0);
  field.edits += 1;
  field.turns += 1;
  rebuildDistances(field, true);
  return field;
};

// The field's distance at any point, between the four cells round it; from the
// one cell it lies in where a wall is among them; 0 off the frame or on a wall.
export const readField = (field, x, y) => {
  const { cols, rows, play, phi } = field;
  if (!(x >= 0) || !(y >= 0) || x >= cols || y >= rows) return 0;
  const own = Math.floor(y) * cols + Math.floor(x);
  if (!play[own]) return 0;
  const col = Math.floor(x - 0.5);
  const row = Math.floor(y - 0.5);
  if (col < 0 || row < 0 || col >= cols - 1 || row >= rows - 1) return phi[own];
  const sw = row * cols + col;
  if (!play[sw] || !play[sw + 1] || !play[sw + cols] || !play[sw + cols + 1]) return phi[own];
  const fx = x - 0.5 - col;
  const fy = y - 0.5 - row;
  const value = (phi[sw] * (1 - fx) + phi[sw + 1] * fx) * (1 - fy) + (phi[sw + cols] * (1 - fx) + phi[sw + cols + 1] * fx) * fy;
  // Between cells of both sides the blend can come out at nothing: a point has a side.
  return value !== 0 ? value : phi[own];
};

// ---- who holds what ------------------------------------------------------------

// Whose ground a point is on: a side, or HOLDER_WALL off the frame and on a wall.
export const holderAtPoint = (field, x, y) => {
  if (!(x >= 0) || !(y >= 0) || x >= field.cols || y >= field.rows) return HOLDER_WALL;
  return field.holders[Math.floor(y) * field.cols + Math.floor(x)];
};

// The cell a side holds that is nearest a point, looked for out to `reach`
// cells; -1 when it holds none that near. Of two equally near, the lower cell.
export const nearestHeld = (field, side, x, y, reach) => {
  const { cols, rows, holders } = field;
  const col = Math.floor(x);
  const row = Math.floor(y);
  let best = -1;
  let bestDistance = Infinity;
  for (let ring = 0; ring <= reach; ring += 1) {
    if (ring > 1 && bestDistance < (ring - 1) * (ring - 1)) break;
    for (let dy = -ring; dy <= ring; dy += 1) {
      const at = row + dy;
      if (at < 0 || at >= rows) continue;
      const edge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx += edge ? 1 : Math.max(1, ring * 2)) {
        const across = col + dx;
        if (across < 0 || across >= cols || holders[at * cols + across] !== side) continue;
        const ox = across + 0.5 - x;
        const oy = at + 0.5 - y;
        const distance = ox * ox + oy * oy;
        const index = at * cols + across;
        if (distance < bestDistance || (distance === bestDistance && index < best)) {
          bestDistance = distance;
          best = index;
        }
      }
    }
  }
  return best;
};

// The cell of its own side's ground a troop at a point stands on: the cell it
// is in, or where the line runs through that cell and the cell is the other
// side's, the cell of its own beside it. -1 when it has none within a cell.
export const ownCell = (field, side, x, y) => {
  if (!(x >= 0) || !(y >= 0) || x >= field.cols || y >= field.rows) return -1;
  const cell = Math.floor(y) * field.cols + Math.floor(x);
  return field.holders[cell] === side ? cell : nearestHeld(field, side, x, y, 1);
};

// The connected bodies of ground one side holds (cells joined edge to edge):
// label[cell] is the body a cell belongs to, -1 where the side does not hold
// it; bodies are numbered in the order their first cell is met. Worked out once
// for each state of the holders.
export const bodiesOf = (field, side) => {
  field.bodies ??= [null, null];
  const known = field.bodies[side];
  if (known && known.turns === field.turns) return known;
  const { cols, rows, size, holders } = field;
  const label = new Int32Array(size).fill(-1);
  const sizes = [];
  const queue = new Int32Array(size);
  for (let seed = 0; seed < size; seed += 1) {
    if (holders[seed] !== side || label[seed] >= 0) continue;
    const body = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    label[seed] = body;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const col = index % cols;
      const row = (index - col) / cols;
      if (row > 0 && holders[index - cols] === side && label[index - cols] < 0) {
        label[index - cols] = body;
        queue[tail] = index - cols;
        tail += 1;
      }
      if (col > 0 && holders[index - 1] === side && label[index - 1] < 0) {
        label[index - 1] = body;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (col < cols - 1 && holders[index + 1] === side && label[index + 1] < 0) {
        label[index + 1] = body;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (row < rows - 1 && holders[index + cols] === side && label[index + cols] < 0) {
        label[index + cols] = body;
        queue[tail] = index + cols;
        tail += 1;
      }
    }
    sizes.push(tail);
  }
  const bodies = { turns: field.turns, label, sizes, count: sizes.length };
  field.bodies[side] = bodies;
  return bodies;
};

// How many cells each side holds.
export const countHolders = (field) => {
  const held = [0, 0];
  for (let index = 0; index < field.size; index += 1) {
    const holder = field.holders[index];
    if (holder === HOLDER_SIDE_A || holder === HOLDER_SIDE_B) held[holder] += 1;
  }
  return held;
};

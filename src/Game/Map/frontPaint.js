/*! Open Historia — battlefields on the map: the ground troops have taken, as paint © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// There is no front line on the map. A troop takes the ground around the way
// it walks, and that ground is drawn in its country's colour: the front is
// where the colours meet. A battlefield's replay keeps the painted ground as
// its run began and every cell that changed afterwards with its time
// (runtime/fronts/replay.js). This plays that to any moment of the run and
// turns it into pixels, a few to a cell, for a picture laid over the
// battlefield's frame (FrontLayers.jsx). Pure, and loads in plain Node.
//
// A cell is taken at one moment, but its colour GROWS into it over the part of
// a day after, and the picture is drawn finer than the cells with the edge
// placed between them by how far each is the one side's or the other's. So the
// colour spreads round a troop as it goes instead of arriving a square at a
// time, and an edge that runs aslant across the cells is drawn as a slant.
//
// The cells know the sea, and the land of countries outside the war, only by
// the square: a cell is one or the other. The land does not end on squares.
// So the picture may be given a MASK, a byte a pixel, of where the
// battlefield's land really is (FrontLayers.jsx makes it from the regions the
// map has drawn): the colour is cut to it, and runs out over the cells that
// count as sea to reach it. With no mask the colour ends on the squares.

import { PAINT_OWN_A, PAINT_OWN_B, PAINT_TICKS_PER_DAY, PAINT_WALL } from "../../runtime/fronts/codec.js";
import { projectorOf } from "../../runtime/fronts/frame.js";

// How long, in days, a cell takes to fill once it is taken.
export const FILL_DAYS = 0.75;
// How wide the soft step across the edge of the colour is, as a part of the
// way from all one side's to all the other's.
const EDGE_HALF_WIDTH = 0.1;
const LONG_AGO = -1e6;

const isPaint = (value) => value !== PAINT_OWN_A && value !== PAINT_OWN_B && value !== PAINT_WALL;

// The painted ground of a battlefield (record.js frontViewOf), to be played:
//
//   state[cell]   what the cell is now: a side's own ground, painted in a
//                 name (1 + its index in `names`), or wall
//   since[cell]   the day it became so
//   was[cell]     what it was before that
//   bounds        the cells that are painted at any time in the run, as
//                 { minCol, maxCol, minRow, maxRow }, or null when none is
//   sideOf(state) which side a state is the ground of: 0 or 1
export const createPaintPlayer = (view) => {
  const { cols, rows } = view.frame;
  const paint = view.replay?.paint ?? null;
  const size = cols * rows;
  const state = new Uint8Array(size);
  const since = new Float32Array(size);
  const was = new Uint8Array(size);
  // The names are side 0's members and then side 1's.
  const firstOfB = (view.sides?.[0]?.length ?? 0) + 1;
  let applied = 0;
  let day = -Infinity;
  let besideCells = null;

  let bounds = null;
  const reach = (cell) => {
    const col = cell % cols;
    const row = (cell - col) / cols;
    if (!bounds) bounds = { minCol: col, maxCol: col, minRow: row, maxRow: row };
    else {
      if (col < bounds.minCol) bounds.minCol = col;
      if (col > bounds.maxCol) bounds.maxCol = col;
      if (row < bounds.minRow) bounds.minRow = row;
      if (row > bounds.maxRow) bounds.maxRow = row;
    }
  };
  if (paint) {
    const began = paint.began;
    for (let cell = 0; cell < size && cell < began.length; cell += 1) if (isPaint(began[cell])) reach(cell);
    for (let index = 0; index < paint.cells.length; index += 1) if (paint.cells[index] < size) reach(paint.cells[index]);
  }

  const reset = () => {
    if (paint) state.set(paint.began.subarray(0, size));
    else state.fill(PAINT_WALL);
    was.set(state);
    since.fill(LONG_AGO);
    applied = 0;
  };
  reset();

  return {
    cols,
    rows,
    names: paint?.names ?? [],
    state,
    since,
    was,
    sideOf: (value) => (value === PAINT_OWN_A ? 0 : value === PAINT_OWN_B ? 1 : value < firstOfB ? 0 : 1),
    // For a cell that counts as sea or as land outside the war: the cell of
    // the battlefield's land nearest it, if one lies beside it, else -1. Land
    // that the land's own shape puts in such a cell is painted as that
    // neighbour is. (What counts as sea never changes in a run.)
    get beside() {
      if (besideCells) return besideCells;
      besideCells = new Int32Array(size).fill(-1);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const cell = row * cols + col;
          if (state[cell] !== PAINT_WALL) continue;
          let nearest = 9;
          for (let dy = -1; dy <= 1; dy += 1) {
            const r = row + dy;
            if (r < 0 || r >= rows) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const c = col + dx;
              if ((dx === 0 && dy === 0) || c < 0 || c >= cols || state[r * cols + c] === PAINT_WALL) continue;
              if (dx * dx + dy * dy < nearest) {
                nearest = dx * dx + dy * dy;
                besideCells[cell] = r * cols + c;
              }
            }
          }
        }
      }
      return besideCells;
    },
    get bounds() { return bounds; },
    get day() { return day; },
    // Brings the ground to a day of the run (a fraction of a day is fine).
    seek(to) {
      if (!paint) return;
      if (to < day) reset();
      day = to;
      const tick = to * PAINT_TICKS_PER_DAY;
      while (applied < paint.cells.length && paint.ticks[applied] <= tick) {
        const cell = paint.cells[applied];
        if (cell < size) {
          was[cell] = state[cell];
          state[cell] = paint.states[applied];
          since[cell] = paint.ticks[applied] / PAINT_TICKS_PER_DAY;
        }
        applied += 1;
      }
    },
  };
};

// How many pixels to a cell: enough for a smooth edge, and no more than a
// picture about a thousand pixels across.
export const paintScaleFor = (cols, rows) => Math.max(2, Math.min(6, Math.floor(1024 / Math.max(cols, rows, 1))));

// Whether a picture the map already has can take another run of the same
// battlefield: it is the size the frame asks for and lies on the same ground.
// The map is given a picture's canvas once, by its size and place, and goes on
// reading that canvas: a new run has to be played on it (FrontLayers.jsx).
//   picture   { canvas: { width, height }, coordinates: [[west, north], [east, north], [east, south], [west, south]] }
export const pictureFits = (picture, frame) => {
  if (!picture?.canvas || !Array.isArray(picture.coordinates) || !frame) return false;
  const scale = paintScaleFor(frame.cols, frame.rows);
  if (picture.canvas.width !== frame.cols * scale || picture.canvas.height !== frame.rows * scale) return false;
  const { toLngLat } = projectorOf(frame);
  const [west, north] = toLngLat(0, frame.rows);
  const [east, south] = toLngLat(frame.cols, 0);
  const [[haveWest, haveNorth], , [haveEast, haveSouth]] = picture.coordinates;
  return haveWest === west && haveNorth === north && haveEast === east && haveSouth === south;
};

// A picture's land mask (`target.mask` below), written into `mask`: inside the window [x0, x1) by [y0, y1)
// it is the alpha of `shape` (RGBA of that window alone), elsewhere 255 on any cell but a wall.
export const landMask = (mask, { width, height, scale, cols, rows, state, shape, x0, x1, y0, y1 }) => {
  const seenWidth = x1 - x0;
  const colOf = new Int32Array(width);
  for (let x = 0; x < width; x += 1) colOf[x] = Math.min(cols - 1, Math.floor(x / scale));
  let lastRow = -1;
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(rows - 1, Math.max(0, Math.floor(rows - (y + 0.5) / scale)));
    const seen = y >= y0 && y < y1;
    const line = y * width;
    // Off the window a row is the cells' alone, the same as the row above it in the same cell row.
    if (!seen && row === lastRow) {
      mask.copyWithin(line, line - width, line);
      continue;
    }
    const base = row * cols;
    for (let x = 0; x < width; x += 1) {
      if (seen && x >= x0 && x < x1) mask[line + x] = shape[((y - y0) * seenWidth + x - x0) * 4 + 3];
      else mask[line + x] = state[base + colOf[x]] === PAINT_WALL ? 0 : 255;
    }
    lastRow = seen ? -1 : row;
  }
  return mask;
};

// The painted ground at the player's day, written into `target.data` (RGBA,
// `target.width` by `target.height`, north up, `target.scale` pixels a cell).
// `palette` holds four bytes a state: its colour, and how solid it is drawn.
// `target.rowOf[y]`, when given, is where in the frame (in rows from its south
// edge) the middle of pixel row y lies, for a frame whose rows are not evenly
// spaced on the map; left out, they are. `only`, when given, is the cells to
// draw, as { minCol, maxCol, minRow, maxRow }: the rest of the picture is left
// as it is. `target.mask`, when given, is a byte a pixel: how much of that
// pixel is the battlefield's land (0 none of it, 255 all). Returns the pixels
// written, as { x, y, width, height }, or null when nothing is painted in
// this run.
//
// Every cell of land is one side's or the other's, or on its way from one to
// the other, and the edge of the colour is drawn where that crosses half-way.
// So paint ends against the other side's ground in a smooth edge, but against
// its own side's home ground it does not end at all: it runs on a little way
// over that ground, which is the same colour, and leaves no sliver of the
// other side's colour along the old border.
export const paintPixels = (player, palette, target, only = null) => {
  const { cols, rows, state, since, was, bounds, day, sideOf } = player;
  if (!bounds) return null;
  const { data, width, height, scale, rowOf, mask } = target;
  const size = cols * rows;
  const beside = mask ? player.beside : null;

  // A part drawn alone is drawn two cells wider than asked: a cell's colour
  // reaches half a cell past it, and its edge is placed by the cells round it.
  const minCol = Math.max(0, Math.max(bounds.minCol - 1, only ? only.minCol - 2 : 0));
  const maxCol = Math.min(cols - 1, Math.min(bounds.maxCol + 1, only ? only.maxCol + 2 : cols));
  const minRow = Math.max(0, Math.max(bounds.minRow - 1, only ? only.minRow - 2 : 0));
  const maxRow = Math.min(rows - 1, Math.min(bounds.maxRow + 1, only ? only.maxRow + 2 : rows));
  if (minCol > maxCol || minRow > maxRow) return null;
  if (!target.share || target.share.length !== size) {
    // How far each cell is side 0's (1) and not side 1's (0); the same evened
    // out; the colour it is painted in, if any; and how full of it it is.
    target.share = new Float32Array(size);
    target.even = new Float32Array(size);
    target.tint = new Uint8Array(size);
    target.full = new Float32Array(size);
  }
  const { share, even, tint, full } = target;
  // A pixel is drawn from the cells round it, evened out, and a cell is
  // evened out with the cells round IT: so cells are evened out one further
  // out than is drawn, and read two further out. A part drawn alone then
  // comes out exactly as it would in the whole picture.
  const fromCol = Math.max(0, minCol - 1);
  const toCol = Math.min(cols - 1, maxCol + 1);
  const fromRow = Math.max(0, minRow - 1);
  const toRow = Math.min(rows - 1, maxRow + 1);
  const readFromCol = Math.max(0, minCol - 2);
  const readToCol = Math.min(cols - 1, maxCol + 2);
  const readFromRow = Math.max(0, minRow - 2);
  const readToRow = Math.min(rows - 1, maxRow + 2);
  for (let row = readFromRow; row <= readToRow; row += 1) {
    for (let col = readFromCol; col <= readToCol; col += 1) {
      const cell = row * cols + col;
      const now = state[cell];
      if (now === PAINT_WALL) {
        tint[cell] = PAINT_WALL;
        full[cell] = 0;
        share[cell] = 0;
        continue;
      }
      const before = was[cell];
      const part = (day - since[cell]) / FILL_DAYS;
      // How far the change to what it is now has got: all the way, unless it
      // changed sides a moment ago.
      const turned = before !== PAINT_WALL && sideOf(before) !== sideOf(now) && part < 1 ? Math.max(0, part) : 1;
      share[cell] = sideOf(now) === 0 ? turned : 1 - turned;
      if (isPaint(now)) {
        tint[cell] = now;
        full[cell] = turned;
      } else if (isPaint(before) && turned < 1) {
        // Taken back: the colour it was painted in drains out of it.
        tint[cell] = before;
        full[cell] = 1 - turned;
      } else {
        tint[cell] = 0;
        full[cell] = 0;
      }
    }
  }
  // Each cell evened out with the eight round it, so that an edge that runs
  // aslant across the cells is drawn as a slant and not as a stair. Sea has no
  // say: a cell beside it is evened out with the land round it only, and the
  // colour runs full to the coast.
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) {
      const cell = row * cols + col;
      if (tint[cell] === PAINT_WALL) {
        even[cell] = 0;
        continue;
      }
      let sum = share[cell] * 4;
      let weight = 4;
      for (let dy = -1; dy <= 1; dy += 1) {
        const r = row + dy;
        if (r < readFromRow || r > readToRow) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const c = col + dx;
          if ((dx === 0 && dy === 0) || c < readFromCol || c > readToCol) continue;
          const other = r * cols + c;
          if (tint[other] === PAINT_WALL) continue;
          const part = dx === 0 || dy === 0 ? 2 : 1;
          sum += share[other] * part;
          weight += part;
        }
      }
      even[cell] = sum / weight;
    }
  }

  const x0 = minCol * scale;
  const x1 = Math.min(width, (maxCol + 1) * scale);
  // Pixel rows run from the north; the frame's rows from the south. Where the
  // rows are not evenly spaced there is no telling which pixel rows they
  // fill without asking each, so all are drawn.
  const y0 = rowOf ? 0 : Math.max(0, height - (maxRow + 1) * scale);
  const y1 = rowOf ? height : Math.min(height, height - minRow * scale);
  const low = 0.5 - EDGE_HALF_WIDTH;
  const span = EDGE_HALF_WIDTH * 2;
  for (let y = y0; y < y1; y += 1) {
    const v = rowOf ? rowOf[y] : rows - (y + 0.5) / scale;
    const ownRow = Math.floor(v);
    const at = y * width * 4;
    if (ownRow < minRow || ownRow > maxRow) {
      // Outside what is painted there is nothing; outside a part drawn alone
      // the picture is left as it is.
      if (!only) for (let x = x0; x < x1; x += 1) data[at + x * 4 + 3] = 0;
      continue;
    }
    // The two rows of cells whose middles the pixel lies between.
    const rowA = Math.max(fromRow, Math.min(toRow, Math.floor(v - 0.5)));
    const rowB = Math.max(fromRow, Math.min(toRow, rowA + 1));
    const fv = Math.max(0, Math.min(1, v - 0.5 - rowA));
    for (let x = x0; x < x1; x += 1) {
      const u = (x + 0.5) / scale;
      const ownCol = Math.floor(u);
      const pixel = at + x * 4;
      let own = ownRow * cols + ownCol;
      // How much of this pixel is the battlefield's land: all of it, going by
      // the cells alone; going by the mask, what the land's own shape gives.
      const land = mask ? mask[y * width + x] : 255;
      if (land === 0) {
        data[pixel + 3] = 0;
        continue;
      }
      // Sea, and land that is nobody's in this war, is never painted. But a
      // cell that counts as such may have the battlefield's land in it, where
      // the land's edge crosses the cell: that is painted as the cell of land
      // beside it is.
      if (tint[own] === PAINT_WALL) {
        const stand = beside ? beside[own] : -1;
        if (stand < 0 || tint[stand] === PAINT_WALL) {
          data[pixel + 3] = 0;
          continue;
        }
        own = stand;
      }
      const colA = Math.max(fromCol, Math.min(toCol, Math.floor(u - 0.5)));
      const colB = Math.max(fromCol, Math.min(toCol, colA + 1));
      const fu = Math.max(0, Math.min(1, u - 0.5 - colA));
      const c00 = rowA * cols + colA;
      const c10 = rowA * cols + colB;
      const c01 = rowB * cols + colA;
      const c11 = rowB * cols + colB;
      // The colour is that of the fullest painted cell of the four round the
      // pixel, its own first. With none of them painted there is no paint here.
      let best = full[own] > 0 ? own : -1;
      let most = best >= 0 ? full[own] : 0;
      if (full[c00] > most) { best = c00; most = full[c00]; }
      if (full[c10] > most) { best = c10; most = full[c10]; }
      if (full[c01] > most) { best = c01; most = full[c01]; }
      if (full[c11] > most) { best = c11; most = full[c11]; }
      if (best < 0) {
        data[pixel + 3] = 0;
        continue;
      }
      // A neighbour that is sea says nothing: the colour runs to the coast
      // as it stands in the pixel's own cell.
      const e00 = tint[c00] === PAINT_WALL ? even[own] : even[c00];
      const e10 = tint[c10] === PAINT_WALL ? even[own] : even[c10];
      const e01 = tint[c01] === PAINT_WALL ? even[own] : even[c01];
      const e11 = tint[c11] === PAINT_WALL ? even[own] : even[c11];
      const sideZero = (e00 * (1 - fu) + e10 * fu) * (1 - fv) + (e01 * (1 - fu) + e11 * fu) * fv;
      const colourState = tint[best];
      const value = sideOf(colourState) === 0 ? sideZero : 1 - sideZero;
      if (value <= low) {
        data[pixel + 3] = 0;
        continue;
      }
      let solid = (value - low) / span;
      if (solid > 1) solid = 1;
      // A smooth step, so the edge is neither a stair nor a blur.
      solid = solid * solid * (3 - 2 * solid);
      const colour = colourState * 4;
      data[pixel] = palette[colour];
      data[pixel + 1] = palette[colour + 1];
      data[pixel + 2] = palette[colour + 2];
      data[pixel + 3] = land === 255 ? Math.round(palette[colour + 3] * solid) : Math.round((palette[colour + 3] * solid * land) / 255);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

// ---- the front, as the map draws its border ----------------------------------
//
// Where one side's ground meets the other's, the map draws a border
// (frontGroundLayer.js), traced from the same thing the colour's edge is: how
// far each cell is one side's or the other's at the day shown, evened out with
// the cells round it. Read between the cells' middles that is a smooth field,
// and the border is where it is half-way. Only the two sides' ground has a say
// in it: sea and land that is nobody's in this war take the value of the land
// beside them, so no border is drawn along a coast or against a neutral's
// land, and none along the frame's edge.

// The cells the run paints at any time (as it began, or as it changes), with
// the cells within `reach` of them: where the border is the battlefield's to
// draw, and the map's own borders give way to it. Elsewhere in the frame the
// sides' ground lies as it always has, and the map's own border runs there.
export const touchedCells = (view, reach = 2) => {
  const { cols, rows } = view.frame;
  const size = cols * rows;
  const out = new Uint8Array(size);
  const paint = view.replay?.paint ?? null;
  if (!paint) return out;
  const touched = [];
  for (let cell = 0; cell < size && cell < paint.began.length; cell += 1) if (isPaint(paint.began[cell])) touched.push(cell);
  for (let index = 0; index < paint.cells.length; index += 1) if (paint.cells[index] < size) touched.push(paint.cells[index]);
  for (const cell of touched) {
    const col = cell % cols;
    const row = (cell - col) / cols;
    for (let r = Math.max(0, row - reach); r <= Math.min(rows - 1, row + reach); r += 1) {
      for (let c = Math.max(0, col - reach); c <= Math.min(cols - 1, col + reach); c += 1) out[r * cols + c] = 1;
    }
  }
  return out;
};

// The field as a picture: a pixel a cell (north up), or for a frame whose rows
// are not even on the map (`rowOf`, as the battlefield's picture has it) a
// pixel row for each of the picture's. Red is how far the ground is side 1's
// (0 to 255), green 255 where the border may be drawn (`touched`, and only on
// a day the battlefield is shown), blue 255 on the two sides' ground.
export const createFrontField = (cols, rows, rowOf = null, touched = null) => {
  const height = rowOf ? rowOf.length : rows;
  return {
    data: new Uint8Array(cols * height * 4),
    width: cols,
    height,
    rows,
    rowOf,
    touched: touched ?? new Uint8Array(cols * rows),
    share: new Float32Array(cols * rows),
    even: new Float32Array(cols * rows),
    version: 0,
  };
};

// The field at the player's day, written into `front` (createFrontField).
export const writeFrontField = (player, front, shown = true) => {
  const { cols, rows, state, was, since, day, sideOf } = player;
  const { data, width, height, rowOf, touched, share, even } = front;
  const size = cols * rows;
  // How far each cell is side 1's, on its way from one side to the other as it is taken.
  for (let cell = 0; cell < size; cell += 1) {
    const now = state[cell];
    if (now === PAINT_WALL) {
      share[cell] = -1;
      continue;
    }
    const before = was[cell];
    const part = (day - since[cell]) / FILL_DAYS;
    const turned = before !== PAINT_WALL && sideOf(before) !== sideOf(now) && part < 1 ? Math.max(0, part) : 1;
    share[cell] = sideOf(now) === 1 ? turned : 1 - turned;
  }
  // Evened out with the eight round it, the land only; sea and others' land
  // take the land's beside them.
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      const wall = share[cell] < 0;
      let sum = wall ? 0 : share[cell] * 4;
      let weight = wall ? 0 : 4;
      for (let dy = -1; dy <= 1; dy += 1) {
        const r = row + dy;
        if (r < 0 || r >= rows) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const c = col + dx;
          if ((dx === 0 && dy === 0) || c < 0 || c >= cols) continue;
          const value = share[r * cols + c];
          if (value < 0) continue;
          const part = dx === 0 || dy === 0 ? 2 : 1;
          sum += value * part;
          weight += part;
        }
      }
      even[cell] = weight > 0 ? sum / weight : -1;
    }
  }
  // Sea with no land beside it takes what lies before it along its row, so it
  // never reads as either side's against land a cell away.
  for (let row = 0; row < rows; row += 1) {
    let last = -1;
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      if (even[cell] >= 0) last = even[cell];
      else if (last >= 0) even[cell] = last;
    }
    for (let col = cols - 1; col >= 0; col -= 1) {
      const cell = row * cols + col;
      if (even[cell] >= 0) last = even[cell];
      else even[cell] = last >= 0 ? last : 0.5;
    }
  }
  for (let y = 0; y < height; y += 1) {
    // The frame row this pixel row shows (from the south, in cells, a cell's middle at +0.5).
    const v = rowOf ? rowOf[y] : rows - y - 0.5;
    const rowA = Math.max(0, Math.min(rows - 1, Math.floor(v - 0.5)));
    const rowB = Math.min(rows - 1, rowA + 1);
    const f = rowOf ? Math.max(0, Math.min(1, v - 0.5 - rowA)) : 0;
    for (let x = 0; x < width; x += 1) {
      const a = rowA * cols + x;
      const b = rowB * cols + x;
      const value = even[a] * (1 - f) + even[b] * f;
      const at = (y * width + x) * 4;
      data[at] = Math.round(Math.max(0, Math.min(1, value)) * 255);
      data[at + 1] = shown && (touched[a] || touched[b]) ? 255 : 0;
      data[at + 2] = share[a] >= 0 ? 255 : 0;
      data[at + 3] = 255;
    }
  }
  front.version += 1;
  return front;
};

// The four corners of a picture as the map is given them ([west, north] round
// to [west, south]), its middle within the map's own copy of the world. A
// battlefield's frame may be told in longitudes a whole turn off (one that
// reaches over the date line is): the map cannot place such a picture, and
// says so by throwing.
export const pictureCorners = (west, north, east, south) => {
  const turn = 360 * Math.round((west + east) / 2 / 360);
  return [[west - turn, north], [east - turn, north], [east - turn, south], [west - turn, south]];
};

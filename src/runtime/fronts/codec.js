/*! Open Historia — battlefields and fronts: the compact encodings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield rides in world.json, which is written whole on every turn and
// copied into every restore point, so its bulky parts are kept as short strings
// of a 64-letter alphabet rather than as arrays of numbers:
//
//   mask    who holds each cell of the frame, as runs          encodeMask
//   band    the distance to the line for the cells near it     encodeBand
//   troops  seven letters a troop                              encodeTroops
//   lines   the drawn line, three letters a vertex             encodeLines
//   tracks  a troop's path through a run, eight letters a point  encodeTracks
//
// Everything is in CELL units of the battlefield's frame (frame.js), counted
// from its south-west corner: x eastward in columns, y northward in rows. A
// cell's centre is at (column + 0.5, row + 0.5). Pure and deterministic: the
// same values always give the same string.

import { hashSeed } from "../unitMotion.js";
import { BAND_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, LINE_UNITS, TROOP_KINDS, TROOP_STATES, TROOP_UNITS } from "./constants.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE_OF = new Int8Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) VALUE_OF[ALPHABET.charCodeAt(index)] = index;

// What a packed string may contain; `;` parts the strands of a line.
export const PACKED_TEXT = /^[A-Za-z0-9_;-]*$/;

const clampInt = (value, min, max) => {
  const number = Math.round(Number(value) || 0);
  return number < min ? min : number > max ? max : number;
};

const createBitWriter = () => {
  const letters = [];
  let pending = 0;
  let bits = 0;
  return {
    write(value, width) {
      for (let shift = width - 1; shift >= 0; shift -= 1) {
        pending = (pending << 1) | ((value >>> shift) & 1);
        bits += 1;
        if (bits === 6) {
          letters.push(ALPHABET[pending]);
          pending = 0;
          bits = 0;
        }
      }
    },
    end() {
      if (bits > 0) letters.push(ALPHABET[pending << (6 - bits)]);
      pending = 0;
      bits = 0;
      return letters.join("");
    },
  };
};

// Reads past the end as zeros, and a letter outside the alphabet as zero: a
// damaged string decodes to something harmless rather than throwing.
const createBitReader = (text) => {
  const source = String(text ?? "");
  let index = 0;
  let pending = 0;
  let bits = 0;
  return {
    read(width) {
      let value = 0;
      for (let count = 0; count < width; count += 1) {
        if (bits === 0) {
          const code = index < source.length ? source.charCodeAt(index) : -1;
          index += 1;
          const letter = code >= 0 && code < 128 ? VALUE_OF[code] : -1;
          pending = letter < 0 ? 0 : letter;
          bits = 6;
        }
        bits -= 1;
        value = value * 2 + ((pending >> bits) & 1);
      }
      return value;
    },
  };
};

// ---- who holds each cell -----------------------------------------------------

// Runs in scan order (row by row from the south, west to east), two letters a
// run: the holder and how many cells, up to 1,024. A wall is stored like any
// other holder, so the mask reads without the map it was made from.
const RUN_BITS = 10;
const RUN_MAX = 1 << RUN_BITS;

export const encodeMask = (holders) => {
  const writer = createBitWriter();
  const length = holders?.length ?? 0;
  let index = 0;
  while (index < length) {
    const holder = holders[index] & 3;
    let run = 1;
    while (index + run < length && run < RUN_MAX && (holders[index + run] & 3) === holder) run += 1;
    writer.write(holder, 2);
    writer.write(run - 1, RUN_BITS);
    index += run;
  }
  return writer.end();
};

// A mask shorter than the frame leaves the rest as wall.
export const decodeMask = (text, length) => {
  const holders = new Uint8Array(Math.max(0, Math.floor(Number(length) || 0))).fill(HOLDER_WALL);
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const runs = Math.floor(source.length / 2);
  let index = 0;
  for (let run = 0; run < runs && index < holders.length; run += 1) {
    const holder = reader.read(2);
    const end = Math.min(holders.length, index + reader.read(RUN_BITS) + 1);
    holders.fill(holder > HOLDER_WALL ? HOLDER_WALL : holder, index, end);
    index = end;
  }
  return holders;
};

// The same runs, of any of four values a cell (a mask's own holders read past HOLDER_WALL as a wall): how well
// supplied each cell is (battle.js supplyLevels: 0 none, 1 supplied, 2 stretched, 3 cut off).
export const decodeFourMask = (text, length) => {
  const values = new Uint8Array(Math.max(0, Math.floor(Number(length) || 0)));
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const runs = Math.floor(source.length / 2);
  let index = 0;
  for (let run = 0; run < runs && index < values.length; run += 1) {
    const value = reader.read(2);
    const end = Math.min(values.length, index + reader.read(RUN_BITS) + 1);
    values.fill(value, index, end);
    index = end;
  }
  return values;
};

// The cells whose distance to the line is kept: held by one side, with a cell
// of the other within `reach` cells of it in each direction. In scan order,
// which is the order the band's values are stored in, so no index is saved.
export const bandIndices = (holders, cols, rows, reach = BAND_CELLS) => {
  const size = cols * rows;
  const near = (side) => {
    const along = new Uint8Array(size);
    for (let row = 0; row < rows; row += 1) {
      const base = row * cols;
      let last = -Infinity;
      for (let col = 0; col < cols; col += 1) {
        if (holders[base + col] === side) last = col;
        if (col - last <= reach) along[base + col] = 1;
      }
      let next = Infinity;
      for (let col = cols - 1; col >= 0; col -= 1) {
        if (holders[base + col] === side) next = col;
        if (next - col <= reach) along[base + col] = 1;
      }
    }
    const hit = new Uint8Array(size);
    for (let col = 0; col < cols; col += 1) {
      let last = -Infinity;
      for (let row = 0; row < rows; row += 1) {
        if (along[row * cols + col]) last = row;
        if (row - last <= reach) hit[row * cols + col] = 1;
      }
      let next = Infinity;
      for (let row = rows - 1; row >= 0; row -= 1) {
        if (along[row * cols + col]) next = row;
        if (next - row <= reach) hit[row * cols + col] = 1;
      }
    }
    return hit;
  };
  const nearA = near(HOLDER_SIDE_A);
  const nearB = near(HOLDER_SIDE_B);
  const cells = [];
  for (let index = 0; index < size; index += 1) {
    const holder = holders[index];
    if ((holder === HOLDER_SIDE_A && nearB[index]) || (holder === HOLDER_SIDE_B && nearA[index])) cells.push(index);
  }
  return Int32Array.from(cells);
};

// One whole number a cell, -127 to 127, in the order bandIndices gives.
export const encodeBand = (values) => {
  const writer = createBitWriter();
  const length = values?.length ?? 0;
  for (let index = 0; index < length; index += 1) writer.write(clampInt(values[index], -127, 127) + 128, 8);
  return writer.end();
};

export const decodeBand = (text, count) => {
  const size = Math.max(0, Math.floor(Number(count) || 0));
  const values = new Int8Array(size);
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const stored = Math.min(size, Math.floor((source.length * 6) / 8));
  for (let index = 0; index < stored; index += 1) values[index] = clampInt(reader.read(8) - 128, -127, 127);
  return values;
};

// ---- troops ------------------------------------------------------------------

// Seven letters a troop, so a side's string is cut cleanly at any multiple of
// seven: x and y to 1/16 of a cell, strength as 0-100, kind as an index into
// TROOP_KINDS, owner as an index into its side's list of members, whether it is
// a named formation, how dug in it is (0-1, in sevenths), and state as an
// index into TROOP_STATES (three bits: up to eight states).
export const TROOP_LETTERS = 7;

const indexIn = (list, value) => {
  if (typeof value === "number") return value;
  const index = list.indexOf(String(value ?? ""));
  return index < 0 ? 0 : index;
};

export const encodeTroops = (troops) => {
  const writer = createBitWriter();
  for (const troop of Array.isArray(troops) ? troops : []) {
    writer.write(clampInt((Number(troop?.x) || 0) * TROOP_UNITS, 0, 4095), 12);
    writer.write(clampInt((Number(troop?.y) || 0) * TROOP_UNITS, 0, 4095), 12);
    writer.write(clampInt(((Number(troop?.strength) || 0) * 63) / 100, 0, 63), 6);
    writer.write(clampInt(indexIn(TROOP_KINDS, troop?.kind), 0, TROOP_KINDS.length - 1), 2);
    writer.write(clampInt(troop?.owner, 0, 7), 3);
    writer.write(troop?.named ? 1 : 0, 1);
    writer.write(clampInt((Number(troop?.dig) || 0) * 7, 0, 7), 3);
    writer.write(clampInt(indexIn(TROOP_STATES, troop?.state), 0, TROOP_STATES.length - 1), 3);
  }
  return writer.end();
};

export const decodeTroops = (text) => {
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const troops = [];
  const count = Math.floor(source.length / TROOP_LETTERS);
  for (let index = 0; index < count; index += 1) {
    const x = reader.read(12) / TROOP_UNITS;
    const y = reader.read(12) / TROOP_UNITS;
    const strength = (reader.read(6) * 100) / 63;
    const kind = Math.min(TROOP_KINDS.length - 1, reader.read(2));
    const owner = reader.read(3);
    const named = reader.read(1) === 1;
    const dig = reader.read(3) / 7;
    const state = Math.min(TROOP_STATES.length - 1, reader.read(3));
    troops.push({ x, y, strength, kind, owner, named, dig, state });
  }
  return troops;
};

// ---- levels ------------------------------------------------------------------

// A value from 0 to 1 a letter, in 63rds: a troop's fatigue (fatigue.js), a
// string a side, in the order of its troops. A letter outside the alphabet reads as 0.
export const encodeLevels = (values) => {
  let text = "";
  for (const value of Array.isArray(values) ? values : []) text += ALPHABET[clampInt((Number(value) || 0) * 63, 0, 63)];
  return text;
};

export const decodeLevels = (text) => {
  const source = String(text ?? "");
  const values = [];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    const value = code < 128 ? VALUE_OF[code] : -1;
    values.push(value > 0 ? value / 63 : 0);
  }
  return values;
};

// ---- the drawn line ----------------------------------------------------------

// A strand is a run of the line: open where it ends on a coast or a country
// outside the war, closed round a pocket or a beachhead. Six letters for the
// first vertex and whether it is closed, three for each after it: the step from
// the vertex before, to 1/32 of a cell, and how that stretch is marked
// (constants.js LINE_*). A step too long for one entry is walked in equal parts.
// Strands are parted by `;`.
const LINE_MAX = (1 << 13) - 1;
const STEP_MAX = 127;
const lineUnit = (value) => clampInt((Number(value) || 0) * LINE_UNITS, 0, LINE_MAX);

const encodeStrand = (strand) => {
  const points = Array.isArray(strand?.points) ? strand.points : [];
  if (points.length === 0) return "";
  const flags = strand?.flags;
  const writer = createBitWriter();
  let x = lineUnit(points[0][0]);
  let y = lineUnit(points[0][1]);
  writer.write(strand?.closed ? 1 : 0, 1);
  writer.write(0, 5);
  writer.write(x, 13);
  writer.write(y, 13);
  writer.write((flags?.[0] ?? 0) & 3, 2);
  writer.write(0, 2);
  for (let index = 1; index < points.length; index += 1) {
    const toX = lineUnit(points[index][0]);
    const toY = lineUnit(points[index][1]);
    if (toX === x && toY === y) continue;
    const flag = (flags?.[index] ?? 0) & 3;
    const fromX = x;
    const fromY = y;
    const parts = Math.ceil(Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)) / STEP_MAX);
    for (let part = 1; part <= parts; part += 1) {
      const nextX = part === parts ? toX : Math.round(fromX + ((toX - fromX) * part) / parts);
      const nextY = part === parts ? toY : Math.round(fromY + ((toY - fromY) * part) / parts);
      writer.write(nextX - x + 128, 8);
      writer.write(nextY - y + 128, 8);
      writer.write(flag, 2);
      x = nextX;
      y = nextY;
    }
  }
  return writer.end();
};

const decodeStrand = (text) => {
  if (text.length < 6) return null;
  const reader = createBitReader(text);
  const closed = reader.read(1) === 1;
  reader.read(5);
  let x = reader.read(13);
  let y = reader.read(13);
  const points = [[x / LINE_UNITS, y / LINE_UNITS]];
  const flags = [reader.read(2)];
  reader.read(2);
  const more = Math.floor((text.length - 6) / 3);
  for (let index = 0; index < more; index += 1) {
    x += reader.read(8) - 128;
    y += reader.read(8) - 128;
    points.push([x / LINE_UNITS, y / LINE_UNITS]);
    flags.push(reader.read(2));
  }
  return { closed, points, flags };
};

export const encodeLines = (strands) =>
  (Array.isArray(strands) ? strands : []).map(encodeStrand).filter(Boolean).join(";");

export const decodeLines = (text) =>
  String(text ?? "").split(";").map(decodeStrand).filter(Boolean);

// ---- tracks --------------------------------------------------------------------

// Where a troop was through a run, as the points the replay keeps of its path
// (replay.js). Eight letters a point: the day of the run, x and y to 1/16 of a
// cell, its strength (0-100) and its state as an index into TROOP_STATES. A
// side's troops are parted by `;` in the order of its list, so a troop with no
// point still holds its place.
export const TRACK_LETTERS = 8;
export const TRACK_DAY_MAX = 4095;

const encodeTrack = (samples) => {
  const writer = createBitWriter();
  for (const sample of Array.isArray(samples) ? samples : []) {
    writer.write(clampInt(sample?.day, 0, TRACK_DAY_MAX), 12);
    writer.write(clampInt((Number(sample?.x) || 0) * TROOP_UNITS, 0, 4095), 12);
    writer.write(clampInt((Number(sample?.y) || 0) * TROOP_UNITS, 0, 4095), 12);
    writer.write(clampInt(sample?.strength, 0, 100), 7);
    writer.write(clampInt(indexIn(TROOP_STATES, sample?.state), 0, TROOP_STATES.length - 1), 3);
    writer.write(0, 2);
  }
  return writer.end();
};

const decodeTrack = (text) => {
  const reader = createBitReader(text);
  const samples = [];
  const count = Math.floor(text.length / TRACK_LETTERS);
  for (let index = 0; index < count; index += 1) {
    const day = reader.read(12);
    const x = reader.read(12) / TROOP_UNITS;
    const y = reader.read(12) / TROOP_UNITS;
    const strength = Math.min(100, reader.read(7));
    const state = Math.min(TROOP_STATES.length - 1, reader.read(3));
    reader.read(2);
    samples.push({ day, x, y, strength, state });
  }
  return samples;
};

export const encodeTracks = (tracks) => (Array.isArray(tracks) ? tracks : []).map(encodeTrack).join(";");

export const decodeTracks = (text) => {
  const source = String(text ?? "");
  return source === "" ? [] : source.split(";").map(decodeTrack);
};

// ---- painted ground --------------------------------------------------------------

// What the map draws as taken ground (replay.js). A cell's state is
// PAINT_OWN_A or PAINT_OWN_B for ground a side holds at home (not painted: the
// map draws it as its region's own, but it is known whose it is), 1 + an index
// into the replay's list of names for ground painted in that name, and
// PAINT_WALL for sea and for land that is nobody's in this war. As runs in
// scan order, three letters a run: the state and how many cells, up to 8,192.
const STATE_BITS = 5;
const STATE_RUN_BITS = 13;
const STATE_RUN_MAX = 1 << STATE_RUN_BITS;
export const PAINT_OWN_A = 0;
export const PAINT_WALL = (1 << STATE_BITS) - 1;
export const PAINT_OWN_B = PAINT_WALL - 1;
// How many names ground can be painted in: every state between the two own
// grounds.
export const PAINT_NAMES_MAX = PAINT_OWN_B - 1;

export const encodeStates = (states) => {
  const writer = createBitWriter();
  const length = states?.length ?? 0;
  let index = 0;
  while (index < length) {
    const state = states[index] & PAINT_WALL;
    let run = 1;
    while (index + run < length && run < STATE_RUN_MAX && (states[index + run] & PAINT_WALL) === state) run += 1;
    writer.write(state, STATE_BITS);
    writer.write(run - 1, STATE_RUN_BITS);
    index += run;
  }
  return writer.end();
};

// Text shorter than the frame leaves the rest as wall.
export const decodeStates = (text, length) => {
  const states = new Uint8Array(Math.max(0, Math.floor(Number(length) || 0))).fill(PAINT_WALL);
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const runs = Math.floor(source.length / 3);
  let index = 0;
  for (let run = 0; run < runs && index < states.length; run += 1) {
    const state = reader.read(STATE_BITS);
    const end = Math.min(states.length, index + reader.read(STATE_RUN_BITS) + 1);
    states.fill(state, index, end);
    index = end;
  }
  return states;
};

// The changes of that ground through a run, in order of time, six letters an
// entry: how many ticks after the entry before it (a tick is a sixteenth of a
// day), a cell, its new state, and how many cells in a row from it changed to
// that state at that tick (a troop's brush takes ground a strip at a time, so
// neighbours along a row mostly go together). A wait too long for one entry
// is spent in entries that change nothing.
export const PAINT_TICKS_PER_DAY = 16;
export const PAINT_LETTERS = 6;
const PAINT_WAIT = 63;
const PAINT_NO_CELL = 0xffff;
const PAINT_RUN_BITS = 6;
const PAINT_RUN_MAX = 1 << PAINT_RUN_BITS;

export const encodePaint = (changes) => {
  const writer = createBitWriter();
  const list = Array.isArray(changes) ? changes : [];
  let at = 0;
  let index = 0;
  while (index < list.length) {
    const tick = Math.max(at, clampInt(list[index]?.tick, 0, 0x7fffffff));
    const cell = clampInt(list[index]?.cell, 0, PAINT_NO_CELL - 1);
    const state = clampInt(list[index]?.state, 0, PAINT_WALL);
    let run = 1;
    while (
      index + run < list.length && run < PAINT_RUN_MAX
      && clampInt(list[index + run]?.cell, 0, PAINT_NO_CELL - 1) === cell + run
      && clampInt(list[index + run]?.state, 0, PAINT_WALL) === state
      && Math.max(tick, clampInt(list[index + run]?.tick, 0, 0x7fffffff)) === tick
    ) run += 1;
    while (tick - at >= PAINT_WAIT) {
      writer.write(PAINT_WAIT, 6);
      writer.write(PAINT_NO_CELL, 16);
      writer.write(0, 14);
      at += PAINT_WAIT;
    }
    writer.write(tick - at, 6);
    writer.write(cell, 16);
    writer.write(state, STATE_BITS);
    writer.write(run - 1, PAINT_RUN_BITS);
    writer.write(0, 3);
    at = tick;
    index += run;
  }
  return writer.end();
};

// As three lists of one length, a cell an entry: when (in ticks from the run's
// first day), which cell, and what it became.
export const decodePaint = (text) => {
  const source = String(text ?? "");
  const reader = createBitReader(source);
  const entries = Math.floor(source.length / PAINT_LETTERS);
  const ticks = [];
  const cells = [];
  const states = [];
  let at = 0;
  for (let index = 0; index < entries; index += 1) {
    const wait = reader.read(6);
    const cell = reader.read(16);
    const state = reader.read(STATE_BITS);
    const run = reader.read(PAINT_RUN_BITS) + 1;
    reader.read(3);
    at += wait;
    if (wait === PAINT_WAIT && cell === PAINT_NO_CELL) continue;
    for (let step = 0; step < run && cell + step < PAINT_NO_CELL; step += 1) {
      ticks.push(at);
      cells.push(cell + step);
      states.push(state);
    }
  }
  return { ticks: Uint32Array.from(ticks), cells: Uint16Array.from(cells), states: Uint8Array.from(states) };
};

// ---- keys ----------------------------------------------------------------------

// A short name for a list of things, to tell whether it is still the same list
// (the regions an arena was drawn from, say).
export const hashKey = (parts) => hashSeed((Array.isArray(parts) ? parts : [parts]).join("\u0001")).toString(36);

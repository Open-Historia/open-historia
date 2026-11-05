/*! Open Historia — battlefields and fronts: ground to be closed on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Nobody marches past an enemy and leaves him standing behind the line. Ground
// of the other side's that is cut off (and is not a place under siege), or
// that is as good as cut off, is ground to be CLOSED ON: it draws in the
// nearest troops whatever order they are under, as many as its size and its
// defenders call for. Each goes in from where it stands, straight through,
// once, and then goes on with the order it had.
//
// As good as cut off is SQUEEZED or cornered ground. A side's ground is in
// the grip of the other where the other's ground is within sixteen
// kilometres (the sea does not grip, nor does ground that is itself cut off
// or squeezed: a ring of besiegers is not squeezed by the place it has shut
// in). Take the grip away and what is left of a piece of a side's ground is
// its body, the largest part, and perhaps other parts joined to the body
// only through the grip. Such a part, and any tongue reaching far out from
// the body through the grip, is squeezed, if the fighting made it so: a bend
// of the border as it always was is left alone. And not a thrust that is
// still being driven: where the troops in it under an attack order are as
// many as those without, it is between the other side's ground because it
// means to be.

import {
  CLOSE_APART_COS,
  CLOSE_FAR_KM,
  CLOSE_LEAST,
  CLOSE_MOST,
  CLOSE_NEAR_KM,
  CLOSE_RIM_KM,
  CLOSE_STRENGTH,
  CLOSE_UNDER_STRENGTH,
  GRIP_KM,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  SIEGE_SPARE_KM,
  SQUEEZED_MIN_KM2,
  SQUEEZED_NEAR,
  SQUEEZED_NEAR_KM,
  SQUEEZED_TAKEN,
  STRAND_KM,
} from "./constants.js";
import { FAR_THIRDS, cellAt, distanceFrom, downhill, nearestOf } from "./ground.js";
import { KIND_ARTILLERY, isLive } from "./troops.js";

const heading = [0, 0];

// Whether a troop is under an order it is still carrying out.
export const liveOrder = (troop) => (troop.order && !troop.order.done ? troop.order : null);

// Whether a cell is ground a side leaves alone for a siege.
const sparedCell = (battle, side, cell) => {
  if (battle.kept[side] && battle.kept[side][cell] === 1) return true;
  const discs = battle.spared[side];
  const x = (cell % battle.field.cols) + 0.5;
  const y = Math.floor(cell / battle.field.cols) + 0.5;
  for (let at = 0; at < discs.length; at += 3) {
    if ((x - discs[at]) * (x - discs[at]) + (y - discs[at + 1]) * (y - discs[at + 1]) <= discs[at + 2] * discs[at + 2]) return true;
  }
  return false;
};

const booksOf = (battle) => {
  const { size } = battle.field;
  if (battle.close && battle.close.size === size) return battle.close;
  const pair = (Kind) => [new Kind(size), new Kind(size)];
  battle.close = {
    size,
    key: "",
    squeezed: pair(Uint8Array),
    was: pair(Uint8Array),
    prey: pair(Uint8Array),
    toPrey: pair(Int32Array),
    preyNear: [new Int32Array(size).fill(-1), new Int32Array(size).fill(-1)],
    toSupplied: pair(Int32Array),
    pockets: [[], []],
    cut: [false, false],
    grip: new Int32Array(size),
    toTaken: new Int32Array(size),
    part: new Int32Array(size),
    steps: new Int32Array(size),
    label: new Int32Array(size),
  };
  return battle.close;
};

// Finds a side's squeezed and cornered ground, into books.squeezed[side].
const squeeze = (battle, books, side) => {
  const { field, place } = battle;
  const { cols, rows, size, holders } = field;
  const other = 1 - side;
  const cellKm = battle.frame.km;
  const neck = (GRIP_KM * 3) / cellKm;
  const { grip, toTaken, part, steps } = books;
  const fed = battle.fed;
  books.was[side].set(books.squeezed[side]);
  books.squeezed[side].fill(0);
  distanceFrom(cols, rows, (cell) => holders[cell] === other && fed[other][cell] === 1 && books.was[other][cell] === 0, grip);
  distanceFrom(cols, rows, (cell) => holders[cell] === other && battle.homes[cell] !== other, toTaken);
  const fedMine = fed[side];
  // A cell's neighbours, always in the same order: left, right, up, down (-1 where there is none).
  const beside = [0, 0, 0, 0];
  const neighbours = (cell) => {
    const col = cell % cols;
    beside[0] = col > 0 ? cell - 1 : -1;
    beside[1] = col < cols - 1 ? cell + 1 : -1;
    beside[2] = cell >= cols ? cell - cols : -1;
    beside[3] = cell + cols < size ? cell + cols : -1;
  };
  // The parts of its ground that are out of the grip.
  part.fill(-1);
  const parts = [];
  const queue = [];
  const stack = [];
  for (let start = 0; start < size; start += 1) {
    if (holders[start] !== side || fedMine[start] !== 1 || grip[start] <= neck || part[start] >= 0) continue;
    const id = parts.length;
    let count = 0;
    part[start] = id;
    stack.push(start);
    while (stack.length) {
      const cell = stack.pop();
      count += 1;
      steps[cell] = 0;
      queue.push(cell);
      neighbours(cell);
      for (let way = 0; way < 4; way += 1) {
        const next = beside[way];
        if (next < 0 || part[next] >= 0 || holders[next] !== side || fedMine[next] !== 1 || grip[next] <= neck) continue;
        part[next] = id;
        stack.push(next);
      }
    }
    parts.push({ id, piece: battle.bodyOf[side][start], count });
  }
  // The body of each piece of its ground: the largest part of it.
  const body = new Map();
  for (const entry of parts) if (!body.has(entry.piece) || entry.count > body.get(entry.piece).count) body.set(entry.piece, entry);
  // Every cell in the grip belongs with the part it is nearest, going by its own ground.
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    neighbours(cell);
    for (let way = 0; way < 4; way += 1) {
      const next = beside[way];
      if (next < 0 || part[next] >= 0 || holders[next] !== side || fedMine[next] !== 1) continue;
      part[next] = part[cell];
      steps[next] = steps[cell] + 1;
      queue.push(next);
    }
  }
  // What hangs by a neck, and what reaches too far out through the grip.
  const strand = STRAND_KM / cellKm;
  const hanging = books.label.fill(0);
  let any = false;
  for (const cell of queue) {
    const entry = parts[part[cell]];
    if (body.get(entry.piece) !== entry || (grip[cell] <= neck && steps[cell] > strand)) {
      hanging[cell] = 1;
      any = true;
    }
  }
  if (!any) return;
  // Where its troops stand, and which of them are attacking.
  const standing = new Map();
  for (const troop of battle.troops[side]) {
    if (!isLive(troop)) continue;
    const here = cellAt(field, troop.x, troop.y);
    if (here < 0 || hanging[here] !== 1) continue;
    const order = liveOrder(troop);
    const entry = standing.get(here) ?? [0, 0];
    entry[order && order.kind !== "breakout" && order.kind !== "fallback" && order.kind !== "withdraw" ? 1 : 0] += 1;
    standing.set(here, entry);
  }
  const near = (SQUEEZED_NEAR_KM * 3) / cellKm;
  for (const start of queue) {
    if (hanging[start] !== 1) continue;
    const cells = [];
    let taken = 0;
    let gripped = 0;
    let holding = 0;
    let attacking = 0;
    let km2 = 0;
    hanging[start] = 2;
    stack.push(start);
    while (stack.length) {
      const cell = stack.pop();
      cells.push(cell);
      const rowKm = place.rowKm[Math.floor(cell / cols)];
      km2 += rowKm * rowKm;
      if (battle.homes[cell] !== side) taken += 1;
      if (toTaken[cell] <= near) gripped += 1;
      const there = standing.get(cell);
      if (there) {
        holding += there[0];
        attacking += there[1];
      }
      neighbours(cell);
      for (let way = 0; way < 4; way += 1) {
        const next = beside[way];
        if (next < 0 || hanging[next] !== 1) continue;
        hanging[next] = 2;
        stack.push(next);
      }
    }
    if (km2 < SQUEEZED_MIN_KM2 || (taken < cells.length * SQUEEZED_TAKEN && gripped < cells.length * SQUEEZED_NEAR)) continue;
    // A thrust being driven: most of those in it are attacking.
    if (attacking > 0 && attacking >= holding) continue;
    for (const cell of cells) if (!sparedCell(battle, other, cell)) books.squeezed[side][cell] = 1;
  }
};

// Works out, for the day, the ground each side is to close on:
//   books.prey[side]        the other side's ground that side is to close on
//   books.pockets[side]     that ground as the pockets it lies in:
//                           { id, km2, cx, cy, inside, held, needed }
//   books.toPrey[side], books.preyNear[side]   how far each cell is from the
//                           nearest of it, and which pocket that is
//   books.squeezed[side]    that side's own ground that is squeezed
//   books.toSupplied[side]  how far each cell is from that side's supplied
//                           ground, while any of its troops is cut off
// and marks the troops that stand in squeezed ground. Returns the books.
export const findPrey = (battle) => {
  const { field, place } = battle;
  const { cols, rows, size, holders } = field;
  const books = booksOf(battle);
  // Squeezing takes ground the fighting has moved: with none taken and nothing
  // cut off there is nothing to close on, and a quiet front costs nothing.
  if (battle.takenFor !== field || battle.takenTurns !== field.turns) {
    let taken = 0;
    for (let cell = 0; cell < size; cell += 1) if (holders[cell] <= HOLDER_SIDE_B && battle.homes[cell] !== holders[cell] && battle.homes[cell] <= HOLDER_SIDE_B) taken += 1;
    battle.takenCells = taken;
    battle.takenFor = field;
    battle.takenTurns = field.turns;
  }
  const quiet = battle.takenCells === 0 && battle.pockets.length === 0;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (quiet) {
      if (books.key !== "quiet") {
        books.squeezed[side].fill(0);
        books.was[side].fill(0);
      }
    } else squeeze(battle, books, side);
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      const here = isLive(troop) ? cellAt(field, troop.x, troop.y) : -1;
      troop.squeezed = here >= 0 && books.squeezed[side][here] === 1;
      if (troop.squeezed) troop.pocket = true;
    }
  }
  if (quiet && books.key === "quiet") return books;
  books.key = quiet ? "quiet" : "";
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const other = 1 - side;
    const prey = books.prey[side];
    prey.fill(0);
    let any = false;
    for (let cell = 0; cell < size && !quiet; cell += 1) {
      if (holders[cell] !== other) continue;
      const pocket = battle.pocketOf ? battle.pocketOf[other][cell] : -1;
      // (Not ground it is leaving alone for a siege: a place being shut in is
      // squeezed for a day or two before the ring closes, and the besiegers
      // are told to go round it, not at it.)
      if ((pocket >= 0 && !battle.pockets[pocket].siege) || (books.squeezed[other][cell] === 1 && !sparedCell(battle, side, cell))) {
        prey[cell] = 1;
        any = true;
      }
    }
    // As the pockets it lies in: how big each is, who holds it, and so how many it takes.
    const label = books.label.fill(-1);
    const pockets = [];
    const stack = [];
    for (let start = 0; start < size && any; start += 1) {
      if (prey[start] !== 1 || label[start] >= 0) continue;
      const pocket = { id: pockets.length, km2: 0, cx: 0, cy: 0, cells: 0, inside: [], held: 0, needed: 0 };
      label[start] = pocket.id;
      stack.push(start);
      while (stack.length) {
        const cell = stack.pop();
        const col = cell % cols;
        const row = (cell - col) / cols;
        pocket.cells += 1;
        pocket.km2 += place.rowKm[row] * place.rowKm[row];
        pocket.cx += col + 0.5;
        pocket.cy += row + 0.5;
        for (const next of [col > 0 ? cell - 1 : -1, col < cols - 1 ? cell + 1 : -1, cell - cols, cell + cols]) {
          if (next < 0 || next >= size || prey[next] !== 1 || label[next] >= 0) continue;
          label[next] = pocket.id;
          stack.push(next);
        }
      }
      pocket.cx /= pocket.cells;
      pocket.cy /= pocket.cells;
      pockets.push(pocket);
    }
    battle.troops[other].forEach((troop, index) => {
      const at = isLive(troop) ? cellAt(field, troop.x, troop.y) : -1;
      if (at < 0 || label[at] < 0) return;
      pockets[label[at]].inside.push(index);
      pockets[label[at]].held += troop.strength;
    });
    for (const pocket of pockets) {
      // As many as its rim has room for, each with its own strip, and a few
      // more for those who hold it: a small pocket is not mobbed.
      const rim = 2 * Math.sqrt(Math.PI * pocket.km2);
      pocket.needed = Math.max(CLOSE_LEAST, Math.min(CLOSE_MOST, Math.ceil(rim / CLOSE_RIM_KM) + Math.ceil(pocket.held / CLOSE_STRENGTH)));
    }
    books.pockets[side] = pockets;
    if (pockets.length > 0) nearestOf(cols, rows, label, books.toPrey[side], books.preyNear[side]);
    else {
      books.toPrey[side].fill(FAR_THIRDS);
      books.preyNear[side].fill(-1);
    }
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    books.cut[side] = battle.troops[side].some((troop) => isLive(troop) && troop.pocket);
    if (books.cut[side]) distanceFrom(cols, rows, (cell) => holders[cell] === side && battle.fed[side][cell] === 1 && books.squeezed[side][cell] === 0, books.toSupplied[side]);
  }
  return books;
};

// Whether a troop of a side stands in the ring round a place its side is besieging.
const onSiegeRing = (battle, side, troop) => {
  for (const siege of battle.sieges) {
    if (siege.by !== side) continue;
    const reach = (SIEGE_SPARE_KM + 3 * battle.radiusKm[side]) / battle.place.kmAt(siege.y);
    if ((troop.x - siege.x) * (troop.x - siege.x) + (troop.y - siege.y) * (troop.y - siege.y) <= reach * reach) return true;
  }
  return false;
};

// Each pocket a side is to close on takes the troops it still wants from that
// side's nearest, WHATEVER they were doing: one on the march past it wheels in
// and goes on with its order after. Not the guns, not those holding the ring
// round a place under siege, not one dug in or sent at a named place, and not
// one too worn, or that has just come out of a pocket.
export const drawIn = (battle, side, day) => {
  const books = battle.close;
  const { field } = battle;
  const cellKm = battle.frame.km;
  const troops = battle.troops[side];
  for (const pocket of books.pockets[side]) {
    const near = [];
    let already = 0;
    // From which way each of those at it comes, as seen from its middle.
    const bearings = [];
    const bearingOf = (troop) => {
      const dx = troop.x - pocket.cx;
      const dy = troop.y - pocket.cy;
      const length = Math.sqrt(dx * dx + dy * dy);
      return length > 0 ? [dx / length, dy / length] : [0, 0];
    };
    troops.forEach((troop, index) => {
      if (!isLive(troop) || troop.kind === KIND_ARTILLERY || troop.pocket) return;
      const cell = cellAt(field, troop.x, troop.y);
      if (cell < 0 || books.preyNear[side][cell] !== pocket.id) return;
      const left = (books.toPrey[side][cell] / 3) * cellKm;
      const order = liveOrder(troop);
      if (order && order.kind === "reduce") {
        already += 1;
        bearings.push(bearingOf(troop));
        return;
      }
      if (troop.dug || troop.strength < CLOSE_UNDER_STRENGTH || troop.rested > day) return;
      // One sent at a named place or formation is not drawn off it; nor one told to fall back, or to leave.
      if (order && (order.kind === "assault" || order.kind === "fallback" || order.kind === "withdraw")) return;
      if (onSiegeRing(battle, side, troop)) return;
      // Those beside it first; from further off only if they are not enough.
      const live = order ? 1 : 0;
      const beside = left <= CLOSE_NEAR_KM[live];
      if (!beside && left > CLOSE_FAR_KM[live]) return;
      // Which way it lies, and whether going there means turning about.
      const toward = left > 0.5 * cellKm && downhill(field, books.toPrey[side], troop.x, troop.y, heading) ? [heading[0], heading[1]] : [troop.hx, troop.hy];
      const facing = toward[0] * troop.hx + toward[1] * troop.hy;
      const turn = !order ? 0 : facing >= -0.3 ? 1 : 2;
      // Ground with nobody of the other side's left in it is not worth leaving
      // its way for: a rank that has run ahead in places does not go back for
      // the strips between its own columns; whoever has it before him takes it.
      if (order && facing < 0.5 && pocket.inside.length === 0) return;
      near.push({ index, troop, toward, turn, order, bearing: bearingOf(troop), key: (beside ? 0 : 1e6) + left * (turn === 0 ? 0.8 : turn === 1 ? 1 : 1.6) });
    });
    near.sort((a, b) => a.key - b.key || a.index - b.index);
    // Those that would come the same way as one already at it wait their turn
    // behind those that come another way: it is closed on from all round
    // where there is anyone all round it.
    const apart = CLOSE_APART_COS[Math.max(CLOSE_LEAST, Math.min(CLOSE_MOST, pocket.needed)) - CLOSE_LEAST];
    const fresh = [];
    const crowding = [];
    for (const entry of near) {
      const crowded = bearings.some((taken) => taken[0] * entry.bearing[0] + taken[1] * entry.bearing[1] > apart)
        || fresh.some((taken) => taken.bearing[0] * entry.bearing[0] + taken.bearing[1] * entry.bearing[1] > apart);
      (crowded ? crowding : fresh).push(entry);
    }
    for (const { troop, toward, turn, order } of [...fresh, ...crowding]) {
      if (already >= pocket.needed) break;
      troop.order = { kind: "reduce", since: day, day, resume: order, entered: false };
      // It wheels toward it at once: a turn, not a wide arc on the march.
      let hx = turn === 1 ? troop.hx + 2 * toward[0] : toward[0];
      let hy = turn === 1 ? troop.hy + 2 * toward[1] : toward[1];
      const length = Math.sqrt(hx * hx + hy * hy);
      if (length > 0) {
        hx /= length;
        hy /= length;
        troop.hx = hx;
        troop.hy = hy;
      }
      troop.fallback = null;
      already += 1;
    }
  }
};

/*! Open Historia — battlefields and fronts: supply, patches and pockets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side fights from its own country: the ground it holds that it is sovereign
// in, and wherever it has landed. Supply runs out from there through ground it
// holds, and thins with distance, so a thrust weakens the further it gets from
// home.
//
// A body of ground with no way back to a source is ENCLOSED. A small patch of
// it that nobody stands in, under 1,500 square kilometres, is filled the day
// the ring closes round it: the gap between two columns that have met, the
// sliver a thrust left behind. Anything else is a POCKET, and a pocket is
// fought for like any other ground, only at a disadvantage: its troops attack
// and defend at a share of their power and waste away for want of supply, and
// after ten days it gives up. Until then its troops may break out, or throw
// the ring back; and the other side's nearest troops close on it (closing.js).
// A scrap of ground with a troop or two left on it as the fighting goes past
// is not a pocket: they are driven off it and it goes.
//
// A place the other side was told to encircle is the one exception: enclosed,
// it is BESIEGED. It is never filled as a patch whatever its size, nobody
// assaults it (the besiegers neither step into it nor fight its troops), its
// troops waste more slowly, and it holds for forty-five days.
//
// What counts as a way back is the subtle part. Encirclements nearly always
// happen on the defender's own soil, where every cut-off piece still holds
// home ground: if home ground were a source wherever it lay, no defender could
// ever be encircled at home. And a peninsula or an island that is a side's
// home ground but joined to its mainland only by sea must not count as cut off
// merely for being the smaller piece. So home ground is read in its connected
// pieces, and of all the bodies a side holds, the one holding the most of a
// piece of home ground is the one that piece feeds. A body the other side's
// ground touches nowhere is left alone: it is cut off from no one.
//
// For a group, which is sovereign nowhere, the area it held when the run began
// stands for its home ground: otherwise every rising would be a pocket.

import {
  CORRIDOR_COST,
  CORRIDOR_KM,
  EMPTY_POCKET_KM2,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  OVERRUN_ESCAPE_KM,
  OVERRUN_LOSS,
  OVERRUN_ODDS,
  OVERRUN_WITHIN_KM,
  PATCH_MAX_KM2,
  POCKET_DAYS,
  SCRAP_KM2,
  SIEGE_DAYS,
  SUPPLY_EVERY_DAYS,
  SUPPLY_FAR_FACTOR,
  SUPPLY_FULL_KM,
  SUPPLY_LEAST,
} from "./constants.js";
import { bodiesOf, ownCell, takeCells } from "./field.js";
import { distanceFrom } from "./ground.js";
import { describePoint } from "./sectors.js";
import { keptWith } from "./walls.js";
import { isLive } from "./troops.js";

const cellOf = (field, x, y) => (x >= 0 && y >= 0 && x < field.cols && y < field.rows ? Math.floor(y) * field.cols + Math.floor(x) : -1);

// The member of a side whose troops are nearest a cell: who newly won ground
// is painted for when no one troop took it. Member 0 when the side has no
// troop left. Of two equally near, the lower in the list.
export const nearestOwner = (battle, side) => (cell) => {
  const x = (cell % battle.field.cols) + 0.5;
  const y = Math.floor(cell / battle.field.cols) + 0.5;
  let best = Infinity;
  let owner = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop)) continue;
    const dx = troop.x - x;
    const dy = troop.y - y;
    if (dx * dx + dy * dy < best) {
      best = dx * dx + dy * dy;
      owner = troop.owner;
    }
  }
  return owner;
};

// The connected pieces of a side's home ground: its mainland, a peninsula
// joined only by sea, an island. piece[cell] is the piece a cell of its home
// ground belongs to, -1 for any other cell. Home ground does not move with
// the line, so this is worked out once for each reading of the regions.
const homePieces = (battle, side) => {
  battle.homePieces ??= [null, null];
  const known = battle.homePieces[side];
  if (known && known.homeSide === battle.homeSide && known.size === battle.field.size) return known;
  const { field, arena } = battle;
  const { cols, rows, size } = field;
  const piece = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  const home = (index) => field.play[index] === 1 && battle.homeSide[arena.region[index]] === side;
  let count = 0;
  for (let seed = 0; seed < size; seed += 1) {
    if (piece[seed] >= 0 || !home(seed)) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    piece[seed] = count;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const col = index % cols;
      const row = (index - col) / cols;
      for (let step = 0; step < 4; step += 1) {
        const next = step === 0 ? (row > 0 ? index - cols : -1)
          : step === 1 ? (col > 0 ? index - 1 : -1)
            : step === 2 ? (col < cols - 1 ? index + 1 : -1)
              : (row < rows - 1 ? index + cols : -1);
        if (next < 0 || piece[next] >= 0 || !home(next)) continue;
        piece[next] = count;
        queue[tail] = next;
        tail += 1;
      }
    }
    count += 1;
  }
  battle.homePieces[side] = { homeSide: battle.homeSide, size, piece, count };
  return battle.homePieces[side];
};

// Which of the bodies of ground a side holds are supplied, and which of them
// the other side's ground touches.
//
// A body is supplied when, of all the bodies its side holds, it is the one
// holding the most of the piece of home ground it holds most of: the main
// part of the mainland, the main part of a peninsula. Every other body is cut
// off: a lesser part of a piece of home ground (a pocket on a side's own soil),
// or ground with no home in it at all (taken ground severed from the rest).
// Where a side has landed, that body is supplied whatever else is true.
const suppliedBodies = (battle, side) => {
  const { field } = battle;
  const { cols, rows, size, holders } = field;
  const bodies = bodiesOf(field, side);
  const pieces = homePieces(battle, side);
  // How much of each piece of home ground each body holds.
  const held = new Map();
  const touched = new Uint8Array(bodies.count);
  for (let index = 0; index < size; index += 1) {
    const body = bodies.label[index];
    if (body < 0) continue;
    if (pieces.piece[index] >= 0) {
      const key = body * pieces.count + pieces.piece[index];
      held.set(key, (held.get(key) ?? 0) + 1);
    }
    if (touched[body]) continue;
    const col = index % cols;
    const row = (index - col) / cols;
    const other = 1 - side;
    if ((row > 0 && holders[index - cols] === other) || (col > 0 && holders[index - 1] === other)
      || (col < cols - 1 && holders[index + 1] === other) || (row < rows - 1 && holders[index + cols] === other)) touched[body] = 1;
  }
  // The piece each body holds most of, and for each piece the body that holds most of it.
  const mostOf = new Int32Array(bodies.count).fill(-1);
  const mostHeld = new Int32Array(bodies.count);
  const holderOf = new Int32Array(pieces.count).fill(-1);
  const heldBy = new Int32Array(pieces.count);
  for (let body = 0; body < bodies.count; body += 1) {
    for (let piece = 0; piece < pieces.count; piece += 1) {
      const cells = held.get(body * pieces.count + piece) ?? 0;
      if (cells > mostHeld[body]) {
        mostHeld[body] = cells;
        mostOf[body] = piece;
      }
    }
  }
  for (let body = 0; body < bodies.count; body += 1) {
    const piece = mostOf[body];
    if (piece >= 0 && mostHeld[body] > heldBy[piece]) {
      heldBy[piece] = mostHeld[body];
      holderOf[piece] = body;
    }
  }
  const supplied = new Uint8Array(bodies.count);
  for (let piece = 0; piece < pieces.count; piece += 1) if (holderOf[piece] >= 0) supplied[holderOf[piece]] = 1;
  for (const anchor of battle.anchors) {
    if (anchor.s !== side) continue;
    const cell = cellOf(field, anchor.x, anchor.y);
    if (cell >= 0 && bodies.label[cell] >= 0) supplied[bodies.label[cell]] = 1;
  }
  // A side with no home ground on this battlefield at all (its country lies
  // beyond the frame) is fed through the largest body it holds.
  if (pieces.count === 0 && !supplied.some((value) => value === 1) && bodies.count > 0) {
    let largest = 0;
    for (let body = 1; body < bodies.count; body += 1) if (bodies.sizes[body] > bodies.sizes[largest]) largest = body;
    supplied[largest] = 1;
  }
  return { bodies, supplied, touched };
};

// Finds the enclosed ground as it now lies. battle.pockets becomes
// [{ s, cell, days, km2, siege, told }], a pocket that was already one keeping
// the days it has stood, and battle.pocketOf[side][cell] the entry a cell is
// in, or -1. `siege` is the place it is besieged for, in words, or "": a
// pocket that holds a place the other side was told to encircle; `told` is
// whether the log has said so. Worked out again only when ground has changed
// hands, or the sieges that stand have changed.
export const findPockets = (battle) => {
  const { field, place } = battle;
  if (battle.pocketTurns === field.turns && battle.pocketSieges === battle.siegeKey && battle.pocketOf) return;
  const before = battle.pocketOf;
  const known = battle.pockets;
  const pockets = [];
  const pocketOf = [new Int32Array(field.size).fill(-1), new Int32Array(field.size).fill(-1)];
  battle.supplied = [null, null];
  // For each side: the body of ground each cell it holds lies in, and whether that body is supplied.
  battle.bodyOf = [null, null];
  battle.fed = [new Uint8Array(field.size), new Uint8Array(field.size)];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const { bodies, supplied, touched } = suppliedBodies(battle, side);
    battle.supplied[side] = supplied;
    battle.bodyOf[side] = bodies.label;
    const pocketOfBody = new Int32Array(bodies.count).fill(-1);
    for (let index = 0; index < field.size; index += 1) {
      const body = bodies.label[index];
      if (body < 0) continue;
      if (supplied[body]) battle.fed[side][index] = 1;
      // Cut off, and with the other side's ground against it somewhere.
      if (supplied[body] || !touched[body]) continue;
      if (pocketOfBody[body] < 0) {
        pocketOfBody[body] = pockets.length;
        pockets.push({ s: side, cell: index, days: 0, km2: 0, cells: 0, cx: 0, cy: 0, siege: "", told: false });
      }
      const pocket = pockets[pocketOfBody[body]];
      const km = place.rowKm[Math.floor(index / field.cols)];
      pocket.km2 += km * km;
      pocket.cells += 1;
      pocket.cx += (index % field.cols) + 0.5;
      pocket.cy += Math.floor(index / field.cols) + 0.5;
      pocketOf[side][index] = pocketOfBody[body];
      // Any cell it shares with a pocket that was there before makes it that
      // pocket still, however it has shrunk.
      const was = before ? before[side][index] : known.findIndex((entry) => entry.s === side && entry.cell === index);
      if (was < 0 || !known[was]) continue;
      if (known[was].days > pocket.days) pocket.days = known[was].days;
      if (known[was].told) pocket.told = true;
    }
  }
  for (const pocket of pockets) {
    pocket.cx /= pocket.cells;
    pocket.cy /= pocket.cells;
  }
  for (const siege of battle.sieges) {
    const index = pocketOf[1 - siege.by][siege.cell];
    if (index >= 0 && !pockets[index].siege) pockets[index].siege = siege.at;
  }
  // A siege that has ended and begins again is news again.
  for (const pocket of pockets) if (!pocket.siege) pocket.told = false;
  // The ground each side leaves alone: every cell of a place it is besieging
  // (and, where walls stand, every stretch of the other side's: walls.js).
  battle.siegeKept = [null, null];
  if (pockets.some((pocket) => pocket.siege !== "")) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      for (let index = 0; index < field.size; index += 1) {
        const pocket = pocketOf[side][index];
        if (pocket < 0 || !pockets[pocket].siege) continue;
        battle.siegeKept[1 - side] ??= new Uint8Array(field.size);
        battle.siegeKept[1 - side][index] = 1;
      }
    }
  }
  battle.kept = keptWith(battle);
  battle.pockets = pockets;
  battle.pocketOf = pocketOf;
  battle.pocketTurns = field.turns;
  battle.pocketSieges = battle.siegeKey;
};

// The live troops of its own side that stand in each pocket.
const garrisons = (battle) => {
  const inside = battle.pockets.map(() => []);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      if (isLive(troop) && cell >= 0 && battle.pocketOf[side][cell] >= 0) inside[battle.pocketOf[side][cell]].push(troop);
    }
  }
  return inside;
};

// Which troops stand in a pocket today, and which of those in a besieged
// place. `pocket` is whether a troop fights as one surrounded (closing.js adds
// those in squeezed ground); `sealed` whether it is truly cut off.
export const markPockets = (battle) => {
  findPockets(battle);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      const pocket = isLive(troop) && cell >= 0 ? battle.pocketOf[side][cell] : -1;
      troop.pocket = pocket >= 0;
      troop.sealed = pocket >= 0;
      troop.besieged = pocket >= 0 && battle.pockets[pocket].siege !== "";
    }
  }
};

// Enclosed ground goes to the other side: every cell of it, painted for the
// member whose troops are nearest, and the troops that stood in it are lost.
// The log says where, once, when `kind` names what happened ("pocket" for one
// that gave up, "overrun" for one that was stormed); a patch that is filled
// had nobody in it, and is not news.
const giveUp = (battle, index, date, kind) => {
  const { field, arena } = battle;
  const pocket = battle.pockets[index];
  const cells = [];
  for (let cell = 0; cell < field.size; cell += 1) if (battle.pocketOf[pocket.s][cell] === index) cells.push(cell);
  for (const troop of battle.troops[pocket.s]) {
    const cell = ownCell(field, pocket.s, troop.x, troop.y);
    if (isLive(troop) && cell >= 0 && battle.pocketOf[pocket.s][cell] === index) troop.strength = 0;
  }
  if (cells.length === 0) return;
  takeCells(field, 1 - pocket.s, cells, nearestOwner(battle, 1 - pocket.s));
  const at = kind ? describePoint(arena, pocket.cx, pocket.cy) : "";
  if (at) battle.log.push({ d: date, k: kind, s: pocket.s, at });
};

// A pocket surrenders now (the story said so): `index` is its place in battle.pockets.
export const surrenderPocket = (battle, index, date) => giveUp(battle, index, date, "pocket");

// Whether a troop driven off a scrap of ground has its own side's supplied
// ground near enough to get away to.
const canEscape = (battle, side, troop) => {
  const { field } = battle;
  const reach = Math.ceil(OVERRUN_ESCAPE_KM / battle.place.kmAt(troop.y));
  const col0 = Math.floor(troop.x);
  const row0 = Math.floor(troop.y);
  for (let row = Math.max(0, row0 - reach); row <= Math.min(field.rows - 1, row0 + reach); row += 1) {
    for (let col = Math.max(0, col0 - reach); col <= Math.min(field.cols - 1, col0 + reach); col += 1) {
      const cell = row * field.cols + col;
      if (field.holders[cell] !== side || battle.pocketOf[side][cell] >= 0) continue;
      if ((col + 0.5 - troop.x) * (col + 0.5 - troop.x) + (row + 0.5 - troop.y) * (row + 0.5 - troop.y) <= reach * reach) return true;
    }
  }
  return false;
};

// After the day's steps: what becomes of each piece of enclosed ground.
//
//   a place under siege      is left as it is, and said once to be besieged;
//                            it gives up after its forty-five days, or when
//                            nobody is left in it
//   a scrap with troops on it, or a small pocket with four times its strength
//   closing on it and upon it
//                            is overrun at once: its troops are driven off it,
//                            back to their own side if that is near, and it goes
//   an empty patch           is filled; a larger empty piece gives up, unless
//                            it is so large that it has to be walked through
//   any other                is a pocket: a day older, and after ten days cut
//                            off it gives up
//
// true when any ground changed hands.
export const settlePockets = (battle, date) => {
  findPockets(battle);
  const inside = garrisons(battle);
  let any = false;
  for (let index = 0; index < battle.pockets.length; index += 1) {
    const pocket = battle.pockets[index];
    const held = inside[index];
    if (pocket.siege) {
      if (!pocket.told) battle.log.push({ d: date, k: "siege", s: pocket.s, at: pocket.siege });
      pocket.told = true;
      pocket.days += 1;
      if (held.length > 0 && pocket.days < SIEGE_DAYS) continue;
      giveUp(battle, index, date, "pocket");
      any = true;
      continue;
    }
    let overrun = held.length > 0 && pocket.km2 < SCRAP_KM2;
    if (held.length > 0 && !overrun && pocket.km2 < PATCH_MAX_KM2) {
      // Those closing on it, within reach of it, against those who hold it.
      const within = Math.sqrt(pocket.cells / Math.PI) + OVERRUN_WITHIN_KM / battle.place.kmAt(pocket.cy);
      let at = 0;
      for (const troop of battle.troops[1 - pocket.s]) {
        if (!isLive(troop) || !troop.order || troop.order.done || troop.order.kind !== "reduce") continue;
        if ((troop.x - pocket.cx) * (troop.x - pocket.cx) + (troop.y - pocket.cy) * (troop.y - pocket.cy) <= within * within) at += troop.strength;
      }
      overrun = at >= OVERRUN_ODDS * held.reduce((sum, troop) => sum + troop.strength, 0);
    }
    if (overrun) {
      for (const troop of held) {
        troop.strength = canEscape(battle, pocket.s, troop) ? Math.max(0, troop.strength - OVERRUN_LOSS) : 0;
        if (troop.order) troop.order = null;
        troop.fallback = null;
      }
      // The ground goes; those who got away are no longer in it.
      const cells = [];
      for (let cell = 0; cell < battle.field.size; cell += 1) if (battle.pocketOf[pocket.s][cell] === index) cells.push(cell);
      takeCells(battle.field, 1 - pocket.s, cells, nearestOwner(battle, 1 - pocket.s));
      const at = describePoint(battle.arena, pocket.cx, pocket.cy);
      if (at) battle.log.push({ d: date, k: "overrun", s: pocket.s, at });
      any = true;
      continue;
    }
    if (held.length === 0) {
      if (pocket.km2 >= EMPTY_POCKET_KM2) continue;
      giveUp(battle, index, date, pocket.km2 < PATCH_MAX_KM2 ? "" : "pocket");
      any = true;
      continue;
    }
    pocket.days += 1;
    if (pocket.days < POCKET_DAYS) continue;
    giveUp(battle, index, date, "pocket");
    any = true;
  }
  if (any) findPockets(battle);
  return any;
};

// How well supplied each cell a side holds is, 1 at home falling to the least
// far from it: the shortest way back to a source through the side's own
// ground, counted five for a step along a row or a column and seven for a
// step on the diagonal (and CORRIDOR_COST times that onto a cell near the
// other side's ground, with battle.corridors: dawn.js). Worked out every few
// days, and only if ground changed hands since.
export const refreshSupply = (battle, day, era) => {
  const { field, arena } = battle;
  if (battle.supply && (day % SUPPLY_EVERY_DAYS !== 0 || battle.supplyTurns === field.turns)) return;
  findPockets(battle);
  const { cols, rows, size } = field;
  const fullKm = SUPPLY_FULL_KM[era];
  const farKm = fullKm * SUPPLY_FAR_FACTOR;
  const kmEach = arena.frame.km / 5;
  // (A step may cost up to 7 * CORRIDOR_COST: as many rounds as that and more, a power of two.)
  const corridors = battle.corridors === true;
  const ringSize = corridors ? 32 : 8;
  const near = corridors ? new Int32Array(size) : null;
  // CORRIDOR_KM in thirds of a cell (ground.js distanceFrom).
  const nearThirds = (CORRIDOR_KM * 3) / arena.frame.km;
  battle.supply = [null, null];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const bodies = bodiesOf(field, side);
    const supplied = battle.supplied[side];
    const cost = new Int32Array(size).fill(-1);
    const rounds = Array.from({ length: ringSize }, () => []);
    const mask = ringSize - 1;
    let waiting = 0;
    const reach = (index, value) => {
      if (cost[index] >= 0 && cost[index] <= value) return;
      cost[index] = value;
      rounds[value & mask].push(index);
      waiting += 1;
    };
    if (corridors) distanceFrom(cols, rows, (cell) => field.holders[cell] === 1 - side, near);
    const exposed = (cell) => corridors && near[cell] < nearThirds;
    let homeless = true;
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side || !supplied[bodies.label[index]] || battle.homeSide[arena.region[index]] !== side) continue;
      reach(index, 0);
      homeless = false;
    }
    for (const anchor of battle.anchors) {
      const cell = cellOf(field, anchor.x, anchor.y);
      if (anchor.s === side && cell >= 0 && field.holders[cell] === side) {
        reach(cell, 0);
        homeless = false;
      }
    }
    // With its country beyond the frame, a side is at home wherever it is fed.
    if (homeless) {
      for (let index = 0; index < size; index += 1) if (field.holders[index] === side && supplied[bodies.label[index]]) reach(index, 0);
    }
    for (let value = 0; waiting > 0; value += 1) {
      const round = rounds[value & mask];
      for (let position = 0; position < round.length; position += 1) {
        const index = round[position];
        waiting -= 1;
        if (cost[index] !== value) continue;
        const col = index % cols;
        const row = (index - col) / cols;
        for (let dy = -1; dy <= 1; dy += 1) {
          const y = row + dy;
          if (y < 0 || y >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = col + dx;
            if ((dx === 0 && dy === 0) || x < 0 || x >= cols || field.holders[y * cols + x] !== side) continue;
            const step = dx !== 0 && dy !== 0 ? 7 : 5;
            reach(y * cols + x, value + (exposed(y * cols + x) ? step * CORRIDOR_COST : step));
          }
        }
      }
      round.length = 0;
    }
    const supply = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side) continue;
      const km = cost[index] < 0 ? Infinity : cost[index] * kmEach;
      supply[index] = km <= fullKm ? 1 : km >= farKm ? SUPPLY_LEAST : 1 - ((1 - SUPPLY_LEAST) * (km - fullKm)) / (farKm - fullKm);
    }
    battle.supply[side] = supply;
  }
  battle.supplyTurns = field.turns;
};

// How well supplied each troop is where it stands today. A troop that is cut
// off is not weighed by its distance from home: what being cut off costs it is
// its own figures (a pocket's share of attack and defence, and its wasting).
export const markSupply = (battle) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const supply = battle.supply?.[side];
    for (const troop of battle.troops[side]) {
      if (troop.pocket) {
        troop.supply = 1;
        continue;
      }
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      const value = supply && cell >= 0 ? supply[cell] : 0;
      // Ground taken since supply was last worked out has no figure yet: a
      // troop standing on it is as well supplied as it was.
      if (value > 0) troop.supply = value;
    }
  }
};

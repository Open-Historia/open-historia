/*! Open Historia — battlefields and fronts: the troops © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side's troops are counters the engine raises and moves: the player and the
// model never place one. They are individuals, not a rank. Each draws its own
// drive, depth, lane and lag for a run, so no two stand evenly spaced, none
// stands at the same depth behind the line, and they do not set off together.
//
// This file is the troop itself: what one carries, how many a side raises and
// of what kinds, and where along the line the newly raised are stood (their
// LANES: places an equal weight of line apart, each shifted by its troop's own
// draw). Where a troop GOES after that is not decided here: way.js says what
// an order is, move.js who goes where each day, combat.js how far a step gets.
//
// A troop as it is saved is { x, y, strength, kind, owner, named, dig, state }
// (codec.js). The rest of what one carries here is the working state of a run.

import { hashSeed } from "../unitMotion.js";
import {
  ARMOUR_SHARE_BY_ERA,
  ARTILLERY_SHARE_BY_ERA,
  CONTROL_RADIUS_MAX_KM,
  CONTROL_RADIUS_MIN_CELLS,
  CONTROL_RADIUS_MIN_KM,
  CONTROL_RADIUS_OF_SPACING,
  EFFORT_FACTORS,
  FOOT_REACH_CELLS,
  HOLDER_SIDE_A,
  LANE_GAP_MIN,
  MAX_TROOPS_PER_SIDE,
  QUALITY_MAX,
  QUALITY_MIN,
  REACH_KM,
  REACH_MIN_CELLS,
  STAND_OFF_KM,
  TRAIT_DEPTH,
  TRAIT_DRIVE,
  TRAIT_LAG_DAYS,
  TRAIT_LANE,
  TROOPS_FACTOR_LEAST,
  TROOPS_FACTOR_MOST,
  TROOPS_LINE_KM_EACH,
  TROOPS_MIN,
  TROOPS_PER_STRENGTH,
  TURNS,
} from "./constants.js";
import { bodiesOf, nearest, nearestOnContour, ownCell, readField } from "./field.js";

export const KIND_INFANTRY = 0;
export const KIND_ARMOUR = 1;
export const KIND_ARTILLERY = 2;
export const STATE_HOLDING = 0;
export const STATE_ADVANCING = 1;
export const STATE_ENCIRCLED = 2;
export const STATE_SPENT = 3;
export const STATE_DUG_IN = 4;

const ATTACKS = new Set(["advance", "blitz", "spearhead", "encircle", "flank"]);
export const isAttack = (word) => ATTACKS.has(word);

export const createTroop = ({ x = 0, y = 0, strength = 100, kind = KIND_INFANTRY, owner = 0, named = false, dig = 0, state = STATE_HOLDING } = {}) => ({
  x,
  y,
  strength,
  kind,
  owner,
  named,
  dig,
  state,
  // Its side's control radius, in kilometres (sideRadiusKm).
  radiusKm: CONTROL_RADIUS_MAX_KM,
  // What it drew for this run; an even hand until it draws.
  drive: 1,
  depth: 1,
  lane: 0,
  lag: 0,
  drawn: false,
  // Which way it is going, a unit vector, or nothing yet; and the leg of
  // the way it is on, which it never goes backwards along (combat.js).
  hx: 0,
  hy: 0,
  axisX: 0,
  axisY: 0,
  // Where it stands against the line when it is raised (planLanes).
  station: null,
  // What it did today: whether it is to step, and whether it took ground.
  stepping: false,
  walkedToday: false,
  // How it stands against the attackers in reach of it this moment (combat.js).
  flank: 1,
  flankMoment: -1,
  faceX: 0,
  faceY: 0,
  movedKm: 0,
  loss: 0,
  engaged: false,
  // Dug in: stronger where it stands, and it does not move at all. (A troop
  // has one state to be saved as, and one that is dug in AND cut off is saved
  // as cut off. Its works say the rest: only a troop told to dig in has them
  // in full, so a garrison shut in is still dug in when the next run begins.)
  dug: state === STATE_DUG_IN || (state === STATE_ENCIRCLED && dig >= 1),
  // The order it is carrying out, or null (way.js, move.js); which of its
  // side's standing orders that serves, for the record; and which way it
  // steps today.
  order: null,
  serves: -1,
  // On a route drawn for it: which of the route's points it was making for
  // when the last run ended (way.js giveRoute), or -1.
  next: -1,
  // Which of its side's generals it is under (command.js); -1 until it is given one.
  command: -1,
  gx: 0,
  gy: 0,
  paceFactor: 1,
  reducing: false,
  plant: false,
  // With no order: the one place it is falling back to, how long it has stood
  // on the other side's ground with nowhere to go, and whether it has slid.
  fallback: null,
  stranded: 0,
  adrift: 0,
  // The day it last gave ground because it had been got round (move.js).
  gave: -1000,
  slid: false,
  // The day an assault sent at it was last upon it: it is fought where it
  // stands, and does not fall back from under it.
  pinned: -9,
  // The day until which it is not sent at a pocket again, or does not try to break out again.
  rested: 0,
  spent: 0,
  // Where it stands in the war: `pocket` when it fights as one surrounded,
  // which is truly cut off (`sealed`), in a besieged place, or in squeezed ground.
  body: -1,
  pocket: false,
  sealed: false,
  squeezed: false,
  besieged: false,
  supply: 1,
  // Wars and Fronts Pt.2 (dawn.js): how worn out it is, 0 to 1 (fatigue.js),
  // and what the day's conditions make of its attack, its defence and its
  // pace, set every morning: each 1 with nothing on.
  fatigue: 0,
  punch: 1,
  guard: 1,
  legs: 1,
  // Whether it attacked today (combat.js stepForward).
  fought: false,
});

export const isLive = (troop) => troop.strength > 0;
export const liveCount = (troops) => troops.reduce((count, troop) => count + (troop.strength > 0 ? 1 : 0), 0);

// A side's control radius, in kilometres: nine tenths of the length of line
// each of its troops has, within bounds. The same for every troop of the
// side, and worked out once a run.
export const sideRadiusKm = (lineKm, troops) =>
  Math.min(CONTROL_RADIUS_MAX_KM, Math.max(CONTROL_RADIUS_MIN_KM, (CONTROL_RADIUS_OF_SPACING * lineKm) / Math.max(1, troops)));
// How far to either side of its path the ground becomes its side's, in cells.
export const controlRadius = (troop, kmAt) => Math.max(CONTROL_RADIUS_MIN_CELLS, troop.radiusKm / kmAt(troop.y));
// How far a troop standing on a row fights, in cells.
export const reachCells = (kmAt, y) => Math.max(REACH_MIN_CELLS, REACH_KM / kmAt(y));
// How far behind the line it stands when it is not attacking, in cells.
export const standOff = (troop, kmAt) => (STAND_OFF_KM[troop.kind] * troop.depth) / kmAt(troop.y);

// Whether a point is on a side's own ground: in a cell it holds, or on its
// side of the line where the line runs through the cell.
export const stands = (field, side, x, y) => {
  if (!(x >= 0) || !(y >= 0) || x >= field.cols || y >= field.rows) return false;
  const cell = Math.floor(y) * field.cols + Math.floor(x);
  if (!field.play[cell]) return false;
  if (field.holders[cell] === side) return true;
  const value = readField(field, x, y);
  return side === HOLDER_SIDE_A ? value < 0 : value > 0;
};

// What a troop draws for a run, from the seed and who it is and nothing else:
// the same run always deals the same hand. `even` deals everyone the same,
// for a test that measures one thing at a time.
export const drawTraits = (troop, seed, name, side, index, even = false) => {
  troop.drawn = true;
  if (even) return;
  const draw = (trait) => (hashSeed([seed, name, side, index, trait].join("|")) % 10000) / 10000;
  troop.drive = TRAIT_DRIVE[0] + (TRAIT_DRIVE[1] - TRAIT_DRIVE[0]) * draw("drive");
  troop.depth = TRAIT_DEPTH[0] + (TRAIT_DEPTH[1] - TRAIT_DEPTH[0]) * draw("depth");
  troop.lane = TRAIT_LANE[0] + (TRAIT_LANE[1] - TRAIT_LANE[0]) * draw("lane");
  troop.lag = TRAIT_LAG_DAYS[Math.min(TRAIT_LAG_DAYS.length - 1, Math.floor(TRAIT_LAG_DAYS.length * draw("lag")))];
};

// ---- raising -------------------------------------------------------------------

// The most counters a side may have on a line of `lineKm`: one for every
// stretch of it, so that a short front is not stacked.
//   factor   what a run is told to raise of the usual (troopsFactor): 1 unless it says
export const troopsCap = (lineKm, factor = 1) => Math.max(troopsLeast(factor), Math.min(MAX_TROOPS_PER_SIDE, Math.floor((lineKm * factor) / TROOPS_LINE_KM_EACH)));
// The fewest counters a side has on any line.
export const troopsLeast = (factor = 1) => Math.max(2, Math.round(TROOPS_MIN * factor));
// What a run's input says of how many to raise, as a factor it can be held to.
export const troopsFactor = (value) => {
  const factor = Number(value);
  return Number.isFinite(factor) && factor > 0 ? Math.max(TROOPS_FACTOR_LEAST, Math.min(TROOPS_FACTOR_MOST, factor)) : 1;
};
// How many counters a side's own strength raises at an effort, before the line's room is looked at.
export const troopsWanted = (strength, effort, factor = 1) => TROOPS_PER_STRENGTH * factor * Math.max(0, strength) * (EFFORT_FACTORS[effort] ?? 1);

// How many counters each side has on a line of `lineKm`. Each is sized by
// its own strength (what its members bring here) and the effort it is making,
// and by nothing of the other side's: a great power fields hundreds, a small
// state a dozen or two. What the count cannot carry of a side's strength,
// because the line is too short for it or the least is more than it has, its
// quality carries as far as quality goes; where both sides are over, only what
// one has over the other.
export const sizeSides = (lineKm, strengths, efforts = ["major", "major"], factor = 1) => {
  const cap = troopsCap(lineKm, factor);
  const wanted = strengths.map((strength, side) => troopsWanted(strength, efforts[side], factor));
  const counts = wanted.map((count) => Math.max(troopsLeast(factor), Math.min(cap, Math.round(count))));
  const over = wanted.map((count, side) => count / counts[side]);
  const both = Math.max(1, Math.min(over[0], over[1]));
  const quality = over.map((share) => Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, share / both)));
  return { counts, quality };
};

// A key that spreads equal things evenly: the fractional part of a multiple of
// the golden ratio.
const spread = (index) => {
  const turned = (index + 1) * 0.6180339887498949;
  return turned - Math.floor(turned);
};

// The kinds of `count` counters in an era, in the order they stand along the
// line: so many armour (cavalry before the tank) and so many artillery, spread
// along it rather than bunched at one end, the rest infantry. A country may
// have its own shares (`mix`: { armour, artillery }, each 0 to 1 or null for
// the era's; military.js mixOf): a horde nearly all horse, a host with no siege train.
export const kindsFor = (count, era, mix = null) => {
  const armourShare = mix && Number.isFinite(mix.armour) ? mix.armour : ARMOUR_SHARE_BY_ERA[era];
  const artilleryShare = mix && Number.isFinite(mix.artillery) ? mix.artillery : ARTILLERY_SHARE_BY_ERA[era];
  const armour = Math.min(count, Math.round(count * armourShare));
  const artillery = Math.min(count - armour, Math.round(count * artilleryShare));
  const ranked = Array.from({ length: count }, (_, index) => index).sort((a, b) => spread(a) - spread(b) || a - b);
  const kinds = new Array(count).fill(KIND_INFANTRY);
  ranked.forEach((rank, turn) => {
    if (turn < armour) kinds[rank] = KIND_ARMOUR;
    else if (turn < armour + artillery) kinds[rank] = KIND_ARTILLERY;
  });
  return kinds;
};

// `count` things shared among holders in proportion to their weights, whole
// numbers that add up to it: what is left over goes to the largest remainders,
// the earlier holder first.
export const shareOut = (count, weights) => {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const parts = weights.map((weight) => (total > 0 ? (count * Math.max(0, weight)) / total : count / weights.length));
  const shares = parts.map((part) => Math.floor(part));
  let left = count - shares.reduce((sum, share) => sum + share, 0);
  const order = parts.map((part, index) => index).sort((a, b) => (parts[b] - shares[b]) - (parts[a] - shares[a]) || a - b);
  for (let turn = 0; left > 0; turn += 1, left -= 1) shares[order[turn % order.length]] += 1;
  return shares;
};

// ---- lanes ---------------------------------------------------------------------

// Reads every live troop of a side against the line, to stand the newly raised
// along it: nobody has ordered anything yet, so the line is held evenly, and
// what makes it uneven is the troops themselves.
//
// Each troop's `station` becomes null (its body of ground touches no line: it
// rests where it is) or
//   { nx, ny          the line's normal at its foot, from side A toward side B
//     place           how far along its own body's line its foot is, in km
//     idealX, idealY, idealNx, idealNy     the place its rank in the lane gives it, and the normal there }
//
// A troop's lane runs along its own body's line and nobody else's: each body
// of a side's ground has the troops that stand on it, in the order they stand.
export const planLanes = (battle, side, line) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const { contour, count } = line;
  const troops = battle.troops[side];
  const bodies = bodiesOf(field, side);
  const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;

  const body = new Int32Array(count).fill(-1);
  const starts = [];
  for (let index = 0; index < contour.strands.length; index += 1) {
    const { first, count: length } = contour.strands[index];
    starts.push(line.km[first]);
    for (let step = 0; step < length; step += 1) {
      const vertex = first + step;
      if (own[vertex] >= 0) body[vertex] = bodies.label[own[vertex]];
      else if (step > 0) body[vertex] = body[vertex - 1];
    }
    // A strand that begins on a wall borrows from the vertex after it.
    for (let step = length - 2; step >= 0; step -= 1) if (body[first + step] < 0) body[first + step] = body[first + step + 1];
  }
  starts.push(line.total);

  // The stretches of line each body of ground has, in the line's own order,
  // and how far along its body's line each vertex is.
  const laneAt = new Float64Array(count);
  const stretches = new Map();
  for (const { first, count: length, closed } of contour.strands) {
    const segments = closed ? length : length - 1;
    for (let step = 0; step < segments; step += 1) {
      const from = first + step;
      const to = first + ((step + 1) % length);
      if (body[from] < 0 || body[from] !== body[to]) continue;
      const lengthKm = (to > from ? line.km[to] : starts[line.strand[from] + 1]) - line.km[from];
      if (!(lengthKm > 0)) continue;
      let stretch = stretches.get(body[from]);
      if (!stretch) {
        stretch = { list: [], length: 0 };
        stretches.set(body[from], stretch);
      }
      laneAt[from] = stretch.length;
      stretch.list.push(from, to, lengthKm, stretch.length);
      stretch.length += lengthKm;
      if (to > from) laneAt[to] = stretch.length;
    }
  }

  // Each troop's foot on its own body's line.
  for (let index = 0; index < troops.length; index += 1) {
    const troop = troops[index];
    troop.station = null;
    if (!isLive(troop)) continue;
    const standing = ownCell(field, side, troop.x, troop.y);
    troop.body = standing >= 0 ? bodies.label[standing] : -1;
    const stretch = troop.body >= 0 ? stretches.get(troop.body) : null;
    if (!stretch) continue;
    let from = -1;
    let to = -1;
    let part = 0;
    let lengthKm = 0;
    let at = 0;
    // The foot is looked for from a little way along its heading: of two
    // points of the line as near it as each other, the one it faces is its foot.
    const lead = controlRadius(troop, kmAt) * 0.5;
    if (nearestOnContour(field, contour, troop.x + troop.hx * lead, troop.y + troop.hy * lead, FOOT_REACH_CELLS) !== Infinity && body[contour.from[nearest.segment]] === troop.body && body[contour.to[nearest.segment]] === troop.body) {
      from = contour.from[nearest.segment];
      to = contour.to[nearest.segment];
      part = nearest.along;
      lengthKm = (to > from ? line.km[to] : starts[line.strand[from] + 1]) - line.km[from];
      at = laneAt[from];
    } else {
      // Too far from the line, or nearest another body's: the nearest end of a stretch of its own.
      let best = Infinity;
      for (let item = 0; item < stretch.list.length; item += 4) {
        for (let end = 0; end < 2; end += 1) {
          const vertex = stretch.list[item + end];
          const dx = contour.x[vertex] - troop.x;
          const dy = contour.y[vertex] - troop.y;
          if (dx * dx + dy * dy >= best) continue;
          best = dx * dx + dy * dy;
          from = stretch.list[item];
          to = stretch.list[item + 1];
          part = end;
          lengthKm = stretch.list[item + 2];
          at = stretch.list[item + 3];
        }
      }
    }
    const sx = contour.x[to] - contour.x[from];
    const sy = contour.y[to] - contour.y[from];
    const span = Math.sqrt(sx * sx + sy * sy);
    let nx = line.nx[from] + (line.nx[to] - line.nx[from]) * part;
    let ny = line.ny[from] + (line.ny[to] - line.ny[from]) * part;
    const length = Math.sqrt(nx * nx + ny * ny);
    nx = length > 0 ? nx / length : span > 0 ? sy / span : 0;
    ny = length > 0 ? ny / length : span > 0 ? -sx / span : 0;
    troop.station = {
      nx,
      ny,
      place: at + lengthKm * part,
      idealX: contour.x[from] + sx * part,
      idealY: contour.y[from] + sy * part,
      idealNx: nx,
      idealNy: ny,
    };
  }

  // The order the side's troops stand in along the line, body by body.
  const lanes = [];
  troops.forEach((troop, index) => {
    if (troop.station) lanes.push(index);
  });
  lanes.sort((a, b) => troops[a].body - troops[b].body || troops[a].station.place - troops[b].station.place || a - b);
  const members = new Map();
  for (const index of lanes) {
    const id = troops[index].body;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(index);
  }
  for (const id of [...members.keys()].sort((a, b) => a - b)) {
    const list = members.get(id);
    const { list: segments, length: whole } = stretches.get(id);
    const total = list.length;
    let held = 0;
    for (let item = 0; item < segments.length; item += 4) held += segments[item + 2];

    // Places an equal length of line apart...
    const ideal = new Float64Array(total);
    let passed = 0;
    let item = 0;
    for (let rank = 0; rank < total; rank += 1) {
      const wanted = ((rank + 0.5) / total) * held;
      let piece = segments[item + 2];
      while (item + 4 < segments.length && passed + piece < wanted) {
        passed += piece;
        item += 4;
        piece = segments[item + 2];
      }
      ideal[rank] = segments[item + 3] + segments[item + 2] * (piece > 0 ? Math.min(1, Math.max(0, (wanted - passed) / piece)) : 0);
    }
    // ...each shifted by its troop's own lane, and never crowding the one before it.
    const gap = (rank) => {
      const low = Math.max(0, rank - 1);
      const high = Math.min(total - 1, rank + 1);
      return high > low ? (ideal[high] - ideal[low]) / (high - low) : whole;
    };
    const shifted = new Float64Array(total);
    for (let rank = 0; rank < total; rank += 1) {
      shifted[rank] = Math.min(whole, Math.max(0, ideal[rank] + troops[list[rank]].lane * gap(rank)));
      if (rank > 0) shifted[rank] = Math.max(shifted[rank], Math.min(whole, shifted[rank - 1] + LANE_GAP_MIN * Math.min(gap(rank), gap(rank - 1))));
    }

    item = 0;
    for (let rank = 0; rank < total; rank += 1) {
      const station = troops[list[rank]].station;
      while (item + 4 < segments.length && segments[item + 3] + segments[item + 2] <= shifted[rank]) item += 4;
      const from = segments[item];
      const to = segments[item + 1];
      const part = Math.min(1, Math.max(0, (shifted[rank] - segments[item + 3]) / segments[item + 2]));
      station.idealX = contour.x[from] + (contour.x[to] - contour.x[from]) * part;
      station.idealY = contour.y[from] + (contour.y[to] - contour.y[from]) * part;
      const nx = line.nx[from] + (line.nx[to] - line.nx[from]) * part;
      const ny = line.ny[from] + (line.ny[to] - line.ny[from]) * part;
      const length = Math.sqrt(nx * nx + ny * ny);
      station.idealNx = length > 0 ? nx / length : station.nx;
      station.idealNy = length > 0 ? ny / length : station.ny;
    }
  }
};

// Stands a side's troops at their ideal places, each at its own depth behind
// the line: for a battlefield that has just opened, when there is nowhere for
// them to have come from.
export const standAtPlaces = (battle, side) => {
  const { field, place } = battle;
  const back = side === HOLDER_SIDE_A ? -1 : 1;
  for (const troop of battle.troops[side]) {
    const station = troop.station;
    if (!station) continue;
    const depth = standOff(troop, place.kmAt);
    for (const share of [1, 0.5, 0.25, 0.05]) {
      const x = station.idealX + station.idealNx * back * depth * share;
      const y = station.idealY + station.idealNy * back * depth * share;
      if (!stands(field, side, x, y)) continue;
      troop.x = x;
      troop.y = y;
      break;
    }
  }
};

// ---- stepping ------------------------------------------------------------------

// Where a step of `length` cells along a heading ends, by the first of the
// heading itself and its fixed turns that `allowed(x, y)` accepts: a little
// to either side (30 and 60 degrees), else the troop waits. Answers through
// `out`; false when none is allowed and the troop stays.
export const stepAlong = (x, y, hx, hy, length, allowed, out) => {
  for (let turn = -1; turn < TURNS.length / 2; turn += 1) {
    const cos = turn < 0 ? 1 : TURNS[turn * 2];
    const sin = turn < 0 ? 0 : TURNS[turn * 2 + 1];
    const tx = x + (hx * cos - hy * sin) * length;
    const ty = y + (hx * sin + hy * cos) * length;
    if (!allowed(tx, ty)) continue;
    out[0] = tx;
    out[1] = ty;
    return true;
  }
  return false;
};

// ---- the list a record keeps ----------------------------------------------------

// The dead of the last run are dropped as a run begins, and the named
// formations follow their troops to their new places in the list.
export const dropTheDead = (troops, named) => {
  const kept = [[], []];
  const moved = [new Map(), new Map()];
  for (let side = 0; side < 2; side += 1) {
    troops[side].forEach((troop, index) => {
      if (!isLive(troop)) return;
      moved[side].set(index, kept[side].length);
      kept[side].push(troop);
    });
  }
  const names = [];
  for (const entry of named) {
    const index = moved[entry.s]?.get(entry.i);
    if (index === undefined || !kept[entry.s][index].named) continue;
    names.push({ ...entry, i: index });
  }
  // A counter marked as a named formation that no name answers for is an ordinary one.
  for (let side = 0; side < 2; side += 1) {
    kept[side].forEach((troop, index) => {
      if (troop.named && !names.some((entry) => entry.s === side && entry.i === index)) troop.named = false;
    });
  }
  return { troops: kept, named: names };
};

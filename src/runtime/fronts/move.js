/*! Open Historia — battlefields and fronts: who goes where © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// WHO GOES WHERE each day is decided here and nowhere else; combat.js only
// says how far a step gets and what it costs.
//
// Troops are a swarm. Each steers by itself: by the way its order gives it,
// its own place across its group, the weak places in front of it and a slow
// drift of its own. It turns by degrees and never goes against its way. Its
// neighbours do not steer it; crowding only eases it a little aside.
//
// A troop with no order moves only when it must: off ground that is no longer
// its side's or when the other side's ground has come right up to it (it
// picks ONE place to fall back to and goes straight there: straight back from
// the line where it can), up to a line that has gone on without it, and along
// its own ground toward fighting that is near. One left on the other side's
// ground with nowhere to go, or two days on it out of reach of its own, is
// taken.
//
// And it keeps its way back open. Where the way to its side's deep ground is
// being pinched by ground the other side has taken, it has been got round, and
// gives the ground up, a day's march, before that is a pocket: a line pushed
// in at two places draws back between them and stays a line.
//
// A troop that is dug in does not move at all: not for that either. It stands
// and may be shut in, which is what telling troops to dig in is for.
//
// Nobody is left alive behind the other side's line. A troop under an order
// that the other side has walked past (the ground under it theirs, and its own
// side's further off than its own brush reaches) is driven off like any other:
// back onto its own side's ground, and on with its order from there; with none
// to go to it is taken. Ground lost under it at the line itself, its own
// side's still within its brush, is ground still being fought for: it stands.
//
// A RANK stays a rank. One told to advance, to blitz or to pursue goes no
// faster than the ground its side holds round it allows (troop.paceFactor):
// the few that slip past the defenders hold the breach until the rest come up,
// and do not run on down a corridor a brush or two wide. A spearhead, a flank
// and an encirclement are thrusts, and narrow because they mean to be.
//
// A general advance (every troop straight out from where it stands, way.js) is
// a LINE going forward. Each of them looks to those advancing beside it, a
// long way along the line: further forward than they are, it slows for them;
// with more of them on one hand than the other, its way moves over toward the
// emptier hand. So nobody runs on as a finger between the other side's troops,
// and where the ways run together the crowd thins out along the line.
//
// A formation an assault has reached is fought where it stands: it does not
// fall back from under those that are upon it.
//
// Besides the ways its side's orders give (way.js), a troop may be sent:
//   { kind: "reduce" }     at ground to be closed on: in, through, once
//   { kind: "assault" }    at a named city, structure or formation
//   { kind: "breakout" }   out of a pocket, toward its own side's ground
//   { kind: "fallback" }   back from the line, a little further every day
//   { kind: "pursue" }     after a side that is falling back
// The first two keep the order it was taken off as `resume`, and it goes on
// with that when it has done.

import { hashSeed } from "../unitMotion.js";
import {
  ADRIFT_DAYS,
  ASSAULT_DAYS,
  ASSAULT_WEAR,
  ATTACK_LAPSE_DAYS,
  BLITZ_PACE,
  BREAK_OUT_DAYS,
  BREAK_OUT_KM,
  BREAK_OUT_REST_DAYS,
  CLOSE_DAYS_MOST,
  CLOSE_GIVEN_UP_DAYS,
  CLOSE_LEAVES_KM,
  CLOSE_REST_DAYS,
  CLOSE_WORN,
  COME_UP_FROM,
  COME_UP_KM,
  COME_UP_TO,
  COMPASS_16,
  CONTROL_RADIUS_MAX_KM,
  DEEP_KM,
  DRIFT_DAYS,
  EASE_KM,
  EASE_SHARE,
  FALL_BACK_FROM_KM,
  FALL_BACK_KM_PER_DAY,
  FALL_BACK_MAX_KM,
  FALL_BACK_PACE_KM,
  FALL_BACK_SEARCH_KM,
  FRONT_PACE_SHARE,
  GAVE_GROUND_REST_DAYS,
  HAND_STALL_KM,
  HEADING_KEPT,
  HEADING_KEPT_CLOSING,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  HOLD_BACK_TO,
  HOLD_TOO_NEAR,
  OUTFLANKED_FROM_KM,
  OUTFLANKED_NARROW,
  OUTFLANKED_NECK_KM,
  RANK_BAND_KM,
  RANK_KM,
  RANK_LEAST,
  RANK_SLACK_KM,
  ROOM_BRUSHES,
  SLIDE_BAND,
  SPREAD_KM,
  SPREAD_KM_PER_DAY,
  STRAIGHT_BACK_FURTHER,
  SLIDE_FAR_KM,
  SLIDE_HEARS_KM,
  SLIDE_KM,
  SLIDE_LEAST_DEPTH,
  SLIDE_NEAR_KM,
  SLOT_SLIDE_KM,
  SLOT_SLIDE_MOST,
  ANCHOR_FREE_KM,
  SUPPORT_FULL,
  SUPPORT_KM,
  SUPPORT_NONE,
  STEER_DRIFT,
  STEER_PRESS,
  STEER_PRESS_KM,
  STRANDED_DAYS,
  THROWN_OUT_LOSS,
  TURN_CLOSING,
  TURN_COS,
  TURN_SIN,
  WAY_LEAST,
} from "./constants.js";
import { drawIn, liveOrder } from "./closing.js";
import { eachNear, squaresOf } from "./combat.js";
import { awayOf, cellAt, cellsOf, distanceFrom, downhill, heldRound, measure, nearestOf, outwardOf } from "./ground.js";
import { describePoint, inSector } from "./sectors.js";
import { KIND_ARTILLERY, STATE_ADVANCING, controlRadius, isLive, reachCells, standOff, stands } from "./troops.js";
import { aimOut, leftOnLeg } from "./way.js";
import { OWN_GROUND_PACE, marchKmOf, marchOn } from "./march.js";

const toward = [0, 0];

const halted = (battle, side, x, y) => {
  for (const halt of battle.haltsToday) if (halt.s === side && inSector(halt.sector, x, y, battle.place.kmAt)) return true;
  return false;
};

const turnTo = (troop, x, y) => {
  const length = Math.sqrt(x * x + y * y);
  if (!(length > 0)) return;
  troop.hx = x / length;
  troop.hy = y / length;
};

// ---- holding -------------------------------------------------------------------

// The one place a troop driven off falls back to: the nearest of its own
// side's ground far enough from the other's, or null when there is none near.
export const placeBehind = (battle, side, troop, depth) => {
  const { field } = battle;
  const toOther = battle.toSide[1 - side];
  const reach = Math.ceil(FALL_BACK_SEARCH_KM / battle.place.kmAt(troop.y));
  const col0 = Math.floor(troop.x);
  const row0 = Math.floor(troop.y);
  let best = Infinity;
  let found = null;
  for (let row = Math.max(0, row0 - reach); row <= Math.min(field.rows - 1, row0 + reach); row += 1) {
    for (let col = Math.max(0, col0 - reach); col <= Math.min(field.cols - 1, col0 + reach); col += 1) {
      const cell = row * field.cols + col;
      if (field.holders[cell] !== side || toOther[cell] / 3 < depth * HOLD_BACK_TO) continue;
      const distance = (col + 0.5 - troop.x) * (col + 0.5 - troop.x) + (row + 0.5 - troop.y) * (row + 0.5 - troop.y);
      if (distance < best) {
        best = distance;
        found = [col + 0.5, row + 0.5];
      }
    }
  }
  return found;
};

// Straight back from the other side's ground, to the first of its own side's
// that is far enough from it: null where there is none of the other side's
// near to go back from, or the way back runs off the land.
const straightBack = (battle, side, troop, depth) => {
  const { field } = battle;
  const km = battle.place.kmAt(troop.y);
  if (!outwardOf(field, side, troop.x, troop.y, FALL_BACK_FROM_KM / km, toward)) return null;
  const toOther = battle.toSide[1 - side];
  const backX = -toward[0];
  const backY = -toward[1];
  const reach = FALL_BACK_SEARCH_KM / km;
  for (let gone = 0.5; gone <= reach; gone += 0.5) {
    const x = troop.x + backX * gone;
    const y = troop.y + backY * gone;
    const cell = cellAt(field, x, y);
    if (cell < 0 || !field.play[cell]) return null;
    if (field.holders[cell] === side && toOther[cell] / 3 >= depth * HOLD_BACK_TO) return [x, y];
  }
  return null;
};

// What a holding troop keeps its way back open by, worked out once for each
// change of the ground:
//   deep[side]    for every cell, WHICH cell of that side's deep ground is
//                 nearest it (its ground DEEP_KM or more from any of the
//                 other's); -1 where it has none
//   taken[side]   how far every cell is from ground that side has taken (holds
//                 away from home), in thirds of a cell
const retreatBooks = (battle) => {
  const { field } = battle;
  if (battle.retreat && battle.retreat.field === field && battle.retreat.turns === field.turns) return battle.retreat;
  const { cols, rows, size, holders } = field;
  const toSide = measure(battle);
  const books = battle.retreat && battle.retreat.size === size ? battle.retreat
    : { size, deep: [new Int32Array(size), new Int32Array(size)], taken: [new Int32Array(size), new Int32Array(size)], labels: new Int32Array(size), far: new Int32Array(size) };
  const deepThirds = (DEEP_KM / battle.frame.km) * 3;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (let cell = 0; cell < size; cell += 1) books.labels[cell] = holders[cell] === side && toSide[1 - side][cell] >= deepThirds ? cell : -1;
    nearestOf(cols, rows, books.labels, books.far, books.deep[side]);
    distanceFrom(cols, rows, (cell) => holders[cell] === side && battle.homes[cell] !== side, books.taken[side]);
  }
  books.field = field;
  books.turns = field.turns;
  battle.retreat = books;
  return books;
};

// Whether a point on a side's ground has been got round: its way back to its
// side's deep ground is pinched by ground the other side has taken (see
// OUTFLANKED_NARROW). The way back is left in `toward`. false where the way is
// shut already, which is a pocket's business and not a retreat's.
const outflanked = (battle, side, x, y) => {
  const { field } = battle;
  const books = retreatBooks(battle);
  const here = cellAt(field, x, y);
  const target = here >= 0 ? books.deep[side][here] : -1;
  if (target < 0) return false;
  const dx = (target % field.cols) + 0.5 - x;
  const dy = Math.floor(target / field.cols) + 0.5 - y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0)) return false;
  toward[0] = dx / length;
  toward[1] = dy / length;
  const km = battle.place.kmAt(y);
  const taken = books.taken[1 - side];
  const least = OUTFLANKED_NECK_KM / km;
  for (let gone = OUTFLANKED_FROM_KM / km; gone <= length; gone += 1) {
    const cell = cellAt(field, x + toward[0] * gone, y + toward[1] * gone);
    if (cell < 0 || field.holders[cell] !== side) return false;
    if (taken[cell] / 3 < Math.max(least, gone * OUTFLANKED_NARROW)) return true;
  }
  return false;
};

// The moves of a troop with no order to carry out today. `attackers` are the
// other side's troops that walked forward yesterday.
const hold = (battle, side, troop, day, date, attackers) => {
  // A formation an assault has reached is fought where it stands.
  if (troop.pinned >= day - 1) return;
  const { field, arena, place } = battle;
  const { kmAt } = place;
  const other = 1 - side;
  const km = kmAt(troop.y);
  const depth = standOff(troop, kmAt);
  const toOther = battle.toSide[other];
  const onOwn = stands(field, side, troop.x, troop.y);
  const away = onOwn ? awayOf(battle, side, troop.x, troop.y) : 0;
  const order = liveOrder(troop);
  // Days on end on the other side's ground, its own side's out of reach: it
  // does not get away. (Not one that is cut off on ground of its own: that is
  // a pocket's business.)
  troop.adrift = onOwn || cellsOf(field, battle.toSide[side], troop.x, troop.y) * battle.frame.km <= CONTROL_RADIUS_MAX_KM ? 0 : troop.adrift + 1;
  if (troop.adrift >= ADRIFT_DAYS && !troop.pocket) {
    const at = describePoint(arena, troop.x, troop.y);
    if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
    troop.strength = 0;
    return;
  }

  // Told to fall back: away from the other side's ground, or toward the place
  // named, a day's march further every day until it has gone far enough. (One
  // the other side has already walked over is driven off like any other.)
  // (Told to WITHDRAW it goes back the same way with no end to how far: it is
  // on its way off the battlefield, and `home` says it can go no further back.)
  if (order && (order.kind === "fallback" || order.kind === "withdraw") && onOwn) {
    const leaving = order.kind === "withdraw";
    if (!leaving && order.gone >= FALL_BACK_MAX_KM) return;
    let dx = 0;
    let dy = 0;
    if (order.target) {
      dx = order.target.x - troop.x;
      dy = order.target.y - troop.y;
    } else if (downhill(field, toOther, troop.x, troop.y, toward)) {
      dx = -toward[0];
      dy = -toward[1];
    }
    const gap = Math.sqrt(dx * dx + dy * dy);
    if (!(gap > 0.05)) {
      if (leaving) order.home = true;
      return;
    }
    const step = Math.min(order.target ? gap : Infinity, FALL_BACK_KM_PER_DAY / km);
    for (const share of [1, 0.5, 0.25]) {
      const x = troop.x + (dx / gap) * step * share;
      const y = troop.y + (dy / gap) * step * share;
      if (!stands(field, side, x, y)) continue;
      troop.x = x;
      troop.y = y;
      troop.movedKm += step * share * km;
      order.gone += step * share * km;
      turnTo(troop, dx, dy);
      return;
    }
    if (leaving) order.home = true;
    return;
  }

  // The place it is falling back to is done with when it is there, or when
  // the place itself has been lost: then it picks again.
  if (troop.fallback && ((Math.abs(troop.fallback[0] - troop.x) < 0.3 && Math.abs(troop.fallback[1] - troop.y) < 0.3)
    || field.holders[cellAt(field, troop.fallback[0], troop.fallback[1])] !== side)) troop.fallback = null;
  if (!troop.fallback && (!onOwn || away < depth * HOLD_TOO_NEAR)) {
    // Driven off: it picks ONE place to fall back to and goes straight there.
    // Straight back from the other side's ground where it can; but to the
    // nearest of its own side's ground that will do where that is much the
    // nearer, or there is no way straight back.
    const nearest = placeBehind(battle, side, troop, depth);
    const back = straightBack(battle, side, troop, depth);
    const reach = (place) => Math.sqrt((place[0] - troop.x) * (place[0] - troop.x) + (place[1] - troop.y) * (place[1] - troop.y));
    troop.fallback = back && (!nearest || reach(back) <= reach(nearest) * STRAIGHT_BACK_FURTHER + 1) ? back : nearest;
  }
  // Nowhere of its own side's to fall back to: after a day of that it is taken
  // where it stands. Nobody is left alive behind the other side's lines.
  if (!onOwn && !troop.fallback && !troop.pocket) {
    troop.stranded += 1;
    if (troop.stranded >= STRANDED_DAYS) {
      const at = describePoint(arena, troop.x, troop.y);
      if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
      troop.strength = 0;
      return;
    }
  } else troop.stranded = 0;

  if (troop.fallback) {
    const dx = troop.fallback[0] - troop.x;
    const dy = troop.fallback[1] - troop.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = Math.min(distance, FALL_BACK_PACE_KM / km);
    if (!(distance > 0)) return;
    // A day's march toward a place further off than that must not end where
    // nobody can stand (the nearest of its own ground may lie beyond a range
    // or a lake): it stops short of it, and with nowhere to stop picks again.
    for (const share of [1, 0.75, 0.5, 0.25]) {
      const x = troop.x + (dx / distance) * step * share;
      const y = troop.y + (dy / distance) * step * share;
      const landing = cellAt(field, x, y);
      if (landing < 0 || !field.play[landing]) continue;
      troop.x = x;
      troop.y = y;
      troop.movedKm += step * share * km;
      turnTo(troop, dx, dy);
      return;
    }
    troop.fallback = null;
    return;
  }
  if (troop.pocket || !onOwn) return;
  // Got round, its way back being pinched: it gives the ground up rather than
  // be shut in, a day's march along that way.
  if (!order && outflanked(battle, side, troop.x, troop.y)) {
    const backX = toward[0];
    const backY = toward[1];
    const step = (FALL_BACK_PACE_KM * Math.max(1, battle.pace / FRONT_PACE_SHARE)) / km;
    // As far as clears it and no further; a full day's march if nothing nearer does.
    let gone = 0;
    for (const share of [0.25, 0.5, 0.75, 1]) {
      const x = troop.x + backX * step * share;
      const y = troop.y + backY * step * share;
      if (!stands(field, side, x, y)) continue;
      gone = share;
      if (!outflanked(battle, side, x, y)) break;
    }
    troop.gave = day;
    if (!(gone > 0)) return;
    troop.x += backX * step * gone;
    troop.y += backY * step * gone;
    troop.movedKm += step * gone * km;
    turnTo(troop, backX, backY);
    return;
  }
  if (away >= depth * SLIDE_BAND[0] && away <= depth * SLIDE_BAND[1]) {
    // Fighting some way off along its own ground: it slides toward it, and
    // never turns back on itself to do so.
    if (order || attackers.length === 0) return;
    const hears = SLIDE_HEARS_KM / km;
    let callX = 0;
    let callY = 0;
    let closest = Infinity;
    for (const enemy of attackers) {
      const dx = enemy.x - troop.x;
      const dy = enemy.y - troop.y;
      if (Math.abs(dx) > hears || Math.abs(dy) > hears) continue;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > hears || !(distance > 0)) continue;
      if (distance < closest) closest = distance;
      callX += dx / (distance * distance);
      callY += dy / (distance * distance);
    }
    // Already in it, or nothing near enough to answer: it stands.
    if (!(closest * km > SLIDE_NEAR_KM && closest * km < SLIDE_FAR_KM)) return;
    if (!downhill(field, toOther, troop.x, troop.y, toward)) return;
    const into = callX * toward[0] + callY * toward[1];
    let slideX = callX - toward[0] * into;
    let slideY = callY - toward[1] * into;
    const length = Math.sqrt(slideX * slideX + slideY * slideY);
    if (!(length > 0)) return;
    slideX /= length;
    slideY /= length;
    // A call that would turn it round is not answered.
    if (troop.slid && slideX * troop.hx + slideY * troop.hy <= 0.25) return;
    let goX = troop.slid ? 0.6 * troop.hx + 0.4 * slideX : slideX;
    let goY = troop.slid ? 0.6 * troop.hy + 0.4 * slideY : slideY;
    const going = Math.sqrt(goX * goX + goY * goY);
    goX /= going;
    goY /= going;
    const step = (SLIDE_KM / km) * troop.drive;
    const landing = cellAt(field, troop.x + goX * step, troop.y + goY * step);
    if (landing < 0 || field.holders[landing] !== side || toOther[landing] / 3 < depth * SLIDE_LEAST_DEPTH) return;
    troop.x += goX * step;
    troop.y += goY * step;
    troop.movedKm += step * km;
    troop.hx = goX;
    troop.hy = goY;
    troop.slid = true;
  } else if (!troop.order && away > depth * COME_UP_FROM && day - troop.gave >= GAVE_GROUND_REST_DAYS) {
    // A line that has gone on without it: it comes up, to within its depth.
    // (Not back into ground it would only have to give up again.)
    if (!downhill(field, toOther, troop.x, troop.y, toward)) return;
    const upX = toward[0];
    const upY = toward[1];
    // (Over its own ground: with troops marching, at their march: march.js.)
    const step = Math.min((battle.marchKm ? Math.max(COME_UP_KM, battle.marchKm[troop.kind]) : COME_UP_KM) / km, away - depth * COME_UP_TO);
    const landing = cellAt(field, troop.x + upX * step, troop.y + upY * step);
    if (landing < 0 || field.holders[landing] !== side || outflanked(battle, side, troop.x + upX * step, troop.y + upY * step)) return;
    troop.x += upX * step;
    troop.y += upY * step;
    troop.movedKm += step * km;
    troop.hx = upX;
    troop.hy = upY;
  }
};

// ---- under an order ------------------------------------------------------------

// A troop that has done with closing on a pocket goes on with what it was at.
const endReduce = (troop, day, passed) => {
  const { order } = troop;
  if (passed) troop.rested = day + CLOSE_REST_DAYS;
  if (order.resume && !order.resume.done) troop.order = order.resume;
  else order.done = true;
};

// Turns a troop that is carrying out an order, and says which way it steps
// today: troop.gx, troop.gy, with troop.stepping set. `weights` are the pulls
// on it, which a test may set aside.
const steer = (battle, run, side, index, troop, order, day, date, squares, weights) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const other = 1 - side;
  const km = kmAt(troop.y);
  const cellKm = battle.frame.km;
  const books = battle.close;
  let ax = troop.hx;
  let ay = troop.hy;
  let slide = 0;
  let closing = false;
  let ranked = false;
  if (order.kind === "breakout") {
    // Toward its own side's ground, until it is joined to it again.
    if (!troop.pocket) {
      order.done = true;
      return;
    }
    if (downhill(field, books.toSupplied[side], troop.x, troop.y, toward)) [ax, ay] = toward;
  } else if (order.kind === "assault") {
    const { entry } = order;
    // A formation moves: it is followed.
    if (entry.unit) {
      entry.x = entry.unit.x;
      entry.y = entry.unit.y;
    }
    const there = cellAt(field, entry.x, entry.y);
    const done = entry.unit ? !isLive(entry.unit) : there >= 0 && field.holders[there] === side;
    if (done || day - entry.day > ASSAULT_DAYS) {
      if (done && !entry.taken) {
        entry.taken = day;
        if (entry.kind !== "city") battle.log.push({ d: date, k: entry.unit ? "destroyed" : "taken", s: side, at: entry.name });
      }
      entry.over = true;
      if (order.resume && !order.resume.done) troop.order = order.resume;
      else order.done = true;
      return;
    }
    const gapX = entry.x - troop.x;
    const gapY = entry.y - troop.y;
    const gap = Math.sqrt(gapX * gapX + gapY * gapY);
    // Close enough for its part: it stands there, its ground round the place,
    // and whoever is nearest takes it. Nobody stacks on the spot.
    if (gap <= order.ring / km) {
      if (entry.unit && gap < reachCells(kmAt, troop.y)) {
        // Upon it: it is worn, and it does not get away while they are.
        entry.unit.strength = Math.max(0, entry.unit.strength - ASSAULT_WEAR);
        entry.unit.pinned = day;
      }
      troop.plant = true;
      return;
    }
    ax = gapX / gap;
    ay = gapY / gap;
  } else if (order.kind === "reduce") {
    // At ground to be closed on. It goes through ONCE: out the other side it
    // has done its part and never turns about for a second pass.
    const here = cellAt(field, troop.x, troop.y);
    const left = here >= 0 ? (books.toPrey[side][here] / 3) * cellKm : Infinity;
    const pocket = here >= 0 && books.preyNear[side][here] >= 0 ? books.pockets[side][books.preyNear[side][here]] : null;
    if (!pocket || left > CLOSE_LEAVES_KM[order.resume ? 1 : 0]) {
      endReduce(troop, day, false);
      return;
    }
    // Long enough at it: it has done its part, and others are sent if more is needed.
    if (day - order.day >= CLOSE_DAYS_MOST) {
      endReduce(troop, day, true);
      return;
    }
    const lies = left > 0.5 * cellKm && downhill(field, books.toPrey[side], troop.x, troop.y, toward);
    if (order.entered && lies && toward[0] * troop.hx + toward[1] * troop.hy < 0.1) {
      endReduce(troop, day, true);
      return;
    }
    if (left <= 0.5 * cellKm) order.entered = true;
    // Straight in from where it stands, and straight on through.
    if (lies) [ax, ay] = toward;
    closing = true;
  } else if (order.kind === "pursue") {
    if (downhill(field, battle.toSide[other], troop.x, troop.y, toward)) [ax, ay] = toward;
    ranked = true;
  } else {
    // Along its leg, to the line across the leg's end: the whole group crosses
    // a line, nobody is sent to a point.
    let leg = order.legs[order.leg];
    const last = order.leg === order.legs.length - 1;
    if (leftOnLeg(leg, troop) <= (last ? (1 - order.stop) * leg.length : 0)) {
      if (last) {
        order.done = true;
        return;
      }
      order.leg += 1;
      leg = order.legs[order.leg];
    }
    ax = leg.ax;
    ay = leg.ay;
    // Its own place across the group: it works its way there as it goes.
    const across = (troop.x - leg.ox) * -leg.ay + (troop.y - leg.oy) * leg.ax;
    slide = Math.max(-SLOT_SLIDE_MOST, Math.min(SLOT_SLIDE_MOST, (order.slot - across) / (SLOT_SLIDE_KM / km)));
    if (order.word === "blitz") troop.paceFactor = BLITZ_PACE;
    ranked = order.word === "advance" || order.word === "blitz";
  }
  // A rank stays a rank: one of it goes no faster than the ground its side
  // holds round it allows, and run out ahead it waits for the rest to come up.
  // (Not a thrust, which is narrow because it means to be; nor one sent
  // straight at a place, closing on a pocket or breaking out.)
  if (ranked && (weights.rank ?? 1) > 0) {
    // (Not a force put ashore, near the place that feeds it: it has no ground behind it to wait for.)
    const free = ANCHOR_FREE_KM / km;
    const ashore = battle.anchors.some((anchor) => anchor.s === side && (anchor.x - troop.x) * (anchor.x - troop.x) + (anchor.y - troop.y) * (anchor.y - troop.y) <= free * free);
    if (!ashore) {
      const held = heldRound(field, side, troop.x, troop.y, SUPPORT_KM / km);
      troop.paceFactor *= Math.max(0, Math.min(1, (held - SUPPORT_NONE) / (SUPPORT_FULL - SUPPORT_NONE)));
    }
  }
  // And one going straight out in a general advance keeps its place in the
  // line: further forward than those advancing beside it, it slows for them.
  if (order.own && (weights.rank ?? 1) > 0) {
    const within = RANK_KM / km;
    const room = SPREAD_KM / km;
    let weight = 0;
    let forward = 0;
    let crowd = 0;
    for (const mate of battle.troops[side]) {
      if (mate === troop || !isLive(mate)) continue;
      const dx = mate.x - troop.x;
      const dy = mate.y - troop.y;
      if (Math.abs(dx) >= within || Math.abs(dy) >= within) continue;
      const theirs = liveOrder(mate);
      if (!theirs || !theirs.own) continue;
      const apart = Math.sqrt(dx * dx + dy * dy);
      if (apart >= within) continue;
      weight += 1 - apart / within;
      forward += (1 - apart / within) * (dx * ax + dy * ay);
      // Which hand of it the mate is on, across its way: left counts up.
      if (apart < room) crowd += (dx * -ay + dy * ax >= 0 ? 1 : -1) * (1 - apart / room);
    }
    const lead = weight > 0 ? (-forward / weight) * km : 0;
    if (lead > RANK_SLACK_KM) troop.paceFactor *= Math.max(RANK_LEAST, 1 - (lead - RANK_SLACK_KM) / RANK_BAND_KM);
    // It keeps its room along the line: its way moves over, away from the crowded hand.
    if (crowd !== 0) {
      const leg = order.legs[order.leg];
      const across = (troop.x - leg.ox) * -leg.ay + (troop.y - leg.oy) * leg.ax;
      const most = SLOT_SLIDE_KM / km;
      order.slot = Math.max(across - most, Math.min(across + most, order.slot - Math.max(-1, Math.min(1, crowd)) * (SPREAD_KM_PER_DAY / km)));
    }
  }

  // The weak places in front of it: away from where the defenders are thick.
  let pressX = 0;
  let pressY = 0;
  const pressing = closing ? 0 : weights.resistance ?? STEER_PRESS;
  if (pressing > 0) {
    const within = STEER_PRESS_KM / km;
    eachNear(squares[other], troop.x, troop.y, (enemy) => {
      const dx = enemy.x - troop.x;
      const dy = enemy.y - troop.y;
      const apart = dx * dx + dy * dy;
      if (!(apart > 0) || apart > within * within || dx * troop.hx + dy * troop.hy <= 0) return;
      pressX -= (enemy.strength * dx) / apart;
      pressY -= (enemy.strength * dy) / apart;
    });
    const length = Math.sqrt(pressX * pressX + pressY * pressY);
    pressX = length > 0 ? pressX / length : 0;
    pressY = length > 0 ? pressY / length : 0;
  }
  // A slow drift of its own, so that no two walk alike: two points of a
  // sixteen-sided figure, by the seed, the troop and the days, blended.
  const drifting = weights.wander ?? STEER_DRIFT;
  let driftX = 0;
  let driftY = 0;
  if (drifting > 0) {
    const block = Math.floor(day / DRIFT_DAYS);
    const from = hashSeed([battle.seed, battle.name, "drift", side, index, block].join("|")) % 16;
    const to = hashSeed([battle.seed, battle.name, "drift", side, index, block + 1].join("|")) % 16;
    const part = (day - block * DRIFT_DAYS) / DRIFT_DAYS;
    driftX = COMPASS_16[from * 2] + (COMPASS_16[to * 2] - COMPASS_16[from * 2]) * part;
    driftY = COMPASS_16[from * 2 + 1] + (COMPASS_16[to * 2 + 1] - COMPASS_16[from * 2 + 1]) * part;
  }
  let wantX = ax - ay * slide + pressing * pressX + drifting * driftX;
  let wantY = ay + ax * slide + pressing * pressY + drifting * driftY;
  const wanting = Math.sqrt(wantX * wantX + wantY * wantY);
  wantX = wanting > 0 ? wantX / wanting : ax;
  wantY = wanting > 0 ? wantY / wanting : ay;

  // It turns by degrees: never more than 30 in a day (45 closing on a pocket,
  // which is close work), and never against its way.
  const keep = closing ? HEADING_KEPT_CLOSING : HEADING_KEPT;
  const most = closing ? TURN_CLOSING : TURN_COS;
  const mostSin = closing ? TURN_CLOSING : TURN_SIN;
  const fromX = troop.hx;
  const fromY = troop.hy;
  let headX = keep * fromX + (1 - keep) * wantX;
  let headY = keep * fromY + (1 - keep) * wantY;
  let length = Math.sqrt(headX * headX + headY * headY);
  headX = length > 0 ? headX / length : wantX;
  headY = length > 0 ? headY / length : wantY;
  const kept = headX * fromX + headY * fromY;
  if (kept < most) {
    let acrossX = headX - fromX * kept;
    let acrossY = headY - fromY * kept;
    length = Math.sqrt(acrossX * acrossX + acrossY * acrossY);
    acrossX = length > 0 ? acrossX / length : -fromY;
    acrossY = length > 0 ? acrossY / length : fromX;
    headX = most * fromX + mostSin * acrossX;
    headY = most * fromY + mostSin * acrossY;
  }
  const onward = headX * ax + headY * ay;
  if (onward < WAY_LEAST) {
    headX += ax * (WAY_LEAST - onward) * 2;
    headY += ay * (WAY_LEAST - onward) * 2;
    length = Math.sqrt(headX * headX + headY * headY);
    headX = length > 0 ? headX / length : ax;
    headY = length > 0 ? headY / length : ay;
  }
  troop.hx = headX;
  troop.hy = headY;
  troop.axisX = ax;
  troop.axisY = ay;

  // Its neighbours do not steer it. Those that crowd it only ease it aside,
  // across its way, and by little.
  const room = controlRadius(troop, kmAt) * ROOM_BRUSHES;
  let apartX = 0;
  let apartY = 0;
  eachNear(squares[side], troop.x, troop.y, (mate) => {
    if (mate === troop) return;
    const dx = troop.x - mate.x;
    const dy = troop.y - mate.y;
    if (Math.abs(dx) > room || Math.abs(dy) > room) return;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (!(distance > 0) || distance >= room) return;
    apartX += (dx / distance) * (1 - distance / room);
    apartY += (dy / distance) * (1 - distance / room);
  });
  const paceKm = run.advanceKm[troop.kind] * run.pace * troop.drive * troop.paceFactor;
  const ease = Math.max(-1, Math.min(1, apartX * -headY + apartY * headX)) * Math.min(EASE_KM / Math.max(1, paceKm), EASE_SHARE);
  let goX = headX - headY * ease;
  let goY = headY + headX * ease;
  length = Math.sqrt(goX * goX + goY * goY);
  troop.gx = goX / length;
  troop.gy = goY / length;
  troop.stepping = true;
  troop.reducing = closing;
  // Worn down closing on ground that fights back: it gives the attempt up,
  // and rests before it is sent at anything again.
  if (closing && troop.strength < CLOSE_WORN) {
    order.done = true;
    troop.rested = day + CLOSE_GIVEN_UP_DAYS;
    troop.stepping = false;
  }
};

// ---- the day -------------------------------------------------------------------

// Decides every troop's day: who is drawn off to close on a pocket, who tries
// to break out, who is thrown out of its works; the moves of those with no
// order; and for those under one, which way each steps. The steps themselves
// are combat.js's (stepForward).
export const moveDay = (battle, run, day) => {
  const { field } = battle;
  battle.pace = run.pace;
  // Marching (march.js): what a troop on its way to the line covers in a day, and how much faster any step over its
  // own side's ground is than through the other side's.
  battle.marchKm = run.mech?.marching === true ? marchKmOf(run) : null;
  battle.ownPace = run.mech?.marching === true ? OWN_GROUND_PACE : 1;
  const { kmAt } = battle.place;
  const date = run.dateOf(day);
  const toSide = measure(battle);
  const books = battle.close;
  const cellKm = battle.frame.km;
  const weights = run.steer ?? {};
  const squares = [squaresOf(battle, battle.troops[0], isLive), squaresOf(battle, battle.troops[1], isLive)];
  const walked = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => battle.troops[side].filter((troop) => isLive(troop) && troop.state === STATE_ADVANCING));
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const other = 1 - side;
    if (!run.braked) drawIn(battle, side, day);
    // (Troops that WITHDRAW are not followed up: they are leaving, and the ground stays as it is unless the other side is ordered forward.)
    const falling = battle.views[other].filter((view) => view.word === "fall back");
    battle.troops[side].forEach((troop, index) => {
      troop.stepping = false;
      troop.reducing = false;
      troop.plant = false;
      troop.paceFactor = 1;
      if (!isLive(troop)) return;
      // It faces the other side's ground until it has somewhere to go.
      if (troop.hx === 0 && troop.hy === 0 && !downhill(field, toSide[other], troop.x, troop.y, toward)) toward[0] = side === HOLDER_SIDE_A ? 1 : -1;
      if (troop.hx === 0 && troop.hy === 0) [troop.hx, troop.hy] = toward;
      // An order that has been replaced, or has stood its time, is over.
      let order = liveOrder(troop);
      if (order && order.standing && (!battle.orders.includes(order.standing) || (order.kind === "way" && order.standing.age >= ATTACK_LAPSE_DAYS))) {
        troop.order = null;
        order = null;
      }
      // Cut off, and its own side's ground not far: it tries to break out to
      // it. (Not from a place under siege: a garrison holds.)
      // (Nor one that is leaving the battlefield: it goes on leaving, and is taken off where it can go no further.)
      if (troop.pocket && !troop.besieged && !troop.dug && troop.kind !== KIND_ARTILLERY && (!order || (order.kind !== "breakout" && order.kind !== "withdraw"))
        && troop.spent <= day && books.cut[side] && cellsOf(field, books.toSupplied[side], troop.x, troop.y) * cellKm < BREAK_OUT_KM) {
        order = { kind: "breakout", since: day, day };
        troop.order = order;
      }
      // Four days of trying and still cut off: it gives the attempt up and
      // holds where it is, and does not try again for a week.
      if (order && order.kind === "breakout" && day - order.day >= BREAK_OUT_DAYS && troop.pocket) {
        order.done = true;
        troop.spent = day + BREAK_OUT_REST_DAYS;
        order = null;
      }
      // No longer cut off (joined to its own side's ground again, or the
      // ground it stood on taken from under it): the breakout is over, and it
      // does today what a troop with no order does. A day is not lost on it.
      // So too when the ring it was breaking out of has closed into a siege:
      // a garrison holds.
      if (order && order.kind === "breakout" && (!troop.pocket || troop.besieged)) {
        order.done = true;
        order = null;
      }
      // Dug in: it does not move, whatever goes on round it, for as long as
      // the ground it stands on is its side's. When that is lost it is thrown
      // out of its works with a loss, and is a troop like any other again.
      if (troop.dug) {
        if (stands(field, side, troop.x, troop.y)) return;
        troop.dug = false;
        troop.dig = 0;
        troop.strength = Math.max(0, troop.strength - THROWN_OUT_LOSS);
        if (!isLive(troop)) return;
      }
      // Called up inside its country and still on its way to the line (march.js): it marches on, unless it was
      // given an order by hand, which it carries out from where it is.
      if (troop.goal >= 0 && battle.marchKm) {
        if (order && order.standing && order.standing.chosen) troop.goal = -1;
        else if (marchOn(battle, side, troop, battle.marchKm)) return;
      }
      // With no order of its own, and the other side falling back in front of it: it goes after it.
      if (!order && !troop.pocket && falling.length > 0) {
        const view = falling.find((entry) => inSector(entry.sector, troop.x, troop.y, kmAt));
        if (view) {
          order = { kind: "pursue", standing: view.order, since: day, day };
          troop.order = order;
        }
      }
      let acts = order && day >= order.since && order.kind !== "fallback" && order.kind !== "withdraw" && (!troop.pocket || order.kind === "breakout") ? order : null;
      // Under an order, and the other side has walked past it: the ground it
      // stands on is theirs, and its own side's is further off than its own
      // brush reaches. It is driven off like any other troop, back onto its
      // own side's ground (or taken, with none to go to), and goes on with its
      // order from there. Nobody attacks from behind the other side's line.
      // (Ground lost under it at the line itself, with its own side's still
      // within its brush, is ground still being fought for: it stands.)
      if (acts && acts.kind !== "breakout" && (troop.fallback
        || (!stands(field, side, troop.x, troop.y) && cellsOf(field, toSide[side], troop.x, troop.y) * cellKm > troop.radiusKm))) acts = null;
      if (!acts) {
        hold(battle, side, troop, day, date, walked[other]);
        return;
      }
      if (run.braked || halted(battle, side, troop.x, troop.y)) return;
      // Going straight out, it keeps its line while the other side's ground is before it.
      if (acts.kind === "way" && acts.own) aimOut(battle, run, side, troop, acts);
      // Under an order given by hand: where it last stood when it had got
      // somewhere, and on which day. An order that gets its troops nowhere any
      // more is given up when the run is saved (battle.js stuckOrders).
      if (acts.kind === "way" && acts.standing && acts.standing.chosen) {
        const apart = acts.markDay === undefined ? Infinity : Math.sqrt((troop.x - acts.markX) * (troop.x - acts.markX) + (troop.y - acts.markY) * (troop.y - acts.markY)) * kmAt(troop.y);
        if (apart > HAND_STALL_KM) {
          acts.markX = troop.x;
          acts.markY = troop.y;
          acts.markDay = day;
        }
      }
      steer(battle, run, side, index, troop, acts, day, date, squares, weights);
    });
  }
};

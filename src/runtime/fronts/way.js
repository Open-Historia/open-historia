/*! Open Historia — battlefields and fronts: an order as a way to go © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An attack order is never a point to gather at: troops sent to a point circle
// it and clump on it. It is a WAY for a group: a run of legs, each a direction
// and the line across the leg's end. A troop goes along its leg until it has
// crossed that line and then takes the next; past the last line it has done.
//
// Every troop of the group has its own place ACROSS the way (its slot, in
// cells to the left of it) and its own share of the last leg to go (its stop),
// so a group ends spread along the ground it took. The shape is the order's:
//
//   advance     a broad rank
//   blitz       a rank half as broad, that masses first and goes faster
//   spearhead   a point (the leading third, the armour in it) and its
//               shoulders, staggered back along the way
//   flank       a column, along a way that goes round
//   encircle    two columns, one each way round
//
// That is for a group sent AT something. An advance or a blitz with nothing
// named is not a group going one way: a line bends, and a third of it does not
// face the way the rest does. There every troop goes STRAIGHT OUT from where
// it stands, the way its own stretch of the line faces (giveOut), and keeps
// that line for as long as the other side's ground lies before it (aimOut).
//
// A troop under an order carries it as `troop.order`:
//   { kind: "way", standing, word, legs, leg, slot, stop, since, day }
// where `standing` is the standing order it serves, `since` the day it sets
// off and `day` the day it was told; one going straight out also has
// `own: true`. The other kinds a troop may carry are made in move.js:
// "fallback", "pursue", "reduce", "assault", "breakout".

import { hashSeed } from "../unitMotion.js";
import { nearestOnRoute } from "./command.js";
import {
  BLITZ_BREADTH,
  BLITZ_MASS_DAYS,
  COLUMN_BREADTH_KM,
  GROUP_BREADTH_BRUSHES,
  GROUP_BREADTH_MIN_KM,
  GROUP_BREADTH_OF_EXTENT,
  OUTWARD_KM,
  OUT_AHEAD_KM,
  POINT_BREADTH,
  POINT_STOPS_SHORT,
  ROUND_KM,
  ROUTE_BREADTH_BRUSHES,
  ROUTE_BREADTH_MIN_KM,
  ROUTE_JOIN_KM,
  ROUTE_SET_OFF_DAYS,
  ROUTE_STOPS_SHORT_KM,
  ROUTE_STOPS_SHORT_MOST,
  SHOULDER_OUT,
  SHOULDER_OUT_KM,
  SHOULDER_STOPS,
  SPEARHEAD_BREADTH_KM,
  WAY_BEND_CELLS,
  WAY_DAYS_MIN,
  WAY_LEGS_MAX,
} from "./constants.js";
import { cellAt, cheapestWay, clearBetween, downhill, measure, outwardOf } from "./ground.js";
import { KIND_ARMOUR, KIND_ARTILLERY, isLive } from "./troops.js";

// Gives a troop its next order. One that is closing on a pocket, or has been
// sent at a named place, finishes that first and goes on with the new order after.
export const takeOrder = (troop, next) => {
  const busy = troop.order && !troop.order.done && (troop.order.kind === "reduce" || troop.order.kind === "assault") ? troop.order : null;
  if (busy && next) busy.resume = next;
  else troop.order = next;
};

// A number from 0 up to 1 that is a battle's own for whatever names it.
export const chanceOf = (battle, ...parts) => (hashSeed([battle.seed, battle.name, ...parts].join("|")) % 10000) / 10000;

const aim = [0, 0];

// The legs of a way from a point through the points after it.
export const legsOf = (from, points) => {
  const legs = [];
  let [x, y] = from;
  for (const [ox, oy] of points) {
    const dx = ox - x;
    const dy = oy - y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.01) legs.push({ ax: dx / length, ay: dy / length, ox, oy, length });
    x = ox;
    y = oy;
  }
  return legs;
};

// A way over the ground, cell by cell, cut down to a few points. A way found
// from cell to cell runs along the rows and the diagonals, and its corners are
// the grid's and not the ground's: so first it is pulled straight, from each
// point kept on to the furthest point of the way that can be gone to in a
// straight line over ground in play. Only a way that still has too many legs
// after that is cut down to its end and the places where it bends furthest.
const bendsOf = (field, cells) => {
  const point = (index) => [(cells[index] % field.cols) + 0.5, Math.floor(cells[index] / field.cols) + 0.5];
  const pulled = [0];
  for (let at = 0; at < cells.length - 1;) {
    let next = at + 1;
    const [ax, ay] = point(at);
    for (let far = cells.length - 1; far > at + 1; far -= 1) {
      const [bx, by] = point(far);
      if (!clearBetween(field, ax, ay, bx, by)) continue;
      next = far;
      break;
    }
    pulled.push(next);
    at = next;
  }
  if (pulled.length - 1 <= WAY_LEGS_MAX) return pulled.slice(1).map(point);
  const kept = [0, cells.length - 1];
  while (kept.length - 1 < WAY_LEGS_MAX) {
    let worst = WAY_BEND_CELLS;
    let at = -1;
    for (let span = 0; span + 1 < kept.length; span += 1) {
      const [ax, ay] = point(kept[span]);
      const [bx, by] = point(kept[span + 1]);
      const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (!(length > 0)) continue;
      for (let index = kept[span] + 1; index < kept[span + 1]; index += 1) {
        const [px, py] = point(index);
        const off = Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / length;
        if (off > worst) {
          worst = off;
          at = index;
        }
      }
    }
    if (at < 0) break;
    kept.push(at);
    kept.sort((a, b) => a - b);
  }
  return kept.slice(1).map(point);
};

// Where a group stands: the middle of it, and the way out from its own ground
// toward the other side's as its troops see it.
const standingOf = (battle, side, picked) => {
  const { field } = battle;
  const troops = battle.troops[side];
  const toOther = measure(battle)[1 - side];
  let midX = 0;
  let midY = 0;
  let outX = 0;
  let outY = 0;
  for (const index of picked) {
    midX += troops[index].x / picked.length;
    midY += troops[index].y / picked.length;
    if (downhill(field, toOther, troops[index].x, troops[index].y, aim)) {
      outX += aim[0];
      outY += aim[1];
    }
  }
  // The way its stretch of the line faces, where the other side's ground is
  // near enough to say; else the way its troops each see it, taken together.
  if (outwardOf(field, side, midX, midY, OUTWARD_KM / battle.place.kmAt(midY), aim)) return { midX, midY, outX: aim[0], outY: aim[1] };
  const length = Math.sqrt(outX * outX + outY * outY);
  return { midX, midY, outX: length > 0 ? outX / length : side === 0 ? 1 : -1, outY: length > 0 ? outY / length : 0 };
};

// Tells a group of a side's troops (by their indexes) to go a way.
//   day        the day it is told
//   word       the order's word, which is its shape
//   way        the points the way goes through, in cells
//   standing   the standing order it serves
//   breadthKm  how broad the group is to go, where the shape does not say
//   lagless    for an order the group was already under: nobody waits to set off
export const give = (battle, side, picked, { day, word, way, standing, breadthKm = 0, lagless = false }) => {
  if (picked.length === 0 || way.length === 0) return;
  const { kmAt } = battle.place;
  const troops = battle.troops[side];
  let midX = 0;
  let midY = 0;
  for (const index of picked) {
    midX += troops[index].x / picked.length;
    midY += troops[index].y / picked.length;
  }
  const legs = legsOf([midX, midY], way);
  if (legs.length === 0) return;
  const first = legs[0];
  const km = kmAt(midY);
  // Abreast in the order they already stand in, so that no two have to cross;
  // and from the front of the group to its rear.
  const across = (index) => (troops[index].x - midX) * -first.ay + (troops[index].y - midY) * first.ax;
  const ahead = (index) => (troops[index].x - midX) * first.ax + (troops[index].y - midY) * first.ay;
  const abreast = picked.slice().sort((a, b) => across(a) - across(b) || a - b);
  // At the point of a spearhead: its armour first, then whoever is furthest forward.
  const forward = picked.slice().sort((a, b) => (word === "spearhead" ? (troops[b].kind === KIND_ARMOUR) - (troops[a].kind === KIND_ARMOUR) : 0) || ahead(b) - ahead(a) || a - b);
  const placeAbreast = new Map(abreast.map((index, rank) => [index, rank]));
  const placeForward = new Map(forward.map((index, rank) => [index, rank]));
  const extent = (across(abreast[abreast.length - 1]) - across(abreast[0])) * km;
  const brush = battle.radiusKm[side];
  let breadth = breadthKm > 0 ? breadthKm
    : word === "spearhead" ? SPEARHEAD_BREADTH_KM
      : word === "flank" || word === "encircle" ? COLUMN_BREADTH_KM
        : Math.max(GROUP_BREADTH_MIN_KM, Math.min(picked.length * brush * GROUP_BREADTH_BRUSHES, extent * GROUP_BREADTH_OF_EXTENT));
  if (word === "blitz") breadth = Math.max(GROUP_BREADTH_MIN_KM, breadth * BLITZ_BREADTH);
  const point = Math.max(2, Math.ceil(picked.length / 3));
  for (const index of picked) {
    const troop = troops[index];
    const share = (placeAbreast.get(index) + 0.5) / picked.length - 0.5;
    const rank = placeForward.get(index);
    let slot = share * breadth;
    let stop = 1;
    if (word === "spearhead") {
      if (rank < point && troop.kind !== KIND_ARTILLERY) {
        // The point: narrow, but each with a place of its own and its own
        // stopping short of the end, so it ends spread over the ground it
        // took and not stacked where the way stops.
        slot = share * breadth * POINT_BREADTH;
        stop = 1 - POINT_STOPS_SHORT * chanceOf(battle, "point", side, index);
      } else {
        // The shoulders: out to the side they are already on, further back
        // the further back in the group they started.
        const back = Math.max(0, rank - point) / Math.max(1, picked.length - point);
        stop = SHOULDER_STOPS[0] + (SHOULDER_STOPS[1] - SHOULDER_STOPS[0]) * (1 - back);
        slot = (share >= 0 ? 1 : -1) * (breadth * SHOULDER_OUT + SHOULDER_OUT_KM[0] + (SHOULDER_OUT_KM[1] - SHOULDER_OUT_KM[0]) * chanceOf(battle, "shoulder", side, index));
      }
    }
    // A troop that was dug in takes a day to leave its works.
    const lag = lagless ? 0 : troop.lag + (troop.dug ? 1 : 0) + (word === "blitz" ? BLITZ_MASS_DAYS : 0);
    troop.dug = false;
    takeOrder(troop, { kind: "way", standing, word, legs, leg: 0, slot: slot / km, stop, since: day + lag, day });
    troop.fallback = null;
  }
};

// Whether the other side's ground lies before a point along a way, within
// `reach` cells and before the land ends: looked for every half cell.
const groundAhead = (field, side, x, y, ax, ay, reach) => {
  for (let gone = 0; gone <= reach; gone += 0.5) {
    const cell = cellAt(field, x + ax * gone, y + ay * gone);
    if (cell < 0 || !field.play[cell]) return false;
    if (field.holders[cell] === 1 - side) return true;
  }
  return false;
};

// Which way a troop going straight out is to go from where it stands: across
// its own stretch of the line, from its side's ground to the other's
// (ground.js outwardOf). Where there is no line near, or that way leads to
// none of the other side's ground, toward the nearest of it however far;
// failing that, the way it is already facing. A unit vector through `aim`.
const outFrom = (battle, side, troop) => {
  const { field, place } = battle;
  const reach = OUTWARD_KM / place.kmAt(troop.y);
  if (outwardOf(field, side, troop.x, troop.y, reach, aim) && groundAhead(field, side, troop.x, troop.y, aim[0], aim[1], reach)) return;
  if (downhill(field, measure(battle)[1 - side], troop.x, troop.y, aim)) return;
  if (outwardOf(field, side, troop.x, troop.y, reach, aim)) return;
  aim[0] = troop.hx !== 0 || troop.hy !== 0 ? troop.hx : side === 0 ? 1 : -1;
  aim[1] = troop.hx !== 0 || troop.hy !== 0 ? troop.hy : 0;
};

// How far ahead of a troop going straight out its line is laid, in cells:
// further than it can get in many days. (Not "to the end of the run": how long
// a run is must change nothing in it, or a run cut at a day would not be the
// full run as it stood that day.)
const farOut = (battle, run, troop) => (WAY_DAYS_MIN * Math.max(run.advanceKm[0], run.advanceKm[1], run.advanceKm[2]) * run.pace) / battle.place.kmAt(troop.y);

// The one leg of a troop going straight out: from where it stands, the way `aim` says.
const legOut = (battle, run, troop) => {
  const far = farOut(battle, run, troop);
  return legsOf([troop.x, troop.y], [[troop.x + aim[0] * far, troop.y + aim[1] * far]]);
};

// Tells troops of a side (by their indexes) to advance with nothing named:
// each goes straight out from where it stands, the way its own stretch of the
// line faces. Nobody is gathered and nobody crosses the front to join a rank:
// the rank is the line they already stand in.
//   day, word, standing, lagless   as for `give`
export const giveOut = (battle, run, side, picked, { day, word, standing, lagless = false }) => {
  const troops = battle.troops[side];
  for (const index of picked) {
    const troop = troops[index];
    outFrom(battle, side, troop);
    const legs = legOut(battle, run, troop);
    if (legs.length === 0) continue;
    const lag = lagless ? 0 : troop.lag + (troop.dug ? 1 : 0) + (word === "blitz" ? BLITZ_MASS_DAYS : 0);
    troop.dug = false;
    takeOrder(troop, { kind: "way", standing, word, legs, leg: 0, slot: 0, stop: 1, since: day + lag, day, own: true });
    troop.fallback = null;
  }
};

// A troop going straight out KEEPS its line for as long as the other side's
// ground lies before it: a rank that turned with every change in the shape of
// what it had taken would fan apart at its edges, and troops that turn cross.
// When there is none of it before it any more (it has come to the sea, to a
// neighbour's border, or onto ground its own side took from another way) it
// turns to face the line nearest it and goes straight out from there. Looked
// at every day; it turns onto a new line by degrees like any other (move.js).
export const aimOut = (battle, run, side, troop, order) => {
  const leg = order.legs[order.leg];
  if (groundAhead(battle.field, side, troop.x, troop.y, leg.ax, leg.ay, OUT_AHEAD_KM / battle.place.kmAt(troop.y))) {
    // Its line is laid on ahead of it: it never comes to the end of it.
    const short = farOut(battle, run, troop) - leftOnLeg(leg, troop);
    if (short > 0) {
      leg.ox += leg.ax * short;
      leg.oy += leg.ay * short;
      leg.length += short;
    }
    return;
  }
  outFrom(battle, side, troop);
  const legs = legOut(battle, run, troop);
  if (legs.length === 0) return;
  order.legs = legs;
  order.leg = 0;
  // Its place across the old way is nothing on the new one, which starts where it stands.
  order.slot = 0;
};

// The way an attack order gives a group, as the points it goes through, in
// cells; for an encirclement, two ways, the one round to the left first.
// `target` is the place the order names (sectors.js findPlace), or null;
// `days` how long the run still has to go. Returns { ways, midX, midY, fx, fy }:
// the ways, the middle of the group, and the way it faces.
export const waysFor = (battle, run, side, picked, word, target, days) => {
  const { field, place } = battle;
  const troops = battle.troops[side];
  const { midX, midY, outX, outY } = standingOf(battle, side, picked);
  const km = place.kmAt(midY);
  // With nowhere named: straight out, for as far as the days would take it.
  const paceKm = Math.max(run.advanceKm[0], run.advanceKm[1], run.advanceKm[2]) * run.pace;
  const far = (Math.max(WAY_DAYS_MIN, days) * paceKm) / km;
  const straight = [[midX + outX * far, midY + outY * far]];
  const facing = { midX, midY, fx: outX, fy: outY };
  if (word === "flank" || word === "encircle") {
    // Round whatever it names, or round what lies two reaches ahead.
    const round = ROUND_KM / km;
    const tx = target ? target.x : midX + outX * round * 2;
    const ty = target ? target.y : midY + outY * round * 2;
    const gap = Math.sqrt((tx - midX) * (tx - midX) + (ty - midY) * (ty - midY));
    const fx = gap > 0 ? (tx - midX) / gap : outX;
    const fy = gap > 0 ? (ty - midY) / gap : outY;
    // The corner beside it on the near side, the corner beside it on the far
    // side, and the place behind it where two columns meet.
    const arm = (turn) => {
      const lx = -fy * turn;
      const ly = fx * turn;
      const points = [[tx + (lx + fx) * round, ty + (ly + fy) * round], [tx + fx * round, ty + fy * round]];
      if (gap > round * 1.5) points.unshift([tx + (lx - fx) * round, ty + (ly - fy) * round]);
      return points;
    };
    if (word === "encircle") return { ways: [arm(1), arm(-1)], midX, midY, fx, fy };
    // A flank goes round the side with fewer of the other side's troops beside it.
    const beside = [1, -1].map((turn) => {
      const px = tx + -fy * turn * round;
      const py = ty + fx * turn * round;
      let count = 0;
      for (const enemy of battle.troops[1 - side]) {
        if (isLive(enemy) && (enemy.x - px) * (enemy.x - px) + (enemy.y - py) * (enemy.y - py) <= round * round) count += 1;
      }
      return count;
    });
    return { ways: [arm(beside[1] < beside[0] ? -1 : 1)], midX, midY, fx, fy };
  }
  if (!target) return { ways: [straight], ...facing };
  // To a place: the cheapest way over the ground, in a few legs.
  let from = cellAt(field, midX, midY);
  if (from < 0 || !field.play[from]) from = cellAt(field, troops[picked[0]].x, troops[picked[0]].y);
  let goal = target.kind === "city" ? target.cell : cellAt(field, target.x, target.y);
  if (goal < 0 || !field.play[goal]) goal = -1;
  const cells = from >= 0 && goal >= 0 ? cheapestWay(battle, from, goal) : null;
  return { ways: [cells && cells.length > 1 ? bendsOf(field, cells) : [[target.x, target.y]]], ...facing };
};

// A number from 0 up to 1 that is a troop's own on one route, the same in
// every run that carries the route on: its place beside the route is not
// dealt afresh each time.
const routeChance = (battle, side, index, standing, what) => (hashSeed([battle.name, "route", standing?.since ?? "", side, index, what].join("|")) % 10000) / 10000;

// Tells troops picked out by hand to go along a route drawn for them (its
// points in cells). They are not a rank and not a column, and they do not keep
// the shape they stood in: each comes onto the route from where it stands by a
// way of its own, has a place of its own beside the route that chance gave it
// (so that who was on the left may well end on the right), sets off when it is
// ready and not with the rest, and stops its own distance short of the end, so
// that they end as a loose body round the place and not as a line across it.
//   day, standing, lagless   as for `give`
// A route is taken from its beginning: one drawn round a place is gone round,
// and the troop that happens to stand nearest its far end does not cut across
// to it. (Only a troop that stands beside the first stretch of it, or where it
// begins, leaves out the point it begins at.) Carried on from an earlier
// run, each goes on to the point it was making for when that run ended
// (troop.next, which the record keeps); for a record that does not say, from
// the place on the route nearest it.
export const giveRoute = (battle, side, picked, { day, way, standing, lagless = false }) => {
  if (picked.length === 0 || way.length === 0) return;
  const { kmAt } = battle.place;
  const troops = battle.troops[side];
  const breadth = Math.max(ROUTE_BREADTH_MIN_KM, Math.sqrt(picked.length) * battle.radiusKm[side] * ROUTE_BREADTH_BRUSHES);
  for (const index of picked) {
    const troop = troops[index];
    let skip = 0;
    if (way.length > 1 && lagless && Number.isInteger(troop.next) && troop.next >= 0) skip = Math.min(troop.next, way.length - 1);
    else if (way.length > 1 && lagless) {
      const { at, part } = nearestOnRoute(way, troop.x, troop.y);
      skip = at === 0 && part === 0 ? 0 : at + 1;
    } else if (way.length > 1) {
      const dx = way[1][0] - way[0][0];
      const dy = way[1][1] - way[0][1];
      const fromX = troop.x - way[0][0];
      const fromY = troop.y - way[0][1];
      skip = fromX * dx + fromY * dy > 0 || Math.sqrt(fromX * fromX + fromY * fromY) * kmAt(troop.y) <= ROUTE_JOIN_KM ? 1 : 0;
    }
    const ahead = skip > 0 ? way.slice(skip) : way;
    const legs = legsOf([troop.x, troop.y], ahead);
    // It stands at the end of the route already: there is nowhere to send it.
    if (legs.length === 0) continue;
    const km = kmAt(troop.y);
    const slot = (routeChance(battle, side, index, standing, "place") - 0.5) * breadth;
    const last = legs[legs.length - 1];
    const short = ROUTE_STOPS_SHORT_KM * routeChance(battle, side, index, standing, "stop");
    const stop = 1 - Math.min(ROUTE_STOPS_SHORT_MOST, short / Math.max(1e-6, last.length * km));
    // A troop that was dug in takes a day to leave its works.
    const lag = lagless ? 0 : troop.lag + (troop.dug ? 1 : 0) + Math.floor(ROUTE_SET_OFF_DAYS * routeChance(battle, side, index, standing, "wait"));
    troop.dug = false;
    // `skip`: how many of the route's points lay behind it when it was told,
    // so that the point it is making for is the route's skip + leg (battle.js).
    takeOrder(troop, { kind: "way", standing, word: "path", legs, leg: 0, skip: skip + ahead.length - legs.length, slot: slot / km, stop, since: day + lag, day });
    troop.fallback = null;
  }
};

// How far a troop still has to go to the line across its leg's end, in cells:
// under the leg's own length while it is on its way, and nothing or less once
// it has crossed.
export const leftOnLeg = (leg, troop) => (leg.ox - troop.x) * leg.ax + (leg.oy - troop.y) * leg.ay;

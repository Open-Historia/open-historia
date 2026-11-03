/*! Open Historia — battlefields and fronts: orders, and what the story says came of them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side is told what to do on a stretch of the line in one of eight words,
// and keeps doing it until it is told otherwise: these are its STANDING ORDERS.
// A new order for a sector replaces the one that stood there, an order for the
// whole line replaces them all, and an attack nobody renews lapses to a hold.
//
// The story may also state what came of a battle: a RESULT. The engine works
// out how far an advance gets by itself; a result is the model overruling it,
// on the day it is dated and never earlier. Where a result takes ground it
// does so the way everything here does, by troops walking: the objective of a
// capture is reached along a path and the path is what changes hands.
//
// A result may come with no order at all: the story saying what happened to a
// side whose orders are not the engine's to change (a human player's). It is
// then applied against the orders that side already has, and they are left
// exactly as they are.
//
// A side told to ENCIRCLE a place lays siege to it. For as long as that order
// stands its troops go round the place and never into it: no step of theirs
// takes ground within twenty kilometres of it. What they shut in there is
// besieged (supply.js), and stays so until the order is replaced, the story
// says the place was captured or the besiegers repulsed, or the ring is opened.

import {
  ASSAULT_BASE,
  ASSAULT_DAYS,
  ASSAULT_DEFENDERS_KM,
  ASSAULT_FROM_KM,
  ASSAULT_LEAST,
  ASSAULT_MOST,
  ASSAULT_PER_STRENGTH,
  ASSAULT_RING_KM,
  ATTACK_LAPSE_DAYS,
  CLOSE_UNDER_STRENGTH,
  BREAKTHROUGH_KM,
  BREAKTHROUGH_LOSS,
  CAPTURED_CITY_CELLS,
  CAPTURED_COLUMN,
  CAPTURED_LOSS,
  COLLAPSE_LEFT,
  CONTROL_RADIUS_MIN_CELLS,
  EFFORT_FACTORS,
  FRONT_EFFORTS,
  FRONT_ORDERS,
  FRONT_RESULTS,
  HALT_DAYS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  LANDING_CELLS,
  LANDING_TROOPS,
  MAX_ORDERS_PER_SIDE,
  MAX_TROOPS_PER_SIDE,
  OVERRUN_CELLS,
  POOL_PER_TROOP,
  REPULSED_LOSS,
  SCENARIO_MARK,
  SIEGE_SPARE_KM,
  THRUST_LEAST,
  THRUST_LINK_KM,
  THRUST_SHARE,
  THRUST_TROOPS,
} from "./constants.js";
import { nearestHeld, redistance, restoreCells, takeCapsule, takeCells } from "./field.js";
import { cellAt, cheapestWay } from "./ground.js";
import { WHOLE_LINE, describePoint, findPlace, inSector, placeText, resolveSector, sectorMiddle } from "./sectors.js";
import { findPockets, nearestOwner, surrenderPocket } from "./supply.js";
import { KIND_ARTILLERY, KIND_INFANTRY, STATE_ADVANCING, STATE_DUG_IN, STATE_HOLDING, controlRadius, createTroop, isAttack, isLive, liveCount, stands } from "./troops.js";
import { chanceOf, give, giveOut, giveRoute, takeOrder, waysFor } from "./way.js";

export { cheapestWay };

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Other ways of telling a side to go round: each is read as `flank`. (The
// ledger folds the longer ways of saying it before an order gets here.)
const FLANK_WORDS = new Set(["flank", "outflank", "envelop"]);

// Which side of a battlefield a country or a group fights on (by its exact
// name in any case), and its place among that side's members; [-1, -1] for
// neither, or for one that has left.
export const memberOf = (battle, name) => {
  const wanted = fold(name);
  if (wanted) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const index = battle.sides[side].findIndex((member, at) => fold(member) === wanted && !battle.gone[side].has(at));
      if (index >= 0) return [side, index];
    }
  }
  return [-1, -1];
};

// ---- sieges ------------------------------------------------------------------------

// The sieges that stand, from the orders as they are: every order to encircle
// a place that has not lapsed, unless the place is already the encircler's.
// battle.sieges becomes [{ by, x, y, cell, at }], `at` the place in words, and
// battle.spared[side] the ground that side's steps leave alone, as a flat list
// of x, y and radius in cells. Read again whenever the orders may have changed.
export const readSieges = (battle) => {
  const { arena, field, place } = battle;
  const sieges = [];
  const spared = [[], []];
  for (const order of battle.orders) {
    if (order.order !== "encircle" || !order.objective || order.age >= ATTACK_LAPSE_DAYS) continue;
    const target = findPlace(arena, order.objective);
    const cell = target ? cellAt(field, target.x, target.y) : -1;
    if (cell < 0 || field.holders[cell] === order.s) continue;
    spared[order.s].push(target.x, target.y, SIEGE_SPARE_KM / place.kmAt(target.y));
    sieges.push({ by: order.s, x: target.x, y: target.y, cell, at: placeText(target) });
  }
  battle.sieges = sieges;
  battle.spared = spared;
  battle.siegeKey = sieges.map((siege) => `${siege.by}:${siege.cell}`).join(",");
};

// ---- standing orders as they read today ------------------------------------------

// Each side's standing orders against today's line: the word in force (an
// attack that has stood too long reads as a hold), the ground its sector
// covers, the place it aims at. The later order of a side takes precedence
// where two cover the same ground. Also the stretches a side may make no step
// on for now.
export const readOrders = (battle, line, sectors) => {
  const { arena, place } = battle;
  const views = [[], []];
  for (const order of battle.orders) {
    // An order for a body of troops picked out is no order for a stretch of line.
    if (order.chosen) continue;
    const sector = resolveSector(arena, line, sectors, order.sector) ?? WHOLE_LINE;
    const target = order.objective ? findPlace(arena, order.objective) : null;
    const word = isAttack(order.order) && order.age >= ATTACK_LAPSE_DAYS ? "hold" : order.order;
    views[order.s].push({
      order,
      word,
      sector,
      target,
      age: order.age,
      middle: target && (word === "advance" || word === "blitz") ? sectorMiddle(line, sector, place.kmAt) : null,
    });
  }
  battle.views = views;
  battle.haltsToday = battle.halts.map((halt) => ({ s: halt.s, sector: resolveSector(arena, line, sectors, halt.sector) ?? WHOLE_LINE }));
  readSieges(battle);
};

// A day passes for the orders: each has stood a day longer, an attack that has
// stood its time becomes the hold it already reads as, and a halt runs down.
export const ageOrders = (battle) => {
  for (const order of battle.orders) {
    order.age += 1;
    if (isAttack(order.order) && order.age >= ATTACK_LAPSE_DAYS) {
      order.order = "hold";
      delete order.objective;
      delete order.way;
      // One for troops picked out is over with its attack: they go back to
      // what their stretch of line is told.
      if (order.chosen) order.lapsed = true;
      battle.ordersChanged += 1;
    }
  }
  const standing = battle.orders.length;
  battle.orders = battle.orders.filter((order) => !order.lapsed && (order.order !== "assault" || (!(order.entry && order.entry.over) && order.age <= ASSAULT_DAYS)));
  if (battle.orders.length !== standing) battle.ordersChanged += 1;
  const before = battle.halts.length;
  for (const halt of battle.halts) halt.days -= 1;
  battle.halts = battle.halts.filter((halt) => halt.days > 0);
  if (battle.halts.length !== before) battle.ordersChanged += 1;
};

const sectorText = (sector) => (sector.kind === "all" ? "all" : sector.word);

// ---- whose troops an order is for ------------------------------------------------------
// On a side of one country every troop is that country's. On a side of
// several, EACH COMMANDS ITS OWN: an order is for the troops of the member
// that gave it (`by`). The order of the side's first member is also for the
// troops of any other member nobody plays that has no order of its own for
// where they stand, so that a coalition the story orders in one line still
// moves together; and an order nobody in particular gave is the whole side's.

// The members of a side that are still in the fight, by their places in its list.
const membersIn = (battle, side) => battle.sides[side].map((member, at) => (battle.gone[side].has(at) ? "" : fold(member)));
// Which member gave an order, as its place in the side's list: -1 for an order
// that is the whole side's (nobody's in particular, or a side of one).
const giverOf = (battle, side, order) => {
  const members = membersIn(battle, side);
  if (members.filter(Boolean).length <= 1) return -1;
  const by = fold(order?.by);
  return by ? members.indexOf(by) : -1;
};
// (troop) => whether a standing order for a stretch of line is that troop's to carry out.
export const takesOrder = (battle, run, order, today) => {
  const side = order.s;
  const giver = giverOf(battle, side, order);
  if (giver < 0) return () => true;
  const members = membersIn(battle, side);
  const lead = members.findIndex(Boolean);
  if (giver !== lead) return (troop) => troop.owner === giver;
  const played = new Set((Array.isArray(run?.input?.players) ? run.input.players : []).map(fold));
  // What each other member has ordered for itself, as the stretches of line it ordered them for.
  const own = members.map((member, at) => (!member || at === giver ? null : battle.orders
    .filter((standing) => standing.s === side && !standing.chosen && standing !== order && standing.order !== "assault" && fold(standing.by) === member)
    .map((standing) => resolveSector(battle.arena, today.line, today.sectors, standing.sector) ?? WHOLE_LINE)));
  const { kmAt } = battle.place;
  return (troop) => {
    if (troop.owner === giver) return true;
    const member = members[troop.owner];
    if (!member || played.has(member)) return false;
    return !(own[troop.owner] ?? []).some((sector) => inSector(sector, troop.x, troop.y, kmAt));
  };
};

// Puts an order among a side's standing orders: it replaces the one for the
// same sector, and one for the whole line replaces them all. (Of the same
// member's, on a side of several: one country's order never replaces another's.)
export const setStandingOrder = (battle, side, order) => {
  const sector = fold(order.sector);
  // An assault is not an order for a stretch of line: it stands beside the others.
  const besides = order.order === "assault";
  const giver = giverOf(battle, side, order);
  const another = (standing) => {
    const theirs = giverOf(battle, side, standing);
    return giver >= 0 && theirs >= 0 && theirs !== giver;
  };
  // (An order given to troops picked out is theirs until they have carried it
  // out or are told otherwise: an order for a stretch of line does not end it.)
  battle.orders = battle.orders.filter((standing) => standing.s !== side || standing.chosen || another(standing) || (standing.order === "assault") !== besides
    || (besides ? fold(standing.objective) !== fold(order.objective) : sector !== "all" && fold(standing.sector) !== sector));
  const set = { ...order, s: side };
  battle.orders.push(set);
  const mine = battle.orders.filter((standing) => standing.s === side);
  if (mine.length > MAX_ORDERS_PER_SIDE) {
    const dropped = mine.find((standing) => !standing.chosen) ?? mine[0];
    battle.orders = battle.orders.filter((standing) => standing !== dropped);
  }
  battle.ordersChanged += 1;
  return set;
};

// ---- an order put to its troops ------------------------------------------------------

// What an assault is sent at: a city of the map, a structure the map names, or
// a named formation of the other side. null when there is no such thing.
const assaultTarget = (battle, run, side, objective) => {
  const named = /^\s*(city|structure|unit)\s*:\s*(.*)$/i.exec(String(objective ?? ""));
  const kind = named ? named[1].toLowerCase() : "";
  const wanted = fold(named ? named[2] : objective);
  if (!wanted) return null;
  if (kind !== "structure" && kind !== "unit") {
    const city = findPlace(battle.arena, `city: ${wanted}`);
    if (city) return { kind: "city", name: placeText(city), x: city.x, y: city.y, unit: null };
  }
  if (kind !== "city" && kind !== "unit") {
    const structures = Array.isArray(run.input?.map?.structures) ? run.input.map.structures : [];
    const found = structures.find((entry) => fold(entry?.name) === wanted);
    if (found) {
      const [x, y] = battle.place.toCell(Number(found.lng), Number(found.lat));
      if (cellAt(battle.field, x, y) >= 0) return { kind: "structure", name: `structure: ${String(found.name).trim()}`, x, y, unit: null };
    }
  }
  if (kind !== "city" && kind !== "structure") {
    const entry = battle.named.find((formation) => formation.s === 1 - side && fold(formation.name) === wanted);
    const unit = entry ? battle.troops[entry.s][entry.i] : null;
    if (unit && isLive(unit)) return { kind: "unit", name: `unit: ${entry.name}`, x: unit.x, y: unit.y, unit };
  }
  return null;
};

// An assault names WHAT is attacked. As many troops as its defenders call for,
// the nearest first, are taken off whatever they were doing and sent straight
// at it; each stops a little short on a ring of its own, so they close round
// it and do not stack on the spot; and when it is taken (or the formation is
// gone) they go on with what they were at. false when there is no such thing
// to assault.
const assault = (battle, run, order, today) => {
  const side = order.s;
  const { kmAt } = battle.place;
  const target = assaultTarget(battle, run, side, order.objective);
  if (!target) return false;
  const km = kmAt(target.y);
  let held = 0;
  for (const enemy of battle.troops[1 - side]) {
    const dx = enemy.x - target.x;
    const dy = enemy.y - target.y;
    if (isLive(enemy) && Math.sqrt(dx * dx + dy * dy) * km < ASSAULT_DEFENDERS_KM) held += enemy.strength;
  }
  const needed = Math.max(ASSAULT_LEAST, Math.min(ASSAULT_MOST, ASSAULT_BASE + Math.ceil((2 * held) / ASSAULT_PER_STRENGTH)));
  const near = [];
  // (Of the troops this order is for: on a side of several countries, its giver's.)
  const mine = takesOrder(battle, run, order, today);
  battle.troops[side].forEach((troop, index) => {
    if (!isLive(troop) || troop.dug || troop.pocket || troop.kind === KIND_ARTILLERY || troop.strength < CLOSE_UNDER_STRENGTH || !mine(troop)) return;
    const distance = Math.sqrt((troop.x - target.x) * (troop.x - target.x) + (troop.y - target.y) * (troop.y - target.y)) * km;
    if (distance < ASSAULT_FROM_KM) near.push({ index, troop, distance });
  });
  near.sort((a, b) => a.distance - b.distance || a.index - b.index);
  const entry = { ...target, side, day: today.day - order.age, taken: 0, over: false };
  order.entry = entry;
  for (const { index, troop } of near.slice(0, needed)) {
    const busy = troop.order && !troop.order.done ? troop.order : null;
    const resume = !busy ? null : busy.kind === "reduce" || busy.kind === "assault" ? busy.resume ?? null : busy;
    troop.order = { kind: "assault", standing: order, since: today.day, day: today.day, entry, resume, ring: ASSAULT_RING_KM[0] + (ASSAULT_RING_KM[1] - ASSAULT_RING_KM[0]) * chanceOf(battle, "ring", side, index) };
    troop.fallback = null;
  }
  return true;
};

// Puts a standing order to the troops it is for: those of its side that stand
// in its sector, or `picked` (their indexes) where the record says who they
// were. `today` is { day, line, sectors }; `lagless` for an order they were
// already under when the run began.
export const assignOrder = (battle, run, order, today, { picked = null, lagless = false } = {}) => {
  const side = order.s;
  const { kmAt } = battle.place;
  const troops = battle.troops[side];
  const word = order.order;
  if (word === "assault") return assault(battle, run, order, today);
  const sector = resolveSector(battle.arena, today.line, today.sectors, order.sector) ?? WHOLE_LINE;
  const group = [];
  // (Troops picked out are the order's whoever they are; a stretch of line gives it to those it is for.)
  const mine = picked ? null : takesOrder(battle, run, order, today);
  troops.forEach((troop, index) => {
    if (isLive(troop) && (picked ? picked.includes(index) : inSector(sector, troop.x, troop.y, kmAt) && mine(troop))) group.push(index);
  });
  if (word === "dig in") {
    // They dig in where they stand, and do not move again until told otherwise.
    for (const index of group) {
      troops[index].order = null;
      troops[index].fallback = null;
      troops[index].dug = true;
      troops[index].dig = 1;
      troops[index].state = STATE_DUG_IN;
    }
  } else if (word === "hold" || word === "land") {
    for (const index of group) {
      takeOrder(troops[index], null);
      if (troops[index].order && troops[index].order.resume) troops[index].order.resume = null;
      if (troops[index].dug) troops[index].state = STATE_HOLDING;
      troops[index].dug = false;
    }
  } else if (word === "withdraw") {
    // They leave: back from the line, and then off the battlefield (engine.js withdrawWhoLeft).
    for (const index of group) {
      if (troops[index].dug) troops[index].state = STATE_HOLDING;
      troops[index].dug = false;
      troops[index].order = { kind: "withdraw", standing: order, since: today.day, day: today.day, gone: 0 };
      troops[index].fallback = null;
    }
  } else if (word === "fall back") {
    const target = order.objective ? findPlace(battle.arena, order.objective) : null;
    for (const index of group) {
      if (troops[index].dug) troops[index].state = STATE_HOLDING;
      troops[index].dug = false;
      troops[index].order = { kind: "fallback", standing: order, target, since: today.day, day: today.day, gone: 0 };
      troops[index].fallback = null;
    }
  } else if (isAttack(word) && group.length > 0 && Array.isArray(order.way) && order.way.length > 0) {
    // A route drawn for them: each goes along it by itself, from wherever on
    // it it has got to, and they keep no formation (way.js giveRoute). It is a
    // way like any other: what is in it stops them, a pocket beside it draws
    // them off and they come back to it, and nothing says they will get to
    // its end.
    giveRoute(battle, side, group, { day: today.day, standing: order, lagless, way: order.way.map(([lng, lat]) => battle.place.toCell(lng, lat)) });
    for (const index of group) if (troops[index].state === STATE_DUG_IN) troops[index].state = STATE_HOLDING;
  } else if (isAttack(word) && group.length > 0) {
    const target = order.objective ? findPlace(battle.arena, order.objective) : null;
    const days = Math.max(1, run.days - today.day);
    const how = { day: today.day, word, standing: order, lagless };
    // An advance or a blitz is the line itself going forward: every troop
    // straight out from where it stands. Anything sent AT something (a thrust
    // of any kind, or an advance on a named place) is a group, and it is the
    // troops nearest what it is sent at, not the whole third of the line.
    const ranked = word === "advance" || word === "blitz";
    let sent = [];
    let rest = group;
    if (target || !ranked) {
      const [nearX, nearY] = target ? [target.x, target.y] : sectorMiddle(today.line, sector, kmAt);
      const most = THRUST_TROOPS[word] ?? THRUST_TROOPS.advance;
      // Those the record says were at it are the group as it was; told afresh,
      // it never takes more than its share of the sector's troops.
      const count = picked || sector.kind === "place" ? Math.min(most, group.length) : Math.min(most, group.length, Math.max(THRUST_LEAST, Math.ceil(group.length * THRUST_SHARE)));
      const nearest = group.filter((index) => !troops[index].pocket).map((index) => {
        const dx = troops[index].x - nearX;
        const dy = troops[index].y - nearY;
        return { index, away: dx * dx + dy * dy, taken: false };
      }).sort((a, b) => a.away - b.away || a.index - b.index);
      // One body of troops: from the nearest, whoever stands within reach of
      // one already in it. (Those the record says were at it are the body as
      // it was, however far the way has strung them out since.)
      const link = THRUST_LINK_KM / kmAt(nearY);
      const body = picked ? nearest.slice(0, count).map((entry) => entry.index) : [];
      for (let pass = 0, grew = !picked; grew && body.length < count; pass += 1) {
        grew = false;
        for (const entry of nearest) {
          if (body.length >= count) break;
          if (entry.taken) continue;
          const mine = troops[entry.index];
          if (body.length > 0 && !body.some((other) => (troops[other].x - mine.x) * (troops[other].x - mine.x) + (troops[other].y - mine.y) * (troops[other].y - mine.y) <= link * link)) continue;
          entry.taken = true;
          body.push(entry.index);
          grew = true;
        }
      }
      const going = new Set(body);
      sent = group.filter((index) => going.has(index));
      rest = group.filter((index) => !going.has(index));
    }
    if (sent.length > 0) {
      const { ways, midX, midY, fx, fy } = waysFor(battle, run, side, sent, word, target, days);
      if (ways.length === 2) {
        // Two columns: those on the left of the way go round to the left.
        const across = (index) => (troops[index].x - midX) * -fy + (troops[index].y - midY) * fx;
        const abreast = sent.slice().sort((a, b) => across(b) - across(a) || a - b);
        const half = Math.ceil(abreast.length / 2);
        give(battle, side, abreast.slice(0, half), { ...how, way: ways[0] });
        give(battle, side, abreast.slice(half), { ...how, way: ways[1] });
      } else give(battle, side, sent, { ...how, way: ways[0] });
    }
    // The rest of an advance goes straight out; the rest of a thrust is left
    // at what it was doing, and holds the line the thrust set off from.
    if (ranked && rest.length > 0) giveOut(battle, run, side, rest, how);
    for (const index of ranked ? group : sent) if (troops[index].state === STATE_DUG_IN) troops[index].state = STATE_HOLDING;
  }
  return true;
};

// Which of its side's standing orders a troop is carrying out, or null: the
// one it was taken off to close on a pocket or to assault a place still counts.
export const standingOf = (battle, troop) => {
  let order = troop.order && !troop.order.done ? troop.order : null;
  if (order && (order.kind === "reduce" || (order.kind === "assault" && !battle.orders.includes(order.standing)))) order = order.resume && !order.resume.done ? order.resume : null;
  return order && order.standing && battle.orders.includes(order.standing) ? order.standing : null;
};

// The same by its place among the battle's standing orders (-1 for none): for
// the record, so that the next run finds the same group under it.
export const servingOf = (battle, troop) => {
  const standing = standingOf(battle, troop);
  return standing ? battle.orders.indexOf(standing) : -1;
};

// ---- the ground a result takes -----------------------------------------------------

// Troops left standing on ground that is no longer their side's fall back onto
// their own, at a cost; one with none of its own within `reach` cells is lost.
export const giveWay = (battle, side, lossShare, date, reach = OVERRUN_CELLS) => {
  const { field, arena } = battle;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || stands(field, side, troop.x, troop.y)) continue;
    const cell = nearestHeld(field, side, troop.x, troop.y, reach);
    if (cell < 0) {
      const at = describePoint(arena, troop.x, troop.y);
      if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
      troop.strength = 0;
      continue;
    }
    troop.x = (cell % field.cols) + 0.5;
    troop.y = Math.floor(cell / field.cols) + 0.5;
    troop.strength *= 1 - lossShare;
    troop.dig = 0;
  }
};

// Troops on ground a story capture gave the other side (engine.js marchInto)
// fall back overland: out across the region taken, or the region they stand
// in, onto the nearest of their own ground that borders it, without loss. The nearest of their own as the crow
// flies could lie behind the taker's lines (a pocket, a besieged town, a coast
// across a strait), and troops put there stood in the taker's territory (a
// player's report, 2026-10-31). One with no way back to its own is lost.
export const fallBackOverland = (battle, side, date, takenRegion, reach) => {
  const { field, arena } = battle;
  const { cols, rows, holders, play } = field;
  const enemy = 1 - side;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || stands(field, side, troop.x, troop.y)) continue;
    const start = Math.floor(troop.y) * cols + Math.floor(troop.x);
    const ownRegion = start >= 0 && start < field.size ? arena.region[start] : -1;
    const steps = new Map([[start, 0]]);
    const queue = [start];
    let found = -1;
    for (let head = 0; head < queue.length && found < 0; head += 1) {
      const at = queue[head];
      const step = steps.get(at);
      if (step >= reach) continue;
      const col = at % cols;
      const row = Math.floor(at / cols);
      for (const next of [col > 0 ? at - 1 : -1, col < cols - 1 ? at + 1 : -1, row > 0 ? at - cols : -1, row < rows - 1 ? at + cols : -1]) {
        if (next < 0 || steps.has(next) || !play[next]) continue;
        if (holders[next] === side) {
          found = next;
          break;
        }
        // Only out across the region taken or the one it stands in: never through
        // the taker's other ground, nor a country outside the war, nor the sea.
        if (holders[next] !== enemy || (arena.region[next] !== takenRegion && arena.region[next] !== ownRegion)) continue;
        steps.set(next, step + 1);
        queue.push(next);
      }
    }
    if (found < 0) {
      const at = describePoint(arena, troop.x, troop.y);
      if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
      troop.strength = 0;
      continue;
    }
    troop.x = (found % cols) + 0.5;
    troop.y = Math.floor(found / cols) + 0.5;
    troop.dig = 0;
  }
};

// "Captured": the objective is the attacker's by the end of the day, by a
// walk. Its strongest troop nearest the objective, with up to three of its
// neighbours in column behind it, walks the cheapest way there; the strip it
// walks becomes its side's, then the objective itself. false when there is no
// way to walk.
const capture = (battle, side, target, date) => {
  const { field, arena, place } = battle;
  const troops = battle.troops[side];
  let leader = -1;
  let best = Infinity;
  for (let index = 0; index < troops.length; index += 1) {
    const troop = troops[index];
    if (!isLive(troop) || !stands(field, side, troop.x, troop.y)) continue;
    const dx = troop.x - target.x;
    const dy = troop.y - target.y;
    // Of two as near, the stronger leads.
    const away = Math.sqrt(dx * dx + dy * dy) - troop.strength / 1000;
    if (away < best) {
      best = away;
      leader = index;
    }
  }
  if (leader < 0) return false;
  let goal = target.kind === "city" ? target.cell : cellAt(field, target.x, target.y);
  if (goal < 0 || !field.play[goal]) {
    // A region's middle may lie in a lake: the nearest of its own cells will do.
    goal = -1;
    let nearest = Infinity;
    for (let index = 0; index < field.size; index += 1) {
      if (!field.play[index] || (target.kind === "region" && arena.region[index] !== target.region)) continue;
      const dx = (index % field.cols) + 0.5 - target.x;
      const dy = Math.floor(index / field.cols) + 0.5 - target.y;
      if (dx * dx + dy * dy < nearest) {
        nearest = dx * dx + dy * dy;
        goal = index;
      }
    }
  }
  const way = cheapestWay(battle, cellAt(field, troops[leader].x, troops[leader].y), goal);
  if (!way) return false;

  const beside = [];
  troops.forEach((troop, index) => {
    if (index === leader || !isLive(troop)) return;
    beside.push({ index, away: (troop.x - troops[leader].x) * (troop.x - troops[leader].x) + (troop.y - troops[leader].y) * (troop.y - troops[leader].y) });
  });
  beside.sort((a, b) => a.away - b.away || a.index - b.index);
  const column = [leader, ...beside.slice(0, CAPTURED_COLUMN).map((entry) => entry.index)];
  let radius = 0;
  for (const index of column) radius = Math.max(radius, controlRadius(troops[index], place.kmAt));
  const how = { painter: troops[leader].owner };
  let fromX = troops[leader].x;
  let fromY = troops[leader].y;
  for (const cell of way) {
    const x = (cell % field.cols) + 0.5;
    const y = Math.floor(cell / field.cols) + 0.5;
    takeCapsule(field, side, fromX, fromY, x, y, radius, radius, how);
    fromX = x;
    fromY = y;
  }
  if (target.kind === "city") takeCapsule(field, side, target.x, target.y, target.x, target.y, CAPTURED_CITY_CELLS, CAPTURED_CITY_CELLS, how);
  else {
    const cells = [];
    for (let index = 0; index < field.size; index += 1) if (field.play[index] && arena.region[index] === target.region) cells.push(index);
    takeCells(field, side, cells, troops[leader].owner);
  }
  // The column ends the day at the objective, one behind the other along the way it came.
  column.forEach((index, rank) => {
    const cell = way[Math.max(0, way.length - 1 - Math.round(rank * radius * 1.5))];
    troops[index].x = (cell % field.cols) + 0.5;
    troops[index].y = Math.floor(cell / field.cols) + 0.5;
    troops[index].dig = 0;
    troops[index].state = STATE_ADVANCING;
  });
  giveWay(battle, 1 - side, CAPTURED_LOSS, date);
  redistance(field);
  return true;
};

// "Repulsed": the ground the attacker took on that sector since the run began
// goes back, its troops there go back behind the restored line a quarter
// weaker, and they make no step there for a fortnight.
const repulse = (battle, side, sector, date) => {
  const { field, place } = battle;
  const cells = [];
  for (let index = 0; index < field.size; index += 1) {
    if (!field.play[index] || battle.startPhi[index] === 0) continue;
    const gained = side === HOLDER_SIDE_A ? field.phi[index] < battle.startPhi[index] : field.phi[index] > battle.startPhi[index];
    if (gained && inSector(sector, (index % field.cols) + 0.5, Math.floor(index / field.cols) + 0.5, place.kmAt)) cells.push(index);
  }
  restoreCells(field, cells, battle.startPhi, nearestOwner(battle, 1 - side));
  // What the side still holds on that sector, for its troops to go back to:
  // straight back behind the restored line, not sideways into the next sector.
  const behind = [];
  for (let index = 0; index < field.size; index += 1) {
    if (field.holders[index] === side && inSector(sector, (index % field.cols) + 0.5, Math.floor(index / field.cols) + 0.5, place.kmAt)) behind.push(index);
  }
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || !inSector(sector, troop.x, troop.y, place.kmAt)) continue;
    troop.strength *= 1 - REPULSED_LOSS;
    troop.dig = 0;
    troop.hx = 0;
    troop.hy = 0;
    if (stands(field, side, troop.x, troop.y)) continue;
    let nearest = Infinity;
    let home = -1;
    for (const index of behind) {
      const dx = (index % field.cols) + 0.5 - troop.x;
      const dy = Math.floor(index / field.cols) + 0.5 - troop.y;
      if (dx * dx + dy * dy >= nearest) continue;
      nearest = dx * dx + dy * dy;
      home = index;
    }
    if (home < 0) continue;
    troop.x = (home % field.cols) + 0.5;
    troop.y = Math.floor(home / field.cols) + 0.5;
  }
  giveWay(battle, side, 0, date, field.cols + field.rows);
  redistance(field);
  liftSieges(battle, side, sector, date);
  battle.halts.push({ s: side, sector: sectorText(sector), days: HALT_DAYS });
  battle.ordersChanged += 1;
};

// A repulsed besieger: its sieges on that sector are lifted. Putting back the
// ground it took this run opens most rings. One that was closed before the
// run began is opened by a relief column: from the besieged side's nearest
// ground outside, the cheapest way in to the place is walked, and what it
// walks through is that side's again.
const liftSieges = (battle, side, sector, date) => {
  const { field, place } = battle;
  const other = 1 - side;
  readSieges(battle);
  for (const siege of battle.sieges) {
    if (siege.by !== side || !inSector(sector, siege.x, siege.y, place.kmAt)) continue;
    findPockets(battle);
    if (battle.pocketOf[other][siege.cell] < 0) continue;
    let goal = -1;
    let nearest = Infinity;
    for (let index = 0; index < field.size; index += 1) {
      if (field.holders[index] !== other || battle.pocketOf[other][index] >= 0) continue;
      const dx = (index % field.cols) + 0.5 - siege.x;
      const dy = Math.floor(index / field.cols) + 0.5 - siege.y;
      if (dx * dx + dy * dy < nearest) {
        nearest = dx * dx + dy * dy;
        goal = index;
      }
    }
    const way = cheapestWay(battle, goal, siege.cell);
    if (!way) continue;
    const radius = Math.max(CONTROL_RADIUS_MIN_CELLS, battle.radiusKm[other] / place.kmAt(siege.y));
    const how = { painter: nearestOwner(battle, other)(goal) };
    let fromX = (goal % field.cols) + 0.5;
    let fromY = Math.floor(goal / field.cols) + 0.5;
    for (const cell of way) {
      const x = (cell % field.cols) + 0.5;
      const y = Math.floor(cell / field.cols) + 0.5;
      takeCapsule(field, other, fromX, fromY, x, y, radius, radius, how);
      fromX = x;
      fromY = y;
    }
    giveWay(battle, side, 0, date);
    redistance(field);
  }
};

// "Land": the attacker takes a disc of ground at a place the other side holds,
// with an anchor there that feeds it, and counters for it out of its reserves.
const land = (battle, side, target, today, notes, note) => {
  const { field } = battle;
  const cell = cellAt(field, target.x, target.y);
  if (cell < 0 || field.holders[cell] !== 1 - side) {
    notes.push({ ...note, kind: "landing-refused", detail: placeText(target) });
    return;
  }
  const room = MAX_TROOPS_PER_SIDE - battle.troops[side].length;
  const strength = Math.min(100, battle.pool[side]);
  if (room <= 0 || strength < 10) {
    notes.push({ ...note, kind: "landing-refused", detail: "no-reserves" });
    return;
  }
  const x = (cell % field.cols) + 0.5;
  const y = Math.floor(cell / field.cols) + 0.5;
  const [, owner] = memberOf(battle, note.side);
  takeCapsule(field, side, x, y, x, y, LANDING_CELLS, LANDING_CELLS, { painter: Math.max(0, owner) });
  battle.anchors.push({ s: side, x, y });
  for (let landed = 0; landed < Math.min(LANDING_TROOPS, room) && battle.pool[side] >= 10; landed += 1) {
    const sent = Math.min(100, battle.pool[side]);
    battle.pool[side] -= sent;
    battle.troops[side].push(createTroop({ x: x + (landed % 2 === 0 ? 0.3 : -0.3), y: y + (landed < 2 ? 0.3 : -0.3), strength: sent, kind: KIND_INFANTRY, owner: Math.max(0, owner) }));
  }
  giveWay(battle, 1 - side, 0, today.date);
  redistance(field);
};

// Troops a transporter has brought (transports.js), stood round a place on
// their own side's ground: a loose body, not a rank. Returns how many there
// was room for.
//   load    [[strength, kind]...]
//   owner   which member of the side they are
// (The eight ways round a place: no sine is taken in the engine.)
const ROUND = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
export const putAshore = (battle, side, x, y, load, owner) => {
  const room = Math.max(0, MAX_TROOPS_PER_SIDE - battle.troops[side].length);
  const count = Math.min(room, Array.isArray(load) ? load.length : 0);
  for (let index = 0; index < count; index += 1) {
    const [strength, kind] = load[index];
    // Round the place in widening turns, each where its side stands.
    const [across, down] = ROUND[(index * 3) % ROUND.length];
    const out = 0.22 + 0.11 * Math.floor(index / 5);
    let px = x + across * out;
    let py = y + down * out;
    if (!stands(battle.field, side, px, py)) {
      px = x;
      py = y;
    }
    battle.troops[side].push(createTroop({ x: px, y: py, strength: Math.min(100, Math.max(1, Number(strength) || 100)), kind: kind === 1 || kind === 2 ? kind : KIND_INFANTRY, owner: Math.max(0, owner) }));
  }
  // What comes with them to keep them up to strength: half of what troops raised on the spot have.
  battle.pool[side] += count * POOL_PER_TROOP * 0.5 * battle.edge[side].reserves;
  battle.planKey = "";
  return count;
};

// Troops a transporter brings to a battle that is being fought. On ground
// their own side holds they simply arrive there. On the other side's they take
// a disc of it with an anchor that feeds it, as a landing does. Returns
// { landed, x, y, hostile }: `landed` is 0 when the place is nobody's ground
// here (the sea, or a country outside the war) or there is no room.
export const landCarried = (battle, side, x, y, load, owner, date) => {
  const { field } = battle;
  let cell = cellAt(field, x, y);
  if (cell < 0 || field.holders[cell] > 1) {
    // Beside it, then: the nearest ground of the other side's within a few cells, else of its own.
    cell = nearestHeld(field, 1 - side, x, y, 3);
    if (cell < 0) cell = nearestHeld(field, side, x, y, 3);
  }
  if (cell < 0 || field.holders[cell] > 1 || battle.troops[side].length >= MAX_TROOPS_PER_SIDE) return { landed: 0, x, y, hostile: false };
  const px = (cell % field.cols) + 0.5;
  const py = Math.floor(cell / field.cols) + 0.5;
  const hostile = field.holders[cell] === 1 - side;
  if (hostile) {
    takeCapsule(field, side, px, py, px, py, LANDING_CELLS, LANDING_CELLS, { painter: Math.max(0, owner) });
    battle.anchors.push({ s: side, x: px, y: py });
  }
  const landed = putAshore(battle, side, px, py, load, owner);
  if (hostile) {
    giveWay(battle, 1 - side, 0, date);
    redistance(field);
  }
  return { landed, x: px, y: py, hostile };
};

// ---- an order, and a result ---------------------------------------------------------

// Applies one order moment to a battlefield as it stands on its day.
//   moment   { side, order, sector, objective?, result?, effort?, ref? }: `order`
//            may be empty when `result` is given
//   today    { day, date, line, sectors }: the line the words are read against
//   notes    refusals and adjustments are added to it, for the caller to word
export const applyOrder = (battle, moment, today, notes) => {
  const { arena, place } = battle;
  const note = { battlefield: battle.name, side: String(moment.side ?? ""), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const [side] = memberOf(battle, moment.side);
  if (side < 0) {
    notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  const by = battle.sides[side][memberOf(battle, moment.side)[1]];
  const told = FLANK_WORDS.has(fold(moment.order)) ? "flank" : moment.order;
  let word = FRONT_ORDERS.includes(told) ? told : "";
  const result = FRONT_RESULTS.includes(moment.result) ? moment.result : "";
  // What its scenario's author made this side of the front (SCENARIO_MARK)
  // stands until an event changes it: an order of the story's to attack that
  // rests on no event of its answer is not carried out. (A person's own order
  // is that person's, and one resting on an event is the story's reason.)
  if (word && moment.unbound === true && (isAttack(word) || word === "assault" || word === "land")
    && battle.orders.some((order) => order.s === side && !order.chosen && order.mark === SCENARIO_MARK)) {
    notes.push({ ...note, kind: "posture-stands", detail: battle.orders.find((order) => order.s === side && !order.chosen && order.mark === SCENARIO_MARK).order });
    word = "";
  }
  if (!word && !result) return;

  let sector = resolveSector(arena, today.line, today.sectors, moment.sector);
  if (!sector) {
    sector = WHOLE_LINE;
    notes.push({ ...note, kind: "sector-read-as-all", detail: today.sectors.names.join(", ") });
  }
  let target = moment.objective && word !== "assault" ? findPlace(arena, moment.objective) : null;
  if (moment.objective && !target && word !== "assault") {
    notes.push({ ...note, kind: "objective-not-found", detail: String(moment.objective) });
    if (word === "land") return;
  }
  // On a border fortified in peace nothing is attacked.
  if (battle.status === "standing" && (isAttack(word) || word === "assault" || word === "land" || result)) {
    notes.push({ ...note, kind: "not-at-war" });
    return;
  }

  if (FRONT_EFFORTS.includes(moment.effort) && moment.effort !== battle.effort[side]) {
    // More effort brings up reserves; less never takes a troop away.
    const rise = EFFORT_FACTORS[moment.effort] / EFFORT_FACTORS[battle.effort[side]] - 1;
    if (rise > 0) battle.pool[side] += rise * POOL_PER_TROOP * liveCount(battle.troops[side]) * battle.edge[side].reserves;
    battle.effort[side] = moment.effort;
  }

  if (word === "land") {
    if (!target) notes.push({ ...note, kind: "objective-not-found", detail: "" });
    else land(battle, side, target, today, notes, note);
  } else if (word === "assault") {
    // The one order that names what is attacked: it has to name something there is.
    const order = { sector: "all", order: word, objective: String(moment.objective ?? "").replace(/\s+/g, " ").trim(), since: today.date, by, age: 0, s: side };
    if (!assault(battle, today.run, order, today)) notes.push({ ...note, kind: "objective-not-found", detail: order.objective });
    else {
      order.objective = order.entry.name;
      const set = setStandingOrder(battle, side, order);
      set.entry = order.entry;
      for (const troop of battle.troops[side]) if (troop.order && troop.order.standing === order) troop.order.standing = set;
      battle.log.push({ d: today.date, k: "assault", s: side, at: order.entry.name });
    }
  } else if (word) {
    const order = { sector: sectorText(sector), order: word, since: today.date, by, age: 0 };
    if (moment.mark === SCENARIO_MARK) order.mark = SCENARIO_MARK;
    if (target) order.objective = placeText(target);
    if (FRONT_EFFORTS.includes(moment.effort)) order.effort = moment.effort;
    assignOrder(battle, today.run, setStandingOrder(battle, side, order), today);
  }
  if (!result) return;

  if (result === "captured") {
    // With no objective of its own, the result is about the standing order's.
    if (!target) {
      const standing = battle.orders.filter((order) => order.s === side && order.objective && (sector.kind === "all" || fold(order.sector) === fold(sectorText(sector)))).at(-1);
      target = standing ? findPlace(arena, standing.objective) : null;
    }
    if (!target) notes.push({ ...note, kind: "objective-not-found", detail: "captured" });
    else if (!capture(battle, side, target, today.date)) notes.push({ ...note, kind: "objective-unreachable", detail: placeText(target) });
  } else if (result === "breakthrough") {
    const [x, y] = sectorMiddle(today.line, sector, place.kmAt);
    for (const troop of battle.troops[1 - side]) {
      const dx = troop.x - x;
      const dy = troop.y - y;
      if (!isLive(troop) || Math.sqrt(dx * dx + dy * dy) * place.kmAt(y) > BREAKTHROUGH_KM / 2) continue;
      troop.strength *= 1 - BREAKTHROUGH_LOSS;
      troop.dig = 0;
    }
  } else if (result === "repulsed") {
    repulse(battle, side, sector, today.date);
  } else if (result === "stalemate") {
    // Both sides hold there. A side whose orders are not the engine's to
    // change is simply kept from stepping for a while.
    for (const each of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (each === side && !word) battle.halts.push({ s: each, sector: sectorText(sector), days: HALT_DAYS });
      else assignOrder(battle, today.run, setStandingOrder(battle, each, { sector: sectorText(sector), order: "hold", since: today.date, age: 0, ...(each === side ? { by } : {}) }), today);
    }
    battle.ordersChanged += 1;
  } else if (result === "collapse") {
    for (const troop of battle.troops[side]) {
      troop.strength *= COLLAPSE_LEFT;
      troop.dig = 0;
    }
    battle.pool[side] = 0;
    assignOrder(battle, today.run, setStandingOrder(battle, 1 - side, { sector: "all", order: "advance", since: today.date, age: 0 }), today);
  } else if (result === "surrender") {
    if (sector.kind === "all") {
      for (const troop of battle.troops[side]) troop.strength = 0;
      battle.closing = "surrender";
      return;
    }
    // A place inside a pocket: that pocket goes now.
    findPockets(battle);
    const where = sector.kind === "place" ? findPlace(arena, moment.sector) : null;
    const cell = where ? cellAt(battle.field, where.x, where.y) : -1;
    const pocket = cell >= 0 ? battle.pocketOf[side][cell] : -1;
    if (pocket < 0) notes.push({ ...note, kind: "no-pocket-there", detail: sectorText(sector) });
    else {
      surrenderPocket(battle, pocket, today.date);
      redistance(battle.field);
      findPockets(battle);
    }
  }
};

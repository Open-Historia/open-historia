/*! Open Historia — battlefields and fronts: a side nobody plays decides for itself © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side of a battlefield that no person plays took its orders from the story
// and from nobody else. Where the story gave it none it held, for as long as
// it was given none: a front between two countries nobody plays lay still, and
// an enemy of the player's waited to be attacked.
//
// So such a side has a STAFF, which is the engine's own. Every few days it
// looks at how the side stands and decides what the side does, by two things:
//
//   who began the war   the side that began it is there to take ground, and
//                       attacks at odds a defender would only hold at. The
//                       side it was begun against defends, and goes over to
//                       the attack when it has clearly the stronger army.
//   how strong each is  what its troops are worth against the other side's,
//                       along the whole line and stretch by stretch.
//
//   much the stronger   a general advance along the whole line
//   the stronger        an attack on the stretch of line where it is strongest
//                       against what faces it, some periods and not others
//   about even          it holds
//   much the weaker     it digs in
//
// THE STORY STILL COMMANDS. An order the story gave a side stands, and its
// staff leaves the side alone, for STAFF_STORY_ORDER_DAYS; only an order that
// old, or none at all, is the staff's to replace. A side with a person on it
// has no staff: its own troops are that person's, and its allies' are ordered
// by the story (what they agreed in their talks).
//
// What the staff decides is an ordinary standing order, marked as its own
// (`mark: "staff"`), so the brief and the war room show it like any other and
// the next period's story is told it.
//
// Only + - * / and whole-number steps from here down: the same input gives
// the same decision on every machine.

import {
  BREAKTHROUGH_COUNTER_ODDS,
  BREAKTHROUGH_ENCLOSED,
  BREAKTHROUGH_ODDS_KM,
  BREAKTHROUGH_RING_KM,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  STAFF_ATTACKER_ADVANCES,
  STAFF_ATTACKER_PROBES,
  STAFF_CHANCE_ATTACKER,
  STAFF_CHANCE_DEFENDER,
  STAFF_DEFENDER_ADVANCES,
  STAFF_DEFENDER_PROBES,
  STAFF_DIGS_IN_UNDER,
  SCENARIO_MARK,
  STAFF_MARK,
  STAFF_SECTOR_TROOPS_LEAST,
  STAFF_STORY_ORDER_DAYS,
  TROOP_ATTACK,
} from "./constants.js";
import { inSector, resolveSector } from "./sectors.js";
import { isLive } from "./troops.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// A number from 0 up to 1 that belongs to one decision.
const chanceOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
};

// What a side's troops are worth where `within(troop)` says, as the fight weighs them.
// What one troop is worth in attack, as the fight weighs it: its strength,
// kind and supply, and what the day makes of it (dawn.js). Before its side's
// quality and edge, which are the same for all of a side's troops.
export const troopWorth = (troop) => troop.strength * TROOP_ATTACK[troop.kind] * troop.supply * troop.punch;

const worthOf = (battle, side, within = null) => {
  let worth = 0;
  let count = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || (within && !within(troop))) continue;
    worth += troopWorth(troop);
    count += 1;
  }
  return { worth: worth * battle.quality[side] * battle.edge[side].power, count };
};

// Whether a side is one a person plays on.
export const sideIsPlayed = (battle, side, players) => {
  const played = new Set((Array.isArray(players) ? players : []).map(fold).filter(Boolean));
  return battle.sides[side].some((member, at) => !battle.gone[side].has(at) && played.has(fold(member)));
};

// What a side's staff would have it do now.
//   battle      the battle as it stands
//   side        which side
//   began       whether this side is the one that began the war
//   today       { line, sectors } of the day (day.js prepare)
//   key         what makes this decision its own (seed, battlefield, side, date)
// Returns { order, sector } or null to leave the side as it is.
export const staffDecision = (battle, side, { began = false, today = null, key = "" } = {}) => {
  const own = worthOf(battle, side);
  const theirs = worthOf(battle, 1 - side);
  if (own.count === 0) return null;
  const ratio = theirs.worth > 0 ? own.worth / theirs.worth : 99;
  const advances = began ? STAFF_ATTACKER_ADVANCES : STAFF_DEFENDER_ADVANCES;
  const probes = began ? STAFF_ATTACKER_PROBES : STAFF_DEFENDER_PROBES;
  if (ratio >= advances) return { order: "advance", sector: "all", ratio };
  if (ratio < STAFF_DIGS_IN_UNDER) return { order: "dig in", sector: "all", ratio };
  if (ratio < probes) return { order: "hold", sector: "all", ratio };
  // Strong enough to try something, not to try everything: some periods it does.
  if (chanceOf(`${key}|tries`) >= (began ? STAFF_CHANCE_ATTACKER : STAFF_CHANCE_DEFENDER)) return { order: "hold", sector: "all", ratio };
  // Where along the line it is strongest against what faces it.
  let best = null;
  const names = today?.sectors?.names ?? [];
  for (const name of names) {
    const sector = today ? resolveSector(battle.arena, today.line, today.sectors, name) : null;
    if (!sector || sector.kind === "all") continue;
    const inside = (troop) => inSector(sector, troop.x, troop.y, battle.place.kmAt);
    const mine = worthOf(battle, side, inside);
    if (mine.count < STAFF_SECTOR_TROOPS_LEAST) continue;
    const facing = worthOf(battle, 1 - side, inside);
    const there = facing.worth > 0 ? mine.worth / facing.worth : 99;
    if (!best || there > best.there) best = { name, there };
  }
  // (A line too short to have stretches, or none where it has the edge: the whole of it, or nothing.)
  if (!best) return ratio >= 1 ? { order: "advance", sector: "all", ratio } : { order: "hold", sector: "all", ratio };
  if (best.there < 1) return { order: "hold", sector: "all", ratio };
  return { order: "advance", sector: best.name, ratio };
};

// ---- a breakthrough (Wars and Fronts Pt.2) -------------------------------------
// "Drawing a route with all your forces and making the route go super deep
// into enemy territory makes it just sledgehammer through and nothing can stop
// it" (the owner, 2026-10-14). A staff that weighed only the whole line every
// ten days never saw a thrust go by. So it looks for SPEARHEADS every day
// (constants.js BREAKTHROUGH_*): the other side's troops on its home ground
// with its own ground on most sides of them. A thrust that has gone deep has
// left the rest of its line thin, and what answers it best (measured in fair
// duels, tools/strategy-nn/duels.mjs: the thrust won 3 of 40 against it, 30 of
// 40 against holding its head and cutting at its neck) is a counter-offensive:
// every troop that is not outmatched where it stands attacks, at the thrust's
// head and flanks and into the ground behind the other side's thin line.
const COMPASS = Object.freeze([[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]]);
const kmApart = (battle, ax, ay, bx, by) => {
  const km = battle.place.kmAt((ay + by) / 2);
  const dx = (ax - bx) * km;
  const dy = (ay - by) * km;
  return Math.sqrt(dx * dx + dy * dy);
};

// The other side's troops that stand in a salient on a side's home ground: [{ x, y, ours }]. (Its lawful home,
// battle.homeSide: ground the other has taken whole is shown as the other's, and is the side's still.)
export const spearheadsOf = (battle, side) => {
  const { field, place } = battle;
  const lawful = battle.homeSide;
  const region = battle.arena?.region;
  if (!lawful || !region) return [];
  const found = [];
  for (const troop of battle.troops[1 - side]) {
    if (!isLive(troop) || troop.pocket) continue;
    const cell = Math.floor(troop.y) * field.cols + Math.floor(troop.x);
    if (!(cell >= 0 && cell < field.size) || lawful[region[cell]] !== side) continue;
    const reach = BREAKTHROUGH_RING_KM / place.kmAt(troop.y);
    let ours = 0;
    for (const [cx, cy] of COMPASS) {
      const x = Math.floor(troop.x + cx * reach);
      const y = Math.floor(troop.y + cy * reach);
      if (x >= 0 && y >= 0 && x < field.cols && y < field.rows && field.holders[y * field.cols + x] === side) ours += 1;
    }
    if (ours >= BREAKTHROUGH_ENCLOSED) found.push({ x: troop.x, y: troop.y, ours });
  }
  return found;
};

// What a side's staff orders against a breakthrough, or null when there is none: { bodies, at }, its troops
// troop by troop ({ order, picked } bodies, as a staff of a run's own gives: engine.js orderTroopsByMind), and
// where the spearhead furthest into its ground stands. Every troop that is not cut off and not outmatched where it
// stands (its side's worth within BREAKTHROUGH_ODDS_KM at least BREAKTHROUGH_COUNTER_ODDS of the other's) attacks,
// straight out from where it stands; the rest hold.
export const breakthroughAnswer = (battle, side) => {
  const heads = spearheadsOf(battle, side);
  if (heads.length === 0) return null;
  const worth = [0, 1].map((who) => {
    const factor = (Number(battle.quality?.[who]) || 1) * (Number(battle.edge?.[who]?.power) || 1);
    return battle.troops[who].map((troop) => (isLive(troop) ? troopWorth(troop) * factor : 0));
  });
  const near = (who, x, y) => {
    let sum = 0;
    battle.troops[who].forEach((troop, index) => {
      if (worth[who][index] > 0 && kmApart(battle, troop.x, troop.y, x, y) <= BREAKTHROUGH_ODDS_KM) sum += worth[who][index];
    });
    return sum;
  };
  const counter = [];
  const hold = [];
  battle.troops[side].forEach((troop, index) => {
    if (!isLive(troop)) return;
    if (!troop.pocket && near(side, troop.x, troop.y) >= BREAKTHROUGH_COUNTER_ODDS * near(1 - side, troop.x, troop.y)) counter.push(index);
    else hold.push(index);
  });
  const bodies = [
    { order: "advance", picked: counter },
    { order: "hold", picked: hold },
  ].filter((body) => body.picked.length > 0);
  // (The one with the most of the side's ground round it; of equals, the first.)
  const at = heads.reduce((best, head) => (head.ours > best.ours ? head : best), heads[0]);
  return { bodies, at: { x: at.x, y: at.y } };
};

// Whether a side's standing orders are the staff's to replace: it has none
// for its line, or only its staff's own, or what the story gave it has stood
// longer than a story's order is left alone.
export const staffMayOrder = (battle, side) => {
  const standing = battle.orders.filter((order) => order.s === side && !order.chosen);
  // What its scenario's author made the front stands until an event changes it, however long that is.
  if (standing.some((order) => order.mark === SCENARIO_MARK)) return false;
  return standing.every((order) => order.mark === STAFF_MARK || (Number(order.age) || 0) > STAFF_STORY_ORDER_DAYS);
};

// What a side stands under now, as the staff would write it: "" for nothing.
export const staffStanding = (battle, side) => battle.orders
  .filter((order) => order.s === side && !order.chosen && order.mark === STAFF_MARK)
  .map((order) => `${order.order}|${fold(order.sector)}`)
  .sort()
  .join(";");

export const STAFF_SIDES = Object.freeze([HOLDER_SIDE_A, HOLDER_SIDE_B]);

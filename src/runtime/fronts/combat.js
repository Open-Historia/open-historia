/*! Open Historia — battlefields and fronts: the fight, and the ground it takes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ground changes hands as a direct result of the path each troop takes,
// and by nothing else. Which way a troop steps is move.js's business; HOW FAR
// the step gets, and what it costs, is decided here (but for the pace of a
// rank, which move.js holds to the ground its side holds round each of it:
// troop.paceFactor). A troop steps forward by
// what its own local fight allows: nothing below 1.15 to 1, the full pace of
// its era through ground nobody defends, more or less as its own drive has it.
// The ground within its control radius of the stretch it just walked becomes
// its side's, painted for the country it belongs to. Where no troop walks,
// nothing is written.
//
// Two sides that both attack stop each other: each is the other's defender,
// and at even odds nobody gains a step.
//
// A defender is weaker for being attacked from more than its front: with an
// attacker come round beside it, weaker; with one behind it, weaker still.
// Works dug facing the enemy are no help against an attacker from behind. A
// troop that is DUG IN is stronger than any that merely holds, and what it
// loses costs it less.
//
// What the game's difficulty gives a side (battle.edge, handicap.js) is in its
// troops' power, in attack and in defence, in the pace of their advance, in
// how slowly its undefended ground is taken, and in how fast they are mended.
//
// Ground that is cut off is fought for like any other, at a disadvantage: its
// troops attack and defend at a share of their power, and those closing on
// them wear them faster. Only a place under siege is left alone: the side
// that was told to encircle it sweeps round it and never into it.
//
// Only + - * / and square roots from here down, in index order: the same
// input gives the same war to the last digit on every machine.

import {
  ATTACK_COST,
  ATTRITION,
  ATTRITION_RATIO_MAX,
  ATTRITION_RATIO_MIN,
  CLOSE_WEAR,
  CONTROL_RADIUS_MAX_KM,
  CONTROL_RADIUS_MIN_CELLS,
  DIG_LOST_KM,
  DIG_MAX_HOLD,
  DIG_PER_DAY_HOLD,
  DUG_IN_DEFENCE,
  DUG_IN_LOSS,
  FLANKED_DEFENCE,
  FLANK_BEHIND_COS,
  FLANK_OPPOSITE_COS,
  GAIN,
  GIVES_UP_UNDER,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  POCKET_ATTACK,
  POCKET_DEFENCE,
  POCKET_LOSS,
  QUIET_ATTRITION,
  RATIO_NEEDED,
  RATIO_SOFTNESS,
  REACH_KM,
  REACH_MIN_CELLS,
  REINFORCE_PER_DAY,
  SIEGE_LOSS,
  SQUEEZED_LOSS,
  STEER_PRESS_KM,
  SUBSTEPS_MAX,
  SURROUNDED_DEFENCE,
  TERRAIN_DEFENCE_GAIN,
  TROOP_ATTACK,
  TROOP_DEFENCE,
} from "./constants.js";
import { ownCell, takeCapsule } from "./field.js";
import { weatherLoss } from "./weather.js";
import { downhill } from "./ground.js";
import { KIND_ARTILLERY, STATE_ADVANCING, STATE_DUG_IN, STATE_ENCIRCLED, STATE_HOLDING, STATE_SPENT, controlRadius, isLive, reachCells, stepAlong } from "./troops.js";
import { WALL_ASSAULT_COST, WALL_DEFENCE_PER_LEVEL, WALL_ODDS, wallAhead, wearWall } from "./walls.js";

const clampRatio = (value) => (value < ATTRITION_RATIO_MIN ? ATTRITION_RATIO_MIN : value > ATTRITION_RATIO_MAX ? ATTRITION_RATIO_MAX : value);

// How much slow ground is worth to whoever defends it.
const terrainDefence = (speed) => 1 + Math.min(0.8, Math.max(0, 1 - speed)) * TERRAIN_DEFENCE_GAIN;

// What a troop is worth in defence where it stands; `front` is whether the
// attacker comes at its front, where its works count.
// (And what the day makes of it, dawn.js: 1 with no newer mechanic on.)
// (Its works: battle.works, the stronger ones of Wars and Fronts Pt.2 where dawn.js set them.)
const defensivePower = (battle, side, troop, front = true) =>
  troop.strength * TROOP_DEFENCE[troop.kind] * (!front ? 1 : troop.dug ? (battle.works ? battle.works.defence : DUG_IN_DEFENCE) : 1 + troop.dig)
  * battle.quality[side] * battle.edge[side].power * troop.supply * (troop.pocket ? POCKET_DEFENCE : 1) * troop.guard;
// And in attack.
const offensivePower = (battle, side, troop) =>
  troop.strength * TROOP_ATTACK[troop.kind] * battle.quality[side] * battle.edge[side].power * troop.supply * (troop.pocket ? POCKET_ATTACK : 1) * troop.punch;

// ---- who is near whom ----------------------------------------------------------

// The furthest anything looks from where it stands, in cells, on the row of
// the frame where a kilometre is the most cells: a troop's reach, and how far
// ahead it reads the defenders in front of it.
const lookOf = (battle) => {
  if (battle.lookFor === battle.place) return battle.look;
  let least = Infinity;
  for (let row = 0; row < battle.place.rowKm.length; row += 1) if (battle.place.rowKm[row] < least) least = battle.place.rowKm[row];
  battle.look = Math.ceil(Math.max(REACH_MIN_CELLS, REACH_KM / least, STEER_PRESS_KM / least, 2 * Math.max(CONTROL_RADIUS_MIN_CELLS, CONTROL_RADIUS_MAX_KM / least)));
  battle.lookFor = battle.place;
  return battle.look;
};

// Troops by the square of ground they stand in, so that who is near whom is
// asked of the neighbours and not of every pair: with hundreds a side, every
// pair is what a day would otherwise be spent on. A square is as wide as the
// furthest anything looks, so everything within that of a point is in the nine
// squares round it. Each square lists its troops in the order of the side's
// own list, and the squares are always read in the same order.
export const squaresOf = (battle, troops, wanted) => {
  const { cols, rows } = battle.field;
  const span = lookOf(battle);
  const across = Math.floor(cols / span) + 1;
  const down = Math.floor(rows / span) + 1;
  const heads = new Int32Array(across * down).fill(-1);
  const nexts = new Int32Array(troops.length);
  for (let index = troops.length - 1; index >= 0; index -= 1) {
    const troop = troops[index];
    if (!wanted(troop)) continue;
    const square = Math.min(down - 1, Math.max(0, Math.floor(troop.y / span))) * across + Math.min(across - 1, Math.max(0, Math.floor(troop.x / span)));
    nexts[index] = heads[square];
    heads[square] = index;
  }
  return { troops, heads, nexts, across, down, span };
};

// Calls `visit(troop, index)` for every troop listed in the nine squares round a point.
export const eachNear = (squares, x, y, visit) => {
  const col = Math.min(squares.across - 1, Math.max(0, Math.floor(x / squares.span)));
  const row = Math.min(squares.down - 1, Math.max(0, Math.floor(y / squares.span)));
  for (let dy = -1; dy <= 1; dy += 1) {
    if (row + dy < 0 || row + dy >= squares.down) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      if (col + dx < 0 || col + dx >= squares.across) continue;
      for (let at = squares.heads[(row + dy) * squares.across + col + dx]; at >= 0; at = squares.nexts[at]) visit(squares.troops[at], at);
    }
  }
};

// Whether a point lies in ground a side is leaving alone: `spare` is its
// list of discs, x, y and radius in cells.
const spared = (spare, x, y) => {
  for (let at = 0; at < spare.length; at += 3) {
    const dx = x - spare[at];
    const dy = y - spare[at + 1];
    if (dx * dx + dy * dy <= spare[at + 2] * spare[at + 2]) return true;
  }
  return false;
};

// ---- the day's steps -----------------------------------------------------------

const kernel = (distance, reach) => {
  const left = 1 - distance / reach;
  return left > 0 ? left * left : 0;
};

const stepsToday = (troop) => troop.stepping && isLive(troop);
const ended = [0, 0];
const face = [0, 0];

// The troops of both sides that step today, in a fixed order: side A's by
// index, then side B's.
const steppers = (battle) => {
  const list = [];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    battle.troops[side].forEach((troop, index) => {
      if (!stepsToday(troop)) return;
      troop.entry = { side, index, troop };
      list.push(troop.entry);
    });
  }
  return list;
};

// How a defender stands against the attackers in reach of it this moment. It
// faces the nearest of the other side's ground, and that is its FRONT: a
// line of attackers before it, however long, comes at its front. `flank`
// scales its defence down when one of them has come round beside it, further
// when one is behind it. Worked out once a moment for each defender.
// `attackers` is the other side's troops that step, by square.
const readDefender = (battle, side, troop, attackers, moment) => {
  if (troop.flankMoment === moment) return;
  troop.flankMoment = moment;
  const reach = reachCells(battle.place.kmAt, troop.y);
  if (!downhill(battle.field, battle.toSide[1 - side], troop.x, troop.y, face)) {
    troop.faceX = 0;
    troop.faceY = 0;
    troop.flank = 1;
    return;
  }
  const [faceX, faceY] = face;
  troop.faceX = faceX;
  troop.faceY = faceY;
  // How far round it the furthest-round attacker in reach has come.
  let round = 1;
  eachNear(attackers, troop.x, troop.y, (attacker) => {
    const dx = attacker.x - troop.x;
    const dy = attacker.y - troop.y;
    const apart = Math.sqrt(dx * dx + dy * dy);
    if (!(apart > 0) || apart > reach) return;
    const before = (dx * faceX + dy * faceY) / apart;
    if (before < round) round = before;
  });
  troop.flank = round < FLANK_OPPOSITE_COS ? SURROUNDED_DEFENCE : round < FLANK_BEHIND_COS ? FLANKED_DEFENCE : 1;
};

// What one defender is worth against one attacker at (x, y).
// (And the more from behind a wall of its own side's: walls.js.)
const defenceAgainst = (battle, side, defender, x, y) => {
  const front = (x - defender.x) * defender.faceX + (y - defender.y) * defender.faceY >= 0;
  return defensivePower(battle, side, defender, front) * defender.flank * (defender.walled > 0 ? 1 + WALL_DEFENCE_PER_LEVEL * defender.walled : 1);
};

// Walks the day in sub-steps short enough that no troop goes more than half
// its control radius in one. Each sub-step is worked out from the positions it
// began with: every troop's fight and step first, then the moves, side A's
// before side B's; ground both step into is kept by the stronger, side A on a
// tie. `paceKm[kind]` is the era's advance in a day, `pace` the scenario's
// setting. Returns how many sub-steps were walked.
export const stepForward = (battle, paceKm, pace) => {
  const { field, arena, place, claims } = battle;
  const { kmAt } = place;
  const active = steppers(battle);
  const inPlay = (x, y) => x >= 0 && y >= 0 && x < field.cols && y < field.rows && field.play[Math.floor(y) * field.cols + Math.floor(x)] === 1;
  let parts = 1;
  for (const entry of active) {
    const { troop } = entry;
    const cell = Math.max(0, ownCell(field, entry.side, troop.x, troop.y));
    entry.radius = controlRadius(troop, kmAt);
    // Where it may step: on ground in play, never into a place its side is
    // besieging or near one it is closing on, and never against its way.
    const spare = battle.spared[entry.side];
    const kept = battle.kept[entry.side];
    entry.forward = (x, y) => inPlay(x, y) && !spared(spare, x, y) && !(kept && kept[Math.floor(y) * field.cols + Math.floor(x)])
      && (x - troop.x) * troop.axisX + (y - troop.y) * troop.axisY >= 0;
    entry.dayCells = (paceKm[troop.kind] * arena.speed[cell] * troop.supply * pace * troop.drive * troop.paceFactor * battle.edge[entry.side].pace * troop.legs) / kmAt(troop.y);
    // Where the ground before it is its own side's, half again as fast as it carves through the other's (march.js).
    if (battle.ownPace > 1) {
      const aheadX = Math.floor(troop.x + troop.gx * entry.radius);
      const aheadY = Math.floor(troop.y + troop.gy * entry.radius);
      if (aheadX >= 0 && aheadY >= 0 && aheadX < field.cols && aheadY < field.rows && field.holders[aheadY * field.cols + aheadX] === entry.side) entry.dayCells *= battle.ownPace;
    }
    parts = Math.max(parts, Math.ceil(entry.dayCells / (entry.radius * 0.5)));
  }
  parts = Math.min(SUBSTEPS_MAX, parts);
  const share = (ATTRITION / 100) / parts;

  for (let part = 0; part < parts && active.length > 0; part += 1) {
    claims.moment += 1;
    const stepping = [squaresOf(battle, battle.troops[0], stepsToday), squaresOf(battle, battle.troops[1], stepsToday)];
    const standing = [squaresOf(battle, battle.troops[0], isLive), squaresOf(battle, battle.troops[1], isLive)];
    // Every troop's fight and step, from where everyone stands now.
    for (const entry of active) {
      const { side, troop } = entry;
      const reach = reachCells(kmAt, troop.y);
      let attack = 0;
      eachNear(stepping[side], troop.x, troop.y, (other) => {
        const dx = other.x - troop.x;
        const dy = other.y - troop.y;
        const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
        if (weight > 0) attack += offensivePower(battle, side, other) * weight;
      });
      const aheadX = troop.x + troop.gx * entry.radius;
      const aheadY = troop.y + troop.gy * entry.radius;
      let defence = 0;
      // How much of it comes from troops in their works (battle.works: dawn.js), for what the assault costs.
      let entrenched = 0;
      const sparing = battle.spared[side];
      eachNear(standing[1 - side], aheadX, aheadY, (enemy) => {
        // A besieged place is not assaulted: its troops are in no fight they
        // did not start. Nor is one being shut in, before the ring closes: who
        // stands in ground this side is leaving alone for a siege is left alone.
        if (enemy.besieged || spared(sparing, enemy.x, enemy.y)) return;
        const dx = enemy.x - aheadX;
        const dy = enemy.y - aheadY;
        const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
        if (!(weight > 0)) return;
        readDefender(battle, 1 - side, enemy, stepping[side], claims.moment);
        const part = defenceAgainst(battle, 1 - side, enemy, troop.x, troop.y) * weight;
        defence += part;
        if (battle.works && (enemy.dug || enemy.dig > 0)) entrenched += part * (enemy.dug ? 1 : enemy.dig < battle.works.most ? enemy.dig / battle.works.most : 1);
      });
      const raw = defence;
      if (inPlay(aheadX, aheadY)) defence *= terrainDefence(arena.speed[Math.floor(aheadY) * field.cols + Math.floor(aheadX)]);
      const ratio = defence > 0 ? attack / defence : Infinity;
      // Ground nobody defends is walked at the full pace, but for what the
      // difficulty gives the side that holds it: the harder its troops fight,
      // the more slowly its ground is taken, defended or empty (never faster
      // than 1 / power of the pace: a lone defender far off is no way round it).
      const theirs = inPlay(aheadX, aheadY) && field.holders[Math.floor(aheadY) * field.cols + Math.floor(aheadX)] === 1 - side;
      const open = theirs ? Math.min(1, 1 / battle.edge[1 - side].power) : 1;
      const gain = Math.min(open, defence > 0 ? Math.min(1, Math.max(0, (GAIN * (ratio - RATIO_NEEDED)) / (ratio + RATIO_SOFTNESS))) : 1);
      entry.power = attack;
      entry.fromX = troop.x;
      entry.fromY = troop.y;
      const length = Math.min((entry.dayCells * gain) / parts, entry.radius * 0.5);
      // A stretch of the other side's wall in its way is assaulted, not gone round (walls.js).
      const ahead = length > 0.5 ? length : 0.5;
      const wall = battle.walls ? wallAhead(battle, side, troop.x + troop.gx * ahead, troop.y + troop.gy * ahead) : null;
      entry.length = !wall && length > 0 && stepAlong(troop.x, troop.y, troop.gx, troop.gy, length, entry.forward, ended) ? length : 0;
      entry.toX = entry.length > 0 ? ended[0] : troop.x;
      entry.toY = entry.length > 0 ? ended[1] : troop.y;
      // What the fight costs, whether or not it gained anything: a failed
      // assault is paid for too. One that is cut off is worn the faster by
      // those closing on it.
      // Assaulting a wall: what it wears of the wall, at the odds against what defends it there, and
      // what it costs the assault besides the fight (walls.js).
      if (wall && attack > 0) {
        wearWall(battle, wall, raw > 0 ? attack / defence : WALL_ODDS, troop.kind === KIND_ARTILLERY, 1 / parts);
        troop.loss += troop.strength * share * ATTACK_COST * (WALL_ASSAULT_COST - 1);
        troop.fought = true;
      }
      if (raw > 0 && attack > 0) {
        // (An assault on troops in their works costs the more: constants.js STRONG_WORKS.assault.)
        const works = battle.works && raw > 0 ? 1 + (battle.works.assault - 1) * (entrenched < raw ? entrenched / raw : 1) : 1;
        troop.loss += troop.strength * share * ATTACK_COST * clampRatio(Math.sqrt(defence / attack)) * works;
        troop.fought = true;
        const theirs = share * clampRatio(Math.sqrt(attack / defence));
        eachNear(standing[1 - side], aheadX, aheadY, (enemy) => {
          if (enemy.besieged || spared(sparing, enemy.x, enemy.y)) return;
          const dx = enemy.x - aheadX;
          const dy = enemy.y - aheadY;
          const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
          if (!(weight > 0)) return;
          enemy.loss += enemy.strength * theirs * ((defenceAgainst(battle, 1 - side, enemy, troop.x, troop.y) * weight) / raw)
            * (troop.reducing && enemy.pocket ? CLOSE_WEAR : 1);
          enemy.engaged = true;
        });
      }
    }

    // The moves, and the ground each takes: the strip it walked. A side laying
    // siege to a place leaves the ground round the place alone, and all of
    // what it has shut in.
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const spare = battle.spared[side].length > 0 ? battle.spared[side] : null;
      const keep = battle.kept[side];
      for (const entry of active) {
        if (entry.side !== side || entry.length <= 0) continue;
        const { troop } = entry;
        takeCapsule(field, side, entry.fromX, entry.fromY, entry.toX, entry.toY, entry.radius, entry.radius, {
          claims,
          strength: entry.power,
          painter: troop.owner,
          from: part / parts,
          span: 1 / parts,
          spare,
          keep,
        });
        troop.x = entry.toX;
        troop.y = entry.toY;
        troop.movedKm += entry.length * kmAt(troop.y);
        troop.walkedToday = true;
      }
    }
  }
  for (const entry of active) entry.troop.entry = null;
  // A troop that has closed on the place it was sent at stands there, and the
  // ground round where it stands is its side's.
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const spare = battle.spared[side].length > 0 ? battle.spared[side] : null;
    for (const troop of battle.troops[side]) {
      if (!troop.plant || !isLive(troop)) continue;
      const radius = controlRadius(troop, kmAt);
      takeCapsule(field, side, troop.x, troop.y, troop.x, troop.y, radius, radius, { painter: troop.owner, spare, keep: battle.kept[side] });
      troop.walkedToday = true;
    }
  }
  return active.length > 0 ? parts : 0;
};

// ---- the end of a day ----------------------------------------------------------

// What the day cost and what it mended: the losses of the fight, of standing in
// contact, of being cut off or squeezed; works dug; reinforcement from the
// side's reserves; and what each troop is seen to be doing.
export const closeDay = (battle) => {
  const { kmAt } = battle.place;
  const standing = [squaresOf(battle, battle.troops[0], isLive), squaresOf(battle, battle.troops[1], isLive)];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      // A quiet stretch in contact costs a little: a tenth of a fight's worth.
      // Not in a besieged place, which wastes by its own figure and no other.
      if (!troop.besieged && !troop.engaged && !troop.walkedToday && troop.loss === 0) {
        const reach = reachCells(kmAt, troop.y);
        let theirs = 0;
        let ours = 0;
        eachNear(standing[1 - side], troop.x, troop.y, (enemy) => {
          const dx = enemy.x - troop.x;
          const dy = enemy.y - troop.y;
          theirs += enemy.strength * kernel(Math.sqrt(dx * dx + dy * dy), reach);
        });
        if (theirs > 0) {
          eachNear(standing[side], troop.x, troop.y, (friend) => {
            const dx = friend.x - troop.x;
            const dy = friend.y - troop.y;
            ours += friend.strength * kernel(Math.sqrt(dx * dx + dy * dy), reach);
          });
          troop.loss += troop.strength * (ATTRITION / 100) * QUIET_ATTRITION * clampRatio(theirs / ours);
        }
      }
    }
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      if (!isLive(troop)) continue;
      // What the fight cost it, the less if it is dug in; and what being cut
      // off wastes: slowly in a besieged place or in squeezed ground, where
      // something still gets through, fast in a pocket.
      const wasting = troop.besieged ? SIEGE_LOSS : troop.sealed ? POCKET_LOSS : troop.squeezed ? SQUEEZED_LOSS : 0;
      // (And what the day's cold or heat takes: from a troop short of supply, and
      // with attrition on from every troop out in it: weather.js weatherLoss.
      // Being cut off and the weather are its attrition, counted: dawn.js.)
      const weathered = battle.sky ? weatherLoss(battle.sky, troop, battle.exposure ? battle.exposure[side] : null) : 0;
      const wasted = wasting + weathered;
      if (battle.lostBy && wasted > 0) battle.lostBy[side].set(troop.owner, (battle.lostBy[side].get(troop.owner) ?? 0) + (wasted < troop.strength ? wasted : troop.strength));
      troop.strength -= troop.loss * (troop.dug ? (battle.works ? battle.works.loss : DUG_IN_LOSS) : 1) + wasted;
      // What is left of a cut-off troop, with the other side upon it, gives up.
      if (troop.pocket && !troop.besieged && troop.engaged && troop.strength < GIVES_UP_UNDER) troop.strength = 0;
    }
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      if (troop.strength > 0) {
        const busy = troop.order !== null && !troop.order.done;
        if (troop.dug) troop.dig = 1;
        else if (troop.movedKm > DIG_LOST_KM) troop.dig = 0;
        else if (!busy && troop.dig < (battle.works ? battle.works.most : DIG_MAX_HOLD)) {
          const most = battle.works ? battle.works.most : DIG_MAX_HOLD;
          troop.dig = Math.min(most, troop.dig + (battle.works ? battle.works.perDay : DIG_PER_DAY_HOLD));
        }
        // Reserves reach every troop that is not cut off.
        if (!troop.pocket && troop.strength < 100 && battle.pool[side] > 0) {
          // (And, weighing countries' own military figures, only with men its country still has: dawn.js dusk.)
          const budget = battle.mendOf ? battle.mendOf(side, troop.owner) : null;
          const sent = budget ? Math.min(REINFORCE_PER_DAY * battle.edge[side].mend, 100 - troop.strength, battle.pool[side], budget.left()) : Math.min(REINFORCE_PER_DAY * battle.edge[side].mend, 100 - troop.strength, battle.pool[side]);
          if (budget) budget.spend(sent);
          troop.strength += sent;
          battle.pool[side] -= sent;
          // (Men sent to make good a loss are recruits like any others: manpower.js counts them.)
          battle.mendedBy[side][troop.owner] = (battle.mendedBy[side][troop.owner] ?? 0) + sent;
        }
      } else {
        troop.strength = 0;
        troop.dig = 0;
        troop.dug = false;
        troop.order = null;
        troop.fallback = null;
      }
      troop.state = troop.strength <= 0 ? STATE_SPENT : troop.pocket ? STATE_ENCIRCLED : troop.walkedToday ? STATE_ADVANCING : troop.dug ? STATE_DUG_IN : STATE_HOLDING;
      troop.stepping = false;
      troop.walkedToday = false;
      troop.movedKm = 0;
      troop.loss = 0;
      troop.engaged = false;
      troop.fought = false;
    }
  }
};

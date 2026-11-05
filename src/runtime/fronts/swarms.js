/*! Open Historia — battlefields and fronts: swarms © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "since war fronts havent always existed and there are other types of
// warfare, make it so you can also deploy "armies" which are just groups of
// troops not arranged in a front", "armies should behave and be able to do the
// same thing as fronts, they are just deployed in a group formation instead of
// a front", "a group should also be run by a single general. using the deploy
// tool should give the option to do a front or swarm", "troops should move
// independantly like they do in fronts" (the owner, 2026-10-16).
//
// A SWARM is a body of a side's troops deployed as a group and not along the
// line, under a general of its own. That is all it is. Its troops are troops
// like any other: each moves by itself, fights, takes the ground it walks
// over, is cut off, digs in, falls back and withdraws by the very rules the
// line's troops do, and is ordered as they are (way.js, move.js, combat.js,
// orders.js). What is a swarm's own:
//
//   - where it stands when it comes: a block round one place (placeBlock),
//     the place its commander chose for it (deploy.js: a swarm's deployment is
//     a place, not a line), or where its war's first troops are raised in a
//     war fought before there were fronts (raiseSwarms);
//   - its general: one of the side's commands (command.js) is the swarm's.
//     Every troop of it is under that general and no other, and the generals
//     the line is shared out among never take a swarm's troops, nor put a
//     newcomer beside it under it (command.js shareOut);
//   - its new troops: those its country's commander deploys at its place join
//     it, or gather there as a new swarm under a general of their own when it
//     has gone on from there (gatherNewcomers).
//
// A battle keeps which of its commands are swarms, a set a side
// (battle.swarms), in its record's brief.carry.swarms.
//
// Only + - * / and square roots.

import {
  CONTROL_RADIUS_MAX_KM,
  FRONT_COMMANDS_MOST,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_COMMANDS,
  SWARM_JOIN_KM,
  SWARM_PLACE_KM,
  SWARM_REAR_KM,
  SWARM_SPACING_BRUSHES,
  SWARM_TROOPS_EACH,
} from "./constants.js";
import { measure } from "./ground.js";
import { isLive, stands } from "./troops.js";

// What a deployment is, and what a scenario's wars are fought in: a front (the
// line, as ever) or a swarm.
export const FRONT_FORM = "front";
export const SWARM_FORM = "swarm";
export const DEPLOY_FORMS = Object.freeze([FRONT_FORM, SWARM_FORM]);

const SIDES = [HOLDER_SIDE_A, HOLDER_SIDE_B];

// ---- what is kept ------------------------------------------------------------------------

// The swarms a record's carry keeps, a list of commands a side, read on the way in.
export const readSwarms = (value) => SIDES.map((side) => {
  const kept = [];
  for (const raw of Array.isArray(value) && Array.isArray(value[side]) ? value[side] : []) {
    const command = Number(raw);
    if (Number.isInteger(command) && command >= 0 && command < MAX_COMMANDS && !kept.includes(command)) kept.push(command);
  }
  return kept.sort((a, b) => a - b);
});

// Whether a troop of a side is a swarm's.
export const inSwarm = (battle, side, troop) => troop.command >= 0 && battle.swarms?.[side]?.has(troop.command) === true;

// The swarms a side has that still have troops, as its record keeps them; those with none are dropped from the battle too.
export const swarmsKept = (battle) => SIDES.map((side) => {
  const held = battle.swarms?.[side];
  if (!held || held.size === 0) return [];
  const manned = new Set();
  for (const troop of battle.troops[side]) if (isLive(troop) && held.has(troop.command)) manned.add(troop.command);
  for (const command of [...held]) if (!manned.has(command)) held.delete(command);
  return [...held].sort((a, b) => a - b);
});

// Where each swarm of a side stands, by its general: { x, y, n, o }, the middle of its living troops, how many they
// are, and whose they are (a general commands one country's troops: the first of them says).
export const swarmMiddles = (battle, side) => {
  const middles = new Map();
  if (!battle.swarms?.[side]?.size) return middles;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || !inSwarm(battle, side, troop)) continue;
    let middle = middles.get(troop.command);
    if (!middle) {
      middle = { x: 0, y: 0, n: 0, o: troop.owner };
      middles.set(troop.command, middle);
    }
    middle.x += troop.x;
    middle.y += troop.y;
    middle.n += 1;
  }
  for (const middle of middles.values()) {
    middle.x /= middle.n;
    middle.y /= middle.n;
  }
  return middles;
};

// ---- a general for it -------------------------------------------------------------------

// A command for a new swarm of a side's: one no living troop of the side is under and no swarm has. While the side
// has troops on the line its own generals keep the first numbers (FRONT_COMMANDS_MOST of them), and a swarm takes
// the first after them; -1 when every one is taken.
export const freeCommand = (battle, side) => {
  const used = new Set(battle.swarms[side]);
  let lined = false;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop)) continue;
    if (troop.command >= 0) used.add(troop.command);
    if (!inSwarm(battle, side, troop)) lined = true;
  }
  const start = lined ? FRONT_COMMANDS_MOST : 0;
  for (let step = 0; step < MAX_COMMANDS; step += 1) {
    const command = (start + step) % MAX_COMMANDS;
    if (!used.has(command)) return command;
  }
  return -1;
};

// ---- standing as a group -----------------------------------------------------------------

// How far apart a swarm's troops stand when it comes, in km: its side's brush, a little less, so that the ground
// between them is all painted when they set off.
const spacingKm = (battle, side) => (Number(battle.radiusKm?.[side]) > 0 ? battle.radiusKm[side] : CONTROL_RADIUS_MAX_KM) * SWARM_SPACING_BRUSHES;

// Half the breadth of the block `count` troops stand in when they come, in km.
export const halfBlockKm = (battle, side, count) => (spacingKm(battle, side) * (Math.ceil(Math.sqrt(Math.max(1, count))) - 1)) / 2;

// The places of a block of `count` round its middle, in whole steps, nearest first: ring after ring, and each ring
// filled from the middle of each of its four sides outward, the four in turn, so that a block not yet whole is not
// lopsided.
export const blockSteps = (count) => {
  const steps = [[0, 0]];
  for (let ring = 1; steps.length < count; ring += 1) {
    const along = (sign) => {
      const out = [0];
      for (let step = 1; step < ring; step += 1) out.push(sign * step, -sign * step);
      out.push(sign * ring);
      return out;
    };
    const up = along(1);
    const down = along(-1);
    for (let at = 0; at < 2 * ring && steps.length < count; at += 1) {
      steps.push([ring, up[at]]);
      if (steps.length < count) steps.push([down[at], ring]);
      if (steps.length < count) steps.push([-ring, down[at]]);
      if (steps.length < count) steps.push([up[at], -ring]);
    }
  }
  return steps.slice(0, count);
};

// The cell of a side's ground in play nearest a point, within `reach` cells of it: -1 for none.
const nearestOwn = (field, side, x, y, reach) => {
  let best = -1;
  let least = Infinity;
  const col0 = Math.floor(x);
  const row0 = Math.floor(y);
  for (let row = Math.max(0, row0 - reach); row <= Math.min(field.rows - 1, row0 + reach); row += 1) {
    for (let col = Math.max(0, col0 - reach); col <= Math.min(field.cols - 1, col0 + reach); col += 1) {
      const cell = row * field.cols + col;
      if (field.holders[cell] !== side || !field.play[cell]) continue;
      const dx = col + 0.5 - x;
      const dy = row + 0.5 - y;
      const far = dx * dx + dy * dy;
      if (far < least) {
        least = far;
        best = cell;
      }
    }
  }
  return best;
};

// Stands troops of a side (by their places in its list) as a block round a point: each on the nearest place of the
// block that none of its side's other troops stands on already, so that a swarm that grows takes its newcomers onto
// its outer ring. A place on ground that is not the side's is moved to the nearest that is, within SWARM_PLACE_KM;
// with none there the troop stands at the middle, if that is the side's; with neither it is left where it was.
export const placeBlock = (battle, side, indexes, x, y) => {
  const { field } = battle;
  const step = spacingKm(battle, side) / battle.place.kmAt(y);
  const reach = Math.max(2, Math.ceil(SWARM_PLACE_KM / battle.frame.km));
  const coming = new Set(indexes);
  const others = battle.troops[side].filter((troop, index) => isLive(troop) && !coming.has(index));
  const standsThere = (tx, ty) => others.some((troop) => troop.x > tx - step / 2 && troop.x < tx + step / 2 && troop.y > ty - step / 2 && troop.y < ty + step / 2);
  let steps = blockSteps(indexes.length * 2 + 8);
  let next = 0;
  for (const index of indexes) {
    const troop = battle.troops[side][index];
    let tx = x;
    let ty = y;
    for (;;) {
      if (next >= steps.length) steps = blockSteps(steps.length * 2);
      const [across, down] = steps[next];
      next += 1;
      tx = x + across * step;
      ty = y + down * step;
      if (!standsThere(tx, ty) || next > indexes.length * 8 + 64) break;
    }
    if (stands(field, side, tx, ty)) {
      troop.x = tx;
      troop.y = ty;
      continue;
    }
    const cell = nearestOwn(field, side, tx, ty, reach);
    if (cell >= 0) {
      troop.x = (cell % field.cols) + 0.5;
      troop.y = Math.floor(cell / field.cols) + 0.5;
    } else if (stands(field, side, x, y)) {
      troop.x = x;
      troop.y = y;
    }
  }
};

// A point of a side's ground near (x, y) that lies `rearKm` back from the other side's: the nearest such within
// SWARM_PLACE_KM and the distance itself; failing that, of the side's ground there, the cell furthest from the other
// side's; failing that, the point itself. [x, y] in cells.
export const rearOf = (battle, side, x, y, rearKm = SWARM_REAR_KM) => {
  const { field } = battle;
  const toOther = measure(battle)[1 - side];
  const cellKm = battle.frame.km;
  const reach = Math.max(2, Math.ceil((SWARM_PLACE_KM + rearKm) / cellKm));
  const wanted = (rearKm / cellKm) * 3;
  const col0 = Math.floor(x);
  const row0 = Math.floor(y);
  let best = -1;
  let least = Infinity;
  let deepest = -1;
  let deep = -1;
  for (let row = Math.max(0, row0 - reach); row <= Math.min(field.rows - 1, row0 + reach); row += 1) {
    for (let col = Math.max(0, col0 - reach); col <= Math.min(field.cols - 1, col0 + reach); col += 1) {
      const cell = row * field.cols + col;
      if (field.holders[cell] !== side || !field.play[cell]) continue;
      if (toOther[cell] > deep) {
        deep = toOther[cell];
        deepest = cell;
      }
      if (toOther[cell] < wanted) continue;
      const dx = col + 0.5 - x;
      const dy = row + 0.5 - y;
      const far = dx * dx + dy * dy;
      if (far < least) {
        least = far;
        best = cell;
      }
    }
  }
  const cell = best >= 0 ? best : deepest;
  return cell >= 0 ? [(cell % field.cols) + 0.5, Math.floor(cell / field.cols) + 0.5] : [x, y];
};

// ---- new troops, and a war's first ------------------------------------------------------------

// The place a member's commander chose for its new troops on a battle where that is a swarm's (deploy.js), on the
// side's own ground: [x, y] in cells; null where it chose a line or nothing, or the place is not its side's any more.
export const swarmPlaceOf = (battle, side, member) => {
  const lines = Array.isArray(battle.deploy) && Array.isArray(battle.deploy[side]) ? battle.deploy[side] : [];
  const wanted = String(member ?? "").trim().toLowerCase();
  const entry = lines.find((line) => line.form === SWARM_FORM && line.country.toLowerCase() === wanted);
  if (!entry || entry.way.length === 0) return null;
  const [x, y] = battle.place.toCell(entry.way[0][0], entry.way[0][1]);
  const cell = nearestOwn(battle.field, side, x, y, Math.max(2, Math.ceil(SWARM_PLACE_KM / battle.frame.km)));
  return cell >= 0 ? [(cell % battle.field.cols) + 0.5, Math.floor(cell / battle.field.cols) + 0.5] : null;
};

// Whether a member's new troops on a battle come as a swarm: where its commander chose a swarm there (deploy.js), or
// where it chose nothing and its wars are fought in swarms (`warfare`, the run's: runtime/warSettings.js).
export const gathersInSwarms = (battle, side, member, warfare) => {
  const lines = Array.isArray(battle.deploy) && Array.isArray(battle.deploy[side]) ? battle.deploy[side] : [];
  const wanted = String(member ?? "").trim().toLowerCase();
  const entry = lines.find((line) => line.country.toLowerCase() === wanted);
  return entry ? entry.form === SWARM_FORM : warfare === SWARM_FORM;
};

// New troops of one member of a side (from `first` on in the side's list, those of `owner`), where they come as a
// swarm (gathersInSwarms): to the place its commander chose for them, or a way behind the line from where they came
// in along it. They join the swarm of their country's whose middle stands within SWARM_JOIN_KM of that place, the
// nearest; with none there they are a new swarm there, under a general of its own; with no general left to give one,
// they join the nearest of their country's swarms wherever it is; and with none at all they are troops of the line.
// Either way they stand at the place, as a block with whoever stands there already. Returns how many went into a swarm.
export const gatherNewcomers = (battle, side, owner, first, warfare) => {
  const troops = battle.troops[side];
  const newcomers = [];
  for (let at = first; at < troops.length; at += 1) if (isLive(troops[at]) && troops[at].owner === owner && !(troops[at].command >= 0)) newcomers.push(at);
  const member = battle.sides[side][owner];
  if (newcomers.length === 0 || !battle.swarms || !gathersInSwarms(battle, side, member, warfare)) return 0;
  let place = swarmPlaceOf(battle, side, member);
  if (!place) {
    let x = 0;
    let y = 0;
    for (const index of newcomers) {
      x += troops[index].x / newcomers.length;
      y += troops[index].y / newcomers.length;
    }
    // (Its front ring SWARM_REAR_KM back: its middle so much further.)
    place = rearOf(battle, side, x, y, SWARM_REAR_KM + halfBlockKm(battle, side, newcomers.length));
  }
  const [px, py] = place;
  const km = battle.place.kmAt(py);
  let join = -1;
  let nearest = Infinity;
  let anywhere = -1;
  let anywhereFar = Infinity;
  for (const [command, middle] of swarmMiddles(battle, side)) {
    if (middle.o !== owner) continue;
    const far = Math.sqrt((middle.x - px) * (middle.x - px) + (middle.y - py) * (middle.y - py)) * km;
    if (far <= SWARM_JOIN_KM && far < nearest) {
      nearest = far;
      join = command;
    }
    if (far < anywhereFar) {
      anywhereFar = far;
      anywhere = command;
    }
  }
  let command = join;
  if (command < 0) {
    command = freeCommand(battle, side);
    if (command >= 0) battle.swarms[side].add(command);
    else command = anywhere;
  }
  if (command < 0) return 0;
  placeBlock(battle, side, newcomers, px, py);
  for (const index of newcomers) troops[index].command = command;
  return newcomers.length;
};

// A side's troops raised as its war begins, where it fights in swarms (`raised`, those standing now, along the line
// in the order they were stood there): each member's in swarms of about SWARM_TROOPS_EACH, as many as there are
// generals for (every member that has troops at least one while any are free), each standing as a block whose
// front is SWARM_REAR_KM behind the stretch of line its troops were raised along, under a general of its own. Those there was
// no general for stay troops of the line.
export const raiseSwarms = (battle, side, raised) => {
  if (!battle.swarms) return;
  const troops = battle.troops[side];
  const indexOf = new Map(troops.map((troop, index) => [troop, index]));
  const owners = [];
  for (const troop of raised) if (isLive(troop) && !owners.includes(troop.owner)) owners.push(troop.owner);
  owners.sort((a, b) => a - b);
  const mine = owners.map((owner) => raised.filter((troop) => isLive(troop) && troop.owner === owner));
  // How many generals are free, and each member's share of them: the larger give one back first where they are too few.
  const used = new Set(battle.swarms[side]);
  for (const troop of troops) if (isLive(troop) && troop.command >= 0) used.add(troop.command);
  const free = MAX_COMMANDS - used.size;
  const wanted = mine.map((list) => Math.max(1, Math.round(list.length / SWARM_TROOPS_EACH)));
  while (wanted.reduce((sum, count) => sum + count, 0) > free) {
    let largest = -1;
    for (let at = 0; at < wanted.length; at += 1) if (wanted[at] > 1 && (largest < 0 || wanted[at] > wanted[largest])) largest = at;
    if (largest < 0) break;
    wanted[largest] -= 1;
  }
  owners.forEach((owner, at) => {
    const list = mine[at];
    const count = Math.min(wanted[at], list.length);
    for (let part = 0; part < count; part += 1) {
      const chunk = list.slice(Math.floor((part * list.length) / count), Math.floor(((part + 1) * list.length) / count));
      if (chunk.length === 0) continue;
      const command = freeCommand(battle, side);
      if (command < 0) return;
      battle.swarms[side].add(command);
      let x = 0;
      let y = 0;
      for (const troop of chunk) {
        x += troop.x / chunk.length;
        y += troop.y / chunk.length;
      }
      // (Its front ring SWARM_REAR_KM behind the line: its middle so much further.)
      const [px, py] = rearOf(battle, side, x, y, SWARM_REAR_KM + halfBlockKm(battle, side, chunk.length));
      const indexes = chunk.map((troop) => indexOf.get(troop));
      for (const index of indexes) troops[index].command = command;
      placeBlock(battle, side, indexes, px, py);
    }
  });
};

// A record's swarms, a list of commands a side (GameUI/warRoom.jsx and the map read them).
export const swarmsOfRecord = (record) => readSwarms(record?.brief?.carry?.swarms);

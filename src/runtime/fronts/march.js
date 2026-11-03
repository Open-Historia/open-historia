/*! Open Historia — battlefields and fronts: new troops march to the line from inside their country © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// (mechanics.js "marching".) "forces shouldnt just be immediatly deployed at the
// front lines, they should need to move to the front lines from in the
// country. how far in should be calculated using population density. troop
// movement in your own sides territory should be 50% faster than if your
// carving through enemy territory" (the owner, 2026-11-02).
//
// A country's new troops are placed where they always were, on the line or on
// the line its commander drew for them (deploy.js), and that place is now only
// where they are going: they are called up where its people live, as far
// behind it as its people are spread thin (depthOf), and march there (marchOn).
// How thin is read off the battlefield's own map: the people of the country's
// cities on it over the ground it holds there. Thinner by a factor of four is
// twice as deep (the square root), from MARCH_DEPTH_AT_KM where a square km has
// MARCH_DENSITY_AT people, and never less than MARCH_DEPTH_LEAST_KM nor more
// than MARCH_DEPTH_MOST_KM; with no cities on the map, MARCH_DEPTH_UNKNOWN_KM.
//
// Over its own side's ground a troop goes OWN_GROUND_PACE times the pace it
// carves through the enemy's: the march, and any step whose ground ahead is
// its own (combat.js stepForward).
//
// Which troops: those a war that began after the game did raises, those a
// border built up in peace raises, and every call-up, draft and levy that
// comes in later. A war under way when the game began has its armies at the
// line already (as muster.js has it), and a scenario's own fronts stand where
// their designer put them.
//
// Where a troop is going is kept with the battlefield (brief.carry.march: a
// side's list, a troop's goal cell + 1, 0 for none: battle.js).
//
// Only + - * / and Math.sqrt.

import { compareGameDates } from "../gameDates.js";
import { holderOf } from "./battle.js";
import { cellAt, downhill, measure } from "./ground.js";

export const OWN_GROUND_PACE = 1.5;
export const MARCH_DEPTH_AT_KM = 45;
export const MARCH_DENSITY_AT = 100;
export const MARCH_DEPTH_LEAST_KM = 20;
export const MARCH_DEPTH_MOST_KM = 350;
export const MARCH_DEPTH_UNKNOWN_KM = 80;
// The days a whole army takes to call up where no mustering curve is known (engine.js callUpSize).
export const CALL_UP_FULL_DAYS = 90;

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const toward = [0, 0];

// Whether a battle's new troops march to the line in this run (see above).
export const marchesFor = (run, battle, war = null) => {
  if (run.mech?.marching !== true || run.input?.authored) return false;
  // (A country's forces at home are called up round its cities and stay there: home.js.)
  if (battle.home) return false;
  if (battle.status === "standing") return true;
  return !war || !war.began || !run.input?.gameBegan || compareGameDates(war.began, run.input.gameBegan) > 0;
};

// How far behind the line a member's troops are called up on a battle, in km: from the people of its cities on
// the battle's map over the ground it holds there. Worked out once a battle a run.
export const depthOf = (battle, run, side, member) => {
  const key = fold(member);
  battle.marchDepths = battle.marchDepths instanceof Map ? battle.marchDepths : new Map();
  if (battle.marchDepths.has(key)) return battle.marchDepths.get(key);
  const { field, arena } = battle;
  const mine = new Uint8Array(arena.ids.length);
  for (let region = 1; region < arena.ids.length; region += 1) if (fold(holderOf(battle, run, arena.ids[region])) === key) mine[region] = 1;
  let cells = 0;
  for (let cell = 0; cell < field.size; cell += 1) if (field.holders[cell] === side && mine[arena.region[cell]] === 1) cells += 1;
  let people = 0;
  for (const city of Array.isArray(arena.cities) ? arena.cities : []) {
    if (city.cell >= 0 && field.holders[city.cell] === side && mine[arena.region[city.cell]] === 1) people += city.population;
  }
  const area = cells * battle.frame.km * battle.frame.km;
  let depth = MARCH_DEPTH_UNKNOWN_KM;
  if (people > 0 && area > 0) {
    depth = MARCH_DEPTH_AT_KM * Math.sqrt(MARCH_DENSITY_AT / (people / area));
    depth = depth < MARCH_DEPTH_LEAST_KM ? MARCH_DEPTH_LEAST_KM : depth > MARCH_DEPTH_MOST_KM ? MARCH_DEPTH_MOST_KM : depth;
  }
  battle.marchDepths.set(key, depth);
  return depth;
};

// The place `depthKm` behind a side's line from (x, y): straight back from the other side's ground, a cell at a
// time over the side's own, until that far or as far as its ground goes. [x, y] in cells.
const inlandOf = (battle, side, x, y, depthKm, heading) => {
  const { field } = battle;
  const toOther = measure(battle)[1 - side];
  const wanted = (depthKm / battle.frame.km) * 3;
  let atX = x;
  let atY = y;
  const most = Math.ceil((2 * depthKm) / battle.frame.km) + 4;
  for (let step = 0; step < most; step += 1) {
    const here = cellAt(field, atX, atY);
    if (here >= 0 && toOther[here] >= wanted) break;
    let backX;
    let backY;
    if (downhill(field, toOther, atX, atY, toward)) {
      backX = -toward[0];
      backY = -toward[1];
    } else {
      backX = -heading[0];
      backY = -heading[1];
    }
    if (backX === 0 && backY === 0) break;
    const nextX = atX + backX;
    const nextY = atY + backY;
    const cell = cellAt(field, nextX, nextY);
    if (cell < 0 || field.holders[cell] !== side || field.play[cell] !== 1) break;
    atX = nextX;
    atY = nextY;
  }
  return [atX, atY];
};

// New troops of a side (`troops`, just placed), sent back to where they are called up, each going to the place it
// was placed at: its goal. A named formation (a unit of the map's) stands where it stood.
export const sendInland = (battle, run, side, troops) => {
  const { field } = battle;
  for (const troop of troops) {
    if (!troop || troop.strength <= 0 || troop.named) continue;
    const goal = cellAt(field, troop.x, troop.y);
    if (goal < 0 || field.holders[goal] !== side) continue;
    const member = battle.sides[side][troop.owner] ?? battle.sides[side][0];
    const heading = [troop.hx || (side === 0 ? 1 : -1), troop.hy || 0];
    const [x, y] = inlandOf(battle, side, troop.x, troop.y, depthOf(battle, run, side, member), heading);
    const start = cellAt(field, x, y);
    if (start === goal) continue;
    troop.x = x;
    troop.y = y;
    troop.goal = goal;
  }
};

// A day's march of a troop on its way to the line: toward its goal over its own side's ground, at its pace there
// (`marchKm` a day by its kind: the run's advance, its pace and OWN_GROUND_PACE). Done, it is with the line: there,
// or where its goal is no longer its side's, or the line has come to meet it. Returns whether it marched today.
export const marchOn = (battle, side, troop, marchKm) => {
  if (!(troop.goal >= 0)) return false;
  const { field, place } = battle;
  const goal = troop.goal;
  if (goal >= field.size || field.holders[goal] !== side) {
    troop.goal = -1;
    return false;
  }
  const goalX = (goal % field.cols) + 0.5;
  const goalY = Math.floor(goal / field.cols) + 0.5;
  const dx = goalX - troop.x;
  const dy = goalY - troop.y;
  const gap = Math.sqrt(dx * dx + dy * dy);
  const km = place.kmAt(troop.y);
  const legs = troop.legs > 0 ? troop.legs : 1;
  const step = (marchKm[troop.kind] * legs) / km;
  if (!(step > 0)) return false;
  if (gap <= step) {
    troop.x = goalX;
    troop.y = goalY;
    troop.movedKm = (troop.movedKm || 0) + gap * km;
    troop.goal = -1;
    return true;
  }
  for (const share of [1, 0.5, 0.25]) {
    const x = troop.x + (dx / gap) * step * share;
    const y = troop.y + (dy / gap) * step * share;
    const cell = cellAt(field, x, y);
    if (cell < 0 || field.holders[cell] !== side || field.play[cell] !== 1) continue;
    troop.x = x;
    troop.y = y;
    troop.movedKm = (troop.movedKm || 0) + step * share * km;
    troop.hx = dx / gap;
    troop.hy = dy / gap;
    return true;
  }
  // No way straight there (water, or a neighbour's land between): it goes on as the line's other troops come up.
  troop.goal = -1;
  return false;
};

// A day of a troop at peace along a route drawn for it (way.js giveRoute: its order's legs, in cells), over its own
// side's ground at the march's pace: leg after leg, as far as its side's ground goes. Where the route goes on into
// another country's land the war is begun before it gets there (engine.js attackFromStanding). Returns whether it
// went anywhere today.
export const walkRoute = (battle, side, troop, marchKm, day) => {
  const order = troop.order;
  if (!order || order.done || order.kind !== "way" || !Array.isArray(order.legs) || !(day >= order.since)) return false;
  const { field, place } = battle;
  const km = place.kmAt(troop.y);
  const legs = troop.legs > 0 ? troop.legs : 1;
  let left = (marchKm[troop.kind] * legs) / km;
  let went = false;
  while (left > 0 && order.leg < order.legs.length) {
    const leg = order.legs[order.leg];
    const dx = leg.ox - troop.x;
    const dy = leg.oy - troop.y;
    const gap = Math.sqrt(dx * dx + dy * dy);
    const step = gap < left ? gap : left;
    const x = troop.x + (gap > 0 ? (dx / gap) * step : 0);
    const y = troop.y + (gap > 0 ? (dy / gap) * step : 0);
    const cell = cellAt(field, x, y);
    if (cell < 0 || field.holders[cell] !== side || field.play[cell] !== 1) break;
    troop.x = x;
    troop.y = y;
    troop.movedKm = (troop.movedKm || 0) + step * km;
    if (gap > 0) {
      troop.hx = dx / gap;
      troop.hy = dy / gap;
    }
    went = went || step > 0;
    left -= step;
    if (step >= gap) order.leg += 1;
    else break;
  }
  if (order.leg >= order.legs.length) order.done = true;
  return went;
};

// What a battle's troops march each day, by kind: the run's advance at its pace, and OWN_GROUND_PACE over their own.
export const marchKmOf = (run) => run.advanceKm.map((km) => km * run.pace * OWN_GROUND_PACE);

// The march goals of a side's troops as kept (a goal cell + 1, 0 for none), and back.
export const readMarch = (value, count) => {
  const goals = [];
  for (let at = 0; at < count; at += 1) {
    const kept = Array.isArray(value) ? Number(value[at]) : 0;
    goals.push(Number.isInteger(kept) && kept > 0 ? kept - 1 : -1);
  }
  return goals;
};
export const marchKept = (troops) => troops.map((troop) => (troop.strength > 0 && troop.goal >= 0 ? troop.goal + 1 : 0));

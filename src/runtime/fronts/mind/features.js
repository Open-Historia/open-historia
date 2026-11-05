/*! Open Historia — battlefields and fronts: what a side's staff sees (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only (net.js). What the network is shown of a
// battlefield when it is asked what one side should do: a list of numbers,
// each between -1 and 1 or so, all read from the battle as the engine holds
// it. They are the side's own view: "own" is the side asked about.
//
// "It should factor in needing to defend its own territory": so it is shown
// how much of its own home ground the other side holds here, how that has
// moved since it last looked, and how its countries stand on their other
// fronts, beside what the scripted staff already weighs (how strong each side
// is, along the line and stretch by stretch).
//
// Only + - * / and comparisons, as everywhere in the engine.

import { POOL_PER_TROOP, STAFF_SECTOR_TROOPS_LEAST, TROOP_ATTACK } from "../constants.js";
import { inSector, resolveSector } from "../sectors.js";
import { staffDecision } from "../staff.js";
import { STATE_DUG_IN, isLive } from "../troops.js";

// What the network may have a side do (policy.js), in the order of its first four outputs.
export const MIND_ACTIONS = Object.freeze(["dig in", "hold", "probe", "advance"]);

export const FEATURE_NAMES = Object.freeze([
  "one",
  "odds", "odds on its best stretch", "odds on its worst stretch",
  "own troops", "their troops", "own strength", "their strength",
  "own reserves", "their reserves", "own supply", "their supply",
  "own cut off", "their cut off", "own dug in",
  "home ground lost", "their ground taken",
  "home ground lost since last look", "their ground taken since last look", "odds since last look",
  "began the war", "days fought", "home ground lost elsewhere", "share of its strength here",
  "staff: dig in", "staff: hold", "staff: probe", "staff: advance",
]);
export const FEATURE_COUNT = FEATURE_NAMES.length;
// What it remembers of its last look beside the network's own memory: home
// ground lost, ground taken, and the odds.
export const SEEN_COUNT = 3;

const within = (value, least, most) => (value < least ? least : value > most ? most : value);
// Odds of r to 1 as a share: 0.5 is even, 0.75 is three to one.
const share = (ratio) => ratio / (1 + ratio);

const weigh = (battle, side, inside = null) => {
  let worth = 0;
  let count = 0;
  let strength = 0;
  let supply = 0;
  let cut = 0;
  let dug = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || (inside && !inside(troop))) continue;
    const fed = troop.supply === undefined ? 1 : troop.supply;
    worth += troop.strength * TROOP_ATTACK[troop.kind] * fed * (troop.punch ?? 1);
    strength += troop.strength;
    supply += fed;
    count += 1;
    if (troop.pocket) cut += 1;
    if (troop.state === STATE_DUG_IN) dug += 1;
  }
  return { worth: worth * battle.quality[side] * battle.edge[side].power, count, strength, supply, cut, dug };
};

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Whose home each cell of a battle is: 0 or 1 for a side, -1 for nobody's.
// A country's home is the ground it is SOVEREIGN in, which a war does not
// change (the engine's own `homes` follow whoever holds a region, so ground
// lost long enough stops being "home" there; a staff that is to defend its
// country must go on knowing whose it was). Worked out once a battle and
// kept on it. Without a run to ask, the engine's own table.
export const homeTableOf = (battle, run = null) => {
  const holders = battle.field?.holders;
  if (!holders) return null;
  if (battle.mindHomes && battle.mindHomes.length === holders.length) return battle.mindHomes;
  const { arena } = battle;
  if (!run || typeof run.sovereignOf !== "function" || !arena?.region || !arena.ids) return battle.homes ?? null;
  const members = battle.sides.map((names) => new Set(names.map(fold)));
  const sideOfRegion = new Int8Array(arena.ids.length).fill(-1);
  for (let region = 1; region < arena.ids.length; region += 1) {
    const sovereign = fold(run.sovereignOf(arena.ids[region]));
    if (!sovereign) continue;
    if (members[0].has(sovereign)) sideOfRegion[region] = 0;
    else if (members[1].has(sovereign)) sideOfRegion[region] = 1;
  }
  const table = new Int8Array(holders.length);
  for (let cell = 0; cell < holders.length; cell += 1) table[cell] = sideOfRegion[arena.region[cell]];
  battle.mindHomes = table;
  return table;
};

// The share of a side's home the other holds, and the share of the other's it holds.
//   holders   who holds each cell (0, 1, or anything else for nobody)
//   homes     whose home each cell is (homeTableOf)
export const countGround = (holders, homes, side) => {
  if (!holders || !homes) return { lost: 0, taken: 0 };
  const other = 1 - side;
  let home = 0;
  let lost = 0;
  let theirs = 0;
  let taken = 0;
  for (let cell = 0; cell < holders.length; cell += 1) {
    if (homes[cell] === side) {
      home += 1;
      if (holders[cell] === other) lost += 1;
    } else if (homes[cell] === other) {
      theirs += 1;
      if (holders[cell] === side) taken += 1;
    }
  }
  return { lost: home > 0 ? lost / home : 0, taken: theirs > 0 ? taken / theirs : 0 };
};

export const groundOf = (battle, side, run = null) => countGround(battle.field?.holders, homeTableOf(battle, run), side);

// What a side is shown.
//   battle, side   the battle as it stands, and which side
//   context        { began, today, key }: as the scripted staff is given them
//   run            the run, for the side's other battlefields (may be null)
//   seen           what it remembered of its last look ([lost, taken, odds]), or null on its first
// Returns { x, best, staff, seen }: the numbers, the stretch of line where it
// is strongest against what faces it ("" for none), what the scripted staff
// would do (an index into MIND_ACTIONS) and what to remember for next time.
export const staffFeatures = (battle, side, context = {}, run = null, seen = null) => {
  const own = weigh(battle, side);
  const theirs = weigh(battle, 1 - side);
  const odds = theirs.worth > 0 ? share(own.worth / theirs.worth) : own.worth > 0 ? 1 : 0.5;

  // Stretch by stretch, as the scripted staff reads the line.
  let best = "";
  let bestOdds = -1;
  let worstOdds = 2;
  const today = context.today ?? null;
  for (const name of today?.sectors?.names ?? []) {
    const sector = resolveSector(battle.arena, today.line, today.sectors, name);
    if (!sector || sector.kind === "all") continue;
    const inside = (troop) => inSector(sector, troop.x, troop.y, battle.place.kmAt);
    const mine = weigh(battle, side, inside);
    if (mine.count < STAFF_SECTOR_TROOPS_LEAST) continue;
    const facing = weigh(battle, 1 - side, inside);
    const there = facing.worth > 0 ? share(mine.worth / facing.worth) : 1;
    if (there > bestOdds) {
      bestOdds = there;
      best = name;
    }
    if (there < worstOdds) worstOdds = there;
  }
  if (bestOdds < 0) bestOdds = odds;
  if (worstOdds > 1) worstOdds = odds;

  const ground = groundOf(battle, side, run);
  const before = Array.isArray(seen) && seen.length >= SEEN_COUNT ? seen : [ground.lost, ground.taken, odds];

  // Its countries on their other fronts: the worst any of them is losing of
  // its home ground there, and how much of what they have is here.
  let elsewhereLost = 0;
  let here = 1;
  if (run && Array.isArray(run.battles)) {
    let other = 0;
    const members = new Set(battle.sides[side].filter((member, at) => !battle.gone[side].has(at)).map(fold));
    for (const front of run.battles) {
      if (front === battle || front.status === "closed") continue;
      const at = [0, 1].find((index) => front.sides[index].some((member, slot) => !front.gone[index].has(slot) && members.has(fold(member))));
      if (at === undefined) continue;
      other += Number(front.lineKm) || 0;
      const lost = groundOf(front, at, run).lost;
      if (lost > elsewhereLost) elsewhereLost = lost;
    }
    const line = Number(battle.lineKm) || 0;
    here = line + other > 0 ? line / (line + other) : 1;
  }

  const scripted = staffDecision(battle, side, context);
  const staff = !scripted ? 1 : scripted.order === "dig in" ? 0 : scripted.order === "hold" ? 1 : scripted.sector === "all" ? 3 : 2;

  const mean = (sum, count, none) => (count > 0 ? sum / count : none);
  const reserve = (index, count) => (count > 0 ? within((Number(battle.pool[index]) || 0) / (count * POOL_PER_TROOP), 0, 2) / 2 : 0);
  const x = new Float64Array(FEATURE_COUNT);
  x[0] = 1;
  x[1] = odds;
  x[2] = bestOdds;
  x[3] = worstOdds;
  x[4] = within(own.count / 40, 0, 1);
  x[5] = within(theirs.count / 40, 0, 1);
  x[6] = mean(own.strength, own.count, 0) / 100;
  x[7] = mean(theirs.strength, theirs.count, 0) / 100;
  x[8] = reserve(side, own.count);
  x[9] = reserve(1 - side, theirs.count);
  x[10] = mean(own.supply, own.count, 1);
  x[11] = mean(theirs.supply, theirs.count, 1);
  x[12] = mean(own.cut, own.count, 0);
  x[13] = mean(theirs.cut, theirs.count, 0);
  x[14] = mean(own.dug, own.count, 0);
  x[15] = ground.lost;
  x[16] = ground.taken;
  x[17] = within((ground.lost - before[0]) * 5, -1, 1);
  x[18] = within((ground.taken - before[1]) * 5, -1, 1);
  x[19] = within((odds - before[2]) * 5, -1, 1);
  x[20] = context.began ? 1 : 0;
  x[21] = within((Number(battle.daysRun) || 0) / 180, 0, 1);
  x[22] = elsewhereLost;
  x[23] = here;
  x[24 + staff] = 1;
  return { x, best, staff, seen: [ground.lost, ground.taken, odds] };
};

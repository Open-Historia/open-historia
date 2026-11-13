/*! Open Historia — battlefields and fronts: a battlefield while a run works on it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A saved battlefield is short strings (record.js). To be fought over it is
// opened out into what the engine works on: the field as numbers, the troops
// as objects, the ground and who is on which side of it. That is a `battle`.
// Here one is made (from a saved record, or new where two sides at war touch),
// kept in step with what the rest of the world did to the map, and written
// back as a record when the run ends.
//
// Whatever others did to the map wins over the field, by one rule: a region
// the world gives to a side that holds less than four tenths of it is
// repainted for that side, and one whose controller is no longer in the war
// becomes wall. The engine never writes who controls a region itself: it
// reports each change of hands and the game applies it the ordinary way.
//
// A region has two holders. Who holds it IN NAME is what the world says: its
// controller, or the group in whose area it lies. Who it is SHOWN as belonging
// to is what the map draws, and that changes only when the whole of the region
// is held: a region taken in name is drawn as its old holder's, with the
// taker's ground painted over it, until the last of it has changed hands.

import { addGameDays, diffGameDays } from "../gameDates.js";
import { decodeLevels, decodeTroops, encodeLevels, encodeLines, encodeMask, encodeTroops } from "./codec.js";
import { readChronicle, chronicleAfter } from "./chronicle.js";
import { skiesAhead } from "./weather.js";
import {
  BATTLEFIELD_VERSION,
  CONTROL_RADIUS_MAX_KM,
  DEFAULT_EFFORT,
  FAR_CELLS,
  HAND_STALL_DAYS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_COMMANDS,
  THAW_LOSS,
  THAW_REACH_CELLS,
  MAX_CONTESTED_REGIONS,
  MAX_LOG_ENTRIES,
  MAX_NAMED_TROOPS,
  MAX_TROOPS_PER_SIDE,
  NAMED_WITHIN_KM,
  POOL_PER_TROOP,
  LINE_MARKS,
  REDISTANCE_REACH_CELLS,
  REPAINT_BELOW,
  TROOP_UNITS,
} from "./constants.js";
import { nearestHeld, nearestOnContour, openField, ownCell, packField, redistance, setGround, takeCells, traceContour, unpackField } from "./field.js";
import { awayOf, cellAt, downhill, measure } from "./ground.js";
import { placeBehind } from "./move.js";
import { readGenerals, readTalk } from "./command.js";
import { FAIR_EDGE, handicapOf, shortEdge, sideShortage } from "./handicap.js";
import { standingOf } from "./orders.js";
import { leftOnLeg } from "./way.js";
import { draw, formationsLeft, menOf, partLeft, sideFormationsLeft } from "./manpower.js";
import { landWorth, mixOf } from "./military.js";
import { headStartOf, levyOwed, levyPending, musterShare, mustersFor, readLevy, spreadPick } from "./muster.js";
import { hasDeploy, readDeploy } from "./deploy.js";
import { marchKept, marchesFor, readMarch, sendInland } from "./march.js";
import { authoredForms, authoredTroops } from "./scenarioFronts.js";
import { SWARM_FORM, raiseSwarms, readSwarms, swarmsKept } from "./swarms.js";
import { projectorOf } from "./frame.js";
import { drawLine, measureLine } from "./line.js";
import { nearestOwner } from "./supply.js";
import { KIND_ARMOUR, KIND_ARTILLERY, KIND_INFANTRY, createTroop, drawTraits, dropTheDead, isAttack, isLive, kindsFor, liveCount, planLanes, shareOut, sideRadiusKm, sizeSides, standAtPlaces, standOff, stands, troopsLeast } from "./troops.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const round3 = (value) => Math.round(value * 1000) / 1000;

// Which side a name fights on in a battle: 0, 1, or -1.
export const sideOfName = (battle, name) => {
  const wanted = fold(name);
  if (!wanted) return -1;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (battle.sides[side].some((member, index) => fold(member) === wanted && !battle.gone[side].has(index))) return side;
  }
  return -1;
};

// The side a group's area fights on: the group's own where it is in the war,
// else that of the country whose force it is (runtime/groups.js `owner`), else
// -1. A country's force holding ground on a third country's land is its side's
// ground in the wars that country fights (day.js settleRegions).
export const groupSideOf = (battle, run, group) => {
  const own = sideOfName(battle, group);
  if (own >= 0 || !group) return own;
  const owner = run.groupOwnerOf?.(group);
  return owner ? sideOfName(battle, owner) : -1;
};

// Who holds a region in name: the group in whose area it lies if that group
// is in the war, or the country whose force that group is if that country is
// (groupSideOf), else its controller.
export const holderOf = (battle, run, id) => {
  const group = run.groupOf(id);
  if (group && sideOfName(battle, group) >= 0) return group;
  const owner = group ? run.groupOwnerOf?.(group) : "";
  return owner && sideOfName(battle, owner) >= 0 ? owner : run.controllerOf(id);
};

// The side each region of the arena fights on, from who holds it in name. And
// whose home ground it is for supply: the same for a group's area, else the
// side of its lawful sovereign. And who the map draws it as belonging to: a
// region new to the battle is shown as whoever holds it in name, and so is
// one outside the war, where the engine has no say. So is every region of a
// battlefield standing in peace: nothing is fought there, so nothing would
// ever take a region in full, and one the story handed over (an annexation)
// would be drawn as its old holder's, colour and name, for good.
export const readRegions = (battle, run) => {
  const { arena } = battle;
  const count = arena.ids.length;
  const regionSide = new Int8Array(count).fill(-1);
  const homeSide = new Int8Array(count).fill(-1);
  const atPeace = battle.status === "standing";
  for (let index = 1; index < count; index += 1) {
    const id = arena.ids[index];
    const group = groupSideOf(battle, run, run.groupOf(id));
    regionSide[index] = group >= 0 ? group : sideOfName(battle, run.controllerOf(id));
    homeSide[index] = group >= 0 ? group : sideOfName(battle, run.sovereignOf(id));
    if (!battle.shown.has(id) || regionSide[index] < 0 || atPeace) battle.shown.set(id, holderOf(battle, run, id));
  }
  battle.regionSide = regionSide;
  battle.homeSide = homeSide;
  // For the map: the side whose home ground each cell is (2 for neither), which
  // is the side of the name its region is shown under. The map lays a side's
  // paint over the region's own colour wherever the side holding a cell is
  // not its home side.
  const homeOfRegion = new Uint8Array(count).fill(2);
  for (let index = 1; index < count; index += 1) {
    const side = sideOfName(battle, battle.shown.get(arena.ids[index]));
    if (side >= 0) homeOfRegion[index] = side;
  }
  battle.homes = Uint8Array.from(arena.region, (region) => homeOfRegion[region]);
  battle.iceSide = iceSides(arena, regionSide);
};

// Whose each cell of frozen water is: the side whose ground is nearest it, by a
// search out from both sides' ground over the ice, in the order of the cells
// (the same on every machine). null where nothing is frozen.
export const iceSides = (arena, regionSide) => {
  if (!arena.iced) return null;
  const { cols, rows } = arena;
  const side = new Int8Array(arena.size).fill(-1);
  const queue = [];
  for (let cell = 0; cell < arena.size; cell += 1) {
    if (arena.iced[cell] === 1 || !(arena.speed[cell] > 0)) continue;
    const own = regionSide[arena.region[cell]];
    if (own !== 0 && own !== 1) continue;
    side[cell] = own;
    queue.push(cell);
  }
  for (let at = 0; at < queue.length; at += 1) {
    const cell = queue[at];
    const col = cell % cols;
    const row = (cell - col) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = col + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const next = y * cols + x;
      if (arena.iced[next] !== 1 || side[next] >= 0) continue;
      side[next] = side[cell];
      queue.push(next);
    }
  }
  return side;
};

// One region changed hands during a run: its side is read again, and whose
// home it is. Nothing else about the ground can have changed, so nothing else
// is read: a war in which hundreds of regions change hands would otherwise
// read every region of the arena for each of them.
export const readRegion = (battle, run, id) => {
  const index = battle.arena.indexOf.get(id);
  if (index === undefined || !battle.regionSide) return;
  const group = groupSideOf(battle, run, run.groupOf(id));
  battle.regionSide[index] = group >= 0 ? group : sideOfName(battle, run.controllerOf(id));
  const home =group >= 0 ? group : sideOfName(battle, run.sovereignOf(id));
  if (home === battle.homeSide[index]) return;
  // A list of its own, so that what was worked out from the old one is worked out again.
  battle.homeSide = Int8Array.from(battle.homeSide);
  battle.homeSide[index] = home;
};

// The place of a name among a side's members, or -1.
export const memberIndex = (battle, side, name) => {
  const wanted = fold(name);
  return wanted ? battle.sides[side].findIndex((member) => fold(member) === wanted) : -1;
};

// The same for a holder that may be a country's force (groupSideOf): the member it is the force of.
export const memberFor = (battle, run, side, name) => {
  const own = memberIndex(battle, side, name);
  if (own >= 0 || !name) return own;
  const owner = run.groupOwnerOf?.(name);
  return owner ? memberIndex(battle, side, owner) : -1;
};

// Whose colour each cell a side holds is painted in, worked out afresh: at
// home, whoever its region is shown as belonging to; elsewhere whoever the
// world says holds the region, if that is a member of the side holding the
// cell, else the member whose troops are nearest. Only the map reads it, and
// it is never saved: a run begins by working it out again.
export const paintGround = (battle, run) => {
  const { field, arena } = battle;
  const near = [nearestOwner(battle, HOLDER_SIDE_A), nearestOwner(battle, HOLDER_SIDE_B)];
  const shownAs = [new Int16Array(arena.ids.length).fill(-1), new Int16Array(arena.ids.length).fill(-1)];
  const holder = [new Int16Array(arena.ids.length).fill(-1), new Int16Array(arena.ids.length).fill(-1)];
  for (let region = 1; region < arena.ids.length; region += 1) {
    const id = arena.ids[region];
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      shownAs[side][region] = memberIndex(battle, side, battle.shown.get(id));
      const group = memberFor(battle, run, side, run.groupOf(id));
      holder[side][region] = group >= 0 ? group : memberIndex(battle, side, run.controllerOf(id));
    }
  }
  for (let index = 0; index < field.size; index += 1) {
    const side = field.holders[index];
    if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) continue;
    const region = arena.region[index];
    const known = battle.homes[index] === side ? Math.max(0, shownAs[side][region]) : holder[side][region];
    field.painter[index] = known >= 0 ? known : near[side](index);
  }
};

// What the difficulty gives each side of a battle, by who is fighting on it
// now and who is played by a person: read when the battle is made, and again
// whenever a country comes into it or leaves.
export const setHandicap = (battle, run) => {
  const sides = battle.sides.map((members, side) => members.filter((member, at) => !battle.gone[side].has(at)));
  const edges = handicapOf({ difficulty: run.input?.difficulty, sides, players: run.input?.players }).edges;
  // And what a side is short of because its countries are cut off from the
  // sea (handicap.js shortEdge): the same four figures, weighed down.
  // (Kept, for what the weather takes from a side short of what it needs: weather.js weatherLoss.)
  battle.short = [0, 1].map((side) => sideShortage(sides[side], run.shortageOf, run.strengthOf));
  battle.edge = edges.map((edge, side) => shortEdge(edge, battle.short[side]));
  // Weighing countries' own military figures (military.js), what each member's
  // troops fight with on land, against what every country had before: by its
  // place in its side's list, as a troop's owner is. Not kept: read again with the edge.
  battle.worth = run.mech?.military ? battle.sides.map((members) => members.map((member) => landWorth(run.militaryOf(member)))) : null;
};

const createBattle = (run, { name, warId, sides, frame, arena, openedDate, openedDay }) => ({
  name,
  warId,
  status: "active",
  sides: [sides[0].slice(), sides[1].slice()],
  gone: [new Set(), new Set()],
  openedDate,
  openedDay,
  frame,
  arena,
  place: projectorOf(frame),
  field: null,
  regionSide: null,
  homeSide: null,
  // Who the map draws each region as belonging to, by the region's id, and
  // what the recorder was told of it since the last day was recorded.
  shown: new Map(),
  said: [],
  troops: [[], []],
  named: [],
  pool: [0, 0],
  // What its reserves have sent each member's troops to make good their losses, in points of strength, this run (manpower.js).
  mendedBy: [[], []],
  base: [0, 0],
  quality: [1, 1],
  // What the game's difficulty gives each side here (handicap.js): not kept
  // with the record, read again by every run (setHandicap).
  edge: [FAIR_EDGE, FAIR_EDGE],
  effort: [DEFAULT_EFFORT, DEFAULT_EFFORT],
  orders: [],
  ordersChanged: 0,
  halts: [],
  // What each side's members are still owed of their levies (muster.js): [{ o, t, r, f }] a side.
  levy: [[], []],
  haltsToday: [],
  views: [[], []],
  plans: null,
  // Where each side's countries' new troops come in, where one drew a line for them (deploy.js).
  deploy: null,
  planKey: "",
  pockets: [],
  pocketOf: null,
  pocketTurns: -1,
  // The ground to be closed on (closing.js), and the distances over the ground (ground.js).
  close: null,
  toSide: null,
  fed: null,
  bodyOf: null,
  // Whose home each cell is as the map is told it: as the run began, until its last day.
  drawnHomes: null,
  // Whether the record said which troops serve which standing order.
  served: false,
  // What its generals are called, a list a side in the order of their commands (command.js).
  generals: [[], []],
  // Which of its generals' commands are swarms (swarms.js), a set a side.
  swarms: [new Set(), new Set()],
  // What was said in each side's war room: kept with the battlefield, and nothing here reads it.
  talk: [[], []],
  // A side whose troops have all withdrawn from here, and the formations of
  // the world that left it so (unit id -> side): they are not taken in again
  // until their side comes back (engine.js withdrawWhoLeft).
  away: [false, false],
  sentHome: new Map(),
  // A border fortified in peace: the days nothing has been ordered there, and
  // which of its sides have been told to leave it.
  quiet: 0,
  leaving: [false, false],
  // Whether its first side fights on the second side of its war.
  swap: false,
  // The sieges that stand, and the ground each side's steps leave alone (orders.js).
  sieges: [],
  spared: [[], []],
  siegeKey: "",
  // And the cells of the places each side is besieging, which it leaves alone (supply.js).
  kept: [null, null],
  supplied: [null, null],
  supply: null,
  supplyTurns: -1,
  anchors: [],
  log: [],
  // How much of the log was there when the run began: what comes after is the
  // run's own news (engine.js snapshot). And the days of fighting it has had.
  logFrom: 0,
  daysRun: 0,
  claims: { stamp: new Int32Array(arena.size), power: new Float32Array(arena.size), moment: 0 },
  // The field as the run found it: what a repulsed attack is put back to, and
  // what the brief measures the run's gains from.
  startPhi: null,
  startHolders: null,
  lastFlip: new Int32Array(arena.ids.length).fill(-1000000),
  settledTurns: -1,
  taken: [[], []],
  citiesTaken: [[], []],
  cityHolder: null,
  recorder: null,
  drawn: null,
  drawnFlags: null,
  drawnContour: null,
  closing: "",
  closedDate: "",
  lineKm: 0,
  fresh: true,
  autoNamed: false,
  seed: run.seed,
  even: run.steer.even === true,
  radiusKm: [CONTROL_RADIUS_MAX_KM, CONTROL_RADIUS_MAX_KM],
  watch: typeof run.input?.watch === "function" ? run.input.watch : null,
  homes: null,
});

export const keepStart = (battle) => {
  battle.startPhi = Float64Array.from(battle.field.phi);
  battle.startHolders = Uint8Array.from(battle.field.holders);
  battle.cityHolder = Int8Array.from(battle.arena.cities, (city) => battle.field.holders[city.cell]);
};

// The length of a battle's line as it stands, in kilometres.
export const lineLength = (battle) => {
  battle.lineKm = measureLine(battle.field, traceContour(battle.field)).total;
  return battle.lineKm;
};

// Each side's control radius for the run, from how close its troops stand
// along the line as the run finds them. Worked out once: a side that loses
// troops does not paint a wider strip for it.
export const setRadii = (battle) => {
  lineLength(battle);
  // (Counting the levies still to come, muster.js: the first few to arrive do not each hold a vast stretch.)
  battle.radiusKm = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => sideRadiusKm(battle.lineKm, liveCount(battle.troops[side]) + levyPending(battle.levy, side)));
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) for (const troop of battle.troops[side]) troop.radiusKm = battle.radiusKm[side];
};

// ---- what the world did --------------------------------------------------------

// Brings a battle's field into step with who controls what now. true when the
// field changed.
export const reconcile = (battle, run) => {
  readRegions(battle, run);
  const { field, arena, regionSide } = battle;
  let changed = setGround(field, regionSide, battle.iceSide);
  const held = new Int32Array(arena.ids.length);
  for (let index = 0; index < field.size; index += 1) {
    if (field.play[index] && field.holders[index] === regionSide[arena.region[index]]) held[arena.region[index]] += 1;
  }
  const repaint = new Uint8Array(arena.ids.length);
  let any = false;
  for (let region = 1; region < arena.ids.length; region += 1) {
    if (regionSide[region] < 0 || arena.regionSpeed[region] <= 0) continue;
    const whole = arena.cells[region] + arena.outside[region];
    if ((held[region] + arena.outside[region]) / whole >= REPAINT_BELOW) continue;
    repaint[region] = 1;
    any = true;
  }
  if (any) {
    const cells = [[], []];
    for (let index = 0; index < field.size; index += 1) {
      if (field.play[index] && repaint[arena.region[index]]) cells[regionSide[arena.region[index]]].push(index);
    }
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (cells[side].length === 0) continue;
      // Painted for whoever the world gave the region to, if that is one of the side's own.
      const near = nearestOwner(battle, side);
      takeCells(field, side, cells[side], (index) => {
        const id = arena.ids[arena.region[index]];
        const group = run.groupOf(id);
        const named = group ? memberFor(battle, run, side, group) : memberIndex(battle, side, run.controllerOf(id));
        return named >= 0 ? named : near(index);
      });
    }
    changed = true;
  }
  if (changed) redistance(field);
  return changed;
};

// ---- raising -------------------------------------------------------------------

// A side's strength on a battle: what each of its members brings to it, a
// member on several battlefields splitting itself among them by the length of
// their lines.
export const memberWeights = (battle, run, side) => battle.sides[side].map((member, index) => {
  if (battle.gone[side].has(index)) return 0;
  let elsewhere = 0;
  for (const other of run.battles) {
    if (other !== battle && other.status !== "closed" && sideOfName(other, member) >= 0) elsewhere += other.lineKm;
  }
  const share = battle.lineKm + elsewhere > 0 ? battle.lineKm / (battle.lineKm + elsewhere) : 1;
  return Math.max(0, Number(run.strengthOf(member)) || 0) * share;
});

// A troop that has just been raised is stood where it would stay: not nearer
// the other side's ground than it would bear, nor further back than it would
// leave be. So a front nobody pushes is at rest from its first day.
const settleRaised = (battle, side, raised) => {
  const { field, place } = battle;
  const toOther = measure(battle)[1 - side];
  const toward = [0, 0];
  for (const troop of raised) {
    const depth = standOff(troop, place.kmAt);
    for (let round = 0; round < 6; round += 1) {
      const onOwn = stands(field, side, troop.x, troop.y);
      const away = onOwn ? awayOf(battle, side, troop.x, troop.y) : 0;
      if (!onOwn || away < depth * 0.6) {
        const behind = placeBehind(battle, side, troop, depth);
        if (!behind || (behind[0] === troop.x && behind[1] === troop.y)) break;
        [troop.x, troop.y] = behind;
      } else if (away > depth * 3 && downhill(field, toOther, troop.x, troop.y, toward)) {
        const step = away - depth * 2;
        if (!stands(field, side, troop.x + toward[0] * step, troop.y + toward[1] * step)) break;
        troop.x += toward[0] * step;
        troop.y += toward[1] * step;
      } else break;
    }
  }
};

// A side's counters shared among its members by their weights (shareOut),
// each held to what it can raise itself (`caps`): what one cannot take goes to
// the next that can, in the order of the side's list.
const capQuota = (quota, caps) => {
  const kept = quota.map((count, at) => Math.min(count, caps[at]));
  let spare = quota.reduce((sum, count) => sum + count, 0) - kept.reduce((sum, count) => sum + count, 0);
  for (let at = 0; spare > 0 && at < kept.length; at += 1) {
    const room = caps[at] - kept[at];
    if (room > 0) {
      const take = Math.min(room, spare);
      kept[at] += take;
      spare -= take;
    }
  }
  return kept;
};

// Raises both sides' troops on a battle that has just opened, and stands them
// along the line: nobody has ordered anything yet, so the weight is even, and
// what makes the line uneven is the troops themselves.
export const raiseTroops = (battle, run, only = -1) => {
  const line = measureLine(battle.field, traceContour(battle.field));
  battle.lineKm = line.total;
  const members = [memberWeights(battle, run, 0), memberWeights(battle, run, 1)];
  const strengths = members.map((list) => list.reduce((sum, weight) => sum + weight, 0));
  const { counts, quality } = sizeSides(line.total, strengths, battle.effort, run.troops);
  // A scenario may say how many each side of a front begins with
  // (scenarioFronts.js): only while a new game's fronts are being built.
  const said = authoredTroops(run.input?.authored, battle.sides);
  // And how they stand there: along the line, or in swarms (swarms.js). Where it does not say, as the run's wars are fought.
  const forms = authoredForms(run.input?.authored, battle.sides);
  if (said) for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) if (said[side] > 0) counts[side] = said[side];
  // (Troops that are there already, come from a country's forces at home, are part of them: home.js.)
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) counts[side] = Math.max(0, counts[side] - liveCount(battle.troops[side]));
  battle.quality = quality.map((value, side) => (only >= 0 && side !== only ? battle.quality[side] : round3(value)));
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // (On a border fortified in peace only the side that deploys there raises troops.)
    if (only >= 0 && side !== only) continue;
    // (No more than its members have the men for: manpower.js. Weighing countries' own military figures,
    // each member only what it has itself, its last men as a counter at part strength, and a member with
    // no army nothing: military.js.)
    const military = run.mech?.military === true;
    const wholes = military ? battle.sides[side].map((member, at) => (battle.gone[side].has(at) || landWorth(run.militaryOf(member)) === 0 ? 0 : formationsLeft(run, member))) : null;
    const parts = military ? battle.sides[side].map((member, at) => (battle.gone[side].has(at) || landWorth(run.militaryOf(member)) === 0 ? 0 : partLeft(run, member))) : null;
    const caps = military ? wholes.map((whole, at) => whole + (parts[at] > 0 ? 1 : 0)) : null;
    const room = Math.max(0, Math.min(counts[side], MAX_TROOPS_PER_SIDE - battle.troops[side].length, military ? caps.reduce((sum, cap) => sum + cap, 0) : sideFormationsLeft(run, battle, side)));
    battle.base[side] = round3(members[side].reduce((sum, weight) => sum + weight, 0));
    battle.pool[side] += room * POOL_PER_TROOP * battle.edge[side].reserves;
    const first = battle.troops[side].length;
    for (const kind of kindsFor(room, run.era)) battle.troops[side].push(createTroop({ kind }));
    const raised = battle.troops[side].slice(first);
    if (raised.length === 0) continue;
    // New troops begin on their own ground along the line, in the order they
    // are listed, so that each body of ground has its share of them; then each
    // is stood at the place an evenly held line gives its rank, shifted and
    // set back by what it drew: there is nowhere for it to have come from.
    const own = side === HOLDER_SIDE_A ? line.contour.cellA : line.contour.cellB;
    const fallback = battle.field.holders.indexOf(side);
    raised.forEach((troop, index) => {
      let vertex = Math.min(line.count - 1, Math.floor(((index + 0.5) * line.count) / raised.length));
      while (vertex > 0 && own[vertex] < 0) vertex -= 1;
      const home = own[vertex] >= 0 ? own[vertex] : fallback;
      troop.x = (home % battle.field.cols) + 0.5;
      troop.y = Math.floor(home / battle.field.cols) + 0.5;
      drawTraits(troop, run.seed, battle.name, side, first + index, battle.even);
    });
    planLanes(battle, side, line);
    standAtPlaces(battle, side);
    settleRaised(battle, side, raised);
    // Each member's share of the counters, the ally whose ground a counter
    // stands on taking it where it still has some to take.
    const shared = shareOut(raised.length, members[side].some((weight) => weight > 0) ? members[side] : members[side].map((weight, index) => (battle.gone[side].has(index) ? 0 : 1)));
    const quota = military ? capQuota(shared, caps) : shared;
    const waiting = [];
    for (const troop of raised) {
      const cell = Math.max(0, ownCell(battle.field, side, troop.x, troop.y));
      const local = battle.sides[side].findIndex((member) => fold(member) === fold(run.controllerOf(battle.arena.ids[battle.arena.region[cell]])));
      if (local >= 0 && quota[local] > 0) {
        troop.owner = local;
        quota[local] -= 1;
      } else waiting.push(troop);
    }
    let owner = 0;
    for (const troop of waiting) {
      while (owner < quota.length - 1 && quota[owner] <= 0) owner += 1;
      troop.owner = owner;
      quota[owner] -= 1;
    }
    // Weighing countries' own military figures, each member's counters are of its
    // own unit mix, and the last of a member that had only part of one more is at that part.
    if (military) {
      battle.sides[side].forEach((member, owner) => {
        const mine = raised.filter((troop) => troop.owner === owner);
        if (mine.length === 0) return;
        const kinds = kindsFor(mine.length, run.era, mixOf(run.militaryOf(member)));
        mine.forEach((troop, index) => { troop.kind = kinds[index]; });
        if (mine.length > wholes[owner] && parts[owner] > 0) mine[mine.length - 1].strength = Math.round(100 * parts[owner]);
      });
    }
    // Weighing a war's mustering (muster.js): of each member's counters only those its curve has brought
    // in by now stand on the line; the rest are owed, and come in day by day (engine.js musterDay).
    let present = raised;
    const war = run.wars.get(battle.warId);
    // (A border built up in peace musters too, from the day it was ordered: march.js.)
    const building = battle.status === "standing" && run.mech?.muster === true && marchesFor(run, battle);
    if (mustersFor(run, war) || building) {
      const today = run.dateOf(run.day);
      // (The side that began the war is the war's first: it called up its levies before it declared.)
      const starter = !building && (battle.swap ? 1 - side : side) === HOLDER_SIDE_A;
      const keep = new Set();
      const owed = [];
      battle.sides[side].forEach((member, owner) => {
        const mine = raised.filter((troop) => troop.owner === owner);
        if (mine.length === 0) return;
        const head = headStartOf(run, member, starter);
        const began = building ? today : war.began;
        const since = head > 0 ? addGameDays(began, -head) || began : began;
        const days = diffGameDays(since, today);
        const share = days === null ? 1 : musterShare(run, member, days);
        const now = Math.min(mine.length, Math.floor(mine.length * share));
        for (const at of spreadPick(mine.length, now)) keep.add(mine[at]);
        owed.push({ o: owner, t: mine.length, r: now, f: since, mine });
      });
      // (A side stands with no fewer than the least it may, troops.js troopsLeast: the largest levy gives them.)
      const least = Math.min(raised.length, troopsLeast(run.troops));
      for (const entry of owed.slice().sort((a, b) => b.t - a.t || a.o - b.o)) {
        for (const troop of entry.mine) {
          if (keep.size >= least) break;
          if (keep.has(troop)) continue;
          keep.add(troop);
          entry.r += 1;
        }
      }
      present = raised.filter((troop) => keep.has(troop));
      if (present.length < raised.length) {
        battle.troops[side] = [...battle.troops[side].slice(0, first), ...present];
        battle.pool[side] -= (raised.length - present.length) * POOL_PER_TROOP * battle.edge[side].reserves;
        for (const entry of owed) if (entry.r < entry.t) battle.levy[side].push({ o: entry.o, t: entry.t, r: entry.r, f: entry.f });
      }
    }
    // Where the side fights in swarms they gather behind the line, each swarm under a general of its own (swarms.js).
    if ((forms?.[side] || run.warfare) === SWARM_FORM) raiseSwarms(battle, side, present);
    // And they are called up inside their country, and march there (march.js).
    if (marchesFor(run, battle, war)) sendInland(battle, run, side, present);
    // Each is drawn from the people of the country it is.
    for (const troop of present) draw(run, battle.sides[side][troop.owner], military ? (troop.strength / 100) * menOf(run, battle.sides[side][troop.owner]) : run.menEach);
  }
  battle.planKey = "";
};

// ---- named formations ----------------------------------------------------------

const KIND_OF_TYPE = { infantry: KIND_INFANTRY, armor: KIND_ARMOUR, artillery: KIND_ARTILLERY };
export const isLandFormation = (unit) => KIND_OF_TYPE[String(unit?.type ?? "")] !== undefined;

// Takes a formation of the world's into a battle as a named troop, at its own
// place and strength. false when it does not belong here: not a land
// formation, not a member's, off the frame, too far from the line, or no room.
export const absorbUnit = (battle, run, unit, { anyDistance = false } = {}) => {
  const kind = KIND_OF_TYPE[String(unit?.type ?? "")];
  const unitId = String(unit?.id ?? "").trim();
  const side = sideOfName(battle, unit?.ownerCode ?? unit?.owner);
  if (kind === undefined || !unitId || side < 0) return false;
  // (Weighing countries' own military figures, one with no army fields none: military.js.)
  if (run.mech?.military && landWorth(run.militaryOf(unit?.ownerCode ?? unit?.owner)) === 0) return false;
  if (battle.named.some((entry) => entry.unitId === unitId)) return false;
  if (battle.troops[side].length >= MAX_TROOPS_PER_SIDE || battle.named.length >= MAX_NAMED_TROOPS) return false;
  const lng = Number(unit.lng);
  const lat = Number(unit.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const [x, y] = battle.place.toCell(lng, lat);
  if (!(x >= 0) || !(y >= 0) || x >= battle.field.cols || y >= battle.field.rows) return false;
  if (!anyDistance) {
    const contour = traceContour(battle.field);
    const reach = NAMED_WITHIN_KM / battle.place.kmAt(y);
    const near = reach <= REDISTANCE_REACH_CELLS ? nearestOnContour(battle.field, contour, x, y, reach) : nearestVertexDistance(contour, x, y);
    if (!(near <= reach)) return false;
  }
  const owner = battle.sides[side].findIndex((member) => fold(member) === fold(unit.ownerCode ?? unit.owner));
  const strength = Math.min(100, Math.max(1, Number(unit.strength) || 100));
  battle.troops[side].push(createTroop({ x, y, strength, kind, owner, named: true }));
  battle.named.push({ s: side, i: battle.troops[side].length - 1, name: String(unit.name ?? "").trim(), unitId });
  // The battle itself, not its name: a battlefield may still be named by its first order.
  run.unitChanges.push({ unitId, committedTo: battle });
  battle.planKey = "";
  return true;
};

const nearestVertexDistance = (contour, x, y) => {
  let best = Infinity;
  for (let vertex = 0; vertex < contour.x.length; vertex += 1) {
    const dx = contour.x[vertex] - x;
    const dy = contour.y[vertex] - y;
    if (dx * dx + dy * dy < best) best = dx * dx + dy * dy;
  }
  return Math.sqrt(best);
};

// A battle is over: its named formations go back to the world where they
// stand, and the ones that fell are struck off.
export const releaseNamed = (battle, run) => {
  for (const entry of battle.named) {
    const troop = battle.troops[entry.s][entry.i];
    if (!troop || entry.reported) continue;
    entry.reported = true;
    if (!isLive(troop)) {
      run.unitChanges.push({ unitId: entry.unitId, committedTo: "", remove: true });
      continue;
    }
    const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
    run.unitChanges.push({ unitId: entry.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
  }
};

// A named formation that fell during the run is struck off the world's list
// when the run is saved; its counter stays in the record until the next run.
const reportTheFallen = (battle, changes) => {
  for (const entry of battle.named) {
    const troop = battle.troops[entry.s][entry.i];
    if (troop && !isLive(troop) && !entry.reported) changes.push({ unitId: entry.unitId, committedTo: "", remove: true });
  }
};

// ---- from a record, and back ---------------------------------------------------

// A saved battlefield opened out to be worked on. `arena` is its frame's.
export const loadBattle = (run, record, arena) => {
  const battle = createBattle(run, {
    name: record.name,
    warId: record.warId,
    sides: record.sides,
    frame: record.frame,
    arena,
    openedDate: record.openedDate,
    openedDay: 0,
  });
  battle.status = record.status;
  battle.fresh = false;
  // A country's forces at home (home.js).
  battle.home = record.home === true;
  setHandicap(battle, run);
  // Who the map draws each region as: the names the last run left for the
  // regions it listed. A region it did not list is shown as its holder in name.
  const carry = record.brief?.carry ?? {};
  for (const entry of Array.isArray(record.contested) ? record.contested : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string" && entry[0] && entry[1]) battle.shown.set(entry[0], entry[1]);
  }
  readRegions(battle, run);
  battle.field = unpackField(arena, record.field, battle.regionSide, battle.iceSide);
  const read = [decodeTroops(record.troops[0]).map(createTroop), decodeTroops(record.troops[1]).map(createTroop)];
  // Which standing order each troop was serving when the last run ended.
  battle.served = Array.isArray(carry.under) && carry.under.length === 2;
  if (battle.served) {
    read.forEach((list, side) => list.forEach((troop, index) => {
      const serves = Array.isArray(carry.under[side]) ? carry.under[side][index] : -1;
      troop.serves = Number.isInteger(serves) ? serves : -1;
    }));
  }
  // And, of those on a route drawn for them, which of its points each was making for.
  read.forEach((list, side) => list.forEach((troop, index) => {
    const next = Array.isArray(carry.next) && Array.isArray(carry.next[side]) ? carry.next[side][index] : -1;
    troop.next = Number.isInteger(next) && next >= 0 ? next : -1;
  }));
  // Which general each troop is under, and what the generals are called.
  read.forEach((list, side) => list.forEach((troop, index) => {
    const command = Array.isArray(carry.command) && Array.isArray(carry.command[side]) ? carry.command[side][index] : -1;
    troop.command = Number.isInteger(command) && command >= 0 && command < MAX_COMMANDS ? command : -1;
  }));
  // How worn out each troop was (fatigue.js), where the last run kept it: fresh where it did not.
  if (Array.isArray(carry.tired)) {
    read.forEach((list, side) => {
      const levels = decodeLevels(carry.tired[side]);
      list.forEach((troop, index) => { troop.fatigue = levels[index] ?? 0; });
    });
  }
  // The day a country's forces at home were last called up (home.js): once a day at most.
  battle.calledOn = typeof carry.called === "string" ? carry.called : "";
  // When each side's own staff last called up troops (engine.js staffCallUp): it waits its days across runs.
  battle.mobilised = [0, 1].map((side) => (Array.isArray(carry.mobilised) && typeof carry.mobilised[side] === "string" ? carry.mobilised[side] : ""));
  // Where each troop still on its way to the line is going (march.js).
  if (Array.isArray(carry.march)) {
    read.forEach((list, side) => {
      const goals = readMarch(carry.march[side], list.length);
      list.forEach((troop, index) => { if (goals[index] >= 0) troop.goal = goals[index]; });
    });
  }
  battle.generals = readGenerals(carry.generals);
  battle.talk = readTalk(carry.talk);
  // Which generals' troops are swarms (swarms.js).
  battle.swarms = readSwarms(carry.swarms).map((list) => new Set(list));
  // The plans a side keeps (plans.js) are not the engine's: it hands them on.
  battle.plans = Array.isArray(carry.plans) ? carry.plans : null;
  // Where a side's countries' new troops come in (deploy.js): drawn in the war room, handed on.
  battle.deploy = Array.isArray(carry.deploy) ? readDeploy(carry.deploy) : null;
  // What each side's own staff last said its plan was (engine.js noteStaffPlan), handed on.
  battle.staffPlans = readStaffPlans(carry.staff);
  // What this battlefield's war has come to so far (chronicle.js), for its report once it is over.
  battle.chronicle = readChronicle(record.chronicle);
  // What the members are still owed of their levies (muster.js).
  battle.levy = readLevy(carry.levy);
  // Troops left on ice that has thawed since (climate.js) get off it as they can: to the nearest ground of
  // their side, at a cost; one with none within reach is lost with it.
  read.forEach((list, side) => list.forEach((troop) => {
    if (!(troop.strength > 0)) return;
    const cell = cellAt(battle.field, troop.x, troop.y);
    if (cell >= 0 && battle.field.play[cell]) return;
    const to = nearestHeld(battle.field, side, troop.x, troop.y, THAW_REACH_CELLS);
    if (to < 0) {
      troop.strength = 0;
      return;
    }
    troop.x = (to % battle.field.cols) + 0.5;
    troop.y = Math.floor(to / battle.field.cols) + 0.5;
    troop.strength *= 1 - THAW_LOSS;
  }));
  const kept = dropTheDead(read, record.named);
  battle.troops = kept.troops;
  battle.named = kept.named;
  battle.pool = record.pool.slice();
  battle.base = record.base.slice();
  battle.quality = record.quality.slice();
  battle.effort = record.effort.slice();
  if (Array.isArray(record.mind)) battle.mind = record.mind.map((list) => (Array.isArray(list) ? list.slice() : []));
  battle.orders = record.orders.map((order, index) => {
    const stood = Array.isArray(carry.ages) && Number.isFinite(carry.ages[index]) ? carry.ages[index] : diffGameDays(order.since, run.input.fromDate);
    return { ...order, age: Math.max(0, Math.floor(Number(stood) || 0)) };
  });
  battle.halts = (Array.isArray(carry.halts) ? carry.halts : [])
    .filter((halt) => (halt?.s === 0 || halt?.s === 1) && halt.days > 0)
    .map((halt) => ({ s: halt.s, sector: String(halt.sector ?? "all"), days: Math.floor(halt.days) }));
  battle.anchors = (Array.isArray(carry.anchors) ? carry.anchors : [])
    .filter((anchor) => (anchor?.s === 0 || anchor?.s === 1) && Number.isFinite(anchor.x) && Number.isFinite(anchor.y))
    .map((anchor) => ({ s: anchor.s, x: anchor.x, y: anchor.y }));
  battle.pockets = (Array.isArray(carry.pockets) ? carry.pockets : [])
    .filter((pocket) => (pocket?.s === 0 || pocket?.s === 1) && Number.isInteger(pocket.cell))
    .map((pocket) => ({ s: pocket.s, cell: pocket.cell, days: Math.max(0, Math.floor(Number(pocket.days) || 0)), km2: 0, siege: "", told: pocket.told === true }));
  battle.log = record.log.map((entry) => ({ ...entry }));
  battle.logFrom = battle.log.length;
  battle.quiet = Math.max(0, Math.floor(Number(carry.quiet) || 0));
  battle.away = [carry.away?.[0] === true, carry.away?.[1] === true];
  battle.sentHome = new Map((Array.isArray(carry.sentHome) ? carry.sentHome : [])
    .filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && entry[0] && (entry[1] === 0 || entry[1] === 1))
    .slice(0, MAX_NAMED_TROOPS)
    .map(([unitId, side]) => [unitId, side]));
  return battle;
};

// A new battle on a frame, where two sides at war touch. null when they do not
// touch on this ground after all.
//   home   a country's forces at home (home.js): they may stand where its land touches nobody's of the other side
export const openBattle = (run, { name, warId, sides, frame, arena, day, home = false }) => {
  const battle = createBattle(run, { name, warId, sides, frame, arena, openedDate: run.dateOf(day), openedDay: day });
  battle.home = home === true;
  setHandicap(battle, run);
  readRegions(battle, run);
  battle.field = openField(arena, run.input.map.regions, battle.regionSide, battle.iceSide);
  if (!battle.field || (!battle.home && traceContour(battle.field).segments === 0)) return null;
  lineLength(battle);
  return battle;
};

// The rings round the ground each side holds that is not its home ground, by
// who each region is shown as belonging to: what the map hatches. A ring is
// marked with the side that holds the ground.
const takenRings = (battle) => {
  const { field } = battle;
  const { cols, rows, size } = field;
  const rings = [];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // A field of its own: inside where this side holds another's ground, and a
    // cell further out all round, so the hatch covers every such cell whole.
    const taken = new Uint8Array(size);
    let any = false;
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side || battle.homes[index] === side) continue;
      taken[index] = 1;
      any = true;
    }
    if (!any) continue;
    const scratch = {
      cols,
      rows,
      size,
      edits: 0,
      contour: null,
      contourEdits: -1,
      play: new Uint8Array(size).fill(1),
      holders: new Uint8Array(size).fill(HOLDER_SIDE_B),
      phi: new Float64Array(size).fill(FAR_CELLS),
      ghost: Int32Array.from({ length: size }, (_, index) => index),
      pieceFrom: new Int32Array(size * 2).fill(-1),
      pieceTo: new Int32Array(size * 2).fill(-1),
    };
    for (let index = 0; index < size; index += 1) {
      const col = index % cols;
      const row = (index - col) / cols;
      if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) continue;
      let inside = taken[index] === 1;
      for (let dy = -1; dy <= 1 && !inside; dy += 1) {
        for (let dx = -1; dx <= 1 && !inside; dx += 1) inside = taken[index + dy * cols + dx] === 1;
      }
      if (!inside) continue;
      // Against the other side the edge of the hatch is the front line itself:
      // both keep the distances the field has. A wall beside it is simply inside.
      const other = field.holders[index] === 1 - side;
      const distance = field.play[index] ? Math.max(1 / 64, Math.abs(field.phi[index])) : 0.5;
      scratch.phi[index] = other ? distance : -distance;
      scratch.holders[index] = other ? HOLDER_SIDE_B : HOLDER_SIDE_A;
    }
    const contour = traceContour(scratch);
    const flags = new Uint8Array(contour.x.length).fill(side);
    for (const strand of drawLine(contour, flags)) if (strand.closed) rings.push(strand);
  }
  return rings;
};

// The orders given by hand that send troops somewhere (an attack of any kind,
// a route drawn for them) and have stopped getting them anywhere: not one of
// the troops that serve it has got further in HAND_STALL_DAYS. Such an order
// has been carried out as far as it can be: it is given up, and its troops go
// back to what their stretch of the line is told. A troop drawn off to close
// on a pocket or to storm a place is at work, and comes back to its way.
// `serving` says which standing order each troop serves, a list a side.
const stuckOrders = (battle, serving, day) => {
  const going = new Map();
  battle.troops.forEach((list, side) => list.forEach((troop, index) => {
    const standing = serving[side][index];
    if (!standing || !standing.chosen || !isAttack(standing.order)) return;
    const live = troop.order && !troop.order.done ? troop.order : null;
    const way = live && live.kind === "way" ? live : null;
    const moves = !way || day - (way.markDay ?? way.since) < HAND_STALL_DAYS;
    going.set(standing, going.get(standing) === true || moves);
  }));
  const stuck = new Set();
  for (const [order, moves] of going) if (!moves) stuck.add(order);
  return stuck;
};

// The plans a side keeps, as they are handed on. A diversion is a movement
// drawn to be stolen while it is still to come: once days of fighting have
// passed over it there is nothing left of it to steal, and it is not kept. (A
// Board operation's entry is kept: it says the operation was sent, and is not
// to be sent again.)
const plansKept = (battle) => {
  if (!Array.isArray(battle.plans) || battle.daysRun <= 0) return battle.plans;
  return battle.plans.map((list) => (Array.isArray(list) ? list.filter((plan) => plan?.kind !== "diversion") : list));
};

// The record of a battle as it stands. `day` is the day of the run it is
// written on; `changes` takes the named formations that fell.
// What a side's own staff last said its plan was, as a record keeps it (engine.js noteStaffPlan): [plan | null, plan | null].
const readStaffPlans = (value) => {
  if (!Array.isArray(value)) return null;
  const read = [0, 1].map((side) => {
    const plan = value[side];
    if (!plan || typeof plan !== "object" || typeof plan.plan !== "string" || !plan.plan) return null;
    return {
      plan: plan.plan.slice(0, 80),
      ...(typeof plan.at === "string" && plan.at ? { at: plan.at.slice(0, 120) } : {}),
      since: String(plan.since ?? "").slice(0, 40),
      n: Number(plan.n) > 0 ? Math.floor(Number(plan.n)) : 0,
    };
  });
  return read.some(Boolean) ? read : null;
};

// How well supplied each cell a side holds is, for the War Room's map (GameUI/warRoom.jsx): 1 supplied, 2 stretched
// (past where supplies come in full: supply.js), 3 cut off; 0 where neither side holds it. Packed as the mask is.
const SUPPLY_STRETCHED = 0.9;
const supplyLevels = (battle) => {
  const { field } = battle;
  const levels = new Uint8Array(field.size);
  for (let cell = 0; cell < field.size; cell += 1) {
    const holder = field.holders[cell];
    if (holder !== HOLDER_SIDE_A && holder !== HOLDER_SIDE_B) continue;
    if (battle.fed?.[holder] && battle.fed[holder][cell] !== 1) {
      levels[cell] = 3;
      continue;
    }
    const supply = battle.supply?.[holder]?.[cell] ?? 0;
    levels[cell] = supply > 0 && supply < SUPPLY_STRETCHED ? 2 : 1;
  }
  return levels;
};

export const saveBattle = (battle, run, day, changes, brief) => {
  const { arena, field } = battle;
  // Members that left are struck off, and every troop's owner follows.
  const owners = [[], []];
  const sides = [[], []];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    battle.sides[side].forEach((member, index) => {
      owners[side].push(battle.gone[side].has(index) ? 0 : sides[side].length);
      if (!battle.gone[side].has(index)) sides[side].push(member);
    });
  }
  // A troop's place is kept to a sixteenth of a cell. Rounded to the nearest,
  // one standing at the very edge of its cell would be saved in the cell next
  // door, which may be a wall or the other side's: it is kept in its own.
  const within = (value) => Math.min(Math.floor(value) + 1 - 1 / TROOP_UNITS, Math.max(Math.floor(value), Math.round(value * TROOP_UNITS) / TROOP_UNITS));
  const troops = battle.troops.map((list, side) => encodeTroops(list.map((troop) => ({ ...troop, x: within(troop.x), y: within(troop.y), owner: owners[side][troop.owner] ?? 0 }))));
  reportTheFallen(battle, changes);
  const closed = battle.status === "closed";
  // The regions the map draws as someone else's than the world says they are:
  // taken in name, and not yet whole. If there are too many to list, the
  // largest are kept.
  let disputed = [];
  for (let region = 1; region < arena.ids.length && !closed; region += 1) {
    const name = battle.shown.get(arena.ids[region]) ?? "";
    if (battle.regionSide[region] >= 0 && name && fold(name) !== fold(holderOf(battle, run, arena.ids[region]))) disputed.push(region);
  }
  if (disputed.length > MAX_CONTESTED_REGIONS) {
    const largest = new Set(disputed.slice().sort((a, b) => arena.cells[b] - arena.cells[a] || a - b).slice(0, MAX_CONTESTED_REGIONS));
    disputed = disputed.filter((region) => largest.has(region));
  }
  const contested = disputed.map((region) => [arena.ids[region], battle.shown.get(arena.ids[region])]);
  const swarms = swarmsKept(battle);
  // Which standing order each troop is carrying out. An order given to troops
  // picked out that none of them is carrying out any more has been done, or
  // its troops are gone: it is not kept. (An order for a stretch of line
  // stands whether or not anybody is carrying it out.)
  const serving = battle.troops.map((list) => list.map((troop) => standingOf(battle, troop)));
  const served = new Set();
  for (const list of serving) for (const order of list) if (order) served.add(order);
  // Nor is one that sends them somewhere they have stopped getting any nearer.
  const stuck = stuckOrders(battle, serving, day);
  const orders = battle.orders.filter((order) => !order.chosen || (served.has(order) && !stuck.has(order)));
  const plans = plansKept(battle);
  // Which point of its route each troop on one is making for, so that the next
  // run sends it on from there and not from wherever on the route lies nearest:
  // a route may cross itself, or come back to where it began.
  const next = battle.troops.map((list, side) => list.map((troop, index) => {
    const standing = serving[side][index];
    if (!standing || !orders.includes(standing) || !Array.isArray(standing.way) || standing.way.length === 0) return -1;
    let way = troop.order && !troop.order.done ? troop.order : null;
    if (way && way.kind !== "way") way = way.resume && !way.resume.done ? way.resume : null;
    if (!way || way.kind !== "way" || way.word !== "path" || !Number.isInteger(way.skip)) return -1;
    // A leg whose end it has crossed today is behind it, though it has not yet turned onto the next.
    let leg = way.leg;
    while (leg < way.legs.length - 1 && leftOnLeg(way.legs[leg], troop) <= 0) leg += 1;
    return way.skip + leg;
  }));
  const record = {
    v: BATTLEFIELD_VERSION,
    name: battle.name,
    warId: battle.warId,
    status: battle.status,
    ...(battle.home ? { home: true } : {}),
    sides,
    openedDate: battle.openedDate,
    asOf: closed ? battle.closedDate : run.dateOf(day),
    frame: battle.frame,
    troops,
    named: battle.named.map(({ s, i, name, unitId }) => ({ s, i, name, unitId })),
    pool: battle.pool.map(round3),
    base: battle.base.slice(),
    quality: battle.quality.slice(),
    effort: battle.effort.slice(),
    ...(Array.isArray(battle.mind) ? { mind: battle.mind.map((list) => (Array.isArray(list) ? list.slice() : [])) } : {}),
    orders: orders.map(({ s, sector, order, objective, effort, by, since, chosen, way, mark, attacks }) => ({
      s,
      sector,
      order,
      since,
      ...(objective ? { objective } : {}),
      ...(effort ? { effort } : {}),
      ...(by ? { by } : {}),
      ...(chosen ? { chosen: true } : {}),
      // (What wrote an order for troops picked out; and, of an order for a stretch of line, that the side's own staff did.)
      ...((chosen || LINE_MARKS.includes(mark)) && mark ? { mark } : {}),
      ...(Array.isArray(way) && way.length > 0 ? { way } : {}),
      ...(chosen && Array.isArray(attacks) && attacks.length > 0 ? { attacks: attacks.slice() } : {}),
    })),
    replay: battle.replay ?? battle.recorder.finish({ date: run.input.fromDate, days: day }),
    held: "",
    contested,
    brief: {
      ...brief,
      // How well supplied its ground is, and the weather of the days ahead (weather.js): the War Room's.
      ...(closed ? {} : { supply: encodeMask(supplyLevels(battle)) }),
      ...(!closed && run.mech?.weather ? { forecast: skiesAhead(run, battle, day) } : {}),
      carry: {
        // Which of the standing orders each troop is serving, so that the next
        // run finds the same group under each.
        under: serving.map((list) => list.map((order) => (order ? orders.indexOf(order) : -1))),
        ages: orders.map((order) => order.age),
        ...(next.some((list) => list.some((point) => point >= 0)) ? { next } : {}),
        // Which general each troop is under, and what the generals are called.
        command: battle.troops.map((list) => list.map((troop) => (isLive(troop) ? troop.command : -1))),
        ...(battle.generals.some((names) => names.some(Boolean)) ? { generals: battle.generals } : {}),
        // Which generals' troops are swarms (swarms.js): those with troops left.
        ...(swarms.some((list) => list.length > 0) ? { swarms } : {}),
        // What each member is still owed of its levy (muster.js), by its place in the side's list as saved.
        ...(levyOwed(battle.levy)
          ? { levy: battle.levy.map((list, side) => list.filter((entry) => entry.r < entry.t && !battle.gone[side].has(entry.o)).map((entry) => [owners[side][entry.o], entry.t, entry.r, entry.f])) }
          : {}),
        // How worn out each troop is (fatigue.js), a letter a troop: only where the run tires troops and one is tired.
        ...(run.mech?.fatigue && battle.troops.some((list) => list.some((troop) => isLive(troop) && troop.fatigue > 0))
          ? { tired: battle.troops.map((list) => encodeLevels(list.map((troop) => (isLive(troop) ? troop.fatigue : 0)))) }
          : {}),
        ...(battle.talk.some((lines) => lines.length > 0) ? { talk: battle.talk } : {}),
        ...(battle.home && battle.calledOn ? { called: battle.calledOn } : {}),
        ...(Array.isArray(battle.mobilised) && battle.mobilised.some(Boolean) ? { mobilised: battle.mobilised.slice() } : {}),
        // Where each troop still on its way to the line is going (march.js).
        ...(battle.troops.some((list) => list.some((troop) => isLive(troop) && troop.goal >= 0)) ? { march: battle.troops.map(marchKept) } : {}),
        ...(plans ? { plans } : {}),
        ...(hasDeploy(battle.deploy) ? { deploy: battle.deploy } : {}),
        ...(Array.isArray(battle.staffPlans) && battle.staffPlans.some(Boolean) ? { staff: battle.staffPlans } : {}),
        ...(battle.status === "standing" ? { quiet: battle.quiet } : {}),
        ...(battle.away[0] || battle.away[1] ? { away: battle.away.slice() } : {}),
        ...(battle.sentHome.size > 0 ? { sentHome: [...battle.sentHome] } : {}),
        halts: battle.halts.map(({ s, sector, days }) => ({ s, sector, days })),
        anchors: battle.anchors.map(({ s, x, y }) => ({ s, x, y })),
        pockets: battle.pockets.map(({ s, cell, days, told }) => ({ s, cell, days, ...(told ? { told: true } : {}) })),
      },
    },
    log: battle.log.slice(-MAX_LOG_ENTRIES),
    // What its war has come to, run by run (chronicle.js): for its report once it is over.
    chronicle: chronicleAfter(battle, closed ? battle.closedDate : run.dateOf(day)),
  };
  if (closed) record.closedDate = battle.closedDate;
  else {
    record.field = packField(field);
    record.held = encodeLines(takenRings(battle));
  }
  return record;
};

/*! Open Historia — battlefields and fronts: fortified lines that must be broken through © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "walls"). "Fortified lines which would
// be more like walls that need to be broken through to get past, like for
// castles or great walls ... a level 0-10, 10 being impossible to pass, 0 ...
// the troops break through immediately (fortified lines should be a minimum of 3)."
//
// A FORTIFIED LINE (runtime/warGeography.js fortifications) is drawn on a
// battlefield as the cells it runs through: a strip a cell wide that the side
// opposite its OWNER may not step into or take while it stands (battle.kept,
// the mask of ground a side leaves alone that a siege uses too). A line whose
// owner is not fighting on the battlefield is no part of the fight there.
//
// It stands until it is BROKEN. Troops held up at it ASSAULT it rather than go
// round (combat.js), and every day they do so wears the stretch before them
// (WALL_PIECE_KM long) toward breaking: in WALL_DAYS of its level at odds of
// WALL_ODDS or better, the more slowly the worse the odds, three times as fast
// with a siege train. A stretch worn through is a BREACH, kept as kilometres
// along the line from its first point, so it is the same breach whatever frame
// a battlefield's ground is drawn in, and open to both sides from then on. A
// line of level 10 is never broken. Assaulting a wall costs the attacker more
// than an attack in the open (WALL_ASSAULT_COST).
//
// Its owner's troops fight from it: within a cell of a standing stretch of
// their own side's line, their defence is WALL_DEFENCE_PER_LEVEL a level more.
//
// A line still being built (`building`: a War Room order) is not there until
// it is finished.
//
// What a run did to each line (its breaches and wear) is handed back with the
// run (engine.js snapshot: fortifications), for the turn to keep.
//
// Only + - * / and comparisons (sqrt for a distance).

import { addGameDays, compareGameDates } from "../gameDates.js";
import { cellAt } from "./ground.js";
import { kmBetween, measureOptions } from "./worldGrid.js";

export const WALL_PIECE_KM = 5;
export const WALL_DAYS = Object.freeze([Infinity, Infinity, Infinity, 3, 6, 10, 15, 22, 32, 50, Infinity]);
export const WALL_ODDS = 2;
export const WALL_DEFENCE_PER_LEVEL = 0.15;
export const WALL_ASSAULT_COST = 1.5;
export const WALL_SIEGE_WEAR = 3;

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The lines a run is given (input.fortifications), read once: each with how
// far along it each of its points lies, and what is worn and broken of it.
export const readLines = (run) => {
  if (run.lines) return run.lines;
  const measure = measureOptions(run.input?.map);
  run.lines = (run.mech?.walls ? list(run.input?.fortifications) : []).map((line) => {
    const points = list(line?.points).filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    const at = [0];
    for (let index = 1; index < points.length; index += 1) at.push(at[index - 1] + kmBetween(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], measure));
    return {
      id: String(line?.id ?? ""),
      // (Its name, for what is told of it: a breach.)
      name: String(line?.name ?? "").replace(/s+/g, " ").trim().slice(0, 80),
      owner: String(line?.owner ?? ""),
      level: Math.max(0, Math.min(10, Math.round(Number(line?.level) || 0))),
      points,
      at,
      breaches: list(line?.breaches).map((stretch) => [Number(stretch[0]), Number(stretch[1])]),
      wear: new Map(list(line?.wear).map((entry) => [Math.floor(Number(entry[0])), Number(entry[1])])),
      building: line?.building ?? null,
      changed: false,
    };
  }).filter((line) => line.points.length >= 2);
  return run.lines;
};

// Whether a line stands on a date: finished, and of a level to stop anybody.
export const standsOn = (line, date) => {
  if (line.level < 3) return false;
  if (!line.building) return true;
  const done = addGameDays(line.building.since, Math.max(0, Math.round(Number(line.building.days) || 0)));
  return Boolean(done) && compareGameDates(done, date) <= 0;
};

// Whether a point along a line, in km from its first point, is broken.
export const brokenAt = (line, km) => line.breaches.some(([from, to]) => km >= from && km <= to);

// The side of a battle a line's owner fights on, or -1.
const ownerSide = (battle, owner) => {
  const wanted = fold(owner);
  if (!wanted) return -1;
  for (const side of [0, 1]) if (battle.sides[side].some((member, at) => !battle.gone[side].has(at) && fold(member) === wanted)) return side;
  return -1;
};

// A battle's walls: which line runs through each cell (its place in the run's
// list, plus one; 0 for none) and how far along it (km). Drawn again whenever
// the battle's frame or its sides change. null where none is any part of it.
export const wallsOf = (run, battle) => {
  const lines = readLines(run);
  const sidesKey = battle.sides.map((members, side) => members.filter((member, at) => !battle.gone[side].has(at)).join("|")).join("/");
  if (battle.wallsFor === battle.place && battle.wallSides === sidesKey) return battle.walls;
  battle.wallsFor = battle.place;
  battle.wallSides = sidesKey;
  battle.walls = null;
  if (lines.length === 0) return null;
  const { field, place } = battle;
  const sides = lines.map((line) => ownerSide(battle, line.owner));
  if (!sides.some((side) => side >= 0)) return null;
  const cellLine = new Int16Array(field.size);
  const cellKm = new Float32Array(field.size);
  let drawn = 0;
  lines.forEach((line, index) => {
    if (sides[index] < 0) return;
    for (let leg = 1; leg < line.points.length; leg += 1) {
      const [ax, ay] = place.toCell(line.points[leg - 1][0], line.points[leg - 1][1]);
      const [bx, by] = place.toCell(line.points[leg][0], line.points[leg][1]);
      const cells = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      const steps = Math.max(1, Math.ceil(cells * 4));
      for (let step = 0; step <= steps; step += 1) {
        const part = step / steps;
        const cell = cellAt(field, ax + (bx - ax) * part, ay + (by - ay) * part);
        if (cell < 0 || !field.play[cell]) continue;
        cellLine[cell] = index + 1;
        cellKm[cell] = line.at[leg - 1] + (line.at[leg] - line.at[leg - 1]) * part;
        drawn += 1;
      }
    }
  });
  if (drawn > 0) battle.walls = { cellLine, cellKm, sides };
  return battle.walls;
};

// Whether the stretch of wall in a cell stands against `side`: a line of the other side's, standing and not broken there.
const standsAgainst = (run, battle, cell, side, date) => {
  const walls = battle.walls;
  const at = walls ? walls.cellLine[cell] : 0;
  if (at === 0) return null;
  const line = run.lines[at - 1];
  if (walls.sides[at - 1] !== 1 - side || !standsOn(line, date) || brokenAt(line, walls.cellKm[cell])) return null;
  return { line: at - 1, piece: Math.floor(walls.cellKm[cell] / WALL_PIECE_KM) };
};

// The morning: the cells each side may not enter or take for the walls
// standing today (battle.wallMask, [mask, mask], null for none), and each
// live troop's own wall (troop.walled: the level of the highest standing
// stretch of its own side's line within a cell of it, 0 for none).
export const raiseWalls = (run, battle, date) => {
  const walls = wallsOf(run, battle);
  battle.wallMask = [null, null];
  battle.wallDate = date;
  battle.wallRun = run;
  if (!walls) {
    for (const side of [0, 1]) for (const troop of battle.troops[side]) troop.walled = 0;
    return;
  }
  const { field } = battle;
  for (let cell = 0; cell < field.size; cell += 1) {
    if (walls.cellLine[cell] === 0) continue;
    for (const side of [0, 1]) {
      if (!standsAgainst(run, battle, cell, side, date)) continue;
      battle.wallMask[side] ??= new Uint8Array(field.size);
      battle.wallMask[side][cell] = 1;
    }
  }
  for (const side of [0, 1]) {
    for (const troop of battle.troops[side]) {
      let level = 0;
      if (troop.strength > 0) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const cell = cellAt(field, troop.x + dx, troop.y + dy);
            const at = cell >= 0 ? walls.cellLine[cell] : 0;
            if (at === 0 || walls.sides[at - 1] !== side) continue;
            const line = run.lines[at - 1];
            if (standsOn(line, date) && !brokenAt(line, walls.cellKm[cell]) && line.level > level) level = line.level;
          }
        }
      }
      troop.walled = level;
    }
  }
};

// What stands in a troop's way at a point: the stretch of an enemy wall it
// would have to break through ({ line, piece }), or null.
export const wallAhead = (battle, side, x, y) => {
  if (!battle.walls || !battle.wallRun) return null;
  const cell = cellAt(battle.field, x, y);
  return cell < 0 ? null : standsAgainst(battle.wallRun, battle, cell, side, battle.wallDate);
};

// A share of a day's assault on a stretch of wall, at `odds` (attack against
// what defends it there): wears it, and opens a breach when it is worn
// through. true when it broke.
export const wearWall = (battle, { line: index, piece }, odds, siege, share) => {
  const run = battle.wallRun;
  const line = run?.lines?.[index];
  if (!line || !(WALL_DAYS[line.level] < Infinity)) return false;
  const worn = (line.wear.get(piece) ?? 0) + (share * (odds >= WALL_ODDS ? 1 : odds / WALL_ODDS) * (siege ? WALL_SIEGE_WEAR : 1)) / WALL_DAYS[line.level];
  line.changed = true;
  if (worn < 1) {
    line.wear.set(piece, worn);
    return false;
  }
  line.wear.delete(piece);
  const from = piece * WALL_PIECE_KM;
  line.breaches.push([from, from + WALL_PIECE_KM]);
  line.breaches.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const stretch of line.breaches) {
    const last = merged[merged.length - 1];
    if (last && stretch[0] <= last[1]) last[1] = last[1] > stretch[1] ? last[1] : stretch[1];
    else merged.push(stretch.slice());
  }
  line.breaches = merged;
  // (Something to tell: who broke through, and which line; once a line a day, however many stretches of it gave
  // way. The report of the war keeps it too: chronicle.js.)
  const owner = battle.walls?.sides?.[index];
  const at = line.name ? `wall: ${line.name}` : "a fortified line";
  const date = String(battle.wallDate ?? "");
  if ((owner === 0 || owner === 1) && !battle.log.some((entry) => entry.k === "breached" && entry.d === date && entry.at === at)) {
    battle.log.push({ d: date, k: "breached", s: 1 - owner, at });
  }
  return true;
};

// The ground each side leaves alone: what its sieges leave (supply.js
// battle.siegeKept) and the walls standing against it (battle.wallMask).
export const keptWith = (battle) => [0, 1].map((side) => {
  const siege = battle.siegeKept?.[side] ?? null;
  const wall = battle.wallMask?.[side] ?? null;
  if (!wall) return siege;
  if (!siege) return wall;
  const both = Uint8Array.from(siege);
  for (let cell = 0; cell < wall.length; cell += 1) if (wall[cell] === 1) both[cell] = 1;
  return both;
});

// What a run did to its lines, for the turn to keep: [{ id, breaches, wear }] of those it changed.
export const linesChanged = (run) => (run.lines ?? []).filter((line) => line.changed).map((line) => ({
  id: line.id,
  breaches: line.breaches.map(([from, to]) => [Math.round(from * 100) / 100, Math.round(to * 100) / 100]),
  wear: [...line.wear.entries()].filter(([, worn]) => worn > 0).sort((a, b) => a[0] - b[0]).map(([piece, worn]) => [piece, Math.round(worn * 1000) / 1000]),
}));

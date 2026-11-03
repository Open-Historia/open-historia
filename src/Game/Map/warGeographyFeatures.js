/*! Open Historia — what a scenario draws on its map for war, as the game's map shows it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 on the game's map (runtime/warGeography.js).
//
// TERRAIN AREAS, ground harder to cross than its region says: a translucent
// flat shade with a dashed edge, both the darker the higher the area's level.
// Level 0 is flat ground and is not drawn; 10 can never be crossed and is the
// darkest.
//
// FORTIFIED LINES, walls that must be broken through: a thick dark line with
// a pale core and teeth along one side, the heavier the higher its level.
// Where it has been breached (its breaches, kilometres along it from its first
// point, as the front engine keeps them: fronts/walls.js) it is broken off, and
// a faint line of rubble shows where it stood. A line still being built
// (building { since, days }, a War Room order) is a lighter dashed line, the
// stretch of it as far along as the work has got drawn stronger, until it is
// finished on the day the engine says it stands.
//
// Pure: geometry out of records. The layers are WarGeographyLayers.jsx.

import { addGameDays, compareGameDates, diffGameDays } from "../../runtime/gameDates.js";
import { unwrapLng } from "../../runtime/fronts/frame.js";
import { kmBetween, measureOptions } from "../../runtime/fronts/worldGrid.js";
import { engineMapOf } from "../../../server/mapDistance.js";
import { TERRAIN_LEVEL_MOST, WALL_LEVEL_MOST, normalizeFortifications, normalizeTerrainAreas } from "../../runtime/warGeography.js";

const collection = (features) => ({ type: "FeatureCollection", features });
const round3 = (value) => Math.round(value * 1000) / 1000;
const within = (value, least, most) => (value < least ? least : value > most ? most : value);

// ---- terrain ---------------------------------------------------------------------

// How an area of a level is drawn: { fillOpacity, lineOpacity, lineWidth }.
export const terrainStyleOf = (level) => {
  const share = within(Math.round(Number(level) || 0), 0, TERRAIN_LEVEL_MOST) / TERRAIN_LEVEL_MOST;
  return { fillOpacity: round3(0.04 + 0.26 * share), lineOpacity: round3(0.3 + 0.65 * share), lineWidth: round3(0.8 + 1.8 * share) };
};

// A ring closed, as a polygon's must be.
const closed = (ring) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

//   areas   world.terrainAreas
// Returns a feature collection of polygons, the lowest first so a higher one
// lies over it: { id, level, fillOpacity, lineOpacity, lineWidth }.
export const terrainAreaFeatures = (areas) => collection(normalizeTerrainAreas(areas)
  .filter((area) => area.level > 0)
  .sort((a, b) => a.level - b.level)
  .map((area) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: area.rings.map(closed) },
    properties: { id: area.id, level: area.level, ...terrainStyleOf(area.level) },
  })));

// ---- fortified lines -------------------------------------------------------------

// How heavily a line of a level is drawn, a factor on its width.
export const wallWeightOf = (level) => round3(0.75 + 0.05 * within(Math.round(Number(level) || 0), 0, WALL_LEVEL_MOST));

// How far the building of a line has got on a date: null for a line that is
// not being built, else { built, share } (share 0 to 1 of its days). It is
// built on the day the engine has it stand (fronts/walls.js standsOn): its
// `since` and `days` on, or a date the calendar cannot read.
export const wallProgressOn = (building, date) => {
  if (!building) return null;
  const days = Math.max(0, Math.round(Number(building.days) || 0));
  const done = addGameDays(building.since, days);
  if (done && compareGameDates(done, date) <= 0) return { built: true, share: 1 };
  const gone = diffGameDays(building.since, date);
  return { built: false, share: days > 0 && Number.isFinite(gone) ? round3(within(gone / days, 0, 1)) : 0 };
};

const round5 = (value) => Math.round(value * 1e5) / 1e5;

// A line as it is drawn and measured: its points, each taken on from the one
// before (so a line across the date line is not drawn the long way round),
// and how far along it each lies in kilometres from the first, measured as
// the engine measures it (fronts/walls.js readLines). { line, at, total }.
//   measure   the map's measure (server/mapDistance.js); without one, `flat`
//             says whether it is a freeform sheet at the usual scale
export const measureLine = (points, { flat = false, measure = null } = {}) => {
  const options = measure ? measureOptions(engineMapOf(measure)) : { flat };
  const line = [];
  for (const [lng, lat] of Array.isArray(points) ? points : []) line.push([line.length > 0 ? unwrapLng(lng, line[line.length - 1][0]) : lng, lat]);
  const at = line.length > 0 ? [0] : [];
  for (let index = 1; index < line.length; index += 1) {
    at.push(at[index - 1] + kmBetween(line[index - 1][0], line[index - 1][1], line[index][0], line[index][1], options));
  }
  return { line, at, total: at.length > 0 ? at[at.length - 1] : 0 };
};

// The stretch of a measured line from one distance along it to another, as points.
const stretchOf = ({ line, at }, from, to) => {
  const pointAt = (km) => {
    let leg = 1;
    while (leg < at.length - 1 && at[leg] < km) leg += 1;
    const length = at[leg] - at[leg - 1];
    const share = length > 0 ? within((km - at[leg - 1]) / length, 0, 1) : 0;
    const [ax, ay] = line[leg - 1];
    const [bx, by] = line[leg];
    return [round5(ax + (bx - ax) * share), round5(ay + (by - ay) * share)];
  };
  const stretch = [pointAt(from)];
  for (let index = 0; index < line.length; index += 1) if (at[index] > from && at[index] < to) stretch.push(line[index]);
  stretch.push(pointAt(to));
  return stretch;
};

// A line cut where it is breached: { standing: [stretch], broken: [stretch] },
// each stretch a list of points. `breaches` are [from km, to km] along it.
export const splitByBreaches = (points, breaches, { flat = false, measure = null } = {}) => {
  const measured = measureLine(points, { flat, measure });
  const { line, total } = measured;
  if (line.length < 2 || !(total > 0)) return { standing: [], broken: [] };
  const cuts = new Set([0, total]);
  for (const [from, to] of Array.isArray(breaches) ? breaches : []) {
    if (!(to > from)) continue;
    if (from > 0 && from < total) cuts.add(from);
    if (to > 0 && to < total) cuts.add(to);
  }
  const marks = [...cuts].sort((a, b) => a - b);
  const pieces = [];
  for (let index = 1; index < marks.length; index += 1) {
    const from = marks[index - 1];
    const to = marks[index];
    if (!(to - from > 1e-6)) continue;
    const middle = (from + to) / 2;
    const broken = (Array.isArray(breaches) ? breaches : []).some(([start, end]) => middle >= start && middle <= end);
    const last = pieces[pieces.length - 1];
    if (last && last.broken === broken) last.to = to;
    else pieces.push({ broken, from, to });
  }
  const standing = [];
  const broken = [];
  for (const piece of pieces) (piece.broken ? broken : standing).push(stretchOf(measured, piece.from, piece.to));
  return { standing, broken };
};

//   lines   world.fortifications
//   date    the game's date, for how far the building of a line has got
//   flat    true for a map laid out flat (world.projection.type "freeform")
// Returns a feature collection of lines, each with { id, part, level, weight }:
//   part "wall"       what stands of a finished line
//        "rubble"     where it has been breached
//        "planned"    the whole of a line still being built
//        "progress"   the stretch of it as far along as the work has got
export const fortificationFeatures = ({ lines = [], date = "", flat = false, measure = null } = {}) => {
  const features = [];
  const add = (id, part, level, stretches) => {
    if (stretches.length === 0) return;
    features.push({
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: stretches },
      properties: { id, part, level, weight: wallWeightOf(level) },
    });
  };
  for (const wall of normalizeFortifications(lines)) {
    const progress = wallProgressOn(wall.building, date);
    if (progress && !progress.built) {
      const measured = measureLine(wall.points, { flat, measure });
      if (!(measured.total > 0)) continue;
      add(wall.id, "planned", wall.level, [measured.line]);
      if (progress.share > 0) add(wall.id, "progress", wall.level, [stretchOf(measured, 0, measured.total * progress.share)]);
      continue;
    }
    const { standing, broken } = splitByBreaches(wall.points, wall.breaches, { flat, measure });
    add(wall.id, "wall", wall.level, standing);
    add(wall.id, "rubble", wall.level, broken);
  }
  return collection(features);
};

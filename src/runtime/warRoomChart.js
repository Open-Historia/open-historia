/*! Open Historia — what the war room reads of the map: where the sea is, and whose the ground © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two of the war room's tools are held to the map itself, as the engine sees it
// on its sheet of the whole map (fronts/worldGrid.js: the one transporters sail
// on and fleets fight on):
//
//   a fleet is sent only to the sea, and only to water its own sea reaches
//   (naval/fleetOps.js); a blockade is laid from open water off the coast of
//   the country blockaded, at the stretch of it nearest the fleet;
//   a fortified line is built only on ground its country holds
//   (fronts/fortifyOps.js).
//
// The page reads the sheet (Game/AI/frontApply.js warRoomChartFor) and asks it
// here. chartOf gives
//
//   sea(lng, lat)              whether a ship may be there
//   joins(from, to)            whether a fleet at `from` can sail to `to`: the same water
//   holds(country, lng, lat)   true on land the country holds, false on land it does not,
//                              null on water and off the sheet: read from the regions' own
//                              shapes where the chart is given them (`locate`,
//                              runtime/regionLocator.js), to the kilometre; else from the
//                              sheet's cell, a quarter of a degree
//   coastOff(country, from)    [lng, lat] in open water off the country's coast, the
//                              stretch nearest `from` in the water `from` is in; null when
//                              it has no such coast
//
// A cell of the sheet that is partly land and partly sea is both: a ship may
// pass it, and a line may be built on the land of it.
//
// Pure, and runs in bare node.

import { nearestCell, seasOf } from "./fronts/worldGrid.js";

// How far from a fleet the water it lies in is looked for: the story leaves a
// fleet in a harbour, and a harbour stands on land.
export const FLEET_WATER_KM = 120;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const finitePoint = (point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
const rounded = ([lng, lat]) => [Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000];

// The cells beside a cell of the sheet, the diagonal ones too (as naval/engine.js counts a coast).
const BESIDE = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const besideOf = (grid, cell) => {
  const col = cell % grid.cols;
  const row = (cell - col) / grid.cols;
  const cells = [];
  for (const [dx, dy] of BESIDE) {
    const x = grid.wrap ? (col + dx + grid.cols) % grid.cols : col + dx;
    const y = row + dy;
    if (x < 0 || x >= grid.cols || y < 0 || y >= grid.rows) continue;
    cells.push(y * grid.cols + x);
  }
  return cells;
};

// The chart of a sheet.
//   grid           the map's sheet (fronts/worldGrid.js buildWorldGrid)
//   controllerOf   (regionId) => who holds a region now
//   groupOf        (regionId) => the group whose area it is in, or "" (groups hold land too)
//   locate         (lng, lat) => the region a place is in, or "" for none
//                  (runtime/regionLocator.js), for whose ground a place is
// null without a sheet.
export const chartOf = ({ grid = null, controllerOf = null, groupOf = null, locate = null } = {}) => {
  if (!grid || typeof controllerOf !== "function") return null;
  // How long a cell's side is, north to south: on a sheet that measures row by
  // row (a flat one, a world projection's), its middle row's.
  const rowsKm = grid.stepKm?.downRow;
  const cellKm = rowsKm?.length
    ? Math.max(0.001, rowsKm[rowsKm.length >> 1])
    : Math.max(0.001, grid.step * (grid.flat ? Number(grid.scale) || 111.2 : 111.2) * (Number(grid.factor) > 0 ? grid.factor : 1));
  const cellsFor = (km) => Math.max(1, Math.ceil(km / cellKm));
  const holders = new Map();
  const holderOfRegion = (id) => {
    if (!holders.has(id)) holders.set(id, { control: fold(controllerOf(id)), group: fold(typeof groupOf === "function" ? groupOf(id) : "") });
    return holders.get(id);
  };
  const holderOf = (mark) => holderOfRegion(grid.ids[mark]);
  const water = (cell) => cell >= 0 && grid.land[cell] < grid.full;
  // The water nearest a place: where a fleet there is.
  const waterNear = (point) => (finitePoint(point) ? nearestCell(grid, grid.cellOf(Number(point[0]), Number(point[1])), cellsFor(FLEET_WATER_KM), water) : -1);

  const sea = (lng, lat) => water(grid.cellOf(Number(lng), Number(lat)));

  const joins = (from, to) => {
    if (!finitePoint(to)) return false;
    const target = grid.cellOf(Number(to[0]), Number(to[1]));
    if (!water(target)) return false;
    const start = waterNear(from);
    // (Where the fleet is, the sheet cannot say: it is not held to it.)
    if (start < 0) return true;
    const seas = seasOf(grid);
    return seas[start] === seas[target];
  };

  // (No way past it: "you should only be able to build fortifications on your own territory", the owner, 2026-10-14.)
  const holds = (country, lng, lat) => {
    const cell = grid.cellOf(Number(lng), Number(lat));
    if (cell < 0 || grid.land[cell] === 0) return null;
    const wanted = fold(country);
    if (!wanted) return false;
    const id = typeof locate === "function" ? locate(Number(lng), Number(lat)) : grid.ids[grid.region[cell]];
    if (!id) return null;
    const holder = holderOfRegion(id);
    return holder.control === wanted || holder.group === wanted;
  };

  const coastOff = (country, from) => {
    const wanted = fold(country);
    if (!wanted) return null;
    const seas = seasOf(grid);
    const start = waterNear(from);
    const home = start >= 0 ? seas[start] : 0;
    // Open water is taken before water that is partly shore: a fleet is not put on the beach.
    let best = -1;
    let bestOpen = false;
    let least = Infinity;
    const consider = (cell) => {
      if (!water(cell) || (home && seas[cell] !== home)) return;
      const open = grid.land[cell] === 0;
      if (bestOpen && !open) return;
      const [lng, lat] = grid.centreOf(cell);
      const far = start >= 0 ? grid.km(Number(from[0]), Number(from[1]), lng, lat) : 0;
      if ((open && !bestOpen) || far < least) {
        best = cell;
        bestOpen = open;
        least = far;
      }
    };
    for (let cell = 0; cell < grid.land.length; cell += 1) {
      const mark = grid.region[cell];
      if (!grid.land[cell] || !mark || holderOf(mark).control !== wanted) continue;
      // (Its own land is a coast where it is partly sea, or lies beside the sea.)
      consider(cell);
      for (const next of besideOf(grid, cell)) consider(next);
    }
    return best >= 0 ? rounded(grid.centreOf(best)) : null;
  };

  return { sea, joins, holds, coastOff };
};

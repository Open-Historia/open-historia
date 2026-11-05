/*! Open Historia — the war room's shading of a battlefield's ground: supply, and a rehearsal's gains and losses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/Map/warRoomCells.test.js
//
// Two things the war room shades on the map, each a set of a battlefield's
// cells (runtime/fronts/frame.js):
//
//   supply      how well supplied the ground each side holds is (the record's
//               brief.supply, runtime/fronts/battle.js supplyLevels): the
//               player's own ground that is stretched or cut off, and the other
//               side's that is cut off: "Supply on the War Room map" (the
//               owner's list, 2026-10-16)
//   rehearsal   what the player's side would gain and lose if time passed with
//               the orders as they stand (GameUI/warRoomRehearsal.jsx: the
//               period fought ahead of time, as a turn fights it): "run your
//               drawn orders a few days ahead on a copy of the battle ... and
//               show the projected front as a faint overlay"
//
// Each cell set is drawn as rectangles, one a run of cells along a row of the
// frame: exact, and few enough (a run a row where the line crosses it).
//
// Pure, and loads in plain Node.

import { decodeFourMask, decodeMask } from "../../runtime/fronts/codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "../../runtime/fronts/constants.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { holderAt } from "../../runtime/fronts/record.js";

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });

// The runs of cells along each row of a frame where `kindOf(cell)` names a kind, as polygons with that kind:
// [{ type: "Feature", properties: { kind }, geometry }].
export const cellRuns = (frame, kindOf) => {
  const { cols, rows } = frame;
  const { toLngLat } = projectorOf(frame);
  const corner = (x, y) => toLngLat(x, y).map((value) => Math.round(value * 1e5) / 1e5);
  const features = [];
  for (let row = 0; row < rows; row += 1) {
    let col = 0;
    while (col < cols) {
      const kind = kindOf(row * cols + col);
      if (!kind) {
        col += 1;
        continue;
      }
      let end = col + 1;
      while (end < cols && kindOf(row * cols + end) === kind) end += 1;
      features.push({
        type: "Feature",
        properties: { kind },
        geometry: { type: "Polygon", coordinates: [[corner(col, row), corner(end, row), corner(end, row + 1), corner(col, row + 1), corner(col, row)]] },
      });
      col = end;
    }
  }
  return features;
};

// The area of the cells `kindOf` names `kind`, in square kilometres.
const areaOf = (frame, kindOf, kind) => {
  const { kmAt } = projectorOf(frame);
  let km2 = 0;
  for (let row = 0; row < frame.rows; row += 1) {
    const km = kmAt(row + 0.5);
    for (let col = 0; col < frame.cols; col += 1) if (kindOf(row * frame.cols + col) === kind) km2 += km * km;
  }
  return Math.round(km2);
};

// ---- supply -------------------------------------------------------------------------------------------

// What the supply map shades of a battlefield for the player's `side`: "stretched" and "cut" of its own ground, and
// "theirs-cut", the other side's ground that is cut off. With the area of each, in km².
export const supplyShading = (record, side) => {
  const frame = record?.frame;
  if (!frame || (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) || typeof record?.brief?.supply !== "string" || !record.field?.mask) return { data: EMPTY, areas: null };
  const size = frame.cols * frame.rows;
  const holders = decodeMask(record.field.mask, size);
  const levels = decodeFourMask(record.brief.supply, size);
  const kindOf = (cell) => {
    if (holders[cell] === side) return levels[cell] === 3 ? "cut" : levels[cell] === 2 ? "stretched" : "";
    if (holders[cell] === 1 - side && levels[cell] === 3) return "theirs-cut";
    return "";
  };
  return {
    data: { type: "FeatureCollection", features: cellRuns(frame, kindOf) },
    areas: { stretched: areaOf(frame, kindOf, "stretched"), cut: areaOf(frame, kindOf, "cut"), theirsCut: areaOf(frame, kindOf, "theirs-cut") },
  };
};

// ---- a rehearsal --------------------------------------------------------------------------------------

// What the player's `side` would gain ("gained") and lose ("lost") between a battlefield as it stands (`before`) and
// as a rehearsal leaves it (`after`): on the frame the rehearsal ends on, which may have grown; with the area of each.
export const rehearsalShading = (before, after, side) => {
  const frame = after?.frame;
  if (!frame || !after.field?.mask || (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B)) return { data: EMPTY, gainedKm2: 0, lostKm2: 0 };
  const size = frame.cols * frame.rows;
  const now = decodeMask(after.field.mask, size);
  const { toLngLat } = projectorOf(frame);
  const then = new Uint8Array(size);
  for (let cell = 0; cell < size; cell += 1) {
    const col = cell % frame.cols;
    const [lng, lat] = toLngLat(col + 0.5, (cell - col) / frame.cols + 0.5);
    then[cell] = before ? holderAt(before, lng, lat) : now[cell];
  }
  const kindOf = (cell) => {
    if (now[cell] === then[cell]) return "";
    if (now[cell] === side && then[cell] === 1 - side) return "gained";
    if (now[cell] === 1 - side && then[cell] === side) return "lost";
    return "";
  };
  return {
    data: { type: "FeatureCollection", features: cellRuns(frame, kindOf) },
    gainedKm2: areaOf(frame, kindOf, "gained"),
    lostKm2: areaOf(frame, kindOf, "lost"),
  };
};

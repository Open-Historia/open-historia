/*! Open Historia — battlefields and fronts: what the engine's tests share © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine is tested through its own front door: a saved battlefield goes in
// with the days and the orders, and what comes out is read back from the
// record, the way the game reads it. So a test needs two things the game never
// does by hand: a battlefield set up exactly as the test wants it (these
// troops, here, facing those), and a quick way to ask a saved record where its
// line runs and who stands where.

import { rasterizeArena } from "./arena.js";
import { decodeMask, decodeTroops, encodeTroops } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { openField, packField, takeCapsule, redistance, traceContour, unpackField } from "./field.js";
import { projectorOf } from "./frame.js";
import { normalizeBattlefield } from "./record.js";
import { sideTable } from "./syntheticMap.js";

export const SIDES = [["Aland"], ["Borduria"]];

// A saved battlefield on a sheet, as the engine would have left it, with the
// troops a test asks for. Each troop is { lng, lat } and whatever else a troop
// carries (strength, kind, owner, named, dig); `carve(field, toCell)` may
// change the field before it is saved (a salient, a pocket); `shown` lists
// the regions the map still draws as someone else's than the sheet says, as
// [regionId, name]: the ones taken in name and not yet whole.
export const battlefieldOn = (world, {
  name = "The front",
  sides = SIDES,
  troops = [[], []],
  orders = [],
  named = [],
  pool = [0, 0],
  effort = ["major", "major"],
  quality = [1, 1],
  marginKm = 10,
  frame = null,
  regionTypes = [],
  carve = null,
  brief = {},
  shown = [],
  status = "active",
} = {}) => {
  const laid = frame ?? world.frame({ marginKm });
  const arena = rasterizeArena(laid, world.regions, { regionTypes, cities: world.map.cities });
  const table = sideTable(arena, world, sides);
  const field = openField(arena, world.regions, table) ?? unpackField(arena, { mask: "", band: "", key: arena.key }, table);
  const { toCell } = projectorOf(laid);
  if (carve) {
    carve(field, toCell);
    redistance(field);
  }
  const placed = troops.map((list) => list.map(({ lng, lat, ...rest }) => {
    const [x, y] = toCell(lng, lat);
    return { x, y, strength: 100, kind: 0, owner: 0, named: false, dig: 0, state: 0, ...rest };
  }));
  return normalizeBattlefield({
    v: 1,
    name,
    warId: "war-1",
    status,
    sides,
    openedDate: "2024-01-01",
    asOf: "2024-03-01",
    frame: laid,
    field: packField(field),
    troops: placed.map(encodeTroops),
    named,
    pool,
    base: [100, 100],
    quality,
    effort,
    orders,
    replay: null,
    held: "",
    contested: shown,
    // The engine keeps the list here as well, for a record whose own check does not keep names yet.
    brief: shown.length > 0 ? { ...brief, carry: { ...brief.carry, shown } } : brief,
    log: [],
  });
};

// Gives the sheet's regions to whoever a saved battlefield has holding six
// tenths of them, as the game would have done turn by turn while the line got
// there: a hand-carved field is then one the world agrees with.
export const settleWorld = (world, record) => {
  const arena = rasterizeArena(record.frame, world.regions, { cities: world.map.cities });
  const holders = decodeMask(record.field.mask, arena.size);
  const held = [new Int32Array(arena.ids.length), new Int32Array(arena.ids.length)];
  for (let index = 0; index < arena.size; index += 1) if (holders[index] < 2) held[holders[index]][arena.region[index]] += 1;
  for (let region = 1; region < arena.ids.length; region += 1) {
    const side = record.sides.findIndex((members) => members.includes(world.controllerOf(arena.ids[region])));
    if (side >= 0 && held[1 - side][region] >= 0.6 * arena.cells[region]) world.controller.set(arena.ids[region], record.sides[1 - side][0]);
  }
  return record;
};

// A disc of ground for a side, for `carve`.
export const disc = (field, side, x, y, radius) => takeCapsule(field, side, x, y, x, y, radius, radius);

// A saved battlefield read back: its frame's projector, who holds each cell,
// the line as the engine would trace it, and each side's troops with where
// they stand on the map.
export const readBattlefield = (record, world, { regionTypes = [] } = {}) => {
  const frame = record.frame;
  const place = projectorOf(frame);
  const arena = rasterizeArena(frame, world.regions, { regionTypes, cities: world.map.cities });
  const holders = record.field ? decodeMask(record.field.mask, frame.cols * frame.rows) : new Uint8Array(frame.cols * frame.rows).fill(2);
  const field = record.field ? unpackField(arena, record.field, sideTable(arena, world, record.sides)) : null;
  const contour = field ? traceContour(field) : null;
  const troops = record.troops.map((text) => decodeTroops(text).map((troop) => {
    const [lng, lat] = place.toLngLat(troop.x, troop.y);
    return { ...troop, lng, lat };
  }));
  const held = [0, 0];
  for (const holder of holders) if (holder === HOLDER_SIDE_A || holder === HOLDER_SIDE_B) held[holder] += 1;
  return {
    frame,
    place,
    arena,
    holders,
    field,
    contour,
    troops,
    held,
    // Who holds a place on the map.
    holderAt: (lng, lat) => {
      const [x, y] = place.toCell(lng, lat);
      return x >= 0 && y >= 0 && x < frame.cols && y < frame.rows ? holders[Math.floor(y) * frame.cols + Math.floor(x)] : 2;
    },
    // Where the line crosses a latitude, as longitudes, west to east.
    lineAt: (lat) => {
      const [, y] = place.toCell(frame.lng0, lat);
      const crossings = [];
      for (let segment = 0; contour && segment < contour.segments; segment += 1) {
        const ay = contour.y[contour.from[segment]];
        const by = contour.y[contour.to[segment]];
        if ((ay - y) * (by - y) > 0 || ay === by) continue;
        const ax = contour.x[contour.from[segment]];
        const bx = contour.x[contour.to[segment]];
        crossings.push(place.toLngLat(ax + ((bx - ax) * (y - ay)) / (by - ay), y)[0]);
      }
      return [...new Set(crossings.map((lng) => Math.round(lng * 1e6) / 1e6))].sort((a, b) => a - b);
    },
  };
};

// The kilometres a degree of longitude is at a latitude on a frame.
export const kmPerDegree = (frame, lat) => {
  const place = projectorOf(frame);
  const [, y] = place.toCell(frame.lng0, lat);
  return place.kmAt(y) / frame.cell;
};

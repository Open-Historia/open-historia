/*! Open Historia — battlefields and fronts: a drawn map for the tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine's tests must not depend on the game's assets, so they draw their
// own world: a sheet of rectangular regions, a letter each, on a grid of
// longitudes and latitudes.
//
//   syntheticMap({
//     layout: ["AAAABBBB",      the northernmost row first, a letter a region
//              "AAAABBBB",
//              "~~~~NNNN"],
//     legend: { A: "Aland", B: "Borduria", N: "Neutralia", "~": null },
//     west: 20, north: 52, step: 1,     the sheet's corner and a region's side, in degrees
//   })
//
// A legend entry is the name of the country that controls the regions of that
// letter, null for open sea (no region at all), or { owner, sovereign, typeId }.
// A region's id is "r<column>-<row>" counted from the north-west corner and its
// name "<owner> <column>.<row>", unless `names` gives it another.

import { addGameDays } from "../gameDates.js";
import { createFrame } from "./frame.js";

const wrap = (lng) => (lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng);

export const syntheticMap = ({
  layout,
  legend,
  west = 20,
  north = 52,
  step = 1,
  stepLat = step,
  flat = false,
  scale,
  cities = [],
  names = {},
  key = "synthetic",
  wrapped = false,
} = {}) => {
  const regions = [];
  const controller = new Map();
  const sovereign = new Map();
  const rowsCount = layout.length;
  const colsCount = Math.max(...layout.map((line) => line.length));
  for (let row = 0; row < rowsCount; row += 1) {
    for (let col = 0; col < layout[row].length; col += 1) {
      const entry = legend[layout[row][col]];
      if (entry === null || entry === undefined) continue;
      const owner = typeof entry === "string" ? entry : entry.owner;
      const id = `r${col}-${row}`;
      const w = west + col * step;
      const e = w + step;
      const n = north - row * stepLat;
      const s = n - stepLat;
      const lng = wrapped ? wrap : (value) => value;
      const region = {
        id,
        name: names[id] ?? `${owner || "Land"} ${col}.${row}`,
        geometry: { type: "Polygon", coordinates: [[[lng(w), s], [lng(e), s], [lng(e), n], [lng(w), n], [lng(w), s]]] },
      };
      if (!wrapped) region.bbox = [w, s, e, n];
      if (typeof entry === "object" && entry.typeId) region.typeId = entry.typeId;
      regions.push(region);
      controller.set(id, owner);
      sovereign.set(id, typeof entry === "object" && entry.sovereign ? entry.sovereign : owner);
    }
  }
  const bounds = { west, south: north - rowsCount * stepLat, east: west + colsCount * step, north };
  const map = { regions, cities, flat, key };
  if (flat) map.scale = scale;
  return {
    regions,
    controller,
    sovereign,
    bounds,
    map,
    controllerOf: (regionId) => controller.get(regionId) ?? "",
    sovereignOf: (regionId) => sovereign.get(regionId) ?? "",
    // The region a stored point lies in, by the sheet's own arithmetic.
    regionAt: (lng, lat) => {
      const col = Math.floor((lng - west) / step);
      const row = Math.floor((north - lat) / stepLat);
      if (row < 0 || row >= rowsCount || col < 0 || col >= layout[row].length) return "";
      const entry = legend[layout[row][col]];
      return entry === null || entry === undefined ? "" : `r${col}-${row}`;
    },
    frame: (options = {}) => createFrame(options.bounds ?? bounds, { flat, scale, marginKm: options.marginKm ?? 0 }),
  };
};

// The side each region of an arena fights on, from who controls it on a sheet:
// 0 or 1 for a member of `sides[0]` or `sides[1]`, -1 for anyone else.
export const sideTable = (arena, world, sides) =>
  Int8Array.from(arena.ids, (id) => {
    const owner = world.controllerOf(id);
    return !owner ? -1 : sides[0].includes(owner) ? 0 : sides[1].includes(owner) ? 1 : -1;
  });

// What the engine is handed for a run on a sheet: one war between Aland and
// Borduria, two small states of equal strength (two dozen counters each),
// nothing ordered, thirty days. A test changes what it needs to.
export const frontInput = (world, overrides = {}) => {
  const days = overrides.days ?? 30;
  const fromDate = overrides.fromDate ?? "2024-03-01";
  return {
    battlefields: [],
    fromDate,
    toDate: addGameDays(fromDate, days) || fromDate,
    days,
    moments: [],
    wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
    controllerOf: world.controllerOf,
    sovereignOf: world.sovereignOf,
    groupAreas: {},
    isGroup: () => false,
    // (A test of something else leaves every side to the orders the test gives it: staff.js is tested by itself.)
    staff: false,
    // (And at the numbers of troops its figures were worked out at: twice the game's own, which were halved since.)
    troops: 2,
    units: [],
    map: world.map,
    regionTypes: [],
    strengthOf: () => 2,
    pace: 1,
    flipAllowance: null,
    seed: "a seed",
    arenas: new Map(),
    ...overrides,
  };
};

// Does to a sheet what the game does with a run's flips: each region that
// changed hands is given to who took it, and a group's area follows. Returns
// the group areas as they then stand.
export const applyFlips = (world, flips, groupAreas = {}) => {
  const areas = { ...groupAreas };
  for (const flip of flips) {
    if (flip.kind === "control") world.controller.set(flip.regionId, flip.to);
    else if (flip.kind === "groupTake") areas[flip.regionId] = flip.to;
    else if (flip.kind === "groupRelease") delete areas[flip.regionId];
  }
  return areas;
};

// A sheet from a picture alone: every letter of `picture` repeated `wide` times
// across and each line `tall` times down, so a test can draw countries as
// blocks of many small regions.
export const enlarge = (picture, wide, tall = wide) =>
  picture.flatMap((line) => Array.from({ length: tall }, () => [...line].map((letter) => letter.repeat(wide)).join("")));

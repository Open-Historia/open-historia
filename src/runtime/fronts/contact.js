/*! Open Historia — battlefields and fronts: where two sides at war touch © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield opens by itself wherever land held by the two sides of a war
// touches. Finding that is a question for the whole map, so it is asked
// cheaply: the boxes round each side's regions are compared, regions whose
// boxes meet are gathered into stretches of contact, and each stretch is given
// a frame: the box round every region of either side within reach of it. That
// is only a first guess, and a generous one: whether the two sides truly share
// a border there is settled when the frame's ground is drawn and the line is
// looked for (battle.js openBattle).
//
// Runs only when a war begins or changes, and needs the map's shapes.

import { CONTACT_WITHIN_KM, FRAME_MARGIN_KM } from "./constants.js";
import { createFrame, latToY, yToLat } from "./frame.js";
import { measureOptions } from "./worldGrid.js";

// Two boxes this near, in degrees, are taken to touch: shapes drawn by hand do
// not always share their border to the last digit.
const TOUCH_DEGREES = 0.02;

// The box round a region, [west, south, east, north] with east never below
// west (a region across the date line runs past 180). Worked out once a region.
const boxes = new WeakMap();
const boxOf = (region) => {
  const known = boxes.get(region);
  if (known) return known;
  let box = null;
  const stated = region.bbox;
  if (Array.isArray(stated) && stated.length >= 4 && stated.every((value) => Number.isFinite(Number(value)))) {
    box = [Number(stated[0]), Number(stated[1]), Number(stated[2]), Number(stated[3])];
    if (box[2] < box[0]) box[2] += 360;
  } else {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    const polygons = region.geometry?.type === "Polygon" ? [region.geometry.coordinates] : region.geometry?.type === "MultiPolygon" ? region.geometry.coordinates : [];
    for (const polygon of polygons) {
      for (const point of polygon?.[0] ?? []) {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
    if (west <= east && south <= north) {
      // Stored across the date line with nothing past 180: the narrow way round is the true one.
      box = east - west > 180 ? [east, south, west + 360, north] : [west, south, east, north];
    }
  }
  boxes.set(region, box ?? [0, 0, 0, 0]);
  return boxes.get(region);
};

// The boxes round the regions each side holds, every box as the copy of it
// nearest `around` (or nearest the first one found).
const boxesOfSides = (regions, sideOf, around = null) => {
  const held = [[], []];
  let middle = around;
  for (const region of Array.isArray(regions) ? regions : []) {
    const side = sideOf(String(region?.id ?? "").trim());
    if (side !== 0 && side !== 1) continue;
    const [west, south, east, north] = boxOf(region);
    if (west === east && south === north) continue;
    if (middle === null) middle = (west + east) / 2;
    const turn = Math.round(((west + east) / 2 - middle) / 360) * 360;
    held[side].push({ west: west - turn, south, east: east - turn, north });
  }
  return held;
};

// The box to lay a frame round a stretch of contact: round every region of
// either side within reach of it, held to that reach. null when there is none.
const boundsRound = (contact, held, map) => {
  // How many kilometres a degree of the map's plane is there: a frame laid on
  // the contact knows, so no angle is taken here.
  const probe = createFrame(contact, measureOptions(map));
  if (!probe) return null;
  const reach = CONTACT_WITHIN_KM / (probe.km / probe.cell);
  const west = contact.west - reach;
  const east = contact.east + reach;
  const south = yToLat(Math.max(latToY(-85), latToY(contact.south) - reach));
  const north = yToLat(Math.min(latToY(85), latToY(contact.north) + reach));
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const side of [0, 1]) {
    for (const box of held[side]) {
      if (box.west > east || box.east < west || box.south > north || box.north < south) continue;
      bounds.west = Math.min(bounds.west, Math.max(west, box.west));
      bounds.east = Math.max(bounds.east, Math.min(east, box.east));
      bounds.south = Math.min(bounds.south, Math.max(south, box.south));
      bounds.north = Math.max(bounds.north, Math.min(north, box.north));
    }
  }
  return bounds.east > bounds.west && bounds.north > bounds.south ? bounds : null;
};

// The box to lay a frame round a place where the two sides do not touch yet (a
// landing): the same reach, round a point. null when neither side is near.
export const contactAt = (regions, sideOf, map, lng, lat) => {
  const bounds = boundsRound({ west: lng - 0.05, south: lat - 0.05, east: lng + 0.05, north: lat + 0.05 }, boxesOfSides(regions, sideOf, lng), map);
  return bounds ? { bounds, lng, lat } : null;
};

// Where a named region is, as the middle of its box: [lng, lat].
export const middleOf = (region) => {
  const [west, south, east, north] = boxOf(region);
  return [(west + east) / 2, (south + north) / 2];
};

// Finds the stretches where the two sides of a war touch.
//   regions   the map's regions
//   sideOf    (regionId) => 0, 1, or -1 for a region neither side holds
//   map       the map's measure (worldGrid.js measureOptions)
// Returns [{ bounds: { west, south, east, north }, lng, lat }]: for each
// stretch the box to lay a frame round, and a point of the contact (to tell
// whether a battlefield already covers it). In the order the map lists the
// first region of each.
export const findContacts = (regions, sideOf, map) => {
  const held = boxesOfSides(regions, sideOf);
  if (held[0].length === 0 || held[1].length === 0) return [];

  // Regions of the two sides whose boxes meet, gathered into stretches.
  const parent = Array.from({ length: held[0].length + held[1].length }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const meeting = new Map();
  // Frozen water between them joins them too (climate.js; map.frozen, its regions' ids): the boxes of the
  // frozen water, those that touch made one, and every region of either side whose box touches one meets
  // every region of the other side's that does, there.
  const frozen = Array.isArray(map?.frozen) && map.frozen.length > 0 ? new Set(map.frozen) : null;
  if (frozen) {
    const ice = [];
    for (const region of Array.isArray(regions) ? regions : []) {
      if (!frozen.has(region?.id)) continue;
      const [west, south, east, north] = boxOf(region);
      if (east >= west && north >= south) ice.push({ west, south, east, north });
    }
    for (let joined = true; joined;) {
      joined = false;
      for (let one = 0; one < ice.length && !joined; one += 1) {
        for (let two = one + 1; two < ice.length && !joined; two += 1) {
          const [p, q] = [ice[one], ice[two]];
          if (p.west > q.east + TOUCH_DEGREES || q.west > p.east + TOUCH_DEGREES || p.south > q.north + TOUCH_DEGREES || q.south > p.north + TOUCH_DEGREES) continue;
          ice[one] = { west: Math.min(p.west, q.west), south: Math.min(p.south, q.south), east: Math.max(p.east, q.east), north: Math.max(p.north, q.north) };
          ice.splice(two, 1);
          joined = true;
        }
      }
    }
    const touching = (box, other) => !(box.west > other.east + TOUCH_DEGREES || other.west > box.east + TOUCH_DEGREES || box.south > other.north + TOUCH_DEGREES || other.south > box.north + TOUCH_DEGREES);
    for (const sheet of ice) {
      const ours = held[0].map((box, at) => (touching(box, sheet) ? at : -1)).filter((at) => at >= 0);
      const theirs = held[1].map((box, at) => (touching(box, sheet) ? at : -1)).filter((at) => at >= 0);
      for (const a of ours) {
        for (const b of theirs) {
          const rootA = find(a);
          const rootB = find(held[0].length + b);
          if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
          meeting.set(`${a}|${b}`, { a, west: sheet.west - TOUCH_DEGREES, south: sheet.south - TOUCH_DEGREES, east: sheet.east + TOUCH_DEGREES, north: sheet.north + TOUCH_DEGREES });
        }
      }
    }
  }
  for (let a = 0; a < held[0].length; a += 1) {
    const one = held[0][a];
    for (let b = 0; b < held[1].length; b += 1) {
      const other = held[1][b];
      if (one.west > other.east + TOUCH_DEGREES || other.west > one.east + TOUCH_DEGREES) continue;
      if (one.south > other.north + TOUCH_DEGREES || other.south > one.north + TOUCH_DEGREES) continue;
      const rootA = find(a);
      const rootB = find(held[0].length + b);
      if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
      // Where their boxes overlap is where they may touch.
      meeting.set(`${a}|${b}`, {
        a,
        west: Math.max(one.west, other.west) - TOUCH_DEGREES,
        south: Math.max(one.south, other.south) - TOUCH_DEGREES,
        east: Math.min(one.east, other.east) + TOUCH_DEGREES,
        north: Math.min(one.north, other.north) + TOUCH_DEGREES,
      });
    }
  }
  const stretches = new Map();
  for (const meet of meeting.values()) {
    const root = find(meet.a);
    const stretch = stretches.get(root);
    if (!stretch) stretches.set(root, { ...meet });
    else {
      stretch.west = Math.min(stretch.west, meet.west);
      stretch.south = Math.min(stretch.south, meet.south);
      stretch.east = Math.max(stretch.east, meet.east);
      stretch.north = Math.max(stretch.north, meet.north);
    }
  }

  const contacts = [];
  for (const root of [...stretches.keys()].sort((a, b) => a - b)) {
    const contact = stretches.get(root);
    const bounds = boundsRound(contact, held, map);
    if (bounds) contacts.push({ bounds, lng: (contact.west + contact.east) / 2, lat: (contact.south + contact.north) / 2 });
  }
  return contacts;
};

// The frame for a stretch of contact: its box with room round it.
export const frameForContact = (contact, map) =>
  createFrame(contact.bounds, { ...measureOptions(map), marginKm: FRAME_MARGIN_KM });

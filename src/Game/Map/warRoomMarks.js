/*! Open Historia — the war room's fortified lines and fleets as shapes for the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Besides its planned movements (warRoomGeometry.js), the war room marks on
// its map what it builds and what it sails (WarRoomMarks.jsx):
//
//   lines    every fortified line on the map (runtime/warGeography.js
//            fortifications): solid once it stands, broken while it is being
//            built, its colour and weight by its level; and the line the
//            player has drawn and not yet ordered built, dotted, in the colour
//            of the level picked for it
//   fleets   the player's fleets: a ring round each, brighter round the one
//            picked out; the ring of the station each is told to patrol; and
//            an arrow to where each is told to sail
//
// The colours are flat, one a level: brass for a palisade, deepening through
// amber and rust to red, and bone for a line nobody passes.
//
// Pure: it takes the world's records and gives GeoJSON, so it is tested without a map.

import { addGameDays, compareGameDates } from "../../runtime/gameDates.js";
import { arrowHead } from "./warRoomGeometry.js";
import { mapRing } from "../../../server/mapDistance.js";
import { currentMapMeasure } from "../../runtime/mapMeasure.js";

export const LINE_COLOURS = Object.freeze({ 3: "#d8c27a", 4: "#d9ad4f", 5: "#e09440", 6: "#e07a36", 7: "#d95f30", 8: "#c9452c", 9: "#b02d2a", 10: "#f4f7fb" });
export const FLEET_COLOURS = Object.freeze({ fleet: "#c9a54c", picked: "#e9b949", course: "#f4f7fb" });
// An air strike waiting is the accent's; one flown, by what came of it.
export const AIR_COLOURS = Object.freeze({ waiting: "#2bc1f3", reach: "#2bc1f3", hit: "#e0454d", partly: "#e09440", missed: "#9aa3ad" });
const RING_POINTS = 48;
const EARTH_KM = 6371;
const RAD = Math.PI / 180;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const placeOf = (point) => (Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) ? [Number(point[0]), Number(point[1])] : null);

// The colour of a line of a level (held to 3..10).
export const lineColour = (level) => LINE_COLOURS[Math.max(3, Math.min(10, Math.round(Number(level)) || 5))];

// Whether a line is still being built on a date: the engine's own rule (runtime/fronts/walls.js standsOn).
export const stillBuilding = (line, date) => {
  if (!line?.building) return false;
  const done = addGameDays(line.building.since, Math.max(0, Math.round(Number(line.building.days) || 0)));
  return !(done && compareGameDates(done, date) <= 0);
};

// The fortified lines, and the line drawn and not yet ordered built, as one GeoJSON collection.
//   lines    world.fortifications, as warGeography.js normalizeFortifications keeps them
//   draft    [[lng, lat]...] of the line drawn, or null; `level` the level picked for it
//   player   the player's country, whose own lines are marked so
//   date     the game's date, which says which lines stand
export const lineFeatures = ({ lines = [], draft = null, level = 5, player = "", date = "" } = {}) => {
  const features = [];
  for (const line of list(lines)) {
    const points = list(line?.points).map(placeOf).filter(Boolean);
    if (points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points },
      properties: {
        what: stillBuilding(line, date) ? "building" : "line",
        level: Math.round(Number(line.level)) || 5,
        colour: lineColour(line.level),
        own: Boolean(fold(player)) && fold(line.owner) === fold(player),
        label: clean(line.name),
      },
    });
  }
  const drawn = list(draft).map(placeOf).filter(Boolean);
  if (drawn.length >= 2) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: drawn }, properties: { what: "draft", level: Math.round(Number(level)) || 5, colour: lineColour(level), own: true, label: "" } });
  }
  return { type: "FeatureCollection", features };
};

// A ring of `km` round a place on the globe, as [lng, lat] points, closed.
export const ringAround = (lng, lat, km, points = RING_POINTS) => {
  // (A map that is not plain Mercator draws it by its own measure: server/mapDistance.js.)
  const measure = currentMapMeasure();
  if (!measure.plain) return mapRing(measure, lng, lat, Math.max(0, Number(km) || 0), points);
  const delta = Math.max(0, Number(km) || 0) / EARTH_KM;
  const phi = lat * RAD;
  const lambda = lng * RAD;
  const ring = [];
  for (let index = 0; index < points; index += 1) {
    const bearing = (index / points) * Math.PI * 2;
    const phi2 = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(bearing));
    const lambda2 = lambda + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(phi2));
    ring.push([lambda2 / RAD, phi2 / RAD]);
  }
  // (Closed on its very first point, not on one worked out again a turn later.)
  ring.push(ring[0]);
  return ring;
};

// The air strikes as the war room marks them, as one GeoJSON collection: how far the air unit picked out reaches
// from its base, every strike of the player's waiting (where its bombs will fall), and what the player's strikes of
// the last turn came to.
//   wing      the air unit picked out ({ lng, lat }), or null; reach, how far it reaches, in km
//   orders    the player's strikes waiting (runtime/fronts/airStrike.js normalizeAirStrikeOrders)
//   flown     the player's strikes of the last turn (normalizeAirStrikes)
//   blast     how far the bombs of one fall, in km
export const airFeatures = ({ wing = null, reach = 0, orders = [], flown = [], blast = 0 } = {}) => {
  const features = [];
  const base = wing ? placeOf([wing.lng, wing.lat]) : null;
  if (base && reach > 0) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ringAround(base[0], base[1], reach) }, properties: { what: "reach", colour: AIR_COLOURS.reach } });
  const ring = (lng, lat, what, colour) => {
    if (blast > 0) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ringAround(lng, lat, blast)] }, properties: { what, colour } });
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { what: `${what}-at`, colour } });
  };
  for (const order of list(orders)) if (placeOf([order?.lng, order?.lat])) ring(order.lng, order.lat, "aim", AIR_COLOURS.waiting);
  for (const strike of list(flown)) {
    if (!placeOf([strike?.lng, strike?.lat]) || strike.outcome === "gone" || strike.outcome === "out of reach") continue;
    const colour = strike.outcome === "turned back" ? AIR_COLOURS.missed : strike.outcome === "partly" ? AIR_COLOURS.partly : AIR_COLOURS.hit;
    ring(strike.lng, strike.lat, "struck", colour);
  }
  return { type: "FeatureCollection", features };
};

// The player's fleets, their stations and their courses, as one GeoJSON collection.
//   fleets   as runtime/naval/fleetOps.js fleetsOf lists them
//   picked   the id of the fleet picked out
export const fleetFeatures = ({ fleets = [], picked = "" } = {}) => {
  const features = [];
  for (const fleet of list(fleets)) {
    const at = placeOf([fleet?.lng, fleet?.lat]);
    if (!at) continue;
    const lit = Boolean(picked) && fleet.id === picked;
    const colour = lit ? FLEET_COLOURS.picked : FLEET_COLOURS.fleet;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { what: "fleet", fleet: fleet.id, lit, colour } });
    const order = fleet.order;
    if (!order || !Number.isFinite(order.toLng) || !Number.isFinite(order.toLat)) continue;
    if (order.kind === "patrol" && order.radiusKm > 0) {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ringAround(order.toLng, order.toLat, order.radiusKm) }, properties: { what: "station", fleet: fleet.id, lit, colour } });
      continue;
    }
    if (order.kind !== "move") continue;
    // (The short way round: a destination across the date line is taken from the fleet's side of it.)
    const to = [order.toLng + 360 * Math.round((at[0] - order.toLng) / 360), order.toLat];
    const way = [at, to];
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: way }, properties: { what: "course", fleet: fleet.id, lit, colour: FLEET_COLOURS.course } });
    const head = arrowHead(way);
    if (head) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [head] }, properties: { what: "head", fleet: fleet.id, lit, colour: FLEET_COLOURS.course } });
  }
  return { type: "FeatureCollection", features };
};

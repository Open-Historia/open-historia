/*! Open Historia — transporters as the map draws them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map draws of the world's transporters (runtime/fronts/transports.js):
// the way each is on, the carrier itself where it has got to, a mark where one
// was lost, and, while the war room is open, the player's own that have not
// set out yet, with the way found for each (or, until it is found, a straight
// line to where it was sent).
//
// Pure: geometry out of records. The layers are TransportLayers.jsx.

import { unwrapLng } from "../../runtime/fronts/frame.js";
import { TRANSPORT_ENDED, loadOf } from "../../runtime/fronts/transports.js";
import { placeAlong } from "../../runtime/fronts/worldGrid.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const collection = (features) => ({ type: "FeatureCollection", features });
export const EMPTY_TRANSPORT_FEATURES = Object.freeze({ ways: collection([]), points: collection([]) });

// Whose a transporter is, to whoever looks at the map: "own", "enemy" or "other".
export const transportTone = (transport, viewer, enemies = []) => {
  if (fold(viewer) && fold(transport?.owner) === fold(viewer)) return "own";
  return list(enemies).some((name) => fold(name) === fold(transport?.owner)) ? "enemy" : "other";
};
export const transportIconId = (medium, tone) => `transport-${medium}-${tone}`;

// A way as one unbroken line: a longitude follows the one before it, so that a
// way across the date line is not drawn back round the world.
const lineOf = (way) => {
  const points = [];
  let before = null;
  for (const point of list(way)) {
    const lng = before === null ? Number(point?.[0]) : unwrapLng(Number(point?.[0]), before);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    points.push([lng, lat]);
    before = lng;
  }
  return points;
};

//   transports   world.transports
//   viewer       the country the player plays
//   enemies      who is at war with it
//   shown        Map of transporter id to the kilometres it is DRAWN at, while
//                a turn that has just landed is being played (TransportLayers.jsx)
//   planned      true while the war room is open: the player's own that are
//                ordered and not out are drawn too
//   previews     { [id]: { way, from } }: the way found for each of those
// Returns { ways, points }: two feature collections.
export const transportFeatures = ({ transports = [], viewer = "", enemies = [], shown = null, planned = false, previews = null, flat = false, scale } = {}) => {
  const ways = [];
  const points = [];
  for (const transport of list(transports)) {
    if (!transport?.id || !transport.to) continue;
    const tone = transportTone(transport, viewer, enemies);
    const base = { id: transport.id, tone, medium: transport.medium, icon: transportIconId(transport.medium, tone), count: String(loadOf(transport) || "") };
    const playing = shown instanceof Map && shown.has(transport.id);
    if (transport.status === "ordered") {
      if (!planned || tone !== "own") continue;
      const preview = previews?.[transport.id] ?? null;
      const from = list(preview?.from).length === 2 ? preview.from : null;
      const end = Number.isFinite(transport.to.lng) ? [transport.to.lng, transport.to.lat] : null;
      const way = list(preview?.way).length > 1 ? lineOf(preview.way) : from && end ? lineOf([from, end]) : [];
      if (way.length > 1) ways.push({ type: "Feature", properties: { ...base, what: "plan", found: list(preview?.way).length > 1 }, geometry: { type: "LineString", coordinates: way } });
      const at = way.length > 1 ? way[way.length - 1] : end;
      if (at) points.push({ type: "Feature", properties: { ...base, what: "plan", bearing: 0 }, geometry: { type: "Point", coordinates: at } });
      continue;
    }
    const way = lineOf(transport.way);
    const ended = TRANSPORT_ENDED.includes(transport.status);
    // The way of one that has ended stays, fainter, for as long as the world keeps it: where it went.
    if (way.length > 1) ways.push({ type: "Feature", properties: { ...base, what: ended ? "wake" : "way" }, geometry: { type: "LineString", coordinates: way } });
    if (way.length > 1 && (transport.status === "moving" || playing)) {
      const place = placeAlong(transport.way, playing ? shown.get(transport.id) : transport.gone, { flat, scale });
      if (place) points.push({ type: "Feature", properties: { ...base, what: "carrier", bearing: Math.round(place.bearing) }, geometry: { type: "Point", coordinates: [unwrapLng(place.lng, way[0][0]), place.lat] } });
    } else if (transport.status === "lost" && list(transport.at).length === 2) {
      points.push({ type: "Feature", properties: { ...base, what: "lost", bearing: 0 }, geometry: { type: "Point", coordinates: [unwrapLng(transport.at[0], way[0]?.[0] ?? transport.at[0]), transport.at[1]] } });
    }
  }
  return { ways: collection(ways), points: collection(points) };
};

// What a turn that has just landed moved, from the transporters as they were
// and as they are: for each that went further, where it was drawn before and
// where it is to be drawn now, and how many days that took it.
// Returns [{ id, from, to, days }].
export const transportMoves = (before, after) => {
  const was = new Map(list(before).map((entry) => [entry?.id, entry]));
  const moves = [];
  for (const transport of list(after)) {
    if (!transport?.id || list(transport.way).length < 2 || transport.status === "ordered") continue;
    const old = was.get(transport.id);
    const from = old && old.status !== "ordered" ? Number(old.gone) || 0 : 0;
    const to = Number(transport.gone) || 0;
    if (!(to > from + 1)) continue;
    moves.push({ id: transport.id, from, to, days: Math.max(1, Math.ceil((to - from) / Math.max(1, Number(transport.speed) || 1))) });
  }
  return moves;
};

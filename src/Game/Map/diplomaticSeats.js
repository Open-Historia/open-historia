/*! Open Historia — where the diplomatic map's lines start and end © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Relations view draws thin lines from the focus country's capital to its
// allies' and enemies' (DiplomaticLayers.jsx). A country's seat is its
// capital among the map's cities (the cities file's `capital` mark, as the
// city layers star them), the most populous where it holds several; a country
// whose land has none is seated at the middle of its largest region.
//
// Which country a capital is in is the region whose box holds it, the
// smallest such box where several do: no geometry is kept on this thread.
//
// Pure: Nations.jsx gives it the cities (runtime/frontCities.js) and the
// regions' compact records (the regions worker's metadata).

import { diplomaticKeyOf } from "../../runtime/diplomaticStance.js";

const boxHolds = (bounds, lng, lat) => {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[west, south], [east, north]] = bounds;
  if (!(lat >= south && lat <= north)) return false;
  return (lng >= west && lng <= east) || (lng + 360 >= west && lng + 360 <= east);
};
const boxArea = (bounds) => Math.max(1e-9, (bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1]));

/**
 * @param cities   [{ name, lng, lat, capital, population }]
 * @param records  [{ id, bounds, lng, lat, territoryWeight }]
 * @param ownerOf  (regionId) => owner name
 * @returns Map<country key, { lng, lat, name }>
 */
export const seatsByCountry = ({ cities = [], records = [], ownerOf = () => "" } = {}) => {
  const seats = new Map();
  const best = new Map();
  for (const city of cities) {
    if (!city?.capital) continue;
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    let holder = null;
    for (const record of records) {
      if (!boxHolds(record?.bounds, lng, lat)) continue;
      if (!holder || boxArea(record.bounds) < boxArea(holder.bounds)) holder = record;
    }
    const key = holder ? diplomaticKeyOf(ownerOf(String(holder.id))) : "";
    if (!key) continue;
    if(city.capitalOwner&&diplomaticKeyOf(city.capitalOwner)!==key)continue;
    const candidate={priority:city.capitalOwner?1:0,population:Number(city.population)||0};
    const previous=best.get(key);
    if(previous&&(previous.priority>candidate.priority||(previous.priority===candidate.priority&&previous.population>=candidate.population)))continue;
    best.set(key,candidate);
    seats.set(key, { lng, lat, name: String(city.name ?? "") });
  }
  // Countries with no capital on the map: the middle of their largest region.
  const largest = new Map();
  for (const record of records) {
    const key = diplomaticKeyOf(ownerOf(String(record?.id ?? "")));
    if (!key || seats.has(key)) continue;
    if (!Number.isFinite(record?.lng) || !Number.isFinite(record?.lat)) continue;
    const weight = Number(record.territoryWeight) || 0;
    if (!largest.has(key) || largest.get(key).weight < weight) largest.set(key, { weight, lng: record.lng, lat: record.lat });
  }
  for (const [key, { lng, lat }] of largest) seats.set(key, { lng, lat, name: "" });
  return seats;
};

// A great circle between two points, as `steps` segments, its longitudes kept
// continuous across the date line so the line takes the short way round.
export const greatCircle = (from, to, steps = 48) => {
  const rad = Math.PI / 180;
  const [lng1, lat1] = [from.lng * rad, from.lat * rad];
  const [lng2, lat2] = [to.lng * rad, to.lat * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2));
  if (!Number.isFinite(d) || d < 1e-6) return [[from.lng, from.lat], [to.lng, to.lat]];
  const points = [];
  let previous = null;
  for (let step = 0; step <= steps; step += 1) {
    const f = step / steps;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
    const y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    let lng = Math.atan2(y, x) / rad;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / rad;
    if (previous !== null) {
      while (lng - previous > 180) lng -= 360;
      while (lng - previous < -180) lng += 360;
    }
    previous = lng;
    points.push([lng, lat]);
  }
  return points;
};

// The lines' features for a view's `lines` ({ kind, from, to }, owner names).
export const diplomaticLineFeatures = (lines, seats) => {
  const features = [];
  const seatOf = (name) => seats.get(diplomaticKeyOf(name));
  for (const line of lines ?? []) {
    const from = seatOf(line.from);
    const to = seatOf(line.to);
    if (!from || !to) continue;
    features.push({
      type: "Feature",
      properties: { kind: line.kind, to: line.to },
      geometry: { type: "LineString", coordinates: greatCircle(from, to) },
    });
  }
  return { type: "FeatureCollection", features };
};

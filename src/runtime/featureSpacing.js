/*! Open Historia — keeping counters and structures off each other © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Three armies are ordered to Kharkiv and a base is built there: four things at
// one point, drawn as one. The player sees a single counter, clicks it, and gets
// whichever happened to be on top. Nothing was wrong with any of the four
// placements; they just were not told about each other.
//
// spaceOut takes the point a thing WANTS and the things already standing, and
// finds the nearest spot where it fits. Each thing has a footprint (a radius on
// the ground, sized so counters read as separate at the zoom a theatre is played
// at). The search walks outward on a golden-angle spiral — each step a little
// further out and turned by ~137.5 degrees, so the ring is filled evenly rather
// than in a line — and takes the first spot that touches nothing. A spot that
// would leave the thing's own region (`inside`) is pulled back along the line to
// where it started until it is inside again, so an army spaced off its neighbour
// never ends up across a border or in the sea. If nowhere is clear, the least
// crowded spot found is used: a little overlap beats a wrong country.
//
// DELIBERATELY IMPORT-FREE, like unitMotion.js, but for the map's measure
// (runtime/mapMeasure.js): on a map that is not plain Mercator a footprint is
// measured as the map measures. Deterministic: the same inputs give the same point.

import { kmPerDegreeAt, mapKm } from "../../server/mapDistance.js";
import { currentMapMeasure } from "./mapMeasure.js";

// Radius on the ground, km. A unit counter is ~11 px at zoom 6, which at the
// latitudes most campaigns are fought in is about this much ground.
export const FOOTPRINT_KM = Object.freeze({ unit: 16, marker: 10 });
// Footprints may not quite touch.
export const SPACING_PADDING = 1.12;
export const SPACING_MAX_STEPS = 72;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat) => 111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));

const asArray = (value) => (Array.isArray(value) ? value : []);
const round = (value) => Number(Number(value).toFixed(5));
// A real number, or text that is one. Number(null) and Number("") are 0, and a
// unit with no longitude is not standing on the Greenwich meridian.
const finite = (value) => (typeof value === "number" ? Number.isFinite(value)
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));

const separationKm = (a, b) => {
    const measure = currentMapMeasure();
    if (!measure.plain) return mapKm(measure, a.lng, a.lat, b.lng, b.lat);
    let dLng = Math.abs(a.lng - b.lng);
    if (dLng > 180) dLng = 360 - dLng;
    return Math.hypot(dLng * kmPerDegLng((a.lat + b.lat) / 2), (a.lat - b.lat) * KM_PER_DEG_LAT);
};

// How badly a spot is crowded: 0 when it touches nothing, otherwise the sum of
// how far each neighbour intrudes.
export const crowding = (point, radiusKm, obstacles) => asArray(obstacles).reduce((total, obstacle) => {
    const room = (radiusKm + (Number(obstacle.radiusKm) || 0)) * SPACING_PADDING;
    const gap = separationKm(point, obstacle);
    return gap < room ? total + (room - gap) : total;
}, 0);

// { lng, lat, moved, clear } — `clear` is false when nowhere free was found.
export const spaceOut = ({ lng, lat, radiusKm = FOOTPRINT_KM.unit, obstacles = [], inside = null } = {}) => {
    if (!finite(lng) || !finite(lat)) return { lng, lat, moved: false, clear: false };
    const origin = { lng: Number(lng), lat: Number(lat) };
    const others = asArray(obstacles).filter((obstacle) => finite(obstacle?.lng) && finite(obstacle?.lat));
    if (!others.length || crowding(origin, radiusKm, others) === 0) return { ...origin, moved: false, clear: true };

    const stays = typeof inside === "function" ? inside : null;
    // Only hold it to a region it started in: a thing placed at sea is not dragged ashore.
    const bounded = stays ? Boolean(stays(origin)) : false;
    let best = origin; let bestCrowding = crowding(origin, radiusKm, others);

    const measure = currentMapMeasure();
    const per = measure.plain ? { x: kmPerDegLng(origin.lat), y: KM_PER_DEG_LAT } : kmPerDegreeAt(measure, origin.lng, origin.lat);
    for (let step = 1; step <= SPACING_MAX_STEPS; step += 1) {
        const reach = Math.sqrt(step) * radiusKm * SPACING_PADDING;
        const angle = step * GOLDEN_ANGLE;
        let candidate = {
            lng: origin.lng + (Math.cos(angle) * reach) / per.x,
            lat: Math.max(-89.9, Math.min(89.9, origin.lat + (Math.sin(angle) * reach) / per.y)),
        };
        if (bounded && !stays(candidate)) {
            // Walk back toward where it started until it is inside again.
            let near = 0; let far = 1;
            for (let pass = 0; pass < 9; pass += 1) {
                const mid = (near + far) / 2;
                const probe = { lng: origin.lng + (candidate.lng - origin.lng) * mid, lat: origin.lat + (candidate.lat - origin.lat) * mid };
                if (stays(probe)) near = mid; else far = mid;
            }
            candidate = { lng: origin.lng + (candidate.lng - origin.lng) * near, lat: origin.lat + (candidate.lat - origin.lat) * near };
        }
        const score = crowding(candidate, radiusKm, others);
        if (score === 0) return { lng: round(candidate.lng), lat: round(candidate.lat), moved: true, clear: true };
        if (score < bestCrowding) { bestCrowding = score; best = candidate; }
    }
    return { lng: round(best.lng), lat: round(best.lat), moved: best !== origin, clear: false };
};

// Everything already standing in a world, as obstacles. `except` leaves out the
// thing being placed (a unit that moves must not dodge itself).
export const obstaclesOf = (world, { except = "" } = {}) => [
    ...asArray(world?.units).filter((unit) => finite(unit?.lng) && finite(unit?.lat) && unit.id !== except)
        .map((unit) => ({ id: unit.id, lng: Number(unit.lng), lat: Number(unit.lat), radiusKm: FOOTPRINT_KM.unit })),
    ...asArray(world?.markers).filter((marker) => finite(marker?.lng) && finite(marker?.lat) && marker.id !== except)
        .map((marker) => ({ id: marker.id, lng: Number(marker.lng), lat: Number(marker.lat), radiusKm: FOOTPRINT_KM.marker })),
];

/*! Open Historia — unit motion, reach & detection math © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Deterministic movement for map units — the reason a fleet sent to the
// Atlantic visibly crosses it over several turns instead of teleporting, and
// keeps working its station afterwards, without costing a single token.
//
// DELIBERATELY IMPORT-FREE. gameState.js pulls in assets.js, which imports
// maplibre-gl, so `node --test src/runtime/gameState.*.test.js` cannot even
// load without a full install. Keeping this file dependency-free (the same
// trick GameUI/eventFocus.js uses) means its tests run in a bare checkout.
// gameState.js re-exports haversineKm from here, so nothing else has to know.

// ---- geometry --------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

// Great-circle distance in km. Moved here from gameState.js (which now
// re-exports it) so the repo carries ONE haversine instead of the two it had —
// gameState's copy and unitCombat.js's `distanceKm` were the same function.
export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad((lat2 ?? 0) - (lat1 ?? 0));
  const dLng = toRad((lng2 ?? 0) - (lng1 ?? 0));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1 ?? 0)) * Math.cos(toRad(lat2 ?? 0)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
};

const wrapLng = (lng) => {
  let value = lng;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
};

const clampLat = (lat) => Math.max(-85, Math.min(85, lat));

// ---- seeded randomness -----------------------------------------------------

// xmur3, salvaged from the deleted unitCombat.js. Same string always yields the
// same uint32, which is what makes patrol drift reproducible across reloads.
export const hashSeed = (text) => {
  const str = String(text ?? "");
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
};

// ---- pace ------------------------------------------------------------------

// Sustained OPERATIONAL pace in km/day at a post-1945 baseline — what a
// formation actually covers day after day, not its dash speed. Garrisons are 0
// because they are fixed by definition (buildMilitaryFeasibilityText already
// tells the model as much).
const KM_PER_DAY = {
  garrison: 0,
  artillery: 35,
  infantry: 40,
  armor: 90,
  naval: 600,
  air: 2000,
};

// Logistics scale with the era: a 1200 BC army does not march like 1944.
// Same year/BCE parsing as the deleted unitCombat.js's eraReachFactor, retuned
// for sustained pace rather than strike reach.
export const eraSpeedFactor = (gameDate) => {
  const text = String(gameDate ?? "");
  const match = /(-?\d{3,4})/.exec(text);
  const bce = /BC|BCE/i.test(text);
  const year = match ? Number(match[1]) * (bce ? -1 : 1) : 2000;
  if (year < 1500) return 0.35;
  if (year < 1850) return 0.5;
  if (year < 1945) return 0.75;
  return 1;
};

export const kmPerDay = (type, gameDate) =>
  Math.round((KM_PER_DAY[type] ?? 40) * eraSpeedFactor(gameDate));

export const maxTravelKm = (type, gameDate, days) =>
  kmPerDay(type, gameDate) * Math.max(0, Number(days) || 0);

// Whole days between two YYYY-MM-DD dates, or null when either side is not a
// plain Gregorian date ("1200 BCE", "Third Age 3019"). null means "do not clamp":
// a fantasy or ancient scenario must never freeze because its dates don't parse.
export const daysBetweenDates = (from, to) => {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
    if (!match) return null;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(time) ? time : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
};

// ---- movement --------------------------------------------------------------

// Step `from` toward `to` by at most maxKm along the great circle.
//
// This SLERPs rather than lerping the coordinates. Interpolating longitude
// linearly tears at the antimeridian: a fleet ordered Yokosuka -> San Diego
// would track backwards across Eurasia instead of over the Pacific.
export const stepToward = (from, to, maxKm) => {
  const fromLat = Number(from?.lat) || 0;
  const fromLng = Number(from?.lng) || 0;
  const toLat = Number(to?.lat) || 0;
  const toLng = Number(to?.lng) || 0;

  const distance = haversineKm(fromLat, fromLng, toLat, toLng);
  if (distance <= 0) {
    return { lng: wrapLng(toLng), lat: clampLat(toLat), arrived: true, remainingKm: 0 };
  }
  const budget = Math.max(0, Number(maxKm) || 0);
  if (budget <= 0) {
    return { lng: wrapLng(fromLng), lat: clampLat(fromLat), arrived: false, remainingKm: distance };
  }
  if (budget >= distance) {
    return { lng: wrapLng(toLng), lat: clampLat(toLat), arrived: true, remainingKm: 0 };
  }

  const omega = distance / EARTH_RADIUS_KM;
  const sinOmega = Math.sin(omega);
  const t = budget / distance;

  const unit = (lat, lng) => {
    const phi = toRad(lat);
    const lambda = toRad(lng);
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };
  const a = unit(fromLat, fromLng);
  const b = unit(toLat, toLng);

  // Guard the antipodal case: sin(omega) -> 0 makes the slerp weights blow up.
  const wa = sinOmega === 0 ? 1 - t : Math.sin((1 - t) * omega) / sinOmega;
  const wb = sinOmega === 0 ? t : Math.sin(t * omega) / sinOmega;

  const x = a[0] * wa + b[0] * wb;
  const y = a[1] * wa + b[1] * wb;
  const z = a[2] * wa + b[2] * wb;

  return {
    lng: wrapLng(toDeg(Math.atan2(y, x))),
    lat: clampLat(toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))),
    arrived: false,
    remainingKm: distance - budget,
  };
};

// ---- patrol ----------------------------------------------------------------

// How wide a station each type works when the model says posture "patrol" and
// names no radius of its own.
export const DEFAULT_PATROL_RADIUS_KM = {
  garrison: 0,
  artillery: 25,
  infantry: 40,
  armor: 60,
  naval: 250,
  air: 300,
};

// A point on the unit's station, derived purely from the seed. Same seed always
// gives the same point, so re-reading world.json never jitters the map and the
// staged event reveal reproduces a patrol exactly. Callers seed with
// `${unit.id}|${round}|${tick}` so the position changes per turn and per idle
// pulse, but never at random.
export const patrolPoint = (station, radiusKm, seed) => {
  const centreLat = Number(station?.lat) || 0;
  const centreLng = Number(station?.lng) || 0;
  const radius = Math.max(0, Number(radiusKm) || 0);
  if (radius <= 0) {
    return { lng: wrapLng(centreLng), lat: clampLat(centreLat) };
  }

  const hash = hashSeed(seed);
  const bearing = ((hash % 3600) / 3600) * Math.PI * 2;
  // Bias outward (0.55..1.0 of the radius) so a patrol reads as working its
  // station rather than loitering on top of the centre point.
  const spread = 0.55 + ((Math.floor(hash / 3600) % 1000) / 1000) * 0.45;

  // Great-circle destination from (centre, bearing, distance). Offsetting the
  // degrees flat-earth style instead looks fine near the equator but overshoots
  // badly at high latitude — an Arctic station would smear its patrol hundreds
  // of km past the radius — so do the spherical trig and be exactly on station.
  const delta = (radius * spread) / EARTH_RADIUS_KM;
  const phi1 = toRad(centreLat);
  const lambda1 = toRad(centreLng);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearing),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return { lng: wrapLng(toDeg(lambda2)), lat: clampLat(toDeg(phi2)) };
};
